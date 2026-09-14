import { describe, expect, it } from 'vitest';
import type { RealtimeCandle } from '../src/market/candle-aggregator';
import { candleMessage, errorMessage, snapshotMessage, validTimeframes } from '../src/ws/protocol-v2';

const candle: RealtimeCandle = {
  symbol: 'AAPL',
  interval: 'm1',
  timestamp: 1_000_000,
  open: 100,
  high: 105,
  low: 98,
  close: 102,
  volume: null,
  source: 'twelve_data',
  lastTickAt: 1_000_500,
  closed: false,
};

describe('WS Protocol V2 message validation', () => {
  it('validTimeframes accepts only known MkrTimeframe values, dropping unknown ones', () => {
    expect(validTimeframes(['m1', 'bogus', 'h1', 123, null])).toEqual(['m1', 'h1']);
  });

  it('validTimeframes returns [] for non-array input, never throws', () => {
    expect(validTimeframes(undefined)).toEqual([]);
    expect(validTimeframes('m1')).toEqual([]);
    expect(validTimeframes(null)).toEqual([]);
  });

  it('validTimeframes de-duplicates', () => {
    expect(validTimeframes(['m1', 'm1', 'm1'])).toEqual(['m1']);
  });

  it('candleMessage carries v:2, type:candle, and the exact symbol/timeframe', () => {
    const msg = candleMessage(candle);
    expect(msg.v).toBe(2);
    expect(msg.type).toBe('candle');
    expect(msg.symbol).toBe('AAPL');
    expect(msg.timeframe).toBe('m1');
    expect(msg.data).toBe(candle);
  });

  it('snapshotMessage carries current and lastClosed distinctly', () => {
    const msg = snapshotMessage('AAPL', 'm1', { current: candle, lastClosed: null });
    expect(msg.type).toBe('snapshot');
    expect(msg.data.current).toBe(candle);
    expect(msg.data.lastClosed).toBeNull();
  });

  it('errorMessage carries a reason and no data leak beyond it', () => {
    const msg = errorMessage('invalid timeframe', 'AAPL');
    expect(msg.type).toBe('error');
    expect(msg.data).toEqual({ reason: 'invalid timeframe' });
  });

  // Backward compatibility (Decision O) - every V2 envelope must be safely
  // ignorable by the existing V1 Flutter client, whose parser
  // (twelve_data_parser.dart `parseWsTick`) requires a numeric top-level
  // `price` field and returns null otherwise (confirmed by reading that
  // code). No V2 message defined here carries a top-level `price`.
  it('no V2 envelope ever carries a top-level "price" field (would be misparsed by the V1 client as a real tick)', () => {
    for (const msg of [candleMessage(candle), snapshotMessage('AAPL', 'm1', { current: candle, lastClosed: null }), errorMessage('x')]) {
      expect('price' in msg).toBe(false);
    }
  });

  it('every V2 envelope is valid JSON and round-trips', () => {
    const msg = candleMessage(candle);
    const roundTripped = JSON.parse(JSON.stringify(msg));
    expect(roundTripped).toEqual(msg);
  });
});
