import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderHealth, ProviderId } from '../types';
import { admitCircuitRequest, circuitSnapshot, recordCircuitFailure, recordCircuitSuccess, releaseCircuitProbe } from './circuit-breaker';
import { admitProviderRequest, type ProviderBudgetPolicy, type RequestPriority } from './quota-manager';
import { ProviderError, type MarketDataProvider } from './types';

interface InMemoryHealth {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  errorCount: number;
}

// Module-scope (isolate-lifetime, best-effort) health bookkeeping - reset on
// cold start. Deliberately NOT written to KV on every request (that would
// burn through KV's daily write quota under real traffic for no functional
// benefit); the manager's own failover decisions only need the CURRENT
// isolate's view, and /api/mkr/market/health does a live probe anyway (see
// [MarketProviderManager.healthSnapshot]).
const memoryHealth = new Map<ProviderId, InMemoryHealth>();

function healthEntry(id: ProviderId): InMemoryHealth {
  let entry = memoryHealth.get(id);
  if (!entry) {
    entry = { lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, errorCount: 0 };
    memoryHealth.set(id, entry);
  }
  return entry;
}

function recordSuccess(id: ProviderId): void {
  healthEntry(id).lastSuccessAt = Date.now();
}

function recordFailure(id: ProviderId, message: string): void {
  const entry = healthEntry(id);
  entry.lastErrorAt = Date.now();
  entry.lastErrorMessage = message;
  entry.errorCount += 1;
}

/** Test-only: clears in-memory health state between test cases. */
export function _resetHealthForTests(): void {
  memoryHealth.clear();
}

export interface ProviderBudgets {
  twelveData: ProviderBudgetPolicy;
  alpaca: ProviderBudgetPolicy;
}

function budgetErrorFor(tier: string): ProviderError {
  return new ProviderError(`Provider request budget exceeded (tier: ${tier})`, 'rate_limit');
}

/**
 * Server-side failover engine - the direct architectural counterpart of
 * Flutter Phase 1's `MarketProviderManager`
 * (lib/features/markets/data/market_provider_manager.dart), and of
 * `auc-backend`'s `crypto-providers/registry.ts` fallback pattern.
 *
 * Critical rule: failover only happens once a provider is CONFIRMED
 * unhealthy via [MarketDataProvider.healthCheck] - never merely because one
 * request happened to fail, and never because a healthy provider returned
 * an empty/no-data result (that is surfaced as `null`, not an exception -
 * see [MarketDataProvider.getQuote]).
 *
 * Final Production Task: once a provider IS confirmed unhealthy, a circuit
 * breaker (circuit-breaker.ts) trips for it - subsequent requests within
 * the backoff window skip contacting that provider entirely (no request,
 * no extra healthCheck probe, avoiding both a failover storm and needless
 * quota spend on a known-down provider) and go straight to whatever
 * fallback exists. The single-failure "confirmed unhealthy" determination
 * itself is unchanged - the breaker only takes over for what happens
 * AFTER that determination, never replaces it.
 *
 * Final Edit Task (Finding 1): the breaker's half-open recovery window
 * admits exactly ONE trial request, claimed atomically via
 * `admitCircuitRequest` - every call site below checks `admission.allowed`
 * before doing anything else, and a caller that claims the trial
 * (`admission.isProbe`) but then aborts before actually contacting the
 * provider (no symbol mapping, or a quota denial) must release the claim
 * via `releaseCircuitProbe` so it isn't wasted.
 *
 * Final Edit Task (Finding 2): the secondary provider now gets the SAME
 * confirmed-unhealthy treatment as the primary - a secondary request
 * failure only trips its circuit once the secondary's own `healthCheck()`
 * confirms it, or the failure was itself the half-open trial (which is
 * its own confirmation). A transient secondary error still propagates
 * (there is no further fallback), but no longer needlessly disables
 * Alpaca for a one-off blip.
 *
 * Final Edit Task 2: `healthCheck()` makes a REAL provider REST call, the
 * same as any other provider method - Mac's follow-up review found that
 * the confirmation probe above called it directly, bypassing quota
 * admission entirely (the call WAS still counted, via the provider's own
 * `request()` choke point, but never ADMITTED first). `confirmUnhealthy`
 * is now the only way this class calls `healthCheck()` for a failover
 * confirmation - it performs the SAME P4 admission check `healthSnapshot`
 * already did, before ever touching the provider. If that admission is
 * denied, the provider is not contacted a second time, and - critically -
 * the circuit is NOT tripped, since an outage that was never actually
 * re-confirmed must never be treated as confirmed (same "never fabricate
 * health data" principle `healthSnapshot` already follows for a
 * budget-denied probe). The half-open trial path is unaffected - it never
 * called `healthCheck()` in the first place (the trial request itself IS
 * the confirmation), so there is nothing to admit there.
 *
 * Task 6: every actual provider call in this class is now gated by the
 * centralized quota guard (quota-manager.ts) - this is the ONE place
 * that gate is enforced, so no caller can bypass it by going around this
 * manager. A provider whose budget denies a request is treated like an
 * unavailable provider for THIS call only (falls through to the
 * secondary, if any, which has its own independent budget) - it is never
 * marked unhealthy for a budget denial, since the provider itself was
 * never even contacted.
 *
 * Task 6 review correction: this manager only CHECKS admission
 * (`admitProviderRequest`) - it deliberately does NOT record usage
 * itself anymore. A single manager-level call (e.g. getBatchQuotes) can
 * fan out into an arbitrary number of REAL upstream REST requests inside
 * the provider implementation (Twelve Data chunks into groups of 8;
 * Alpaca issues one request per symbol) - recording once per manager
 * call undercounted those. Each concrete provider (twelve-data-provider.ts,
 * alpaca-provider.ts) now records its OWN usage at its one true low-level
 * `request()` choke point, so the count always matches the real number of
 * HTTP requests made, however many that turns out to be. The admission
 * decision stays centralized here (still the one place a caller cannot
 * bypass); only the recording of ground truth moved to where that truth
 * actually lives.
 */
