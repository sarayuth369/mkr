import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAiAsk, handleAiAssetInsight, handleAiBrief, handleAiEventImpact, handleAiNewsSummary } from '../src/ai/ai-routes';
import { _resetInFlightForTests, cacheKey } from '../src/cache/cache-service';
import { ApiError } from '../src/errors';
import { _resetCircuitsForTests } from '../src/providers/circuit-breaker';
import { _resetHealthForTests } from '../src/providers/provider-manager';
import { _resetQuotaUsageForTests } from '../src/providers/quota-manager';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env, NormalizedQuote } from '../src/types';
import { createFakeKv } from './fakes';

// 2026-09-17 Final UX/Reliability task: `handleAiAssetInsight` now actively
// fetches a live quote (the same `requireSymbolRow` + `cachedFetch` +
// `manager.getQuote` path `/market/quote` uses) instead of only passively
// reading whatever another route happened to already cache - see
// ai-routes.ts's `liveQuoteContext` doc comment for the real bug this
// fixes. That means these tests need a working fake D1 catalog (not the
// empty `{}` this file used before) and, for the "cold cache" cases, a
// stubbed Twelve Data fetch response - the exact same pattern already
// established in market-routes-quote-cache.test.ts.
function symbolRow(overrides: Partial<SymbolRow> & { symbol: string }): SymbolRow {
  return {
    display_name: overrides.symbol,
    category: 'us_stock',
    enabled: 1,
    featured: 0,
    sort_order: 0,
    twelve_data_symbol: overrides.symbol,
    alpaca_symbol: null,
    default_timeframe: 'd1',
    cache_ttl_seconds: null,
    updated_at: 0,
    ...overrides,
  };
}

const CATALOG: SymbolRow[] = [
  symbolRow({ symbol: 'XAU/USD', category: 'gold', featured: 1 }),
  symbolRow({ symbol: 'NVDA', featured: 1, alpaca_symbol: 'NVDA' }),
  symbolRow({ symbol: 'BTC', category: 'crypto', twelve_data_symbol: 'BTC/USD', alpaca_symbol: 'BTC/USD' }),
  symbolRow({ symbol: 'ETH', category: 'crypto', twelve_data_symbol: 'ETH/USD', alpaca_symbol: 'ETH/USD' }),
  symbolRow({ symbol: 'EUR/USD', category: 'forex' }),
];

