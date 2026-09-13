import { describe, expect, it } from 'vitest';
import {
  isTwelveDataRateLimited,
  parseTwelveDataCandles,
  parseTwelveDataMarketStatus,
  parseTwelveDataQuote,
} from '../src/providers/twelve-data/twelve-data-parser';

describe('parseTwelveDataQuote', () => {
  it('parses a well-formed quote response', () => {
    const quote = parseTwelveDataQuote(
      {
        symbol: 'AAPL',
        name: 'Apple Inc',
        close: '227.50',
        open: '225.00',
        high: '228.10',
        low: '224.80',
        previous_close: '224.00',
        change: '3.50',
        percent_change: '1.56',
        volume: '52000000',
        currency: 'USD',
        is_market_open: true,
      },
      'AAPL',
    );
    expect(quote?.price).toBe(227.5);
    expect(quote?.changePercent).toBe(1.56);
    expect(quote?.isLive).toBe(true);
    expect(quote?.sessionStatus).toBe('open');
  });

  it('returns null for an error response', () => {
    expect(parseTwelveDataQuote({ status: 'error', code: 400, message: 'bad symbol' }, 'AAPL')).toBeNull();
  });

  it('returns null when the price field is missing entirely', () => {
    expect(parseTwelveDataQuote({ symbol: 'AAPL' }, 'AAPL')).toBeNull();
  });

  it('derives change/changePercent from price and previous_close when absent', () => {
    const quote = parseTwelveDataQuote({ close: '110', previous_close: '100' }, 'X');
    expect(quote?.change).toBe(10);
    expect(quote?.changePercent).toBe(10);
  });

  it('does not throw on a malformed non-numeric price and returns null', () => {
    expect(parseTwelveDataQuote({ close: 'not-a-number' }, 'X')).toBeNull();
  });
});

describe('isTwelveDataRateLimited', () => {
  it('detects a 429 error code', () => {
    expect(isTwelveDataRateLimited({ status: 'error', code: 429, message: 'too many requests' })).toBe(true);
  });

  it('detects an API-credits message without code 429', () => {
    expect(isTwelveDataRateLimited({ status: 'error', code: 400, message: 'You have run out of API credits' })).toBe(true);
  });

  it('does not flag a normal error as rate-limited', () => {
    expect(isTwelveDataRateLimited({ status: 'error', code: 400, message: 'bad symbol' })).toBe(false);
  });

  it('never flags a success response', () => {
    expect(isTwelveDataRateLimited({ close: '1.0' })).toBe(false);
  });
});

describe('parseTwelveDataCandles', () => {
  it('reverses newest-first values into oldest-first candles', () => {
    const candles = parseTwelveDataCandles(
      {
        values: [
          { datetime: '2026-01-02', open: '2', high: '3', low: '1', close: '2.5', volume: '10' },
          { datetime: '2026-01-01', open: '1', high: '2', low: '0.5', close: '1.8', volume: '5' },
        ],
      },
      'AAPL',
      'd1',
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]?.timestamp).toBeLessThan(candles[1]!.timestamp);
  });

  it('skips entries missing a required OHLC field', () => {
    const candles = parseTwelveDataCandles({ values: [{ datetime: '2026-01-01', open: '1', high: '2', low: '0.5' }] }, 'AAPL', 'd1');
    expect(candles).toHaveLength(0);
  });

  it('returns empty for an error-shaped response', () => {
    expect(parseTwelveDataCandles({ status: 'error', code: 400, message: 'bad' }, 'AAPL', 'd1')).toEqual([]);
  });

  it('returns empty when values is missing or not a list', () => {
    expect(parseTwelveDataCandles({}, 'AAPL', 'd1')).toEqual([]);
    expect(parseTwelveDataCandles({ values: 'oops' }, 'AAPL', 'd1')).toEqual([]);
  });
});

describe('parseTwelveDataMarketStatus', () => {
  it('returns unknown/null for a missing or error response - never a guess', () => {
    const status = parseTwelveDataMarketStatus(null, 'AAPL');
    expect(status.session).toBe('unknown');
    expect(status.isOpen).toBeNull();
  });

  it('maps is_market_open into session/isOpen', () => {
    const status = parseTwelveDataMarketStatus({ is_market_open: true, exchange: 'NASDAQ' }, 'AAPL');
    expect(status.isOpen).toBe(true);
    expect(status.session).toBe('open');
    expect(status.exchange).toBe('NASDAQ');
  });
});
