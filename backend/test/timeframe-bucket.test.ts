import { describe, expect, it } from 'vitest';
import { bucketStart, isSameBucket, nextBucketStart } from '../src/market/timeframe-bucket';
import type { MkrTimeframe } from '../src/types';

describe('bucketStart', () => {
  const t = Date.UTC(2026, 8, 14, 10, 23, 41); // 2026-09-14T10:23:41.000Z

  it('m1: 10:23:41 -> 10:23:00', () => {
    expect(new Date(bucketStart(t, 'm1')).toISOString()).toBe('2026-09-14T10:23:00.000Z');
  });

  it('m5: 10:23:41 -> 10:20:00', () => {
    expect(new Date(bucketStart(t, 'm5')).toISOString()).toBe('2026-09-14T10:20:00.000Z');
  });

  it('m15: 10:23:41 -> 10:15:00', () => {
    expect(new Date(bucketStart(t, 'm15')).toISOString()).toBe('2026-09-14T10:15:00.000Z');
  });

  it('h1: 10:23:41 -> 10:00:00', () => {
    expect(new Date(bucketStart(t, 'h1')).toISOString()).toBe('2026-09-14T10:00:00.000Z');
  });

  it('h4: 10:23:41 -> 08:00:00 (UTC-epoch-aligned 4h buckets)', () => {
    expect(new Date(bucketStart(t, 'h4')).toISOString()).toBe('2026-09-14T08:00:00.000Z');
  });

  it('d1: -> 2026-09-14T00:00:00Z (UTC calendar day)', () => {
    expect(new Date(bucketStart(t, 'd1')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('w1: Monday 2026-09-14 -> itself (already a Monday, UTC ISO week)', () => {
    expect(new Date(bucketStart(t, 'w1')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('w1: mid-week (Thursday) rolls back to that week\'s Monday', () => {
    const thursday = Date.UTC(2026, 8, 17, 15, 0, 0); // 2026-09-17 is a Thursday
    expect(new Date(bucketStart(thursday, 'w1')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('w1: Sunday rolls back to the PRECEDING Monday, not forward', () => {
    const sunday = Date.UTC(2026, 8, 20, 23, 0, 0); // 2026-09-20 is a Sunday
    expect(new Date(bucketStart(sunday, 'w1')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('mo1: -> 2026-09-01T00:00:00Z (UTC calendar month)', () => {
    expect(new Date(bucketStart(t, 'mo1')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('is deterministic and pure - same input always produces the same output', () => {
    const timeframes: MkrTimeframe[] = ['m1', 'm5', 'm15', 'h1', 'h4', 'd1', 'w1', 'mo1'];
    for (const tf of timeframes) expect(bucketStart(t, tf)).toBe(bucketStart(t, tf));
  });

  it('uses explicit UTC math, never the host machine local timezone', () => {
    // A timestamp exactly at a UTC midnight must bucket to itself for d1,
    // regardless of what timezone the process happens to run in.
    const utcMidnight = Date.UTC(2026, 8, 14, 0, 0, 0);
    expect(bucketStart(utcMidnight, 'd1')).toBe(utcMidnight);
  });
});

describe('nextBucketStart / isSameBucket', () => {
  it('m1 bucket boundary: the last ms of a bucket is inside it, the next ms is not', () => {
    const start = Date.UTC(2026, 8, 14, 10, 23, 0);
    const end = nextBucketStart(start, 'm1');
    expect(end).toBe(Date.UTC(2026, 8, 14, 10, 24, 0));
    expect(isSameBucket(end - 1, start, 'm1')).toBe(true);
    expect(isSameBucket(end, start, 'm1')).toBe(false);
  });

  it('mo1 rollover crosses a year boundary correctly (Dec -> Jan)', () => {
    const dec = Date.UTC(2026, 11, 1);
    expect(nextBucketStart(dec, 'mo1')).toBe(Date.UTC(2027, 0, 1));
  });

  it('w1 rollover is exactly 7 days later', () => {
    const monday = Date.UTC(2026, 8, 14);
    expect(nextBucketStart(monday, 'w1')).toBe(monday + 7 * 86_400_000);
  });
});
