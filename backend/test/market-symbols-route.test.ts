import { describe, expect, it } from 'vitest';
import { handleMarketSymbols } from '../src/market/market-routes';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

// 2026-09-15 frontend hardening task: handleMarketSymbols is the public,
// read-only counterpart to the admin symbols route - the fix that lets
// production Flutter stop treating MockMarketCatalog as the source of
// truth for which symbols to request.

const AAPL: SymbolRow = {
  symbol: 'AAPL',
  display_name: 'Apple Inc.',
  category: 'us_stock',
  enabled: 1,
  featured: 1,
  sort_order: 1,
  twelve_data_symbol: 'AAPL',
  alpaca_symbol: 'AAPL',
  default_timeframe: 'd1',
  cache_ttl_seconds: null,
  updated_at: 0,
};
const XAU: SymbolRow = { ...AAPL, symbol: 'XAU/USD', display_name: 'Gold Spot', category: 'gold', sort_order: 0, featured: 1 };
const BTC: SymbolRow = { ...AAPL, symbol: 'BTC/USD', display_name: 'Bitcoin', category: 'crypto', sort_order: 30, featured: 0, twelve_data_symbol: 'BTC/USD', alpaca_symbol: 'BTC/USD' };
const DISABLED: SymbolRow = { ...AAPL, symbol: 'DXY', display_name: 'US Dollar Index', category: 'commodity', enabled: 0, sort_order: 60 };

function fakeSymbolsD1(rows: SymbolRow[]) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows, success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
    },
  } as unknown as Env['MKR_DB'];
}

function makeEnv(rows: SymbolRow[]): Env {
  return {
    MKR_CONFIG: createFakeKv(),
    MKR_CACHE: createFakeKv(),
    MKR_DB: fakeSymbolsD1(rows),
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
    AI: {} as never,
    MARKET_PRIMARY_PROVIDER: 'twelve_data',
    MARKET_SECONDARY_PROVIDER: 'alpaca',
    MARKET_SECONDARY_ENABLED: 'false',
    CACHE_QUOTE_TTL_SECONDS: '60',
    CACHE_CANDLE_INTRADAY_TTL_SECONDS: '60',
    CACHE_CANDLE_DAILY_TTL_SECONDS: '600',
    CACHE_STATUS_TTL_SECONDS: '60',
    STALE_THRESHOLD_SECONDS: '90',
    RATE_LIMIT_PUBLIC_PER_MINUTE: '60',
    RATE_LIMIT_ADMIN_PER_MINUTE: '120',
    RATE_LIMIT_WS_MAX_CONNECTIONS: '500',
    ADMIN_WEB_ORIGIN: 'https://mkr-admin.pages.dev',
  };
}

describe('handleMarketSymbols', () => {
  it('returns only enabled symbols - a disabled symbol is never exposed to the client', async () => {
    const env = makeEnv([XAU, AAPL, BTC, DISABLED]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { success: boolean; data: { symbol: string }[] };

    expect(body.success).toBe(true);
    expect(body.data.map((s) => s.symbol).sort()).toEqual(['AAPL', 'BTC/USD', 'XAU/USD']);
  });

  it('preserves canonical symbol formats end to end (XAU/USD, BTC/USD)', async () => {
    const env = makeEnv([XAU, BTC]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { data: { symbol: string; category: string; displayName: string }[] };

    const xau = body.data.find((s) => s.symbol === 'XAU/USD');
    const btc = body.data.find((s) => s.symbol === 'BTC/USD');
    expect(xau).toMatchObject({ symbol: 'XAU/USD', category: 'gold', displayName: 'Gold Spot' });
    expect(btc).toMatchObject({ symbol: 'BTC/USD', category: 'crypto', displayName: 'Bitcoin' });
  });

  it('never exposes provider-specific symbol mapping fields (twelve_data_symbol/alpaca_symbol)', async () => {
    const env = makeEnv([AAPL]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { data: Record<string, unknown>[] };

    expect(body.data[0]).not.toHaveProperty('twelveDataSymbol');
    expect(body.data[0]).not.toHaveProperty('twelve_data_symbol');
    expect(body.data[0]).not.toHaveProperty('alpacaSymbol');
    expect(body.data[0]).not.toHaveProperty('alpaca_symbol');
  });

  it('includes display metadata and sort order for client rendering', async () => {
    const env = makeEnv([XAU]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { data: { symbol: string; displayName: string; category: string; featured: boolean; sortOrder: number; defaultTimeframe: string }[] };

    expect(body.data[0]).toEqual({ symbol: 'XAU/USD', displayName: 'Gold Spot', category: 'gold', featured: true, sortOrder: 0, defaultTimeframe: 'd1' });
  });

  it('an empty catalog returns an honest empty list, not an error', async () => {
    const env = makeEnv([]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { success: boolean; data: unknown[] };

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('a catalog with only disabled symbols returns an empty list', async () => {
    const env = makeEnv([DISABLED]);

    const res = await handleMarketSymbols(new Request('https://x/api/mkr/market/symbols'), env, 'r1');
    const body = (await res.json()) as { data: unknown[] };

    expect(body.data).toEqual([]);
  });
});
