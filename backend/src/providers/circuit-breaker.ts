import type { ProviderId } from '../types';

/**
 * Per-provider circuit breaker (Final Production Task) - prevents a known-
 * down provider from being hammered with repeated requests (and repeated
 * `healthCheck()` probes, which themselves cost real provider quota) while
 * it's confirmed unavailable, and prevents a reconnect/retry storm once it
 * recovers.
 *
 * Deliberately does NOT change the existing "confirmed unhealthy" trigger:
 * `MarketProviderManager` still calls `provider.healthCheck()` on the
 * FIRST failure to decide whether to fail over at all (a single transient
 * blip must not trip anything) - this module only takes over ONCE that
 * live probe has confirmed the provider is actually down. From then on,
 * subsequent requests skip contacting the provider entirely (no call, no
 * extra healthCheck probe) until an exponential-backoff-with-jitter window
 * elapses, at which point exactly one request is allowed through as a
 * recovery trial (the request itself doubles as the probe - no separate
 * healthCheck() call needed for that either).
 *
 * State is per-isolate, in-memory - same accepted best-effort tradeoff as
 * this file's siblings (`provider-manager.ts`'s `memoryHealth`,
 * `quota-manager.ts`'s usage counters). A worst-case cold-start-loses-state
 * outcome just means one extra live probe after a cold start, never an
 * outage - never written to KV, so this adds zero KV write volume.
 */
const INITIAL_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 300; // 5 minutes

interface CircuitState {
  open: boolean;
  openedAt: number;
  /** Once `now >= nextProbeAt`, the circuit is treated as half-open - exactly one trial request is allowed through. */
  nextProbeAt: number;
  backoffSeconds: number;
  /**
   * Final Edit Task - Finding 1: true while some caller holds the single
   * half-open recovery-trial slot. Without this, `isCircuitOpen()` alone
   * returning `false` in half-open let every concurrent caller through at
   * once (multiple simultaneous requests all "confirming" the same
   * recovery independently) - violating the documented "exactly one
   * recovery trial" contract. Cleared by `recordCircuitSuccess`/
   * `recordCircuitFailure` (the trial resolved) or `releaseCircuitProbe`
   * (the claimant aborted before ever actually contacting the provider).
   */
  probing: boolean;
}

const circuits = new Map<ProviderId, CircuitState>();

export type CircuitStatus = 'closed' | 'open' | 'half_open';

/** `open` (skip the provider entirely) only while genuinely within the backoff window; once elapsed, reports `half_open` (one trial request should be allowed through) without mutating state - the trial's own outcome (see `recordCircuitSuccess`/`recordCircuitFailure`) decides what happens next. Pure/read-only - for observability only (e.g. admin snapshots); never use this alone to decide whether to actually contact the provider, since it does not claim the single half-open slot - see `admitCircuitRequest`. */
export function circuitStatus(id: ProviderId, now: number = Date.now()): CircuitStatus {
  const c = circuits.get(id);
  if (!c || !c.open) return 'closed';
  return now < c.nextProbeAt ? 'open' : 'half_open';
}

/** Pure/read-only convenience for call sites that only need the binary "still definitely within backoff" observation. Like `circuitStatus`, this does NOT claim anything - it is safe for logging/observability, but `admitCircuitRequest` is the only race-safe way to decide whether a call may actually contact the provider (see Final Edit Task Finding 1). */
export function isCircuitOpen(id: ProviderId, now: number = Date.now()): boolean {
  return circuitStatus(id, now) === 'open';
}

export interface CircuitAdmission {
  /** false: skip the provider entirely for this call - either still within the backoff window, or another caller already holds the one half-open trial slot. */
  allowed: boolean;
  /**
   * true only for the single caller (per provider, per half-open window)
   * that claimed the recovery trial. That caller's own request outcome
   * decides the circuit's next state - the trial itself doubles as the
   * confirmation, no separate `healthCheck()` needed (see
   * `recordCircuitSuccess`/`recordCircuitFailure`). If the claimant
   * aborts before ever actually contacting the provider (no symbol
   * mapping for it, or a quota denial), it MUST call `releaseCircuitProbe`
   * so a later caller can claim the SAME window instead of the slot
   * sitting wasted.
   */
  isProbe: boolean;
}

