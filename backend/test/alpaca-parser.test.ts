import { describe, expect, it } from 'vitest';
import {
  isAlpacaCryptoSymbol,
  parseAlpacaBars,
  parseAlpacaCryptoBars,
  parseAlpacaCryptoSnapshot,
  parseAlpacaSnapshot,
} from '../src/providers/alpaca/alpaca-parser';

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

// 2026-09-16 hybrid capability validation task: crypto and stock are
// separate Alpaca API families with different response shapes (crypto is
// always keyed by symbol under `snapshots`/`bars`, even for one symbol) -
// see alpaca-provider.ts and its own doc comments for why.
describe('isAlpacaCryptoSymbol', () => {
  it('is true for a crypto-shaped Alpaca symbol (contains a slash)', () => {
    expect(isAlpacaCryptoSymbol('BTC/USD')).toBe(true);
    expect(isAlpacaCryptoSymbol('ETH/USD')).toBe(true);
  });

  it('is false for a bare stock ticker', () => {
    expect(isAlpacaCryptoSymbol('AAPL')).toBe(false);
    expect(isAlpacaCryptoSymbol('QQQ')).toBe(false);
  });
});

describe('parseAlpacaCryptoSnapshot', () => {
  it('parses a well-formed crypto snapshot nested under snapshots[symbol]', () => {
    const quote = parseAlpacaCryptoSnapshot(
      {
        snapshots: {
          'BTC/USD': {
            latestTrade: { p: 65000.5 },
            latestQuote: { bp: 65000.1, ap: 65000.9 },
            prevDailyBar: { c: 64000 },
            dailyBar: { o: 64100, h: 65200, l: 63900, v: 12.5 },
          },
        },
      },
      'BTC/USD',
      'BTC',
    );
    expect(quote?.symbol).toBe('BTC');
    expect(quote?.price).toBe(65000.5);
    expect(quote?.source).toBe('alpaca');
    expect(quote?.change).toBeCloseTo(1000.5);
  });

  it('returns null when the requested symbol is missing from the snapshots map', () => {
    expect(parseAlpacaCryptoSnapshot({ snapshots: { 'ETH/USD': { latestTrade: { p: 1 } } } }, 'BTC/USD', 'BTC')).toBeNull();
  });

  it('returns null for a top-level error response', () => {
    expect(parseAlpacaCryptoSnapshot({ code: 40010001, message: 'invalid symbol' }, 'BTC/USD', 'BTC')).toBeNull();
  });

  it('returns null when snapshots is missing entirely', () => {
    expect(parseAlpacaCryptoSnapshot({}, 'BTC/USD', 'BTC')).toBeNull();
  });
});

describe('parseAlpacaCryptoBars', () => {
  it('parses bars nested under bars[symbol]', () => {
    const candles = parseAlpacaCryptoBars(
      {
        bars: {
          'BTC/USD': [
            { t: '2026-01-01T00:00:00Z', o: 64000, h: 65000, l: 63500, c: 64800, v: 100 },
            { t: '2026-01-02T00:00:00Z', o: 64800, h: 66000, l: 64700, c: 65900, v: 120 },
          ],
        },
      },
      'BTC/USD',
      'BTC',
      'd1',
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]?.close).toBe(64800);
    expect(candles[0]?.source).toBe('alpaca');
  });

  it('returns empty when the requested symbol is missing from the bars map', () => {
    expect(parseAlpacaCryptoBars({ bars: { 'ETH/USD': [] } }, 'BTC/USD', 'BTC', 'd1')).toEqual([]);
  });

  it('returns empty for a top-level error response or missing bars', () => {
    expect(parseAlpacaCryptoBars({ code: 1, message: 'x' }, 'BTC/USD', 'BTC', 'd1')).toEqual([]);
    expect(parseAlpacaCryptoBars({}, 'BTC/USD', 'BTC', 'd1')).toEqual([]);
  });
});
