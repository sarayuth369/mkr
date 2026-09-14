import { describe, expect, it } from 'vitest';
import { isRegularSession, resolveBucketStart, resolveIsSameBucket, resolveNextBucketStart, sessionPolicyForCategory } from '../src/market/session-policy';

describe('sessionPolicyForCategory - evidence-based category mapping (schema.sql)', () => {
  it('us_stock and indices resolve to the exchange (NYSE-hours) policy - the two categories the Task 3 audit identified as most-affected', () => {
    expect(sessionPolicyForCategory('us_stock')).toMatchObject({ kind: 'exchange', timezone: 'America/New_York' });
    expect(sessionPolicyForCategory('indices')).toMatchObject({ kind: 'exchange', timezone: 'America/New_York' });
  });

  it('gold, forex, and crypto resolve to the continuous/UTC policy - no exchange-session model forced onto them without evidence (Task 5 explicit instruction)', () => {
    expect(sessionPolicyForCategory('gold')).toEqual({ kind: 'continuous', timezone: 'UTC' });
    expect(sessionPolicyForCategory('forex')).toEqual({ kind: 'continuous', timezone: 'UTC' });
    expect(sessionPolicyForCategory('crypto')).toEqual({ kind: 'continuous', timezone: 'UTC' });
  });

  it('thailand falls back to continuous/UTC - schema.sql seeds SET/SET50 with NULL provider symbols for both Twelve Data and Alpaca, so no live tick data can ever evidence a session model for them', () => {
    expect(sessionPolicyForCategory('thailand')).toEqual({ kind: 'continuous', timezone: 'UTC' });
  });

  it('an unrecognized/future category never throws - falls back to continuous/UTC safely', () => {
    expect(sessionPolicyForCategory('commodity')).toEqual({ kind: 'continuous', timezone: 'UTC' });
    expect(sessionPolicyForCategory('made_up_category')).toEqual({ kind: 'continuous', timezone: 'UTC' });
  });
});

describe('isRegularSession - session open/close', () => {
  const NYSE = sessionPolicyForCategory('us_stock');

  it('true during a normal weekday regular session (Tuesday 10:00 EDT)', () => {
    // 2026-09-15 is a Tuesday; 14:00 UTC = 10:00 EDT.
    expect(isRegularSession(Date.UTC(2026, 8, 15, 14, 0, 0), NYSE)).toBe(true);
  });

  it('false before the 09:30 ET open on a normal weekday', () => {
    // 13:00 UTC = 09:00 EDT - before open.
    expect(isRegularSession(Date.UTC(2026, 8, 15, 13, 0, 0), NYSE)).toBe(false);
  });

  it('false at/after the 16:00 ET close on a normal weekday', () => {
    // 20:00 UTC = 16:00 EDT - exactly at close, session end is exclusive.
    expect(isRegularSession(Date.UTC(2026, 8, 15, 20, 0, 0), NYSE)).toBe(false);
  });

  it('true at the exact 09:30 ET open (inclusive)', () => {
    expect(isRegularSession(Date.UTC(2026, 8, 15, 13, 30, 0), NYSE)).toBe(true);
  });

  it('false on Saturday, any time', () => {
    // 2026-09-19 is a Saturday.
    expect(isRegularSession(Date.UTC(2026, 8, 19, 14, 0, 0), NYSE)).toBe(false);
  });

  it('false on Sunday, any time', () => {
    // 2026-09-20 is a Sunday.
    expect(isRegularSession(Date.UTC(2026, 8, 20, 14, 0, 0), NYSE)).toBe(false);
  });

  it('correctly uses EST hours (13:30-20:00 UTC changes to 14:30-21:00 UTC) outside DST', () => {
    // 2026-01-15 is a Thursday, outside DST. 15:00 UTC = 10:00 EST - within session.
    expect(isRegularSession(Date.UTC(2026, 0, 15, 15, 0, 0), NYSE)).toBe(true);
    // 14:00 UTC = 09:00 EST - before the 09:30 EST open.
    expect(isRegularSession(Date.UTC(2026, 0, 15, 14, 0, 0), NYSE)).toBe(false);
  });

  it('continuous-policy assets (gold/forex/crypto) always report true - no "out of session" concept exists for them without evidence', () => {
    const gold = sessionPolicyForCategory('gold');
    expect(isRegularSession(Date.UTC(2026, 8, 19, 3, 0, 0), gold)).toBe(true); // Saturday 3am
  });
});

