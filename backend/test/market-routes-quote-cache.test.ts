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

  describe('O. a transient per-chunk provider failure does not poison the cache (2026-09-15 review)', () => {
    // TwelveDataProvider.getBatchQuotes chunks into groups of 8 and only
    // ever sets `result[symbol]` (possibly to `null`) for a symbol whose
    // chunk actually completed - a symbol in a chunk that threw (network/
    // timeout/rate_limit) is left OUT of `result` entirely, distinct from a
    // provider-confirmed "no data" (`result[symbol] === null`). 9 symbols
    // forces exactly 2 chunks so one can fail while the other succeeds -
    // the previous `result[symbol] ?? null` in handleQuotes collapsed that
    // distinction and cached the transient failure as if it were confirmed
    // "no data", for the full TTL (violates Decision 15: never negative-
    // cache a transient failure).
    const NINE = Array.from({ length: 9 }, (_, i) => ({ ...AAPL, symbol: `SYM${i}`, twelve_data_symbol: `SYM${i}`, alpaca_symbol: `SYM${i}` }));

    function fetchStubOneChunkFails(failingSymbol: string) {
      return vi.fn(async (url: string) => {
        const u = new URL(String(url));
        const requested = (u.searchParams.get('symbol') ?? '').split(',').filter(Boolean);
        if (requested.includes(failingSymbol)) throw new TypeError('network blip');
        const multi: Record<string, unknown> = {};
        for (const s of requested) multi[s] = twelveDataQuote(100);
        return new Response(JSON.stringify(multi), { status: 200 });
      });
    }

    it('the failed symbol is reported as an error, not silently dropped', async () => {
      vi.stubGlobal('fetch', fetchStubOneChunkFails('SYM8'));
      const env = makeEnv({ MKR_DB: fakeSymbolsD1(NINE) });

      const response = await handleQuotes(new Request(`https://x/api/mkr/market/quotes?symbols=${NINE.map((r) => r.symbol).join(',')}`), env, 'r1');
      const body = (await response.json()) as { data: { items: { symbol: string }[]; errors: { symbol: string; code: string }[] } };

      expect(body.data.items).toHaveLength(8); // the 8 symbols in the successful chunk
      expect(body.data.errors).toEqual([{ symbol: 'SYM8', code: 'PROVIDER_UNAVAILABLE', message: expect.any(String) }]);
    });

    it('the failed symbol is NOT cached, so a later request retries it instead of being served a poisoned negative-cache entry', async () => {
      const fetchSpy = fetchStubOneChunkFails('SYM8');
      vi.stubGlobal('fetch', fetchSpy);
      const env = makeEnv({ MKR_DB: fakeSymbolsD1(NINE) });

      await handleQuotes(new Request(`https://x/api/mkr/market/quotes?symbols=${NINE.map((r) => r.symbol).join(',')}`), env, 'r1');
      const cachedAfterFailure = await env.MKR_CACHE.get('quote:v2:SYM8', 'json');
      expect(cachedAfterFailure).toBeNull(); // nothing written - the old bug wrote {v:null} here

      const callsAfterFirstRequest = fetchSpy.mock.calls.length;
      await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=SYM8'), env, 'r2');

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstRequest); // genuinely retried, not served from cache
    });

    it('a symbol the provider EXPLICITLY returns a per-symbol error entry for IS still cached (confirmed no-data is not a transient failure)', async () => {
      // MSFT IS present in the response object, but as Twelve Data's own
      // per-symbol error shape - a genuine, explicit "no data" answer, not
      // an absent key - see the 2026-09-16 doc comment on
      // parseTwelveDataBatchQuotes for the distinction this test exists to
      // preserve.
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ AAPL: twelveDataQuote(150), MSFT: { status: 'error', code: 400, message: 'symbol not found' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const env = makeEnv();

      const response = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL,MSFT'), env, 'r1');
      const body = (await response.json()) as { data: { items: { symbol: string }[]; errors: { symbol: string; code: string }[] } };
      const cachedMsft = await env.MKR_CACHE.get('quote:v2:MSFT', 'json');

      expect(cachedMsft).toEqual({ v: null }); // confirmed no-data IS cached - unchanged, correct behavior
      expect(body.data.items).toEqual([expect.objectContaining({ symbol: 'AAPL' })]);
      expect(body.data.errors).toEqual([]); // an explicit provider "no data" answer is NOT reported as an error
      expect(fetchSpy).toHaveBeenCalledTimes(1); // the single successful chunk covering both symbols
    });

    it('2026-09-16 Closed Testing readiness (root cause, provider capacity): a symbol entirely ABSENT from the response object (never an explicit entry) is reported as an error and NOT cached, never treated as confirmed no-data', async () => {
      const fetchSpy = fetchStub({ AAPL: twelveDataQuote(150) }); // MSFT has NO key at all in the response - the real, live-confirmed Twelve Data Free capacity-drop signature
      vi.stubGlobal('fetch', fetchSpy);
      const env = makeEnv();

      const response = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=AAPL,MSFT'), env, 'r1');
      const body = (await response.json()) as { data: { items: { symbol: string }[]; errors: { symbol: string; code: string }[] } };
      const cachedMsft = await env.MKR_CACHE.get('quote:v2:MSFT', 'json');

      expect(body.data.items).toEqual([expect.objectContaining({ symbol: 'AAPL' })]);
      expect(body.data.errors).toEqual([{ symbol: 'MSFT', code: 'PROVIDER_UNAVAILABLE', message: expect.any(String) }]);
      expect(cachedMsft).toBeNull(); // never poisoned as a false "confirmed no-data" for the TTL window - retried on the very next request instead
      expect(fetchSpy).toHaveBeenCalledTimes(1); // the single successful chunk covering both symbols - the omission is within an otherwise-successful chunk, not a chunk-level failure
    });
  });

  describe('2026-09-16 Hybrid Provider Architecture task - capability-aware routing + cache/source correctness', () => {
    const US_STOCK: SymbolRow = { ...AAPL, symbol: 'NVDA', category: 'us_stock', twelve_data_symbol: 'NVDA', alpaca_symbol: 'NVDA' };

    /** Routes by hostname - data.alpaca.markets vs api.twelvedata.com - so one fetch stub can simulate both providers in the same test. */
    function hybridFetchStub(opts: { alpacaPrice?: number; twelveDataPrice?: number }) {
      return vi.fn(async (url: string) => {
        const u = new URL(String(url));
        if (u.hostname === 'data.alpaca.markets') {
          // A genuine connectivity failure (AlpacaProvider.request()'s own
          // catch -> ProviderError 'network') - not just a non-2xx status,
          // since AlpacaProvider only special-cases 401/403/429 and would
          // otherwise try to parse whatever body a 5xx happened to carry.
          if (opts.alpacaPrice === undefined) throw new TypeError('simulated Alpaca network failure');
          return new Response(JSON.stringify({ latestTrade: { p: opts.alpacaPrice } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (opts.twelveDataPrice === undefined) return new Response(JSON.stringify({ status: 'error', message: 'down' }), { status: 200 });
        const requested = (u.searchParams.get('symbol') ?? '').split(',').filter(Boolean);
        if (requested.length <= 1) return new Response(JSON.stringify(twelveDataQuote(opts.twelveDataPrice)), { status: 200 });
        const multi: Record<string, unknown> = {};
        for (const s of requested) multi[s] = twelveDataQuote(opts.twelveDataPrice);
        return new Response(JSON.stringify(multi), { status: 200 });
      });
    }

    function hybridEnv(overrides: Partial<Env> = {}): Env {
      return makeEnv({
        MKR_DB: fakeSymbolsD1([US_STOCK]),
        ALPACA_API_KEY_ID: 'fake-id-not-real',
        ALPACA_API_SECRET_KEY: 'fake-secret-not-real',
        MARKET_SECONDARY_ENABLED: 'true',
        HYBRID_ROUTING_ENABLED: 'true',
        ...overrides,
      });
    }

    it('a mapped us_stock symbol is routed to Alpaca first when hybrid routing is enabled - the response retains the real "alpaca" source, never masquerading as Twelve Data', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ alpacaPrice: 555 }));
      const env = hybridEnv();

      const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const body = (await response.json()) as { data: { price: number; source: string } };

      expect(body.data.price).toBe(555);
      expect(body.data.source).toBe('alpaca');
    });

    it('the SAME cached quote is retrieved consistently via /quotes too - preserves the existing fixed quote-cache compatibility between /quote and /quotes', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ alpacaPrice: 555 }));
      const env = hybridEnv();

      await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const batchResponse = await handleQuotes(new Request('https://x/api/mkr/market/quotes?symbols=NVDA'), env, 'r2');
      const body = (await batchResponse.json()) as { data: { items: { symbol: string; source: string; price: number }[] } };

      expect(body.data.items).toEqual([expect.objectContaining({ symbol: 'NVDA', source: 'alpaca', price: 555 })]);
    });

    it('falls back to Twelve Data when Alpaca is confirmed unhealthy, even with hybrid routing enabled - normal failover discipline is never bypassed by a routing preference', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ twelveDataPrice: 100 })); // no alpacaPrice - Alpaca fails every call
      const env = hybridEnv();

      const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const body = (await response.json()) as { data: { price: number; source: string } };

      expect(body.data.price).toBe(100);
      expect(body.data.source).toBe('twelve_data');
    });

    it('missing Alpaca credentials is a safe no-op even with hybrid routing flags fully enabled - Twelve Data serves it, exactly as if hybrid routing were off', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ twelveDataPrice: 100 }));
      const env = hybridEnv({ ALPACA_API_KEY_ID: undefined, ALPACA_API_SECRET_KEY: undefined });

      const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const body = (await response.json()) as { data: { price: number; source: string } };

      expect(body.data.price).toBe(100);
      expect(body.data.source).toBe('twelve_data');
    });

    it('hybrid routing is a no-op when the master switch is off, even with real Alpaca credentials configured - the production default stays byte-identical to pre-hybrid behavior', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ alpacaPrice: 555, twelveDataPrice: 100 }));
      const env = hybridEnv({ HYBRID_ROUTING_ENABLED: 'false' });

      const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const body = (await response.json()) as { data: { price: number; source: string } };

      expect(body.data.price).toBe(100); // Twelve Data, not Alpaca - hybrid preference never applied
      expect(body.data.source).toBe('twelve_data');
    });

    it('hybrid routing is a no-op when MARKET_SECONDARY_ENABLED is false, even with the hybrid flag on and real credentials configured - the existing master gate always wins', async () => {
      vi.stubGlobal('fetch', hybridFetchStub({ alpacaPrice: 555, twelveDataPrice: 100 }));
      const env = hybridEnv({ MARKET_SECONDARY_ENABLED: 'false' });

      const response = await handleQuote(new Request('https://x/api/mkr/market/quote?symbol=NVDA'), env, 'r1');
      const body = (await response.json()) as { data: { price: number; source: string } };

      expect(body.data.price).toBe(100);
      expect(body.data.source).toBe('twelve_data');
    });
  });
});