export class MarketProviderManager {
  constructor(
    private readonly primary: MarketDataProvider | null,
    private readonly secondary: MarketDataProvider | null,
    private readonly secondaryEnabled: boolean,
    private readonly budgets: ProviderBudgets,
  ) {}

  private budgetFor(id: ProviderId): ProviderBudgetPolicy {
    return id === 'twelve_data' ? this.budgets.twelveData : this.budgets.alpaca;
  }

  /**
   * Admission CHECK only - never records usage itself (see class doc's
   * Task 6 review correction). A denied decision means the caller must
   * not touch the network at all; an allowed decision is a green light to
   * proceed, and whatever real REST calls that ends up making will record
   * themselves at their own source.
   */
  private admit(id: ProviderId, priority: RequestPriority) {
    return admitProviderRequest(id, priority, this.budgetFor(id));
  }

  /**
   * Final Edit Task 2 - the ONLY path this class uses to call
   * `healthCheck()` for a failover confirmation (i.e. NOT the half-open
   * trial path, which never calls `healthCheck()` at all). Performs a P4
   * quota admission BEFORE contacting the provider a second time - a
   * confirmation probe is exactly the kind of "optional/background" work
   * P4 exists for, and it must obey the same budget/shedding rules as any
   * other real provider call. Never records usage itself; the provider's
   * own `request()` choke point still does that, exactly once, only if
   * admission allowed the call to actually happen.
   *
   * Returns `'unknown'` (never contacted, nothing learned) when admission
   * is denied - callers must treat this the same as a NOT-yet-confirmed
   * outage: never trip the circuit, since that would fabricate a health
   * verdict for a provider that was never actually re-checked.
   */
  private async confirmUnhealthy(id: ProviderId, provider: MarketDataProvider): Promise<'healthy' | 'unhealthy' | 'unknown'> {
    const decision = this.admit(id, 'P4');
    if (!decision.allowed) return 'unknown';
    const probe = await provider.healthCheck();
    return probe.healthy ? 'healthy' : 'unhealthy';
  }

