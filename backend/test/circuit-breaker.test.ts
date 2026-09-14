import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetCircuitsForTests,
  admitCircuitRequest,
  circuitSnapshot,
  circuitStatus,
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  releaseCircuitProbe,
} from '../src/providers/circuit-breaker';

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

afterEach(() => _resetCircuitsForTests());

describe('circuit-breaker - state transitions', () => {
  it('starts closed for a provider with no recorded state', () => {
    expect(circuitStatus('twelve_data', T0)).toBe('closed');
    expect(isCircuitOpen('twelve_data', T0)).toBe(false);
  });

  it('a confirmed failure trips the circuit open', () => {
    recordCircuitFailure('twelve_data', T0);
    expect(circuitStatus('twelve_data', T0)).toBe('open');
    expect(isCircuitOpen('twelve_data', T0)).toBe(true);
  });

  it('the circuit stays open until the backoff window elapses, at most 30s after the initial trip', () => {
    recordCircuitFailure('twelve_data', T0);
    expect(circuitStatus('twelve_data', T0 + 10_000)).toBe('open'); // 10s in - still within the 15-30s jittered window
  });

  it('reports half_open once the backoff window has fully elapsed', () => {
    recordCircuitFailure('twelve_data', T0);
    // Max initial backoff is 30s - well past that is unambiguously half-open regardless of jitter.
    expect(circuitStatus('twelve_data', T0 + 31_000)).toBe('half_open');
    expect(isCircuitOpen('twelve_data', T0 + 31_000)).toBe(false); // half-open means "let the trial through", not "still skip it"
  });

  it('a success fully closes the circuit, discarding backoff state', () => {
    recordCircuitFailure('twelve_data', T0);
    recordCircuitSuccess('twelve_data');
    expect(circuitStatus('twelve_data', T0)).toBe('closed');
  });

  it('a half-open trial that fails re-opens the circuit with a longer (doubled) backoff', () => {
    recordCircuitFailure('twelve_data', T0); // opens with ~15-30s backoff
    const afterFirstTrip = circuitSnapshot('twelve_data', T0);
    const firstNextProbeAt = afterFirstTrip.nextProbeAt!;

    // Simulate the half-open trial failing, at the moment it becomes eligible.
    const trialTime = firstNextProbeAt;
    recordCircuitFailure('twelve_data', trialTime);
    const afterSecondTrip = circuitSnapshot('twelve_data', trialTime);

    expect(afterSecondTrip.status).toBe('open');
    // Second backoff window must be longer than the first (roughly double, before jitter).
    expect(afterSecondTrip.nextProbeAt!).toBeGreaterThan(trialTime + (firstNextProbeAt - T0) * 0.9);
  });

  it('backoff is capped and never grows unbounded across many repeated failures', () => {
    let now = T0;
    for (let i = 0; i < 10; i++) {
      recordCircuitFailure('twelve_data', now);
      const snap = circuitSnapshot('twelve_data', now);
      now = snap.nextProbeAt!; // jump straight to the next eligible trial each time
    }
    const finalSnap = circuitSnapshot('twelve_data', now);
    recordCircuitFailure('twelve_data', now);
    const afterCap = circuitSnapshot('twelve_data', now);
    // Capped at 300s (5 min) - the gap can never exceed that, even after many trips.
    expect(afterCap.nextProbeAt! - now).toBeLessThanOrEqual(300_000);
    expect(finalSnap).toBeDefined();
  });
});

describe('circuit-breaker - provider isolation', () => {
  it('Twelve Data and Alpaca circuits are completely independent', () => {
    recordCircuitFailure('twelve_data', T0);
    expect(circuitStatus('twelve_data', T0)).toBe('open');
    expect(circuitStatus('alpaca', T0)).toBe('closed'); // untouched
  });
});