function fakeSymbolsD1(rows: SymbolRow[]): Env['MKR_DB'] {
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

function twelveDataQuote(price: number) {
  return { close: String(price), open: String(price - 1), high: String(price + 1), low: String(price - 2), previous_close: String(price - 0.5), volume: '1000', name: 'Test', currency: 'USD', is_market_open: true };
}

/** Stubs `fetch` to answer Twelve Data's quote shape for whichever symbols
 * are given - a symbol NOT in `bySymbol` gets Twelve Data's own "not found"
 * error envelope, simulating a genuine provider-side miss. */
function fetchStub(bySymbol: Record<string, ReturnType<typeof twelveDataQuote>>) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url));
    const requested = (u.searchParams.get('symbol') ?? '').split(',').filter(Boolean)[0] ?? '';
    const data = bySymbol[requested];
    return new Response(JSON.stringify(data ?? { status: 'error', message: 'symbol not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetInFlightForTests();
  _resetCircuitsForTests();
  _resetHealthForTests();
  _resetQuotaUsageForTests();
});

function makeEnv(overrides: { aiEnabled?: boolean; aiRun?: unknown; quotes?: Record<string, Partial<NormalizedQuote>>; catalog?: SymbolRow[] } = {}): Env {
  const config = createFakeKv();
  const cache = createFakeKv();
  if (overrides.aiEnabled !== false) {
    void config.put('runtime-config', JSON.stringify({ featureFlags: { aiBriefEnabled: true } }));
  }
  for (const [symbol, quote] of Object.entries(overrides.quotes ?? {})) {
    void cache.put(
      cacheKey('quote', symbol),
      JSON.stringify({ v: { symbol, price: 100, changePercent: 1, sessionStatus: 'open', ...quote }, storedAt: Date.now() }),
    );
  }

  const run = overrides.aiRun ?? vi.fn(async () => ({ response: '' }));
  return {
    MKR_CONFIG: config,
    MKR_CACHE: cache,
    MKR_DB: fakeSymbolsD1(overrides.catalog ?? CATALOG),
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
    AI: { run } as never,
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
  };
}

const VALID_INSIGHT_JSON = JSON.stringify({
  summary: 'Markets are mixed today.',
  whyItMatters: 'Rates and inflation data are in focus.',
  marketImpact: 'Gold firm, equities mixed.',
  whatToWatch: ['CPI print', 'Fed presser'],
  risks: ['Volatility around the data release'],
});

async function jsonBody(response: Response): Promise<any> {
  return response.json();
}

/** Extracts the user-role prompt text from a mocked `env.AI.run` call, so
 * tests can assert real grounding data reached the model. */
function userPromptFrom(run: ReturnType<typeof vi.fn>): string {
  const call = run.mock.calls[0];
  if (!call) throw new Error('run() was never called');
  const [, options] = call as [string, { messages: { role: string; content: string }[] }];
  const userMessage = options.messages[1];
  if (!userMessage) throw new Error('expected a user-role message at index 1');
  return userMessage.content;
}

describe('AI routes - feature flag gating', () => {
  it('handleAiBrief throws FEATURE_DISABLED when aiBriefEnabled is off', async () => {
    const env = makeEnv({ aiEnabled: false });
    await expect(handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });

  it('handleAiAsk throws FEATURE_DISABLED when aiBriefEnabled is off', async () => {
    const env = makeEnv({ aiEnabled: false });
    const req = new Request('https://x/api/mkr/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'What is gold?' }) });
    await expect(handleAiAsk(req, env, 'r1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('AI routes - handleAiBrief', () => {
  it('returns a structured AIInsight grounded in cached quotes, calling Workers AI exactly once', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run, quotes: { 'XAU/USD': { price: 4300, changePercent: 0.5 }, BTC: { price: 95000, changePercent: -1.2 } } });

    const res = await handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1');
    const body = await jsonBody(res);

    expect(run).toHaveBeenCalledTimes(1);
    expect(body.success).toBe(true);
    expect(body.data.summary).toBe('Markets are mixed today.');
    expect(body.data.whatToWatch).toEqual(['CPI print', 'Fed presser']);
    expect(body.data.risks).toEqual(['Volatility around the data release']);
    expect(typeof body.data.generatedAt).toBe('number');

    // Grounding data actually reached the model - never a hallucinated brief.
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('XAU/USD: 4300');
    expect(userMessage).toContain('BTC: 95000');
  });

  it('throws INTERNAL_ERROR (not a 500 crash) when the model returns non-JSON text', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: 'Sure! Markets are doing fine today, no JSON here.' })) });
    await expect(handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('throws INTERNAL_ERROR when the model returns JSON missing required fields', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: JSON.stringify({ summary: 'ok' }) })) });
    await expect(handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('maps a Workers AI failure to PROVIDER_UNAVAILABLE rather than crashing', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => Promise.reject(new Error('binding not available'))) });
    await expect(handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('still produces a brief (with weaker grounding) when no quotes are cache-warm - never throws for that reason alone', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run });
    const res = await handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1');
    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('No live quote data is currently cached.');
  });

  // Confirmed live (2026-09-15): after switching models following a
  // deprecation, the new model's `response` field was sometimes an object
  // rather than a plain string - these pin the fallback shapes
  // extractModelText now handles instead of producing "[object Object]".
  it('extracts text from a nested response.content shape', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: { content: VALID_INSIGHT_JSON } })) });
    const res = await handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1');
    expect(res.status).toBe(200);
  });

  it('extracts text from an OpenAI-compatible choices[0].message.content shape', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ choices: [{ message: { content: VALID_INSIGHT_JSON } }] })) });
    const res = await handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1');
    expect(res.status).toBe(200);
  });

  it('throws INTERNAL_ERROR (not "[object Object]") when response is an unrecognized shape', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: { unexpected: 'shape' } })) });
    await expect(handleAiBrief(new Request('https://x/api/mkr/ai/brief', { method: 'POST' }), env, 'r1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('AI routes - handleAiAssetInsight', () => {
  it('requires a symbol', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: VALID_INSIGHT_JSON })) });
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({}) });
    await expect(handleAiAssetInsight(req, env, 'r1')).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('grounds the prompt in that symbol\'s cached quote (cache hit - no provider fetch needed)', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const fetchSpy = fetchStub({});
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv({ aiRun: run, quotes: { 'XAU/USD': { price: 4321 } } });
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({ symbol: 'XAU/USD' }) });
    const res = await handleAiAssetInsight(req, env, 'r1');
    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('XAU/USD: 4321');
    expect(fetchSpy).not.toHaveBeenCalled(); // fresh cache entry - never re-fetched from the provider
  });

  // 2026-09-17 Final UX/Reliability task - THE regression test for the real
  // bug: live smoke found this route returning "no available data" for
  // XAU/USD/NVDA despite both having real, working live quotes at that
  // moment. Root cause was a cold/never-warmed cache entry with no active
  // fetch fallback - this reproduces exactly that (no `quotes` pre-seeded)
  // and asserts the fix actively fetches a real quote instead of falling
  // back to the "no data" placeholder.
  it('actively fetches a live quote when the cache is cold, instead of falling back to "no data" (the real bug this task fixes)', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const fetchSpy = fetchStub({ NVDA: twelveDataQuote(180) });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv({ aiRun: run }); // no `quotes` seeded - cache starts genuinely cold
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({ symbol: 'NVDA' }) });

    const res = await handleAiAssetInsight(req, env, 'r1');

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // a real, single, bounded fetch happened
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('NVDA: 180');
    expect(userMessage).not.toContain('No live quote data');
  });

  it('normalizes symbol casing exactly like /market/quote, so both routes share one cache entry', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run, quotes: { 'XAU/USD': { price: 4321 } } }); // seeded under the canonical UPPERCASE key
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({ symbol: 'xau/usd' }) }); // lowercase from the client
    const fetchSpy = fetchStub({});
    vi.stubGlobal('fetch', fetchSpy);

    const res = await handleAiAssetInsight(req, env, 'r1');

    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('XAU/USD: 4321'); // hit the same cache entry - no case-mismatch miss
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a disabled/unknown symbol degrades to the honest "no data" context instead of throwing the whole insight', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run }); // 'SPX' is not in the fake catalog at all
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({ symbol: 'SPX' }) });

    const res = await handleAiAssetInsight(req, env, 'r1');

    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('No live quote data is currently available.');
  });
});

