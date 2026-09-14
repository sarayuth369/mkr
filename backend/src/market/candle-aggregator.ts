import type { MarketDataSource, MkrTimeframe, NormalizedCandle } from '../types';
import { bucketStart, isSameBucket } from './timeframe-bucket';

/** What a client actually receives - [NormalizedCandle]'s exact fields (same shape as the REST /candles response) plus the two realtime-only fields. */
export interface RealtimeCandle extends NormalizedCandle {
  /** Epoch ms of the tick that most recently updated this candle. */
  lastTickAt: number;
  /** `false` while still the live/open bucket; `true` once a later tick has rolled it over. */
  closed: boolean;
}

interface MutableBucket {
  bucketStart: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Timestamp of the tick that set `close` - NOT necessarily the last-received tick; see class doc. */
  closeTickTimestamp: number;
  lastTickAt: number;
}

export interface IngestResult {
  current: RealtimeCandle;
  /** Set only on the tick that rolls the bucket over - the now-final previous candle. */
  rolledOverFrom: RealtimeCandle | null;
  /** True when this tick was accepted into an already-closed, earlier bucket and intentionally NOT applied - see class doc's out-of-order policy. */
  ignoredAsStale: boolean;
}

/**
 * Pure, in-memory tick-to-candle aggregator - no I/O, no Cloudflare APIs,
 * fully unit-testable. One instance is owned by MarketStreamRoom and fed
 * every tick for every (symbol, timeframe) pair that has active candle
 * demand (see market-stream-do.ts) - never persisted tick-by-tick (Decision
 * 15/23: DO storage is for recovery/control state, not a time-series DB).
 *
 * Out-of-order / duplicate tick policy (Decision 6), stated explicitly
 * because the upstream tick in this codebase carries only a LOCAL RECEIPT
 * timestamp (`Date.now()` in market-stream-do.ts) - Twelve Data's frame
 * format used here has no embedded exchange timestamp to parse. Ticks
 * therefore arrive receipt-ordered by construction today; the policy below
 * exists as a defensive, explicit contract (protects against local clock
 * jitter and is ready if a provider ever supplies a real event timestamp)
 * rather than a scenario this deployment can currently produce on its own -
 * that limitation is documented, not hidden.
 *
 * The policy itself:
 * - `open` is set once, from the first tick that creates the bucket -
 *   never touched again by any later tick, in-order or not.
 * - `high`/`low` are the running max/min of every tick's price accepted
 *   into the CURRENT bucket, regardless of tick arrival order.
 * - `close` is the price of the tick with the GREATEST `tickTimestamp`
 *   accepted into the current bucket so far - i.e. "latest by event time",
 *   not "latest by arrival order". A duplicate tick (identical
 *   symbol/timestamp/price) is naturally idempotent under this rule: high/
 *   low/close are unchanged by re-applying the same values.
 * - A tick whose timestamp falls in a bucket STRICTLY BEFORE the current
 *   open bucket is deliberately NOT applied (`ignoredAsStale: true`) - by
 *   the time a bucket has rolled over, it may already have been fanned out
 *   to clients as closed/final; silently reopening and mutating a
 *   already-delivered candle would be worse than dropping one late tick.
 * - A tick whose timestamp falls in a bucket AFTER the current one triggers
 *   a normal rollover (see `ingest`), not "out of order" handling.
 */
export class CandleAggregator {
  private current = new Map<string, MutableBucket>(); // key: `${symbol}:${timeframe}`
  private lastClosed = new Map<string, RealtimeCandle>();

  private static key(symbol: string, timeframe: MkrTimeframe): string {
    return `${symbol}:${timeframe}`;
  }

  /** Seeds the current bucket from a known-good starting point (Decision 8 reconciliation) - only called when no live bucket exists yet for this (symbol, timeframe). No-op if a bucket already exists (never clobbers live state with a stale REST fetch that raced it). */
  seed(symbol: string, timeframe: MkrTimeframe, candle: NormalizedCandle, seededAt: number): void {
    const key = CandleAggregator.key(symbol, timeframe);
    if (this.current.has(key)) return;
    this.current.set(key, {
      bucketStart: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      closeTickTimestamp: seededAt,
      lastTickAt: seededAt,
    });
  }

