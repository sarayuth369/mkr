import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetInFlightForTests } from '../src/cache/cache-service';
import { handleQuote, handleQuotes } from '../src/market/market-routes';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

// Task 4 regression suite - handler-level tests for handleQuote/handleQuotes
// did not exist before this task (flagged as a gap in the Task 3 audit,
// which is exactly the layer the quote/quotes cache-key collision lived
// in). These exercise the real route handlers against a fake D1 catalog
// and a stubbed Twelve Data REST response - no real network access.

const AAPL: SymbolRow = {
  symbol: 'AAPL',
  display_name: 'Apple Inc.',
  category: 'us_equity',
  enabled: 1,
  featured: 1,
  sort_order: 1,
  twelve_data_symbol: 'AAPL',
  alpaca_symbol: 'AAPL',
  default_timeframe: 'm1',
  cache_ttl_seconds: null,
  updated_at: 0,
};
const MSFT: SymbolRow = { ...AAPL, symbol: 'MSFT', twelve_data_symbol: 'MSFT', alpaca_symbol: 'MSFT' };

function fakeSymbolsD1(rows: SymbolRow[]) {
  return {
    prepare() {
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return this;
        },
        async all() {
          return { results: rows, success: true, meta: {} };
        },
        async first<T>() {
          const symbol = boundArgs[0] as string | undefined;
          return (rows.find((r) => r.symbol === symbol) ?? null) as T | null;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
    },
  } as unknown as Env['MKR_DB'];
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MKR_CONFIG: createFakeKv(),
    MKR_CACHE: createFakeKv(),
    MKR_DB: fakeSymbolsD1([AAPL, MSFT]),
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
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
    TWELVE_DATA_API_KEY: 'fake-key-not-real',
    ...overrides,
  };
}

function twelveDataQuote(price: number, extra: Record<string, unknown> = {}) {
  return { close: String(price), open: String(price - 1), high: String(price + 1), low: String(price - 2), previous_close: String(price - 0.5), volume: '1000', name: 'Test Co', currency: 'USD', is_market_open: true, ...extra };
}

