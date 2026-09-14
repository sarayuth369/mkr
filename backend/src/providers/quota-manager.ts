import type { ProviderId } from '../types';

/**
 * Centralized provider REST-call budget guard (Task 6). The single choke
 * point every provider REST call passes through - wired into
 * [MarketProviderManager], never a route handler calling a provider
 * directly - so nothing can bypass it via an alternate code path.
 *
 * Deliberately does NOT track WebSocket usage the same way: Twelve Data's
 * WS usage in this codebase is ONE persistent, pooled connection (Market
 * Pool Core, Task 1) with subscribe/unsubscribe control messages, not a
 * per-call request volume comparable to REST - there is no evidence in
 * this codebase or provider docs of a discrete "WS message quota" distinct
 * from the connection itself, so nothing was invented for it. WS
 * observability (connection state, subscribed-symbol count) already
 * exists via `poolStatusSnapshot()` (Task 1) and is not duplicated here.
 *
 * Budget numbers are NEVER invented. `dailyRequestBudget` defaults to 0
 * (unconfigured) unless an operator explicitly sets
 * PROVIDER_TWELVE_DATA_DAILY_BUDGET / PROVIDER_ALPACA_DAILY_BUDGET (or the
 * admin-editable equivalent) to a real number from their own provider
 * account - this codebase has no reliable source for Twelve Data's or
 * Alpaca's actual plan limits, and Task 6 explicitly forbids fabricating
 * one. With `dailyRequestBudget <= 0`, every check below fails OPEN
 * (always allowed) - the guard exists and is fully wired, but is inert
 * until an operator supplies a real number, which is the only honest
 * default given no evidenced source of truth.
 *
 * State is per-isolate, in-memory (same accepted tradeoff as this file's
 * sibling `provider-manager.ts`'s `memoryHealth`: "deliberately NOT
 * written to KV on every request" - a KV-backed global counter here would
 * reintroduce exactly the write-volume problem Task 1 fixed, just for a
 * new purpose). This means the guard is a best-effort deterrent against
 * gross, sustained overuse within one isolate's lifetime, not an exact
 * cross-isolate daily total - a real limitation, documented here and in
 * the Task 6 report, not hidden. It compounds usefully with the existing
 * cache/single-flight layer (Task 1), which already removes the vast
 * majority of would-be duplicate calls before they'd ever reach this
 * guard at all.
 */
export type RequestPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

export type BudgetTier = 'normal' | 'reduced' | 'emergency' | 'critical' | 'stopped';

/**
 * One priority is shed per threshold, lowest-priority first - directly
 * combining the two ordered lists Task 6 specifies (priorities P0..P4,
 * thresholds 70/85/95/100%), nothing else invented:
 *
 *   <70%  normal    - all of P0..P4 allowed
 *   70%   reduced   - P4 (optional/background) denied
 *   85%   emergency - P3 (reconciliation/warm maintenance) also denied
 *   95%   critical  - P2 (watchlist/background) also denied
 *   100%  stopped   - P1 (user-requested market data) also denied; only
 *                     P0 (active user/live + alerts) is NEVER preemptively
 *                     denied by this guard - it may still fail at the
 *                     provider itself if truly exhausted, but this guard
 *                     never adds a second, self-inflicted rejection on
 *                     top of that for the most essential traffic.
 */
const DENIED_AT_TIER: Record<BudgetTier, ReadonlySet<RequestPriority>> = {
  normal: new Set(),
  reduced: new Set(['P4']),
  emergency: new Set(['P3', 'P4']),
  critical: new Set(['P2', 'P3', 'P4']),
  stopped: new Set(['P1', 'P2', 'P3', 'P4']),
};

export function tierForUsedFraction(usedFraction: number): BudgetTier {
  if (usedFraction >= 1) return 'stopped';
  if (usedFraction >= 0.95) return 'critical';
  if (usedFraction >= 0.85) return 'emergency';
  if (usedFraction >= 0.7) return 'reduced';
  return 'normal';
}

export interface ProviderBudgetPolicy {
  /** 0 = unconfigured - guard fails open (see class doc). Never a fabricated number. */
  dailyRequestBudget: number;
}

export interface BudgetDecision {
  allowed: boolean;
  tier: BudgetTier;
  usedFraction: number;
  usedCount: number;
  /** `null` when the policy is unconfigured (dailyRequestBudget <= 0). */
  budget: number | null;
}

interface UsageCounter {
  /** UTC-day window start (ms) this count belongs to - see class doc for why UTC, not exchange-local. */
  windowStart: number;
  count: number;
}

// Per-isolate, in-memory, best-effort - see class doc.
const usage = new Map<ProviderId, UsageCounter>();

/**
 * Daily windows reset on the UTC calendar day, deliberately NOT the
 * session-aware exchange-local day Task 5 introduced for candles - a
 * provider's own billing/quota cycle is a property of the PROVIDER
 * account, not of any one symbol's exchange, and this codebase has no
 * evidence of which timezone Twelve Data/Alpaca actually reset on. UTC is
 * the neutral, unbiased default; if an operator later learns the real
 * reset time, that would be a config addition, not assumed here.
 */
function dayWindowStart(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000) * 86_400_000;
}

function currentCount(providerId: ProviderId, now: number): number {
  const entry = usage.get(providerId);
  if (!entry || entry.windowStart !== dayWindowStart(now)) return 0;
  return entry.count;
}

/** Checks admission WITHOUT recording a call - call [recordProviderRequest] separately, only once the call is actually about to be attempted (see provider-manager.ts). */
export function admitProviderRequest(providerId: ProviderId, priority: RequestPriority, policy: ProviderBudgetPolicy, now: number = Date.now()): BudgetDecision {
  if (!policy.dailyRequestBudget || policy.dailyRequestBudget <= 0) {
    return { allowed: true, tier: 'normal', usedFraction: 0, usedCount: currentCount(providerId, now), budget: null };
  }
  const usedCount = currentCount(providerId, now);
  const usedFraction = usedCount / policy.dailyRequestBudget;
  const tier = tierForUsedFraction(usedFraction);
  return { allowed: !DENIED_AT_TIER[tier].has(priority), tier, usedFraction, usedCount, budget: policy.dailyRequestBudget };
}

/** Records one REST call attempt against `providerId`'s daily counter - call once per actual attempt (success or failure both consume real provider quota), never for a call [admitProviderRequest] denied. */
export function recordProviderRequest(providerId: ProviderId, now: number = Date.now()): void {
  const windowStart = dayWindowStart(now);
  const entry = usage.get(providerId);
  if (!entry || entry.windowStart !== windowStart) {
    usage.set(providerId, { windowStart, count: 1 });
  } else {
    entry.count += 1;
  }
}

export interface BudgetSnapshot extends BudgetDecision {
  provider: ProviderId;
}

/** Read-only snapshot for observability (admin visibility) - never mutates state. */
export function budgetSnapshot(providerId: ProviderId, policy: ProviderBudgetPolicy, now: number = Date.now()): BudgetSnapshot {
  // P0 is used purely as a probe priority here - it is never denied by
  // DENIED_AT_TIER, so this always reports `allowed: true`; the caller
  // cares about `tier`/`usedFraction`, not `allowed`, for a snapshot.
  const decision = admitProviderRequest(providerId, 'P0', policy, now);
  return { ...decision, provider: providerId };
}

/** Test-only: clears in-memory usage state between test cases. */
export function _resetQuotaUsageForTests(): void {
  usage.clear();
}
