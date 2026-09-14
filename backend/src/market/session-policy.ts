import type { MkrTimeframe } from '../types';
import { addLocalDays, localMidnightUtc, localMonthStartUtc, localNextMonthStartUtc, minutesOfDay, weekdayAt } from './exchange-timezone';
import { bucketStart as utcBucketStart, nextBucketStart as utcNextBucketStart } from './timeframe-bucket';

/**
 * Centralized session/bucket policy - the one place asset-class timezone
 * semantics live, instead of scattered through the candle engine (Task 5's
 * explicit requirement). Built strictly from evidence in the current
 * codebase: `schema.sql`'s real, currently-seeded `category` column
 * (`gold | us_stock | indices | forex | crypto | thailand | commodity |
 * rate | other`) - no asset semantics were invented beyond what that data
 * and the Task 3 audit's own findings already establish.
 *
 * Only two policy kinds exist:
 *
 * - `exchange`: a real regular trading session in a specific IANA
 *   timezone (`us_stock`, `indices` - both trade on US exchange hours;
 *   Twelve Data's own `NDX`/`SPX`/`DJI`/`RUT`/`VIX` index symbols track US
 *   market hours too, confirmed by their symbol/category pairing in
 *   schema.sql, not invented here). d1/w1/mo1 buckets align to the
 *   EXCHANGE's local calendar day/week/month, not UTC.
 *
 * - `continuous`: no evidence justifies forcing an exchange-session model
 *   (`gold`, `forex`, `crypto`, and everything else, including
 *   `thailand` - SET/SET50 are seeded with NULL provider symbols for
 *   BOTH Twelve Data and Alpaca, so no live tick data can ever reach them
 *   through either currently-integrated provider; there is no live
 *   behavior to evidence a Thai session model from, so they fall back to
 *   the same continuous/UTC policy as everything else unmapped - this is
 *   a documented limitation, not a claim that UTC is "correct" for SET).
 *   d1/w1/mo1 buckets remain the pre-existing UTC calendar boundaries -
 *   unchanged behavior, matching the Task 3 audit's own LOW/LOW-MEDIUM
 *   severity assessment for crypto/FX and explicit instruction not to
 *   force an exchange model onto 24/5 or 24/7 instruments without
 *   evidence.
 *
 * m1/m5/m15/h1/h4 are NEVER session-aware for either policy kind - they
 * stay exactly the existing fixed-duration, UTC-epoch-aligned buckets
 * from timeframe-bucket.ts, per Task 5's explicit "preserve 1m-4H
 * behavior unless session alignment requires a targeted correction"
 * instruction. Only d1/w1/mo1 ever consult a session policy.
 */
export type SessionKind = 'exchange' | 'continuous';

export interface SessionPolicy {
  kind: SessionKind;
  /** IANA timezone. Only meaningful for `exchange` - `continuous` always uses UTC, unchanged from before this task. */
  timezone: string;
  /** Regular session window, exchange-local minutes-of-day [start, end). Only meaningful for `exchange`. */
  regularSession?: { startMinutes: number; endMinutes: number };
}

// NYSE/NASDAQ regular session: 09:30-16:00 America/New_York. NOT
// holiday-aware (see class doc / ADR) - only weekday + time-of-day.
const US_EXCHANGE_POLICY: SessionPolicy = {
  kind: 'exchange',
  timezone: 'America/New_York',
  regularSession: { startMinutes: 9 * 60 + 30, endMinutes: 16 * 60 },
};

const CONTINUOUS_POLICY: SessionPolicy = { kind: 'continuous', timezone: 'UTC' };

/** `category` is `SymbolRow.category` from schema.sql - a plain string column, not an enum in code, so this stays a runtime lookup rather than a type union (an unrecognized/future category safely falls back to `continuous`, never throws). */
export function sessionPolicyForCategory(category: string): SessionPolicy {
  if (category === 'us_stock' || category === 'indices') return US_EXCHANGE_POLICY;
  return CONTINUOUS_POLICY;
}

const CALENDAR_TIMEFRAMES: ReadonlySet<MkrTimeframe> = new Set(['d1', 'w1', 'mo1']);

/**
 * Weekday-and-time-of-day regular-session check for `exchange` policies -
 * NOT holiday-aware (documented limitation: no holiday calendar exists in
 * this codebase or its dependencies, and Task 5 explicitly forbids
 * inventing one). Always `true` for `continuous` policies - there is no
 * "out of session" concept for a 24/7 or provider-gated-24/5 instrument
 * that this codebase has evidence for; whatever ticks the provider sends
 * are accepted as-is, matching pre-existing behavior.
 */
export function isRegularSession(utcMs: number, policy: SessionPolicy): boolean {
  if (policy.kind === 'continuous' || !policy.regularSession) return true;
  const weekday = weekdayAt(utcMs, policy.timezone);
  if (weekday === 0 || weekday === 6) return false; // Sunday/Saturday - always known-closed, no calendar needed
  const minutes = minutesOfDay(utcMs, policy.timezone);
  return minutes >= policy.regularSession.startMinutes && minutes < policy.regularSession.endMinutes;
}

/**
 * The session-aware bucket start for `timeframe` under `policy`. For
 * m1/m5/m15/h1/h4, and for ANY timeframe under a `continuous` policy,
 * this is byte-identical to the pre-existing `timeframe-bucket.ts` UTC
 * math (zero behavior change). Only d1/w1/mo1 under an `exchange` policy
 * take the new exchange-local path.
 */
export function resolveBucketStart(utcMs: number, timeframe: MkrTimeframe, policy: SessionPolicy): number {
  if (policy.kind === 'continuous' || !CALENDAR_TIMEFRAMES.has(timeframe)) {
    return utcBucketStart(utcMs, timeframe);
  }
  const tz = policy.timezone;
  if (timeframe === 'd1') return localMidnightUtc(utcMs, tz);
  if (timeframe === 'w1') {
    const dayStart = localMidnightUtc(utcMs, tz);
    const weekday = weekdayAt(dayStart, tz); // 0=Sun..6=Sat
    const daysSinceMonday = (weekday + 6) % 7;
    return addLocalDays(dayStart, -daysSinceMonday, tz);
  }
  // mo1
  return localMonthStartUtc(utcMs, tz);
}

export function resolveNextBucketStart(bucketStartMs: number, timeframe: MkrTimeframe, policy: SessionPolicy): number {
  if (policy.kind === 'continuous' || !CALENDAR_TIMEFRAMES.has(timeframe)) {
    return utcNextBucketStart(bucketStartMs, timeframe);
  }
  const tz = policy.timezone;
  if (timeframe === 'd1') return addLocalDays(bucketStartMs, 1, tz);
  if (timeframe === 'w1') return addLocalDays(bucketStartMs, 7, tz);
  return localNextMonthStartUtc(bucketStartMs, tz);
}

export function resolveIsSameBucket(utcMs: number, bucketStartMs: number, timeframe: MkrTimeframe, policy: SessionPolicy): boolean {
  return utcMs >= bucketStartMs && utcMs < resolveNextBucketStart(bucketStartMs, timeframe, policy);
}
