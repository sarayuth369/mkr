import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderHealth, ProviderId } from '../types';
import { circuitSnapshot, isCircuitOpen, recordCircuitFailure, recordCircuitSuccess } from './circuit-breaker';
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

  private async withFailover<T>(
    call: (provider: MarketDataProvider, providerSymbol: string) => Promise<T>,
    symbolFor: (id: ProviderId) => string | null,
    priority: RequestPriority,
  ): Promise<{ result: T; source: ProviderId }> {
    let budgetDeniedTier: string | null = null;

    if (this.primary && !isCircuitOpen(this.primary.id)) {
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
            const probe = await this.primary.healthCheck();
            if (probe.healthy) {
              // Confirmed still reachable - a one-off/transient fault, not a
              // genuine outage. Do not fail over; propagate the real error.
              throw err;
            }
            recordCircuitFailure(this.primary.id); // confirmed unhealthy - trip/extend the breaker
            // Confirmed unhealthy - fall through to the secondary below.
          }
        } else {
          budgetDeniedTier = decision.tier; // never contacted primary at all - not a health event
        }
      }
    }

    if (this.secondaryEnabled && this.secondary && !isCircuitOpen(this.secondary.id)) {
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
            recordCircuitFailure(this.secondary.id); // no further fallback - any confirmed failure trips it
            throw err;
          }
        }
        budgetDeniedTier = decision.tier;
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

    if (this.primary && !isCircuitOpen(this.primary.id)) {
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
            const probe = await this.primary.healthCheck();
            if (probe.healthy) throw err; // transient - propagate, don't fail over
            recordCircuitFailure(this.primary.id);
          }
        } else {
          budgetDeniedTier = decision.tier;
        }
      }
    }

    if (this.secondaryEnabled && this.secondary && !isCircuitOpen(this.secondary.id)) {
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
            recordCircuitFailure(this.secondary.id);
            throw err;
          }
        }
        budgetDeniedTier = decision.tier;
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
   */
  async healthSnapshot(): Promise<{ primary: ProviderHealth | null; secondary: ProviderHealth | null }> {
    const build = async (provider: MarketDataProvider | null, enabled: boolean): Promise<ProviderHealth | null> => {
      if (!provider) return null;
      const mem = healthEntry(provider.id);
      const circuit = circuitSnapshot(provider.id);
      if (!enabled) {
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

      if (circuit.status === 'open') {
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
