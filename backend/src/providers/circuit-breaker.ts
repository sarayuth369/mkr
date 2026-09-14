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
}

const circuits = new Map<ProviderId, CircuitState>();

export type CircuitStatus = 'closed' | 'open' | 'half_open';

/** `open` (skip the provider entirely) only while genuinely within the backoff window; once elapsed, reports `half_open` (one trial request should be allowed through) without mutating state - the trial's own outcome (see `recordCircuitSuccess`/`recordCircuitFailure`) decides what happens next. */
export function circuitStatus(id: ProviderId, now: number = Date.now()): CircuitStatus {
  const c = circuits.get(id);
  if (!c || !c.open) return 'closed';
  return now < c.nextProbeAt ? 'open' : 'half_open';
}

/** Convenience for call sites that only care about the binary "skip this provider right now" decision. */
export function isCircuitOpen(id: ProviderId, now: number = Date.now()): boolean {
  return circuitStatus(id, now) === 'open';
}

/** Call after a provider's `healthCheck()` has CONFIRMED it unhealthy (never merely because one request failed - that determination stays in provider-manager.ts, unchanged). Backoff doubles on each repeated trip while already open (a half-open trial that fails), reset to the initial value once the circuit had been fully closed. */
export function recordCircuitFailure(id: ProviderId, now: number = Date.now()): void {
  const existing = circuits.get(id);
  const baseSeconds = existing?.open ? Math.min(MAX_BACKOFF_SECONDS, existing.backoffSeconds * 2) : INITIAL_BACKOFF_SECONDS;
  // Jitter avoids every symbol's next trial landing on the exact same
  // tick after a shared provider outage - same rationale as the WS
  // reconnect jitter in market-stream-do.ts.
  const jitteredSeconds = baseSeconds * (0.5 + Math.random() * 0.5);
  circuits.set(id, { open: true, openedAt: existing?.open ? existing.openedAt : now, nextProbeAt: now + jitteredSeconds * 1000, backoffSeconds: baseSeconds });
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
