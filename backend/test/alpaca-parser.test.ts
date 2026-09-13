import { describe, expect, it } from 'vitest';
import { parseAlpacaBars, parseAlpacaSnapshot } from '../src/providers/alpaca/alpaca-parser';

describe('parseAlpacaSnapshot', () => {
  it('parses a well-formed snapshot', () => {
    const quote = parseAlpacaSnapshot(
      {
        latestTrade: { p: 227.5 },
        latestQuote: { bp: 227.4, ap: 227.6 },
        prevDailyBar: { c: 224.0 },
        dailyBar: { o: 225.0, h: 228.0, l: 224.5, v: 1000 },
      },
      'AAPL',
    );
    expect(quote?.price).toBe(227.5);
    expect(quote?.bid).toBe(227.4);
    expect(quote?.ask).toBe(227.6);
    expect(quote?.change).toBeCloseTo(3.5);
  });

  it('returns null for an error response', () => {
    expect(parseAlpacaSnapshot({ code: 40010001, message: 'symbol not found' }, 'AAPL')).toBeNull();
  });

  it('returns null when latestTrade is missing', () => {
    expect(parseAlpacaSnapshot({ latestQuote: { bp: 1, ap: 2 } }, 'AAPL')).toBeNull();
  });
});

describe('parseAlpacaBars', () => {
  it('parses bars in original order', () => {
    const candles = parseAlpacaBars(
      {
        bars: [
          { t: '2026-01-01T00:00:00Z', o: 1, h: 2, l: 0.5, c: 1.8, v: 5 },
          { t: '2026-01-02T00:00:00Z', o: 2, h: 3, l: 1, c: 2.5, v: 10 },
        ],
      },
      'AAPL',
      'd1',
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]?.close).toBe(1.8);
  });

  it('returns empty for missing bars or an error shape', () => {
    expect(parseAlpacaBars({ code: 1, message: 'x' }, 'AAPL', 'd1')).toEqual([]);
    expect(parseAlpacaBars({}, 'AAPL', 'd1')).toEqual([]);
  });

  it('skips a malformed bar entry missing a required field', () => {
    expect(parseAlpacaBars({ bars: [{ t: '2026-01-01T00:00:00Z', o: 1, h: 2, l: 0.5 }] }, 'AAPL', 'd1')).toEqual([]);
  });
});
