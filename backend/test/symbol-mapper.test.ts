import { describe, expect, it } from 'vitest';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import { isValidMkrSymbolFormat, mapSymbolFromRows, parseSymbolList } from '../src/symbols/symbol-mapper';

const rows: SymbolRow[] = [
  {
    symbol: 'AAPL',
    display_name: 'Apple',
    category: 'us_stock',
    enabled: 1,
    featured: 0,
    sort_order: 1,
    twelve_data_symbol: 'AAPL',
    alpaca_symbol: 'AAPL',
    default_timeframe: 'd1',
    cache_ttl_seconds: null,
    updated_at: 0,
  },
  {
    symbol: 'XAU/USD',
    display_name: 'Gold',
    category: 'gold',
    enabled: 1,
    featured: 1,
    sort_order: 0,
    twelve_data_symbol: 'XAU/USD',
    alpaca_symbol: null,
    default_timeframe: 'd1',
    cache_ttl_seconds: null,
    updated_at: 0,
  },
  {
    symbol: 'SET50',
    display_name: 'SET50',
    category: 'thailand',
    enabled: 0,
    featured: 0,
    sort_order: 5,
    twelve_data_symbol: null,
    alpaca_symbol: null,
    default_timeframe: 'd1',
    cache_ttl_seconds: null,
    updated_at: 0,
  },
];

describe('mapSymbolFromRows', () => {
  it('maps a known symbol for both providers', () => {
    expect(mapSymbolFromRows(rows, 'AAPL', 'twelve_data')).toBe('AAPL');
    expect(mapSymbolFromRows(rows, 'AAPL', 'alpaca')).toBe('AAPL');
  });

  it('maps gold only for Twelve Data, not Alpaca', () => {
    expect(mapSymbolFromRows(rows, 'XAU/USD', 'twelve_data')).toBe('XAU/USD');
    expect(mapSymbolFromRows(rows, 'XAU/USD', 'alpaca')).toBeNull();
  });

  it('returns null for a disabled symbol even if a provider mapping exists', () => {
    expect(mapSymbolFromRows(rows, 'SET50', 'twelve_data')).toBeNull();
  });

  it('returns null for an unknown symbol rather than guessing', () => {
    expect(mapSymbolFromRows(rows, 'NOPE', 'twelve_data')).toBeNull();
  });
});

describe('isValidMkrSymbolFormat', () => {
  it('accepts plain tickers and slash pairs', () => {
    expect(isValidMkrSymbolFormat('AAPL')).toBe(true);
    expect(isValidMkrSymbolFormat('XAU/USD')).toBe(true);
  });

  it('rejects obviously invalid input (injection attempts, empty, too long)', () => {
    expect(isValidMkrSymbolFormat('')).toBe(false);
    expect(isValidMkrSymbolFormat('AAPL; DROP TABLE')).toBe(false);
    expect(isValidMkrSymbolFormat('A'.repeat(20))).toBe(false);
    expect(isValidMkrSymbolFormat('../../etc/passwd')).toBe(false);
  });
});

describe('parseSymbolList', () => {
  it('trims, uppercases, and de-duplicates', () => {
    expect(parseSymbolList(' aapl, AAPL ,msft')).toEqual(['AAPL', 'MSFT']);
  });

  it('ignores empty segments', () => {
    expect(parseSymbolList('aapl,,msft,')).toEqual(['AAPL', 'MSFT']);
  });
});