  private async withFailover<T>(
    call: (provider: MarketDataProvider, providerSymbol: string) => Promise<T>,
    symbolFor: (id: ProviderId) => string | null,
    priority: RequestPriority,
  ): Promise<{ result: T; source: ProviderId }> {
    let budgetDeniedTier: string | null = null;

    if (this.primary) {
      const admission = admitCircuitRequest(this.primary.id);
      if (admission.allowed) {
        const symbol = symbolFor(this.primary.id);
        if (symbol) {
          const decision = this.admit(this.primary.id, priority);
          if (decision.allowed) {
            try {
              const result = await call(this.primary, symbol);
              recordSuccess(this.primary.id);
              recordCircuitSuccess(this.primary.id);
              return { result, source: this.primary.id };
            } catch (err) {
              recordFailure(this.primary.id, (err as Error).message);
              if (admission.isProbe) {
                // The half-open trial's own outcome IS the confirmation -
                // no separate healthCheck needed (would just double-spend
                // quota to re-ask a question this attempt already answered).
                recordCircuitFailure(this.primary.id);
              } else {
                const confirmation = await this.confirmUnhealthy(this.primary.id, this.primary);
                if (confirmation !== 'unhealthy') {
                  // 'healthy' - confirmed still reachable, a one-off/
                  // transient fault, not a genuine outage. 'unknown' - the
                  // confirmation probe itself was budget-denied, so nothing
                  // was actually learned - never trip the circuit on an
                  // UNVERIFIED outage. Either way: do not fail over; propagate.
                  throw err;
                }
                recordCircuitFailure(this.primary.id); // confirmed unhealthy - trip/extend the breaker
              }
              // Confirmed unhealthy either way - fall through to the secondary below.
            }
          } else {
            if (admission.isProbe) releaseCircuitProbe(this.primary.id); // claimed but never attempted - free the slot
            budgetDeniedTier = decision.tier; // never contacted primary at all - not a health event
          }
        } else if (admission.isProbe) {
          releaseCircuitProbe(this.primary.id); // no symbol mapping - never attempted, free the slot
        }
      }
    }

    if (this.secondaryEnabled && this.secondary) {
      const admission = admitCircuitRequest(this.secondary.id);
      if (admission.allowed) {
        const symbol = symbolFor(this.secondary.id);
        if (symbol) {
          const decision = this.admit(this.secondary.id, priority);
          if (decision.allowed) {
            try {
              const result = await call(this.secondary, symbol);
              recordSuccess(this.secondary.id);
              recordCircuitSuccess(this.secondary.id);
              return { result, source: this.secondary.id };
            } catch (err) {
              recordFailure(this.secondary.id, (err as Error).message);
              // Finding 2: the secondary gets the SAME confirmed-unhealthy
              // treatment as the primary - a transient error must not
              // needlessly trip the circuit and disable Alpaca. There is no
              // further fallback either way, so the real error always
              // propagates - only whether the circuit trips differs.
              if (admission.isProbe) {
                recordCircuitFailure(this.secondary.id);
              } else {
                const confirmation = await this.confirmUnhealthy(this.secondary.id, this.secondary);
                if (confirmation === 'unhealthy') recordCircuitFailure(this.secondary.id);
                // 'healthy' or 'unknown' (budget-denied confirmation): never
                // trip the circuit on an unverified outage - same rule as primary.
              }
              throw err;
            }
          } else {
            if (admission.isProbe) releaseCircuitProbe(this.secondary.id);
            budgetDeniedTier = decision.tier;
          }
        } else if (admission.isProbe) {
          releaseCircuitProbe(this.secondary.id);
        }
      }
    }

    if (budgetDeniedTier) throw budgetErrorFor(budgetDeniedTier);
    throw new ProviderError('No healthy provider available for this symbol', 'unknown');
  }

  getQuote(mkrSymbol: string, symbolFor: (id: ProviderId) => string | null, priority: RequestPriority = 'P1') {
    return this.withFailover<NormalizedQuote | null>((provider, symbol) => provider.getQuote(symbol, mkrSymbol), symbolFor, priority);
  }

