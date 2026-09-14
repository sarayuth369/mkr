import type { MkrTimeframe } from '../types';

/**
 * Centralized bucket-boundary math for server-side candle aggregation - the
 * single place every timeframe's "which candle does this tick belong to"
 * rule lives, so it's never duplicated/drifted across files.
 *
 * All math is explicit UTC (Date.UTC / getUTCFullYear etc.) - never the
 * local machine's timezone, per the architecture decision. This is a
 * deliberately simple, documented policy, not a full market-session/
 * exchange-calendar system: `d1`/`w1`/`mo1` buckets align to the UTC
 * calendar day/week/month, not to any individual exchange's actual trading
 * session (US equities close at 21:00 UTC / 20:00 UTC DST, not midnight
 * UTC; FX/crypto have their own session conventions). Building a real
 * per-asset-class session calendar is out of scope for this task (see
 * ADR Decision 13, still deferred) - this bucketing is the safe, explicit,
 * testable policy in the meantime, and every consumer of these buckets
 * should treat `d1`/`w1`/`mo1` as "UTC calendar day/week/month", not as
 * "this asset's trading day".
 */
const FIXED_DURATION_MS: Partial<Record<MkrTimeframe, number>> = {
  m1: 60_000,
  m5: 5 * 60_000,
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000,
};

/** `null` for the three calendar-based timeframes (d1/w1/mo1), whose bucket length varies (a month isn't a fixed number of ms). */
export function fixedDurationMsFor(timeframe: MkrTimeframe): number | null {
  return FIXED_DURATION_MS[timeframe] ?? null;
}

/** Deterministic UTC bucket-start epoch ms for `timestamp` under `timeframe`. */
export function bucketStart(timestampMs: number, timeframe: MkrTimeframe): number {
  const fixedMs = fixedDurationMsFor(timeframe);
  if (fixedMs !== null) return Math.floor(timestampMs / fixedMs) * fixedMs;

  const d = new Date(timestampMs);
  if (timeframe === 'd1') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (timeframe === 'w1') {
    // ISO-ish: week starts Monday 00:00 UTC. getUTCDay() is 0=Sunday..6=Saturday.
    const dayOfWeek = d.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysSinceMonday * 86_400_000;
  }
  if (timeframe === 'mo1') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

  // Unreachable: fixedDurationMsFor covers m1/m5/m15/h1/h4, the three ifs above cover d1/w1/mo1 - all 8 MkrTimeframe values.
  throw new Error(`Unhandled timeframe: ${String(timeframe)}`);
}

/** The bucket boundary immediately after `bucketStartMs` - i.e. when the current candle closes and the next one opens. */
export function nextBucketStart(bucketStartMs: number, timeframe: MkrTimeframe): number {
  const fixedMs = fixedDurationMsFor(timeframe);
  if (fixedMs !== null) return bucketStartMs + fixedMs;

  const d = new Date(bucketStartMs);
  if (timeframe === 'd1') return bucketStartMs + 86_400_000;
  if (timeframe === 'w1') return bucketStartMs + 7 * 86_400_000;
  if (timeframe === 'mo1') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);

  // Unreachable: fixedDurationMsFor covers m1/m5/m15/h1/h4, the three ifs above cover d1/w1/mo1 - all 8 MkrTimeframe values.
  throw new Error(`Unhandled timeframe: ${String(timeframe)}`);
}

export function isSameBucket(timestampMs: number, bucketStartMs: number, timeframe: MkrTimeframe): boolean {
  return timestampMs >= bucketStartMs && timestampMs < nextBucketStart(bucketStartMs, timeframe);
}
