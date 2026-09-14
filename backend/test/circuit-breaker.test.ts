import { afterEach, describe, expect, it } from 'vitest';
import { _resetCircuitsForTests, circuitSnapshot, circuitStatus, isCircuitOpen, recordCircuitFailure, recordCircuitSuccess } from '../src/providers/circuit-breaker';

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