describe('AI routes - handleAiNewsSummary', () => {
  it('requires headline and summary', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: VALID_INSIGHT_JSON })) });
    const req = new Request('https://x/api/mkr/ai/news-summary', { method: 'POST', body: JSON.stringify({ headline: 'Only a headline' }) });
    await expect(handleAiNewsSummary(req, env, 'r1')).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('passes the article text through to the model', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run });
    const req = new Request('https://x/api/mkr/ai/news-summary', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Gold hits record high', summary: 'Bullion rallied on rate-cut bets.' }),
    });
    const res = await handleAiNewsSummary(req, env, 'r1');
    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('Gold hits record high');
    expect(userMessage).toContain('Bullion rallied on rate-cut bets.');
  });
});

describe('AI routes - handleAiEventImpact', () => {
  it('requires a title', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: VALID_INSIGHT_JSON })) });
    const req = new Request('https://x/api/mkr/ai/event-impact', { method: 'POST', body: JSON.stringify({}) });
    await expect(handleAiEventImpact(req, env, 'r1')).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });
});

describe('AI routes - handleAiAsk', () => {
  it('requires a non-empty question', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: 'anything' })) });
    const req = new Request('https://x/api/mkr/ai/ask', { method: 'POST', body: JSON.stringify({ question: '   ' }) });
    await expect(handleAiAsk(req, env, 'r1')).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('returns the model\'s free-text answer, not JSON-parsed', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: 'Gold is a precious metal often used as a hedge.' })) });
    const req = new Request('https://x/api/mkr/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'What is gold?' }) });
    const res = await handleAiAsk(req, env, 'r1');
    const body = await jsonBody(res);
    expect(body.data.answer).toBe('Gold is a precious metal often used as a hedge.');
  });

  it('throws INTERNAL_ERROR when the model returns an empty answer', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: '   ' })) });
    const req = new Request('https://x/api/mkr/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'What is gold?' }) });
    await expect(handleAiAsk(req, env, 'r1')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