  /**
   * One upstream call for many symbols instead of N - see the interface
   * doc comment on [MarketDataProvider.getBatchQuotes] for why this exists
   * (Twelve Data Free's rate limit is exhausted almost immediately by N
   * concurrent individual quote calls for one client's full catalog load).
   * Same failover discipline as [withFailover]: only falls to secondary
   * after the primary throws AND a healthCheck confirms it's genuinely
   * down, never merely because some symbols in the batch came back null.
   */
  async getBatchQuotes(
    mkrSymbols: string[],
    providerSymbolFor: (id: ProviderId, mkrSymbol: string) => string | null,
    priority: RequestPriority = 'P1',
  ): Promise<{ result: Record<string, NormalizedQuote | null>; source: ProviderId | null }> {
    const buildMap = (id: ProviderId): Record<string, string> => {
      const map: Record<string, string> = {};
      for (const mkrSymbol of mkrSymbols) {
        const providerSymbol = providerSymbolFor(id, mkrSymbol);
        if (providerSymbol) map[providerSymbol] = mkrSymbol;
      }
      return map;
    };
    let budgetDeniedTier: string | null = null;

    if (this.primary) {
      const admission = admitCircuitRequest(this.primary.id);
      if (admission.allowed) {
        const map = buildMap(this.primary.id);
        if (Object.keys(map).length > 0) {
          const decision = this.admit(this.primary.id, priority);
          if (decision.allowed) {
            try {
              const result = await this.primary.getBatchQuotes(map);
              recordSuccess(this.primary.id);
              recordCircuitSuccess(this.primary.id);
              return { result, source: this.primary.id };
            } catch (err) {
              recordFailure(this.primary.id, (err as Error).message);
              if (admission.isProbe) {
                recordCircuitFailure(this.primary.id); // the trial's own failure is the confirmation
              } else {
                const confirmation = await this.confirmUnhealthy(this.primary.id, this.primary);
                if (confirmation !== 'unhealthy') throw err; // 'healthy' (transient) or 'unknown' (unverified) - propagate, don't fail over, don't trip
                recordCircuitFailure(this.primary.id);
              }
            }
          } else {
            if (admission.isProbe) releaseCircuitProbe(this.primary.id);
            budgetDeniedTier = decision.tier;
          }
        } else if (admission.isProbe) {
          releaseCircuitProbe(this.primary.id);
        }
      }
    }

    if (this.secondaryEnabled && this.secondary) {
      const admission = admitCircuitRequest(this.secondary.id);
      if (admission.allowed) {
        const map = buildMap(this.secondary.id);
        if (Object.keys(map).length > 0) {
          const decision = this.admit(this.secondary.id, priority);
          if (decision.allowed) {
            try {
              const result = await this.secondary.getBatchQuotes(map);
              recordSuccess(this.secondary.id);
              recordCircuitSuccess(this.secondary.id);
              return { result, source: this.secondary.id };
            } catch (err) {
              recordFailure(this.secondary.id, (err as Error).message);
              // Finding 2: same confirmed-unhealthy treatment as the primary.
              if (admission.isProbe) {
                recordCircuitFailure(this.secondary.id);
              } else {
                const confirmation = await this.confirmUnhealthy(this.secondary.id, this.secondary);
                if (confirmation === 'unhealthy') recordCircuitFailure(this.secondary.id);
              }
              throw err;
            }
          } else {
            if (admission.isProbe) releaseCircuitProbe(this.secondary.id);
            budgetDeniedTier = decision.tier;
          }
        } else if (admission.isProbe) {
          releaseCircuitProbe(this.secondary.id);
        }
      }
    }

    if (budgetDeniedTier) throw budgetErrorFor(budgetDeniedTier);
    // Nothing mapped for either provider - a mapping outcome, not a fault.
    return { result: Object.fromEntries(mkrSymbols.map((s) => [s, null])), source: null };
  }

  getCandles(mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number, symbolFor: (id: ProviderId) => string | null, priority: RequestPriority = 'P1') {
    return this.withFailover<NormalizedCandle[]>((provider, symbol) => provider.getCandles(symbol, mkrSymbol, timeframe, outputSize), symbolFor, priority);
  }

  getMarketStatus(mkrSymbol: string, symbolFor: (id: ProviderId) => string | null, priority: RequestPriority = 'P1') {
    return this.withFailover<NormalizedMarketStatus>((provider, symbol) => provider.getMarketStatus(symbol, mkrSymbol), symbolFor, priority);
  }