describe('resolveBucketStart / resolveNextBucketStart / resolveIsSameBucket - the actual bug fix', () => {
  const NYSE = sessionPolicyForCategory('us_stock');
  const CONTINUOUS = sessionPolicyForCategory('gold');

  it('1D: an exchange-policy asset buckets by exchange-local calendar day, not UTC day', () => {
    // 2026-09-14 02:00 UTC = 2026-09-13 22:00 EDT - still Sept 13 in New York.
    const tick = Date.UTC(2026, 8, 14, 2, 0, 0);
    const exchangeBucket = resolveBucketStart(tick, 'd1', NYSE);
    const continuousBucket = resolveBucketStart(tick, 'd1', CONTINUOUS);

    expect(exchangeBucket).toBe(Date.UTC(2026, 8, 13, 4, 0, 0)); // Sept 13 00:00 EDT
    expect(continuousBucket).toBe(Date.UTC(2026, 8, 14, 0, 0, 0)); // old/unchanged UTC-day behavior for continuous assets
    expect(exchangeBucket).not.toBe(continuousBucket); // this divergence IS the fix
  });

  it('1W: derives from the same exchange-local policy, Monday-start in exchange-local time', () => {
    // 2026-09-17 is a Thursday. Its exchange-local week should start Monday 2026-09-14.
    const tick = Date.UTC(2026, 8, 17, 14, 0, 0);
    const weekStart = resolveBucketStart(tick, 'w1', NYSE);
    expect(weekStart).toBe(Date.UTC(2026, 8, 14, 4, 0, 0)); // Monday Sept 14, 00:00 EDT
  });

  it('1M: derives from the same exchange-local policy', () => {
    const tick = Date.UTC(2026, 8, 17, 14, 0, 0);
    const monthStart = resolveBucketStart(tick, 'mo1', NYSE);
    expect(monthStart).toBe(Date.UTC(2026, 8, 1, 4, 0, 0)); // Sept 1, 00:00 EDT
  });

  it('m1/m5/m15/h1/h4 are byte-identical between exchange and continuous policies - only d1/w1/mo1 are session-aware', () => {
    const tick = Date.UTC(2026, 8, 14, 13, 37, 0);
    for (const tf of ['m1', 'm5', 'm15', 'h1', 'h4'] as const) {
      expect(resolveBucketStart(tick, tf, NYSE)).toBe(resolveBucketStart(tick, tf, CONTINUOUS));
    }
  });

  it('resolveIsSameBucket correctly identifies a tick within the same exchange-local day', () => {
    const dayStart = resolveBucketStart(Date.UTC(2026, 8, 14, 14, 0, 0), 'd1', NYSE);
    const laterSameDay = Date.UTC(2026, 8, 14, 19, 59, 0); // still Sept 14 in New York
    const nextDay = Date.UTC(2026, 8, 15, 5, 0, 0); // now Sept 15 in New York
    expect(resolveIsSameBucket(laterSameDay, dayStart, 'd1', NYSE)).toBe(true);
    expect(resolveIsSameBucket(nextDay, dayStart, 'd1', NYSE)).toBe(false);
  });

  it('resolveNextBucketStart for 1D under an exchange policy is a full exchange-local calendar day later, DST-safe', () => {
    const dayStart = resolveBucketStart(Date.UTC(2026, 2, 7, 12, 0, 0), 'd1', NYSE); // day before spring-forward
    const next = resolveNextBucketStart(dayStart, 'd1', NYSE);
    expect(next).toBe(resolveBucketStart(Date.UTC(2026, 2, 8, 12, 0, 0), 'd1', NYSE)); // spring-forward day itself
  });
});

describe('reconciles with the pre-existing UTC-only behavior (regression proof - continuous policy never changes)', () => {
  it('every timeframe under a continuous policy matches the exact pre-Task-5 UTC bucket math', () => {
    const CONTINUOUS = sessionPolicyForCategory('crypto');
    const tick = Date.UTC(2026, 8, 14, 10, 23, 41);
    // Hand-computed expected UTC buckets (matches timeframe-bucket.test.ts's own assertions).
    expect(resolveBucketStart(tick, 'm1', CONTINUOUS)).toBe(Date.UTC(2026, 8, 14, 10, 23, 0));
    expect(resolveBucketStart(tick, 'd1', CONTINUOUS)).toBe(Date.UTC(2026, 8, 14, 0, 0, 0));
    expect(resolveBucketStart(tick, 'w1', CONTINUOUS)).toBe(Date.UTC(2026, 8, 14, 0, 0, 0)); // Sept 14 2026 is itself a Monday
    expect(resolveBucketStart(tick, 'mo1', CONTINUOUS)).toBe(Date.UTC(2026, 8, 1, 0, 0, 0));
  });
});