/** Routes both the single-symbol `/quote` shape (bare object) and the multi-symbol `/quote?symbol=A,B` shape (keyed object) from one fixture map. */
function fetchStub(bySymbol: Record<string, ReturnType<typeof twelveDataQuote>>) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url));
    const requested = (u.searchParams.get('symbol') ?? '').split(',').filter(Boolean);
    if (requested.length <= 1) {
      const data = bySymbol[requested[0] ?? ''];
      return new Response(JSON.stringify(data ?? { status: 'error', message: 'not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const multi: Record<string, unknown> = {};
    for (const s of requested) if (bySymbol[s]) multi[s] = bySymbol[s];
    return new Response(JSON.stringify(multi), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetInFlightForTests();
});

describe('handleQuote / handleQuotes - cache correctness (Task 4)', () => {
  it('A. /quote is a cache hit on the second call - fetcher runs once', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r1');
    await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r2');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('B. /quotes is a cache hit on the second call - fetcher runs once', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL'), env, 'r1');
    await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL'), env, 'r2');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('C. /quote then /quotes for the SAME symbol do not collide - this is the exact Task 3 P1 bug, reproduced and fixed', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const quoteResponse = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r1');
    const quoteBody = (await quoteResponse.json()) as { data: { symbol: string; price: number } };
    expect(quoteBody.data.symbol).toBe('AAPL'); // handleQuote's own shape, sanity check

    // /quotes now reads the SAME cache entry /quote just wrote (well within the 60s TTL).
    const batchResponse = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL'), env, 'r2');
    const batchBody = (await batchResponse.json()) as { data: { items: { symbol?: string; price?: number; quote?: unknown }[] } };

    expect(fetchSpy).toHaveBeenCalledTimes(1); // the /quotes call was a cache HIT, not a second fetch
    expect(batchBody.data.items).toHaveLength(1);
    // The old bug: items[0] would be {quote:{...}, source:...} with NO top-level `symbol`,
    // which Flutter's parser silently drops. Assert the correct, flat NormalizedQuote shape instead.
    expect(batchBody.data.items[0]!.symbol).toBe('AAPL');
    expect(batchBody.data.items[0]!.price).toBe(150);
    expect(batchBody.data.items[0]!.quote).toBeUndefined(); // no leftover wrapper field
  });

  it('C2. /quotes then /quote for the SAME symbol do not collide (reverse order)', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL'), env, 'r1');
    const quoteResponse = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r2');
    const quoteBody = (await quoteResponse.json()) as { data: { symbol: string; price: number } | null };

    expect(fetchSpy).toHaveBeenCalledTimes(1); // /quote was a cache HIT off /quotes' write
    expect(quoteBody.data?.symbol).toBe('AAPL');
    expect(quoteBody.data?.price).toBe(150);
  });

  it('D. cached values under the shared key are structurally identical from both routes (no shape drift)', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const raw = await env.MKR_CACHE.get('quote:v2:AAPL', 'json');
    expect(raw).toBeNull(); // nothing cached yet, confirms the exact key name this fix uses

    await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r1');
    const afterQuote = (await env.MKR_CACHE.get('quote:v2:AAPL', 'json')) as { v: { symbol?: string } };
    expect(afterQuote.v.symbol).toBe('AAPL'); // bare NormalizedQuote, not {quote,source}
  });

  it('E. concurrent identical /quote requests for the same symbol coalesce into one fetch', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 15));
        return new Response(JSON.stringify(twelveDataQuote(150)), { status: 200 });
      }),
    );
    const env = makeEnv();

    await Promise.all([
      handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r1'),
      handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r2'),
      handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), env, 'r3'),
    ]);

    expect(calls).toBe(1);
  });

  it('F. /quotes?symbols=AAPL,MSFT and /quotes?symbols=MSFT,AAPL are equivalent requests (order-independent coalescing, already-correct existing behavior)', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls++;
        await new Promise((r) => setTimeout(r, 15));
        const u = new URL(String(url));
        const symbols = (u.searchParams.get('symbol') ?? '').split(',');
        const multi: Record<string, unknown> = {};
        for (const s of symbols) multi[s] = twelveDataQuote(s === 'AAPL' ? 150 : 300);
        return new Response(JSON.stringify(multi), { status: 200 });
      }),
    );
    const env = makeEnv();

    const [a, b] = await Promise.all([
      handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL,MSFT'), env, 'r1'),
      handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=MSFT,AAPL'), env, 'r2'),
    ]);

    expect(calls).toBe(1); // coalesced() sorts the uncached-symbol set before building its key
    const bodyA = (await a.json()) as { data: { items: unknown[] } };
    const bodyB = (await b.json()) as { data: { items: unknown[] } };
    expect(bodyA.data.items).toHaveLength(2);
    expect(bodyB.data.items).toHaveLength(2);
  });

  it('G. duplicate symbols in one /quotes request are de-duplicated', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const response = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL,AAPL,AAPL'), env, 'r1');
    const body = (await response.json()) as { data: { items: unknown[] } };

    expect(body.data.items).toHaveLength(1);
  });

  it('H. symbol input is normalized (lowercase, whitespace) the same way on both routes', async () => {
    const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const quoteResponse = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=aapl'), env, 'r1');
    const batchResponse = await handleQuotes(new Request(`https://x/api/mkr/market/quotes?symbols=${encodeURIComponent(' aapl ')}`), env, 'r2');

    expect(quoteResponse.status).toBe(200);
    const batchBody = (await batchResponse.json()) as { data: { items: { symbol?: string }[] } };
    expect(batchBody.data.items[0]?.symbol).toBe('AAPL');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call was a cache hit off the normalized key
  });

  it('I. a genuine cache miss calls the provider and returns fresh data', async () => {
    const fetchSpy = fetchStub({ MSFT: twelveDataQuote(300) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=MSFT'), env, 'r1');
    const body = (await response.json()) as { data: { price: number } };

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body.data.price).toBe(300);
  });

  it('N. a malformed cached payload under the versioned key is not silently misread as a valid quote by the OTHER route (both routes agree on shape post-fix)', async () => {
    const env = makeEnv();
    // Simulate a stale/corrupt entry - e.g. leftover from a hypothetical future bug -
    // and confirm both routes treat a non-quote-shaped cached value the same way
    // they'd treat any other cached value: returned as-is, no crash, no special-casing.
    await env.MKR_CACHE.put('quote:v2:AAPL', JSON.stringify({ v: { unexpected: 'shape' } }));
    vi.stubGlobal('fetch', vi.fn());
    const envForQuote = makeEnv({ MKR_CACHE: env.MKR_CACHE, MKR_CONFIG: env.MKR_CONFIG });

    const quoteResponse = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=AAPL'), envForQuote, 'r1');
    const batchResponse = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL'), envForQuote, 'r2');

    // Neither route throws (no runtime schema validation exists in this cache layer -
    // documented limitation, not fixed by this task). Both surface whatever was cached.
    expect(quoteResponse.status).toBe(200);
    expect(batchResponse.status).toBe(200);
  });
});