  /**
   * Live probe of both providers, for GET /api/mkr/market/health - callers
   * should cache this briefly (see cache-service.ts). Tagged P4 (optional/
   * background) and gated by the SAME budget guard as everything else - a
   * diagnostic probe is exactly "optional/background" work, so it is
   * correctly the first thing shed as budget tightens. A budget-denied
   * probe reports `status: 'unknown'` (never fabricated as healthy/
   * unhealthy) rather than throwing - a health endpoint must degrade
   * gracefully, never itself become the outage.
   *
   * Final Production Task: while a provider's circuit is OPEN (already
   * confirmed down, backoff not yet elapsed), this skips the live probe
   * entirely and reports `unhealthy` directly from the breaker's own
   * state - we already know the answer, so spending a second P4 request
   * (and its quota) to re-ask would be wasteful. Once the backoff window
   * elapses (half-open), a real probe runs again as the recovery trial.
   *
   * Final Edit Task (Finding 1): this probe now goes through the SAME
   * `admitCircuitRequest` claim as live traffic, instead of its own
   * separate `circuit.status === 'open'` check. That closes a real gap -
   * without it, a concurrent admin `/admin/health` call could run its own
   * live `healthCheck()` at the exact same half-open moment as a real
   * market-data request's recovery trial, i.e. two independent "trials"
   * racing each other, which is exactly the bug Finding 1 fixes. Routing
   * both through one claim means there is only ever one recovery trial in
   * flight for a given provider, regardless of which code path triggers it.
   */
  async healthSnapshot(): Promise<{ primary: ProviderHealth | null; secondary: ProviderHealth | null }> {
    const build = async (provider: MarketDataProvider | null, enabled: boolean): Promise<ProviderHealth | null> => {
      if (!provider) return null;
      const mem = healthEntry(provider.id);
      if (!enabled) {
        const circuit = circuitSnapshot(provider.id);
        return {
          provider: provider.id,
          status: 'disabled',
          latencyMs: null,
          lastSuccessAt: mem.lastSuccessAt,
          lastErrorAt: mem.lastErrorAt,
          lastErrorMessage: mem.lastErrorMessage,
          errorCount: mem.errorCount,
          circuit: circuit.status,
          circuitNextProbeAt: circuit.nextProbeAt,
        };
      }

      const admission = admitCircuitRequest(provider.id);
      if (!admission.allowed) {
        // Either still genuinely open, or half-open but another caller
        // (live traffic, or a concurrent admin call) already holds the
        // one trial slot - either way, do not probe, report unhealthy.
        const circuit = circuitSnapshot(provider.id);
        return {
          provider: provider.id,
          status: 'unhealthy',
          latencyMs: null,
          lastSuccessAt: mem.lastSuccessAt,
          lastErrorAt: mem.lastErrorAt,
          lastErrorMessage: mem.lastErrorMessage,
          errorCount: mem.errorCount,
          circuit: circuit.status,
          circuitNextProbeAt: circuit.nextProbeAt,
        };
      }

      const decision = this.admit(provider.id, 'P4');
      if (!decision.allowed) {
        if (admission.isProbe) releaseCircuitProbe(provider.id); // claimed the trial but budget denied it - never actually attempted, free the slot
        const circuit = circuitSnapshot(provider.id);
        return {
          provider: provider.id,
          status: 'unknown',
          latencyMs: null,
          lastSuccessAt: mem.lastSuccessAt,
          lastErrorAt: mem.lastErrorAt,
          lastErrorMessage: mem.lastErrorMessage,
          errorCount: mem.errorCount,
          circuit: circuit.status,
          circuitNextProbeAt: circuit.nextProbeAt,
        };
      }

      const probe = await provider.healthCheck();
      if (probe.healthy) recordCircuitSuccess(provider.id);
      else recordCircuitFailure(provider.id);
      const circuitAfter = circuitSnapshot(provider.id);
      return {
        provider: provider.id,
        status: probe.healthy ? 'healthy' : 'unhealthy',
        latencyMs: probe.latencyMs,
        lastSuccessAt: mem.lastSuccessAt,
        lastErrorAt: mem.lastErrorAt,
        lastErrorMessage: mem.lastErrorMessage,
        errorCount: mem.errorCount,
        circuit: circuitAfter.status,
        circuitNextProbeAt: circuitAfter.nextProbeAt,
      };
    };

    return {
      primary: await build(this.primary, true),
      secondary: await build(this.secondary, this.secondaryEnabled),
    };
  }
}