  /** Seeds `lastClosed` (Decision 8 reconciliation, cold-start case where the provider's most recent historical candle is already a closed prior bucket, not the still-forming current one). No-op if already known - never overwrites a real closed candle observed from an actual rollover with an older REST snapshot. */
  seedLastClosed(symbol: string, timeframe: MkrTimeframe, candle: NormalizedCandle, seededAt: number): void {
    const key = CandleAggregator.key(symbol, timeframe);
    if (this.lastClosed.has(key)) return;
    this.lastClosed.set(key, { ...candle, lastTickAt: seededAt, closed: true });
  }

  ingest(symbol: string, timeframe: MkrTimeframe, price: number, tickTimestamp: number, source: MarketDataSource): IngestResult {
    const key = CandleAggregator.key(symbol, timeframe);
    const existing = this.current.get(key);
    const thisBucketStart = bucketStart(tickTimestamp, timeframe);

    if (!existing) {
      const fresh: MutableBucket = { bucketStart: thisBucketStart, open: price, high: price, low: price, close: price, closeTickTimestamp: tickTimestamp, lastTickAt: tickTimestamp };
      this.current.set(key, fresh);
      return { current: this.toPublic(symbol, timeframe, fresh, source, false), rolledOverFrom: null, ignoredAsStale: false };
    }

    if (isSameBucket(tickTimestamp, existing.bucketStart, timeframe)) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.lastTickAt = Math.max(existing.lastTickAt, tickTimestamp);
      if (tickTimestamp >= existing.closeTickTimestamp) {
        existing.close = price;
        existing.closeTickTimestamp = tickTimestamp;
      }
      return { current: this.toPublic(symbol, timeframe, existing, source, false), rolledOverFrom: null, ignoredAsStale: false };
    }

    if (thisBucketStart < existing.bucketStart) {
      // Late tick for an already-superseded bucket - documented policy: drop it, never mutate a closed bucket.
      return { current: this.toPublic(symbol, timeframe, existing, source, false), rolledOverFrom: null, ignoredAsStale: true };
    }

    // New bucket - close the previous one, open a fresh one from this tick.
    const closed = this.toPublic(symbol, timeframe, existing, source, true);
    this.lastClosed.set(key, closed);
    const fresh: MutableBucket = { bucketStart: thisBucketStart, open: price, high: price, low: price, close: price, closeTickTimestamp: tickTimestamp, lastTickAt: tickTimestamp };
    this.current.set(key, fresh);
    return { current: this.toPublic(symbol, timeframe, fresh, source, false), rolledOverFrom: closed, ignoredAsStale: false };
  }

  getCurrent(symbol: string, timeframe: MkrTimeframe, source: MarketDataSource): RealtimeCandle | null {
    const existing = this.current.get(CandleAggregator.key(symbol, timeframe));
    return existing ? this.toPublic(symbol, timeframe, existing, source, false) : null;
  }

  getLastClosed(symbol: string, timeframe: MkrTimeframe): RealtimeCandle | null {
    return this.lastClosed.get(CandleAggregator.key(symbol, timeframe)) ?? null;
  }

  /** Cleanup lifecycle (Decision 15) - drops all in-memory state for a (symbol, timeframe) once nothing needs it, so memory doesn't grow unbounded with every symbol/timeframe ever touched. */
  clear(symbol: string, timeframe: MkrTimeframe): void {
    const key = CandleAggregator.key(symbol, timeframe);
    this.current.delete(key);
    this.lastClosed.delete(key);
  }

  private toPublic(symbol: string, timeframe: MkrTimeframe, bucket: MutableBucket, source: MarketDataSource, closed: boolean): RealtimeCandle {
    return {
      symbol,
      interval: timeframe,
      timestamp: bucket.bucketStart,
      open: bucket.open,
      high: bucket.high,
      low: bucket.low,
      close: bucket.close,
      volume: null, // Twelve Data's WS price-quote frame carries no volume - never fabricated
      source,
      lastTickAt: bucket.lastTickAt,
      closed,
    };
  }
}
