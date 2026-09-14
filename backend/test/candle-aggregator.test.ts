import { describe, expect, it } from 'vitest';
import { CandleAggregator } from '../src/market/candle-aggregator';
import type { SessionPolicy } from '../src/market/session-policy';
import type { NormalizedCandle } from '../src/types';

const M1_BUCKET = Date.UTC(2026, 8, 14, 10, 23, 0);
const t = (secondsIntoMinute: number) => M1_BUCKET + secondsIntoMinute * 1000;

// These tests predate Task 5's session-policy parameter and were written
// against pure UTC bucket math - passing the `continuous` policy here
// reproduces that exact pre-existing behavior byte-for-byte (see
// session-policy.ts: `continuous` always falls through to the unchanged
// timeframe-bucket.ts UTC math). Session-aware (`exchange`) behavior is
// covered separately in session-policy.test.ts and exchange-timezone.test.ts.
const UTC: SessionPolicy = { kind: 'continuous', timezone: 'UTC' };

describe('CandleAggregator', () => {
  it('creates a fresh candle from the first tick - open=high=low=close=that price', () => {
    const agg = new CandleAggregator();
    const result = agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
    expect(result.current).toMatchObject({ open: 100, high: 100, low: 100, close: 100, closed: false });
    expect(result.rolledOverFrom).toBeNull();
  });

  describe('high/low/close update within the same bucket', () => {
    it('high tracks the max, low tracks the min, close follows the latest-by-event-time tick', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 98, t(20), 'twelve_data', UTC);
      const result = agg.ingest('AAPL', 'm1', 102, t(30), 'twelve_data', UTC);

      expect(result.current).toMatchObject({ open: 100, high: 105, low: 98, close: 102 });
    });
  });

  describe('bucket rollover', () => {
    it('a tick in the next minute closes the previous candle and opens a fresh one', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 110, t(50), 'twelve_data', UTC);

      const result = agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data', UTC);

      expect(result.rolledOverFrom).toMatchObject({ open: 100, high: 110, low: 100, close: 110, closed: true });
      expect(result.current).toMatchObject({ open: 120, high: 120, low: 120, close: 120, closed: false });
      expect(result.current.timestamp).toBe(M1_BUCKET + 60_000);
    });

    it('the rolled-over candle is retrievable as getLastClosed', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data', UTC);

      expect(agg.getLastClosed('AAPL', 'm1')).toMatchObject({ close: 100, closed: true });
    });
  });

  describe('duplicate tick', () => {
    it('re-applying the exact same tick is idempotent (open/high/low/close unchanged)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data', UTC);
      const before = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data', UTC); // exact duplicate
      const after = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      expect(after).toEqual(before);
    });
  });

  describe('out-of-order tick policy', () => {
    it('a late tick that still falls within the current bucket updates high/low but NOT close (close follows event time, not arrival order)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(10), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 105, t(30), 'twelve_data', UTC); // "latest" close so far

      const result = agg.ingest('AAPL', 'm1', 200, t(5), 'twelve_data', UTC); // arrives late, but its event time (t(5)) is EARLIER than t(30)

      expect(result.current.high).toBe(200); // still affects high...
      expect(result.current.close).toBe(105); // ...but does not become the close
    });

    it('a tick whose bucket is strictly before the current bucket is ignored, never reopening a closed candle', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data', UTC); // rolls over to the next minute
      const beforeStale = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      const result = agg.ingest('AAPL', 'm1', 999, t(5), 'twelve_data', UTC); // belongs to the now-closed prior bucket

      expect(result.ignoredAsStale).toBe(true);
      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toEqual(beforeStale); // current bucket untouched
    });
  });

  describe('multiple symbols and multiple timeframes are independent', () => {
    it('ticks for one symbol never affect another symbol\'s candle', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('XAU/USD', 'm1', 3450, t(1), 'twelve_data', UTC);

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')?.close).toBe(100);
      expect(agg.getCurrent('XAU/USD', 'm1', 'twelve_data')?.close).toBe(3450);
    });

    it('the same symbol tracks m1 and m5 candles independently from the same ticks', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm5', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 110, M1_BUCKET + 61_000, 'twelve_data', UTC); // rolls m1 over
      agg.ingest('AAPL', 'm5', 110, M1_BUCKET + 61_000, 'twelve_data', UTC); // still the same m5 bucket

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')?.open).toBe(110); // m1 rolled over
      expect(agg.getCurrent('AAPL', 'm5', 'twelve_data')?.open).toBe(100); // m5 did not
      expect(agg.getCurrent('AAPL', 'm5', 'twelve_data')?.close).toBe(110);
    });
  });

  describe('reconciliation seeding (Decision 8)', () => {
    const historical: NormalizedCandle = {
      symbol: 'AAPL',
      interval: 'm1',
      timestamp: M1_BUCKET,
      open: 90,
      high: 95,
      low: 88,
      close: 93,
      volume: 1000,
      source: 'twelve_data',
    };

    it('seed() initializes the current bucket from a historical candle', () => {
      const agg = new CandleAggregator();
      agg.seed('AAPL', 'm1', historical, Date.now());
      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toMatchObject({ open: 90, high: 95, low: 88, close: 93 });
    });

    it('seed() never overwrites a live bucket that already exists (would clobber real ticks with a stale REST fetch)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 200, t(1), 'twelve_data', UTC);
      agg.seed('AAPL', 'm1', historical, Date.now());
      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')?.open).toBe(200);
    });

    it('seedLastClosed() never overwrites a real closed candle from an actual rollover', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data', UTC); // real rollover -> lastClosed = {open:100,...}
      agg.seedLastClosed('AAPL', 'm1', historical, Date.now());
      expect(agg.getLastClosed('AAPL', 'm1')?.open).toBe(100);
    });
  });

  describe('cleanup lifecycle (Decision 15)', () => {
    it('clear() removes both current and lastClosed state for a (symbol, timeframe)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data', UTC);

      agg.clear('AAPL', 'm1');

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toBeNull();
      expect(agg.getLastClosed('AAPL', 'm1')).toBeNull();
    });

    it('clear() for one (symbol, timeframe) does not affect another', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
      agg.ingest('AAPL', 'm5', 100, t(1), 'twelve_data', UTC);

      agg.clear('AAPL', 'm1');

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toBeNull();
      expect(agg.getCurrent('AAPL', 'm5', 'twelve_data')).not.toBeNull();
    });
  });

  it('never fabricates volume - always null (provider WS tick frame carries none)', () => {
    const agg = new CandleAggregator();
    const result = agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data', UTC);
    expect(result.current.volume).toBeNull();
  });

  describe('exchange session policy (Task 5) - d1/w1/mo1 use exchange-local boundaries, m1-h4 unaffected', () => {
    const NYSE: SessionPolicy = { kind: 'exchange', timezone: 'America/New_York', regularSession: { startMinutes: 9 * 60 + 30, endMinutes: 16 * 60 } };

    it('a d1 candle under an exchange policy opens at exchange-local midnight, not UTC midnight', () => {
      const agg = new CandleAggregator();
      // 2026-09-14 13:35:00 UTC = 2026-09-14 09:35:00 America/New_York (EDT, UTC-4) - just after the 09:30 open.
      const tickUtc = Date.UTC(2026, 8, 14, 13, 35, 0);
      const result = agg.ingest('AAPL', 'd1', 230, tickUtc, 'twelve_data', NYSE);
      // Exchange-local midnight for 2026-09-14 America/New_York = 2026-09-14T04:00:00Z (EDT, UTC-4).
      expect(result.current.timestamp).toBe(Date.UTC(2026, 8, 14, 4, 0, 0));
    });

    it('a d1 candle under a continuous policy still opens at UTC midnight - unaffected by Task 5', () => {
      const agg = new CandleAggregator();
      const tickUtc = Date.UTC(2026, 8, 14, 13, 35, 0);
      const result = agg.ingest('XAU/USD', 'd1', 3450, tickUtc, 'twelve_data', UTC);
      expect(result.current.timestamp).toBe(Date.UTC(2026, 8, 14, 0, 0, 0));
    });

    it('m1 buckets are byte-identical under an exchange policy and a continuous policy (only d1/w1/mo1 differ)', () => {
      const aggExchange = new CandleAggregator();
      const aggUtc = new CandleAggregator();
      const tickUtc = Date.UTC(2026, 8, 14, 13, 35, 20);
      const r1 = aggExchange.ingest('AAPL', 'm1', 230, tickUtc, 'twelve_data', NYSE);
      const r2 = aggUtc.ingest('AAPL', 'm1', 230, tickUtc, 'twelve_data', UTC);
      expect(r1.current.timestamp).toBe(r2.current.timestamp);
    });

    it('an early-UTC-day tick that is still yesterday in exchange-local time buckets into yesterday\'s d1 candle (the exact failure mode this task fixes)', () => {
      const agg = new CandleAggregator();
      // 2026-09-14 02:00:00 UTC = 2026-09-13 22:00:00 America/New_York (EDT) - still Sept 13 locally, after the close.
      const tickUtc = Date.UTC(2026, 8, 14, 2, 0, 0);
      const result = agg.ingest('AAPL', 'd1', 229, tickUtc, 'twelve_data', NYSE);
      // Under the OLD UTC-calendar-day policy this would have opened a "Sept 14" bucket (wrong).
      // Under the exchange-local policy it correctly belongs to Sept 13's local calendar day.
      expect(result.current.timestamp).toBe(Date.UTC(2026, 8, 13, 4, 0, 0)); // 2026-09-13T00:00 America/New_York = 2026-09-13T04:00Z (EDT)
    });

    it('a tick outside the regular session (e.g. 3am ET) is still aggregated into its exchange-local calendar-day bucket, not dropped or rejected - documented design decision, not an oversight', () => {
      // No evidence exists in this codebase that Twelve Data's WS feed
      // sends extended-hours ticks for us_stock/indices symbols (never
      // observed in production during this or prior tasks) - so this
      // aggregator deliberately does NOT filter/reject ticks based on
      // isRegularSession(). If a provider ever does send one, it is
      // correctly attributed to the right LOCAL CALENDAR DAY (the actual
      // bug this task fixes) rather than silently dropped or misattributed
      // to the wrong day. Whether such a tick SHOULD count toward a
      // "regular session only" candle is a policy question with no
      // current evidence to decide it - deferred, see the report.
      const agg = new CandleAggregator();
      // 07:00 UTC = 03:00 EDT - well before the 09:30 ET open.
      const tickUtc = Date.UTC(2026, 8, 15, 7, 0, 0); // Tuesday
      const result = agg.ingest('AAPL', 'd1', 231, tickUtc, 'twelve_data', NYSE);
      expect(result.ignoredAsStale).toBe(false);
      expect(result.current.close).toBe(231); // accepted, not dropped
      expect(result.current.timestamp).toBe(Date.UTC(2026, 8, 15, 4, 0, 0)); // correct exchange-local calendar day (Sept 15)
    });
  });
});
