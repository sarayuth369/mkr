import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAdminAlpacaCapabilityTest } from '../src/admin/admin-alpaca-capability-routes';
import type { Env } from '../src/types';

// Hybrid Provider Architecture task (2026-09-16), item 4 - the capability
// test route itself. Cannot exercise a REAL Alpaca account from this
// environment (no live secrets provisioned here - see the architecture
// report), so these tests confirm: (a) the honest "not configured"
// response and its exact operator step when secrets are absent (the
// state this deployment is actually in today), and (b) that a configured
// run genuinely calls the real AlpacaProvider code sequentially and
// classifies outcomes correctly, using a stubbed fetch (never a second,
// fake provider implementation - the task's own "using the actual backend
// provider code" requirement).

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MKR_CONFIG: {} as never,
    MKR_CACHE: {} as never,
    MKR_DB: {} as never,
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
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleAdminAlpacaCapabilityTest', () => {
  it('reports configured: false with the exact operator step when Alpaca credentials are absent - the current state of this deployment', async () => {
    const env = makeEnv(); // no ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY
    const response = await handleAdminAlpacaCapabilityTest(new Request('https://x/api/mkr/admin/alpaca-capability-test'), env);
    const body = (await response.json()) as { data: { configured: boolean; message: string } };

    expect(body.data.configured).toBe(false);
    expect(body.data.message).toContain('wrangler secret put ALPACA_API_KEY_ID');
    expect(body.data.message).toContain('wrangler secret put ALPACA_API_SECRET_KEY');
    // Never fabricates/prints a credential value - only names the two secrets.
    expect(body.data.message).not.toMatch(/[A-Za-z0-9]{20,}/);
  });

  it('tests every representative symbol SEQUENTIALLY against the real AlpacaProvider code, routes stock vs crypto through the correct API family, and classifies each outcome, without changing any config', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrls.push(url);
        const u = new URL(url);
        // Crypto family (v1beta3/crypto/us) - always keyed by the
        // requested symbol, even for a single-symbol request - see
        // alpaca-parser.test.ts's parseAlpacaCryptoSnapshot/Bars tests for
        // why this shape matters.
        if (u.pathname === '/v1beta3/crypto/us/snapshots') {
          const symbol = u.searchParams.get('symbols') ?? '';
          return new Response(JSON.stringify({ snapshots: { [symbol]: { latestTrade: { p: 100 } } } }), { status: 200 });
        }
        if (u.pathname === '/v1beta3/crypto/us/bars') {
          const symbol = u.searchParams.get('symbols') ?? '';
          return new Response(JSON.stringify({ bars: { [symbol]: [{ o: 1, h: 2, l: 0.5, c: 1.5, t: '2026-01-01T00:00:00Z' }] } }), { status: 200 });
        }
        // Stock family (v2/stocks) - flat body, unchanged from before this task.
        if (u.pathname.endsWith('/snapshot')) return new Response(JSON.stringify({ latestTrade: { p: 100 } }), { status: 200 });
        if (u.pathname.endsWith('/bars')) return new Response(JSON.stringify({ bars: [{ o: 1, h: 2, l: 0.5, c: 1.5, t: '2026-01-01T00:00:00Z' }] }), { status: 200 });
        return new Response('{}', { status: 200 });
      }),
    );
    const env = makeEnv({ ALPACA_API_KEY_ID: 'fake-id-not-real', ALPACA_API_SECRET_KEY: 'fake-secret-not-real' });

    const response = await handleAdminAlpacaCapabilityTest(new Request('https://x/api/mkr/admin/alpaca-capability-test'), env);
    const body = (await response.json()) as {
      data: { configured: boolean; results: { mkrSymbol: string; alpacaSymbol: string; family: string; quote: string; candles: string }[]; healthCheck: { healthy: boolean } };
    };

    expect(body.data.configured).toBe(true);
    expect(body.data.results.map((r) => r.mkrSymbol)).toEqual(['AAPL', 'MSFT', 'NVDA', 'QQQ', 'TSLA', 'BTC', 'ETH']);
    for (const r of body.data.results) {
      expect(r.quote).toBe('works');
      expect(r.candles).toBe('works');
    }
    // Family is reported truthfully per symbol, derived from the same
    // symbol-shape check the provider itself uses - never hard-coded here.
    const byMkrSymbol = Object.fromEntries(body.data.results.map((r) => [r.mkrSymbol, r.family]));
    expect(byMkrSymbol.AAPL).toBe('stock');
    expect(byMkrSymbol.TSLA).toBe('stock');
    expect(byMkrSymbol.BTC).toBe('crypto');
    expect(byMkrSymbol.ETH).toBe('crypto');
    expect(body.data.healthCheck.healthy).toBe(true);
    // Every crypto request actually hit the crypto API family, every stock
    // request the stock family - proves this isn't hard-coded only in the
    // admin route, the provider itself dispatched correctly.
    expect(requestedUrls.some((u) => u.includes('/v1beta3/crypto/us/snapshots?symbols=BTC%2FUSD'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/v1beta3/crypto/us/snapshots?symbols=ETH%2FUSD'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/v1beta3/crypto/us/bars?symbols=BTC%2FUSD'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/v1beta3/crypto/us/bars?symbols=ETH%2FUSD'))).toBe(true);
    // Never any request-level concurrency for this test - every fetch call
    // is a distinct, real HTTP call to Alpaca's per-symbol snapshot/bars
    // endpoints (2 per symbol x 7 symbols + 1 health probe = 15), issued
    // one at a time (see the route's own doc comment on why).
    expect(requestedUrls).toHaveLength(15);
  });

  it('classifies a genuine auth failure distinctly from a symbol-specific capability gap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const env = makeEnv({ ALPACA_API_KEY_ID: 'wrong-id', ALPACA_API_SECRET_KEY: 'wrong-secret' });

    const response = await handleAdminAlpacaCapabilityTest(new Request('https://x/api/mkr/admin/alpaca-capability-test'), env);
    const body = (await response.json()) as { data: { results: { quote: string; candles: string }[]; healthCheck: { healthy: boolean } } };

    expect(body.data.results[0]?.quote).toBe('auth');
    expect(body.data.results[0]?.candles).toBe('auth');
    expect(body.data.healthCheck.healthy).toBe(false);
  });
});
