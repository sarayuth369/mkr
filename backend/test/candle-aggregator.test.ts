import { describe, expect, it } from 'vitest';
import { CandleAggregator } from '../src/market/candle-aggregator';
import type { NormalizedCandle } from '../src/types';

const M1_BUCKET = Date.UTC(2026, 8, 14, 10, 23, 0);
const t = (secondsIntoMinute: number) => M1_BUCKET + secondsIntoMinute * 1000;

describe('CandleAggregator', () => {
  it('creates a fresh candle from the first tick - open=high=low=close=that price', () => {
    const agg = new CandleAggregator();
    const result = agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
    expect(result.current).toMatchObject({ open: 100, high: 100, low: 100, close: 100, closed: false });
    expect(result.rolledOverFrom).toBeNull();
  });

  describe('high/low/close update within the same bucket', () => {
    it('high tracks the max, low tracks the min, close follows the latest-by-event-time tick', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data');
      agg.ingest('AAPL', 'm1', 98, t(20), 'twelve_data');
      const result = agg.ingest('AAPL', 'm1', 102, t(30), 'twelve_data');

      expect(result.current).toMatchObject({ open: 100, high: 105, low: 98, close: 102 });
    });
  });

  describe('bucket rollover', () => {
    it('a tick in the next minute closes the previous candle and opens a fresh one', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 110, t(50), 'twelve_data');

      const result = agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data');

      expect(result.rolledOverFrom).toMatchObject({ open: 100, high: 110, low: 100, close: 110, closed: true });
      expect(result.current).toMatchObject({ open: 120, high: 120, low: 120, close: 120, closed: false });
      expect(result.current.timestamp).toBe(M1_BUCKET + 60_000);
    });

    it('the rolled-over candle is retrievable as getLastClosed', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data');

      expect(agg.getLastClosed('AAPL', 'm1')).toMatchObject({ close: 100, closed: true });
    });
  });

  describe('duplicate tick', () => {
    it('re-applying the exact same tick is idempotent (open/high/low/close unchanged)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data');
      const before = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      agg.ingest('AAPL', 'm1', 105, t(10), 'twelve_data'); // exact duplicate
      const after = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      expect(after).toEqual(before);
    });
  });

  describe('out-of-order tick policy', () => {
    it('a late tick that still falls within the current bucket updates high/low but NOT close (close follows event time, not arrival order)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(10), 'twelve_data');
      agg.ingest('AAPL', 'm1', 105, t(30), 'twelve_data'); // "latest" close so far

      const result = agg.ingest('AAPL', 'm1', 200, t(5), 'twelve_data'); // arrives late, but its event time (t(5)) is EARLIER than t(30)

      expect(result.current.high).toBe(200); // still affects high...
      expect(result.current.close).toBe(105); // ...but does not become the close
    });

    it('a tick whose bucket is strictly before the current bucket is ignored, never reopening a closed candle', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data'); // rolls over to the next minute
      const beforeStale = agg.getCurrent('AAPL', 'm1', 'twelve_data');

      const result = agg.ingest('AAPL', 'm1', 999, t(5), 'twelve_data'); // belongs to the now-closed prior bucket

      expect(result.ignoredAsStale).toBe(true);
      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toEqual(beforeStale); // current bucket untouched
    });
  });

  describe('multiple symbols and multiple timeframes are independent', () => {
    it('ticks for one symbol never affect another symbol\'s candle', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('XAU/USD', 'm1', 3450, t(1), 'twelve_data');

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')?.close).toBe(100);
      expect(agg.getCurrent('XAU/USD', 'm1', 'twelve_data')?.close).toBe(3450);
    });

    it('the same symbol tracks m1 and m5 candles independently from the same ticks', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm5', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 110, M1_BUCKET + 61_000, 'twelve_data'); // rolls m1 over
      agg.ingest('AAPL', 'm5', 110, M1_BUCKET + 61_000, 'twelve_data'); // still the same m5 bucket

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
      agg.ingest('AAPL', 'm1', 200, t(1), 'twelve_data');
      agg.seed('AAPL', 'm1', historical, Date.now());
      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')?.open).toBe(200);
    });

    it('seedLastClosed() never overwrites a real closed candle from an actual rollover', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data'); // real rollover -> lastClosed = {open:100,...}
      agg.seedLastClosed('AAPL', 'm1', historical, Date.now());
      expect(agg.getLastClosed('AAPL', 'm1')?.open).toBe(100);
    });
  });

  describe('cleanup lifecycle (Decision 15)', () => {
    it('clear() removes both current and lastClosed state for a (symbol, timeframe)', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm1', 120, M1_BUCKET + 61_000, 'twelve_data');

      agg.clear('AAPL', 'm1');

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toBeNull();
      expect(agg.getLastClosed('AAPL', 'm1')).toBeNull();
    });

    it('clear() for one (symbol, timeframe) does not affect another', () => {
      const agg = new CandleAggregator();
      agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
      agg.ingest('AAPL', 'm5', 100, t(1), 'twelve_data');

      agg.clear('AAPL', 'm1');

      expect(agg.getCurrent('AAPL', 'm1', 'twelve_data')).toBeNull();
      expect(agg.getCurrent('AAPL', 'm5', 'twelve_data')).not.toBeNull();
    });
  });

  it('never fabricates volume - always null (provider WS tick frame carries none)', () => {
    const agg = new CandleAggregator();
    const result = agg.ingest('AAPL', 'm1', 100, t(1), 'twelve_data');
    expect(result.current.volume).toBeNull();
  });
});