/**
 * Final Edit Task - Finding 1: the single race-safe gate for "may this
 * call actually contact the provider right now", replacing the old plain
 * `!isCircuitOpen(id)` check (which let every concurrent caller through
 * during half-open). The read-and-claim below happens synchronously - no
 * `await` between observing `c.probing` and setting it `true` - which is
 * what makes this race-safe within one Cloudflare Worker isolate: JS
 * execution is single-threaded, so however many concurrent async call
 * sites reach this function "at once", each one's synchronous body still
 * runs to completion before the next one starts. Whichever call happens
 * to run first wins the claim; every other one observes `probing: true`
 * and is correctly denied.
 */
export function admitCircuitRequest(id: ProviderId, now: number = Date.now()): CircuitAdmission {
  const c = circuits.get(id);
  if (!c || !c.open) return { allowed: true, isProbe: false }; // closed - ordinary traffic, nothing to claim
  if (now < c.nextProbeAt) return { allowed: false, isProbe: false }; // still genuinely within the backoff window
  if (c.probing) return { allowed: false, isProbe: false }; // half-open, but another caller already claimed the one trial
  c.probing = true; // atomic claim
  return { allowed: true, isProbe: true };
}

/**
 * Releases a claimed-but-never-attempted recovery trial - the claimant
 * decided not to (or could not) actually contact the provider after
 * claiming the slot (no symbol mapping for it, or a quota denial). Must
 * never be called once the trial's real outcome is known - use
 * `recordCircuitSuccess`/`recordCircuitFailure` for that instead, which
 * already clear this flag as part of resolving the trial.
 */
export function releaseCircuitProbe(id: ProviderId): void {
  const c = circuits.get(id);
  if (c) c.probing = false;
}

/** Call after a provider's `healthCheck()` has CONFIRMED it unhealthy (never merely because one request failed - that determination stays in provider-manager.ts, unchanged), OR after a claimed half-open trial's own request failed (the trial itself is the confirmation there - no separate healthCheck needed). Backoff doubles on each repeated trip while already open (a half-open trial that fails), reset to the initial value once the circuit had been fully closed. Always clears any in-progress probe claim. */
export function recordCircuitFailure(id: ProviderId, now: number = Date.now()): void {
  const existing = circuits.get(id);
  const baseSeconds = existing?.open ? Math.min(MAX_BACKOFF_SECONDS, existing.backoffSeconds * 2) : INITIAL_BACKOFF_SECONDS;
  // Jitter avoids every symbol's next trial landing on the exact same
  // tick after a shared provider outage - same rationale as the WS
  // reconnect jitter in market-stream-do.ts.
  const jitteredSeconds = baseSeconds * (0.5 + Math.random() * 0.5);
  circuits.set(id, { open: true, openedAt: existing?.open ? existing.openedAt : now, nextProbeAt: now + jitteredSeconds * 1000, backoffSeconds: baseSeconds, probing: false });
}

/** Call after ANY successful provider contact (a normal closed-circuit success, or a half-open trial that succeeded) - fully resets the breaker, discarding any backoff state. */
export function recordCircuitSuccess(id: ProviderId): void {
  circuits.delete(id);
}

export interface CircuitSnapshot {
  provider: ProviderId;
  status: CircuitStatus;
  openedAt: number | null;
  nextProbeAt: number | null;
}

/** Read-only, for admin observability - never mutates state. */
export function circuitSnapshot(id: ProviderId, now: number = Date.now()): CircuitSnapshot {
  const c = circuits.get(id);
  return { provider: id, status: circuitStatus(id, now), openedAt: c?.openedAt ?? null, nextProbeAt: c?.nextProbeAt ?? null };
}

/** Test-only: clears in-memory circuit state between test cases. */
export function _resetCircuitsForTests(): void {
  circuits.clear();
}
