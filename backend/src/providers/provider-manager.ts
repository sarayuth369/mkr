import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderHealth, ProviderId } from '../types';
import { admitCircuitRequest, circuitSnapshot, recordCircuitFailure, recordCircuitSuccess, releaseCircuitProbe } from './circuit-breaker';
import { admitProviderRequest, type ProviderBudgetPolicy, type RequestPriority } from './quota-manager';
import { ProviderError, type MarketDataProvider } from './types';

/**
 * A `not_found` [ProviderError] means one specific symbol is invalid or
 * unavailable on the account's plan tier - a permanent, symbol-specific
 * outcome that retrying (or confirming provider health) can never change.
 * Confirmed live (2026-09-15): treating this the same as a genuine
 * transient/infra fault meant a handful of misconfigured catalog symbols
 * each spent a healthCheck() confirmation call and, once enough piled up
 * under real request volume, tripped the circuit for the WHOLE provider -
 * taking every other, perfectly valid symbol down with it. Skipping
 * confirmation and circuit-breaker involvement entirely for this kind is
 * what actually fixes that: the error still propagates (the route handler
 * already treats a thrown error for one symbol as "no data for this
 * symbol", same as a null result), it just never touches provider health.
 */
function isSymbolSpecificError(err: unknown): boolean {
  return err instanceof ProviderError && err.kind === 'not_found';
}

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

  /**
   * 2026-09-16 Hybrid Provider Architecture task: the ordered list of
   * providers a call should try, in order - generalizes the previous
   * hard-coded "always primary, then secondary" into a routing decision
   * this class makes ONCE per call, from [preferredProvider] (resolved by
   * the caller via capability.ts's `resolvePreferredProvider`, itself
   * driven by the D1 catalog mapping + the two hybrid feature flags - see
   * that file's doc comment for the full capability/preference/activation
   * split).
   *
   * `secondaryEnabled` remains THE one gate for "may Alpaca be contacted
   * at all" - unchanged in meaning, and re-checked HERE regardless of
   * [preferredProvider], so a caller that resolves a stale/wrong
   * preference can never cause Alpaca to be contacted while it's globally
   * disabled. When [preferredProvider] doesn't match the secondary's own
   * id (including when there IS no secondary, or hybrid routing simply
   * didn't apply to this symbol), the order is byte-identical to the
   * pre-hybrid behavior: primary first, secondary second.
   */
  private routeSlots(preferredProvider?: ProviderId): MarketDataProvider[] {
    const alpacaAllowed = this.secondaryEnabled && this.secondary !== null;
    const preferSecondary = alpacaAllowed && preferredProvider !== undefined && preferredProvider === this.secondary!.id;

    const slots: MarketDataProvider[] = [];
    if (preferSecondary) {
      slots.push(this.secondary!);
      if (this.primary) slots.push(this.primary);
    } else {
      if (this.primary) slots.push(this.primary);
      if (alpacaAllowed) slots.push(this.secondary!);
    }
    return slots;
  }

  /**
   * Walks [routeSlots] in order, applying the SAME confirmed-health/
   * circuit/quota discipline to whichever provider occupies each slot -
   * the algorithm itself is unchanged from the pre-hybrid two-block
   * version; only "which provider is first" is now a per-call decision
   * instead of always `this.primary`. A slot's failure only advances to
   * the NEXT slot when genuinely confirmed unhealthy (or the failure WAS
   * itself the half-open trial's own confirmation) - a transient/
   * unconfirmed failure on ANY slot propagates immediately, matching the
   * original's "primary" behavior; the LAST slot always throws on
   * failure regardless of confirmation outcome, since there is nothing
   * left to fall back to - matching the original's "secondary" behavior.
   */
  private async withFailover<T>(
    call: (provider: MarketDataProvider, providerSymbol: string) => Promise<T>,
    symbolFor: (id: ProviderId) => string | null,
    priority: RequestPriority,
    preferredProvider?: ProviderId,
  ): Promise<{ result: T; source: ProviderId }> {
    const slots = this.routeSlots(preferredProvider);
    let budgetDeniedTier: string | null = null;

    for (let i = 0; i < slots.length; i++) {
      const provider = slots[i]!;
      const isLastSlot = i === slots.length - 1;
      const admission = admitCircuitRequest(provider.id);
      if (!admission.allowed) continue; // circuit already open - skip straight to the next slot, if any

      const symbol = symbolFor(provider.id);
      if (!symbol) {
        if (admission.isProbe) releaseCircuitProbe(provider.id); // no symbol mapping - never attempted, free the slot
        continue;
      }

      const decision = this.admit(provider.id, priority);
      if (!decision.allowed) {
        if (admission.isProbe) releaseCircuitProbe(provider.id); // claimed but never attempted - free the slot
        budgetDeniedTier = decision.tier; // never contacted this provider at all - not a health event
        continue;
      }

      try {
        const result = await call(provider, symbol);
        recordSuccess(provider.id);
        recordCircuitSuccess(provider.id);
        return { result, source: provider.id };
      } catch (err) {
        recordFailure(provider.id, (err as Error).message);
        if (isSymbolSpecificError(err)) {
          if (admission.isProbe) releaseCircuitProbe(provider.id); // claimed but never a real health signal - free the slot
          throw err; // never a provider-health event - see isSymbolSpecificError
        }
        if (admission.isProbe) {
          // The half-open trial's own outcome IS the confirmation - no
          // separate healthCheck needed (would just double-spend quota to
          // re-ask a question this attempt already answered).
          recordCircuitFailure(provider.id);
        } else {
          const confirmation = await this.confirmUnhealthy(provider.id, provider);
          if (confirmation !== 'unhealthy') {
            // 'healthy' - confirmed still reachable, a one-off/transient
            // fault, not a genuine outage. 'unknown' - the confirmation
            // probe itself was budget-denied, so nothing was actually
            // learned - never trip the circuit on an UNVERIFIED outage.
            // Either way: do not fail over; propagate immediately.
            throw err;
          }
          recordCircuitFailure(provider.id); // confirmed unhealthy - trip/extend the breaker
        }
        // 2026-09-16 Hybrid Provider Architecture task: preserves the
        // PRE-HYBRID behavior exactly for both possible orderings. The
        // primary (Twelve Data) NEVER throws its own error from here - a
        // confirmed-unhealthy primary always falls through, to the next
        // slot if any, or to the generic fallback below if not (matches
        // the original "always primary first" code, where primary-only
        // configurations - no secondary at all - fell through to the
        // generic message, never primary's own error). The secondary
        // (Alpaca) throws its OWN specific error (more diagnostic value
        // than a generic message) but ONLY once it's the LAST slot with
        // nothing left to try - in the pre-hybrid order that's always true
        // (secondary was structurally always last), so this is
        // byte-identical there; in a hybrid-swapped order (Alpaca
        // preferred FIRST), a confirmed-unhealthy Alpaca instead falls
        // through to let Twelve Data - the real fallback - actually run,
        // rather than aborting the whole call on Alpaca's failure alone.
        if (provider === this.secondary && isLastSlot) throw err;
      }
    }

    if (budgetDeniedTier) throw budgetErrorFor(budgetDeniedTier);
    throw new ProviderError('No healthy provider available for this symbol', 'unknown');
  }

  getQuote(mkrSymbol: string, symbolFor: (id: ProviderId) => string | null, priority: RequestPriority = 'P1', preferredProvider?: ProviderId) {
    return this.withFailover<NormalizedQuote | null>((provider, symbol) => provider.getQuote(symbol, mkrSymbol), symbolFor, priority, preferredProvider);
  }

  /**
   * One upstream call for many symbols instead of N - see the interface
   * doc comment on [MarketDataProvider.getBatchQuotes] for why this exists
   * (Twelve Data Free's rate limit is exhausted almost immediately by N
   * concurrent individual quote calls for one client's full catalog load).
   * Same failover discipline as [withFailover]: only falls to secondary
   * after the primary throws AND a healthCheck confirms it's genuinely
   * down, never merely because some symbols in the batch came back null.
   *
   * 2026-09-16 post-phone Closed Testing correction task (root cause,
   * deeper layer): unlike [withFailover] (whose final fallback always
   * throws - `throw new ProviderError('No healthy provider available...',
   * 'unknown')`), this method's final fallback returns EVERY requested
   * symbol mapped to `null`, deliberately treating "nothing mapped for
   * either provider" (a real, non-fault case: a symbol simply has no
   * provider coverage at all) as distinct from "a provider WAS mapped and
   * genuinely failed." The bug: the primary's own catch block, on a
   * confirmed-unhealthy or half-open-trial failure, recorded the circuit
   * failure and fell through WITHOUT throwing or otherwise flagging that a
   * real attempt failed - with MKR's secondary disabled by default
   * (MARKET_SECONDARY_ENABLED=false), execution always reached the bottom
   * fallback next, silently returning `{symbol: null}` for every symbol as
   * if it were the benign "nothing mapped" case. `market-routes.ts`
   * treats `result[symbol] === null` identically to a confirmed
   * provider-verified empty answer - never reported as an error, and
   * (worse) cached as such for the full quote TTL. Confirmed live
   * (2026-09-16): a batch request that hit this path returned symbols
   * present in NEITHER `items` NOR `errors`, exactly the "opens with no
   * market content, no explanation" symptom this task traces to its root.
   * [primaryAttemptFailed] now tracks whether the primary was actually
   * ASKED for something and failed (or its circuit was already open with
   * something to ask) - the bottom fallback throws [withFailover]'s own
   * generic "no healthy provider" error instead of silently defaulting to
   * null-for-everyone whenever it's set, exactly matching that method's
   * "always throw once anything was genuinely attempted" contract (the
   * original underlying error is already recorded via [recordFailure]
   * above; the generic message here matches what a caller already gets
   * from every OTHER method on this class in the equivalent situation).
   * The secondary path is unaffected - it already unconditionally throws
   * on its own failure (see its own catch block below), so it never
   * reaches this fallback at all.
   *
   * 2026-09-16 Hybrid Provider Architecture task: [preferredProviderFor],
   * when given, splits [mkrSymbols] into (at most) two groups - symbols
   * that prefer the secondary (Alpaca) and everything else - and runs
   * [batchWithFailover] once per non-empty group CONCURRENTLY (the two
   * groups hit entirely different upstream services with independent
   * rate limits, so there is no shared-provider concurrency risk the way
   * there would be firing multiple chunks at the SAME provider at once -
   * see TwelveDataProvider.getBatchQuotes's own doc comment for why THAT
   * stays sequential), then merges both groups' results. A symbol's own
   * per-provider routing is fully preserved even when its preferred
   * group's call fails and the OTHER group's succeeds - only that
   * symbol's own group is affected, matching "a failed request must
   * still obey the existing confirmed-health/failover rules... do not
   * turn one symbol's failure into a global provider outage." When
   * [preferredProviderFor] is omitted (or nothing in [mkrSymbols]
   * actually prefers the secondary), this is a single, byte-identical
   * call to the pre-hybrid behavior.
   */
  async getBatchQuotes(
    mkrSymbols: string[],
    providerSymbolFor: (id: ProviderId, mkrSymbol: string) => string | null,
    priority: RequestPriority = 'P1',
    preferredProviderFor?: (mkrSymbol: string) => ProviderId | null,
  ): Promise<{ result: Record<string, NormalizedQuote | null>; source: ProviderId | null }> {
    if (!preferredProviderFor || !this.secondary) {
      return this.batchWithFailover(mkrSymbols, providerSymbolFor, priority);
    }

    const secondaryId = this.secondary.id;
    const preferSecondaryGroup = mkrSymbols.filter((s) => preferredProviderFor(s) === secondaryId);
    const preferPrimaryGroup = mkrSymbols.filter((s) => preferredProviderFor(s) !== secondaryId);

    if (preferSecondaryGroup.length === 0) return this.batchWithFailover(mkrSymbols, providerSymbolFor, priority);
    if (preferPrimaryGroup.length === 0) return this.batchWithFailover(mkrSymbols, providerSymbolFor, priority, secondaryId);

    const [primaryGroupOutcome, secondaryGroupOutcome] = await Promise.allSettled([
      this.batchWithFailover(preferPrimaryGroup, providerSymbolFor, priority),
      this.batchWithFailover(preferSecondaryGroup, providerSymbolFor, priority, secondaryId),
    ]);

    const merged: Record<string, NormalizedQuote | null> = {};
    let anyGroupSucceeded = false;
    let lastError: unknown;
    if (primaryGroupOutcome.status === 'fulfilled') {
      Object.assign(merged, primaryGroupOutcome.value.result);
      anyGroupSucceeded = true;
    } else {
      lastError = primaryGroupOutcome.reason;
    }
    if (secondaryGroupOutcome.status === 'fulfilled') {
      Object.assign(merged, secondaryGroupOutcome.value.result);
      anyGroupSucceeded = true;
    } else {
      lastError = secondaryGroupOutcome.reason;
    }

    if (!anyGroupSucceeded) throw lastError;
    // Mixed providers contributed - no single scalar can honestly
    // represent "the" source (unused by any caller today - see this
    // method's own doc comment history - but `null` matches the
    // existing "ambiguous" convention rather than fabricating one).
    return { result: merged, source: null };
  }

  /**
   * The actual per-group failover walk - see [getBatchQuotes]'s doc comment
   * for why this is now a private helper callable once per hybrid-routed
   * group. [routeSlots] (see its own doc comment) decides which provider is
   * tried first.
   *
   * 2026-09-16 Final Full-System One-Pass audit ("CRITICAL BATCH CHECK"):
   * a provider's `getBatchQuotes` can return SUCCESSFULLY (no throw) while
   * still leaving individual requested symbols missing from its result - a
   * per-symbol/per-chunk transient failure inside the provider's own batch
   * implementation (see TwelveDataProvider/AlpacaProvider's own doc
   * comments: "a partial chunk failure just leaves those specific symbols
   * out of `result`"). Previously this method returned immediately on the
   * FIRST successful (non-throwing) attempt, so a symbol missing from that
   * one provider's partial response had no chance to be retried against
   * the OTHER mapped provider, even when one was available and healthy -
   * it just stayed missing, surfaced by the route layer as
   * PROVIDER_UNAVAILABLE, when a second provider might have actually had
   * the data.
   *
   * Fixed by tracking `remaining` (symbols not yet resolved by ANY slot)
   * and only asking each subsequent slot for what's STILL missing, instead
   * of stopping at the first non-throwing attempt. This is bounded and
   * safe: each symbol is asked of at most `slots.length` providers (in
   * practice at most 2 - primary and secondary), never retried against a
   * provider that already resolved it (fully or as confirmed no-data), and
   * never fans out concurrently - the loop remains strictly sequential,
   * one provider at a time, exactly as before. A symbol resolved to `null`
   * (provider-confirmed no-data) is removed from `remaining` immediately,
   * so it is never mistaken for "missing" and never retried as if it were
   * a fault - preserving "never retry a confirmed no-data result." Once
   * `remaining` is empty, no further slot is contacted at all (`break`),
   * so a fully-successful first attempt costs exactly the same one real
   * call it always did.
   *
   * A provider's own THROWN failure (as opposed to a partial success) is
   * handled exactly as before - the confirmed-health/circuit/budget rules
   * and the primary-never-throws/secondary-throws-only-if-last asymmetry
   * are unchanged; only the loop's success path gained per-symbol
   * bounded fallback.
   */
  private async batchWithFailover(
    mkrSymbols: string[],
    providerSymbolFor: (id: ProviderId, mkrSymbol: string) => string | null,
    priority: RequestPriority,
    preferredProvider?: ProviderId,
  ): Promise<{ result: Record<string, NormalizedQuote | null>; source: ProviderId | null }> {
    const buildMap = (id: ProviderId, symbols: Iterable<string>): Record<string, string> => {
      const map: Record<string, string> = {};
      for (const mkrSymbol of symbols) {
        const providerSymbol = providerSymbolFor(id, mkrSymbol);
        if (providerSymbol) map[providerSymbol] = mkrSymbol;
      }
      return map;
    };
    const slots = this.routeSlots(preferredProvider);
    let budgetDeniedTier: string | null = null;
    let anyAttemptFailed = false;
    const result: Record<string, NormalizedQuote | null> = {};
    const contributingProviders = new Set<ProviderId>();
    const remaining = new Set(mkrSymbols);

    for (let i = 0; i < slots.length; i++) {
      if (remaining.size === 0) break; // everything already resolved - never contact a slot with nothing left to ask
      const provider = slots[i]!;
      const isLastSlot = i === slots.length - 1;
      const admission = admitCircuitRequest(provider.id);
      if (!admission.allowed) {
        // Circuit already open - known-unhealthy from a recent
        // confirmation, not even contacted this call, but this call DID
        // have something to ask it for. Same "a real provider was needed
        // and unavailable" fault as an in-call failure (2026-09-15
        // post-phone Closed Testing correction task's own root-cause fix,
        // preserved here).
        if (Object.keys(buildMap(provider.id, remaining)).length > 0) anyAttemptFailed = true;
        continue;
      }

      const map = buildMap(provider.id, remaining);
      if (Object.keys(map).length === 0) {
        if (admission.isProbe) releaseCircuitProbe(provider.id);
        continue;
      }

      const decision = this.admit(provider.id, priority);
      if (!decision.allowed) {
        if (admission.isProbe) releaseCircuitProbe(provider.id);
        budgetDeniedTier = decision.tier;
        continue;
      }

      try {
        const partial = await provider.getBatchQuotes(map);
        recordSuccess(provider.id);
        recordCircuitSuccess(provider.id);
        contributingProviders.add(provider.id);
        for (const mkrSymbol of Object.values(map)) {
          if (mkrSymbol in partial) {
            result[mkrSymbol] = partial[mkrSymbol] ?? null;
            remaining.delete(mkrSymbol);
          }
          // else: this symbol's own chunk/request transiently failed
          // inside the provider - stays in `remaining` for the NEXT slot
          // (bounded, at most one more attempt) instead of being dropped.
        }
        continue; // keep walking slots only for what's still `remaining`
      } catch (err) {
        recordFailure(provider.id, (err as Error).message);
        if (isSymbolSpecificError(err)) {
          if (admission.isProbe) releaseCircuitProbe(provider.id);
          throw err;
        }
        if (admission.isProbe) {
          recordCircuitFailure(provider.id); // the trial's own failure is the confirmation
          anyAttemptFailed = true;
        } else {
          const confirmation = await this.confirmUnhealthy(provider.id, provider);
          if (confirmation !== 'unhealthy') throw err; // 'healthy' (transient) or 'unknown' (unverified) - propagate, don't fail over, don't trip
          recordCircuitFailure(provider.id);
          anyAttemptFailed = true;
        }
        // See withFailover's identical comment: primary never throws its
        // own error (always falls through to the generic message below);
        // secondary throws its own error only once it's the LAST slot -
        // byte-identical to the pre-hybrid behavior in the default order,
        // and lets a hybrid-swapped Alpaca-preferred group actually fall
        // back to Twelve Data instead of aborting on Alpaca's failure alone.
        if (provider === this.secondary && isLastSlot) throw err;
      }
    }

    if (Object.keys(result).length === 0) {
      if (budgetDeniedTier) throw budgetErrorFor(budgetDeniedTier);
      // 2026-09-15 post-phone Closed Testing correction task: a real fault
      // must surface as an error, never be silently absorbed into the
      // "nothing mapped" fallback below - matches [withFailover]'s own
      // final fallback message exactly.
      if (anyAttemptFailed) throw new ProviderError('No healthy provider available for these symbols', 'unknown');
      // Nothing mapped for either provider (in THIS group) - a genuine mapping outcome, not a fault.
      return { result: Object.fromEntries(mkrSymbols.map((s) => [s, null])), source: null };
    }
    // A symbol still left in `remaining` here (unresolved by every slot
    // that had anything to offer it) is simply absent from `result` - the
    // route layer already treats a missing key as "not resolved this
    // call" (PROVIDER_UNAVAILABLE, never cached), so a partial success is
    // returned as-is rather than discarding the symbols that DID resolve.
    const source = contributingProviders.size === 1 ? [...contributingProviders][0]! : null;
    return { result, source };
  }

  getCandles(mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number, symbolFor: (id: ProviderId) => string | null, priority: RequestPriority = 'P1', preferredProvider?: ProviderId) {
    return this.withFailover<NormalizedCandle[]>((provider, symbol) => provider.getCandles(symbol, mkrSymbol, timeframe, outputSize), symbolFor, priority, preferredProvider);
  }

  /**
   * No `preferredProvider` param, unlike [getQuote]/[getCandles]/
   * [getBatchQuotes] - Alpaca has no real market-status endpoint here
   * (`AlpacaProvider.getMarketStatus` always returns a stub "unavailable"
   * result, never a real HTTP call - see that method's own doc comment),
   * so preferring it for this specific operation would never be
   * meaningful; Twelve Data stays first exactly as before.
   */
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
        // Denied for one of two genuinely different reasons - do not probe
        // either way, but they must not be reported identically:
        const circuit = circuitSnapshot(provider.id);
        // Final Edit Task 3: `circuit.status === 'open'` means still
        // genuinely inside the confirmed backoff window - `unhealthy` is
        // an accurate, already-confirmed verdict, unchanged from before.
        // But `circuit.status === 'half_open'` here means the ONLY reason
        // admission was denied is that another caller (live traffic, or a
        // concurrent admin call) already claimed the single recovery
        // probe - a real trial is actively in flight, and its outcome
        // isn't known yet. Reporting `unhealthy` in that case would
        // fabricate a health verdict the system hasn't actually confirmed
        // (the same "never fabricate health data" principle this class
        // already applies to a budget-denied probe, reported `unknown`
        // rather than guessed). This never touches admitCircuitRequest,
        // `probing`, or the probe owner's own resolution of the trial -
        // purely a read of already-existing state for a more accurate
        // observability label.
        const status = circuit.status === 'half_open' ? 'unknown' : 'unhealthy';
        return {
          provider: provider.id,
          status,
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
