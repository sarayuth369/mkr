import { MKR_TIMEFRAMES, type MkrTimeframe } from '../types';
import type { RealtimeCandle } from '../market/candle-aggregator';

/**
 * WebSocket Protocol V2 - additive, coexists on the SAME connection as the
 * existing (unversioned, "V1") tick frame `{symbol, price, timestamp,
 * source}`, which is left completely unchanged for backward compatibility.
 *
 * V1's Flutter client (`lib/features/markets/data/providers/
 * twelve_data_provider.dart`) parses any incoming frame defensively: it
 * requires `decoded['symbol']` to match a subscribed symbol, then requires
 * a numeric `decoded['price']` (`TwelveDataParser.parseWsTick` returns
 * `null` otherwise, and the null is silently dropped) - confirmed by
 * reading that code, not assumed. A V2 envelope message has no top-level
 * `price` field, so it is safely ignored by an unmodified V1 client. This
 * is what makes V2 additive rather than a version-negotiated protocol
 * switch: no Flutter change was needed or made for this task.
 */
export type WsV2MessageType = 'candle' | 'snapshot' | 'error';

export interface WsV2Envelope<T = unknown> {
  v: 2;
  type: WsV2MessageType;
  symbol?: string;
  timeframe?: MkrTimeframe;
  /** Server timestamp (epoch ms) this message was constructed - NOT the candle's own bucket time (see `data.timestamp` for that). */
  timestamp: number;
  data: T;
}

export function candleMessage(candle: RealtimeCandle): WsV2Envelope<RealtimeCandle> {
  return { v: 2, type: 'candle', symbol: candle.symbol, timeframe: candle.interval, timestamp: Date.now(), data: candle };
}

export interface SnapshotData {
  current: RealtimeCandle | null;
  lastClosed: RealtimeCandle | null;
}

/**
 * Sent once, synchronously as part of handling a candle subscribe request
 * (Decision 11) - `current` is the live/still-open bucket, `lastClosed` is
 * the most recently completed one (`null` if none exists yet, e.g. a
 * brand-new symbol/timeframe pair with no prior ticks or reconciled
 * history). This is what lets a client render immediately without waiting
 * for the next tick, and without a subscribe-then-miss-a-tick race - the
 * snapshot is built from whatever is in the aggregator's memory at the
 * moment the subscribe message finishes processing, which by construction
 * already reflects every tick applied before it (DO request handling has
 * no concurrent handlers within one instance).
 */
export function snapshotMessage(symbol: string, timeframe: MkrTimeframe, data: SnapshotData): WsV2Envelope<SnapshotData> {
  return { v: 2, type: 'snapshot', symbol, timeframe, timestamp: Date.now(), data };
}

export function errorMessage(reason: string, symbol?: string): WsV2Envelope<{ reason: string }> {
  return { v: 2, type: 'error', symbol, timestamp: Date.now(), data: { reason } };
}

/** Validates a client-supplied `timeframes` field - unknown/malformed entries are dropped, never guessed or coerced (matching the existing "unsupported symbol - silently skip" convention for `symbols`). */
export function validTimeframes(raw: unknown): MkrTimeframe[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<MkrTimeframe>();
  for (const entry of raw) {
    const value = String(entry);
    if ((MKR_TIMEFRAMES as readonly string[]).includes(value)) set.add(value as MkrTimeframe);
  }
  return [...set];
}