describe('admitCircuitRequest - Final Edit Task Finding 1: race-safe single half-open probe admission', () => {
  it('closed circuit allows normal calls (not a probe)', () => {
    expect(admitCircuitRequest('twelve_data', T0)).toEqual({ allowed: true, isProbe: false });
  });

  it('open circuit blocks calls before nextProbeAt', () => {
    recordCircuitFailure('twelve_data', T0);
    const admission = admitCircuitRequest('twelve_data', T0 + 10_000); // 10s in - well within the 15-30s window
    expect(admission).toEqual({ allowed: false, isProbe: false });
  });

  it('after nextProbeAt, exactly one caller can claim the half-open trial', () => {
    recordCircuitFailure('twelve_data', T0);
    const past = T0 + 31_000; // past the 30s max initial backoff - unambiguously half-open

    const first = admitCircuitRequest('twelve_data', past);
    expect(first).toEqual({ allowed: true, isProbe: true });
  });

  it('a second (concurrent) caller cannot claim another probe once the first has claimed it', () => {
    recordCircuitFailure('twelve_data', T0);
    const past = T0 + 31_000;

    const first = admitCircuitRequest('twelve_data', past);
    expect(first.isProbe).toBe(true);

    // Simulates a second concurrent request arriving before the first
    // trial has resolved (no recordCircuitSuccess/Failure call in between).
    const second = admitCircuitRequest('twelve_data', past);
    expect(second).toEqual({ allowed: false, isProbe: false });

    const third = admitCircuitRequest('twelve_data', past + 1);
    expect(third).toEqual({ allowed: false, isProbe: false });
  });

  it('a successful probe closes/resets the circuit - a subsequent call is ordinary (non-probe) traffic', () => {
    recordCircuitFailure('twelve_data', T0);
    const past = T0 + 31_000;
    const admission = admitCircuitRequest('twelve_data', past);
    expect(admission.isProbe).toBe(true);

    recordCircuitSuccess('twelve_data');

    expect(circuitStatus('twelve_data', past)).toBe('closed');
    expect(admitCircuitRequest('twelve_data', past)).toEqual({ allowed: true, isProbe: false });
  });

  it('a failed probe reopens the circuit with the next exponential backoff, and clears the claim', () => {
    recordCircuitFailure('twelve_data', T0);
    const firstNextProbeAt = circuitSnapshot('twelve_data', T0).nextProbeAt!;
    const admission = admitCircuitRequest('twelve_data', firstNextProbeAt);
    expect(admission.isProbe).toBe(true);

    recordCircuitFailure('twelve_data', firstNextProbeAt); // the trial itself failed

    const snap = circuitSnapshot('twelve_data', firstNextProbeAt);
    expect(snap.status).toBe('open'); // reopened, not stuck half-open or left claimed
    expect(snap.nextProbeAt!).toBeGreaterThan(firstNextProbeAt); // backoff grew, not reset to the same window
    // The claim was released as part of reopening - once THIS new backoff
    // window elapses, a trial can be claimed again (proves `probing` isn't
    // stuck `true` forever).
    const secondNextProbeAt = snap.nextProbeAt!;
    expect(admitCircuitRequest('twelve_data', secondNextProbeAt)).toEqual({ allowed: true, isProbe: true });
  });

  it('repeated failures cap backoff at 300s base before jitter, even across many claimed-and-failed trials', () => {
    let now = T0;
    recordCircuitFailure('twelve_data', now);
    for (let i = 0; i < 10; i++) {
      const snap = circuitSnapshot('twelve_data', now);
      now = snap.nextProbeAt!;
      const admission = admitCircuitRequest('twelve_data', now);
      expect(admission.isProbe).toBe(true); // each cycle claims cleanly - never left stuck from the previous one
      recordCircuitFailure('twelve_data', now);
    }
    const finalSnap = circuitSnapshot('twelve_data', now);
    expect(finalSnap.nextProbeAt! - now).toBeLessThanOrEqual(300_000);
  });

  it('releaseCircuitProbe frees a claimed-but-never-attempted trial for a later caller in the SAME window', () => {
    recordCircuitFailure('twelve_data', T0);
    const past = T0 + 31_000;

    const claimed = admitCircuitRequest('twelve_data', past);
    expect(claimed.isProbe).toBe(true);

    // The claimant aborts without ever actually contacting the provider
    // (e.g. no symbol mapping, or a quota denial) - releases the slot.
    releaseCircuitProbe('twelve_data');

    // A later caller, still within the SAME half-open window, can now claim it.
    const reclaimed = admitCircuitRequest('twelve_data', past + 1);
    expect(reclaimed).toEqual({ allowed: true, isProbe: true });
  });

  it('releaseCircuitProbe on a provider with no state at all is a safe no-op', () => {
    expect(() => releaseCircuitProbe('alpaca')).not.toThrow();
  });

  it('Twelve Data and Alpaca half-open claims are fully independent', () => {
    recordCircuitFailure('twelve_data', T0);
    recordCircuitFailure('alpaca', T0);
    const past = T0 + 31_000;

    const tdClaim = admitCircuitRequest('twelve_data', past);
    expect(tdClaim.isProbe).toBe(true);

    // Alpaca's own half-open slot is untouched by Twelve Data's claim.
    const alpacaClaim = admitCircuitRequest('alpaca', past);
    expect(alpacaClaim).toEqual({ allowed: true, isProbe: true });
  });
});

describe('circuitSnapshot - read-only observability', () => {
  it('never mutates state - calling it repeatedly does not change the outcome', () => {
    recordCircuitFailure('twelve_data', T0);
    const a = circuitSnapshot('twelve_data', T0);
    const b = circuitSnapshot('twelve_data', T0);
    expect(a).toEqual(b);
  });

  it('reports openedAt/nextProbeAt as null for a closed circuit', () => {
    const snap = circuitSnapshot('twelve_data', T0);
    expect(snap.status).toBe('closed');
    expect(snap.openedAt).toBeNull();
    expect(snap.nextProbeAt).toBeNull();
  });
});
