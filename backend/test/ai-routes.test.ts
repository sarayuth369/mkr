import { describe, expect, it, vi } from 'vitest';
import { handleAiAsk, handleAiAssetInsight, handleAiBrief, handleAiEventImpact, handleAiNewsSummary } from '../src/ai/ai-routes';
import { cacheKey } from '../src/cache/cache-service';
import { ApiError } from '../src/errors';
import type { Env, NormalizedQuote } from '../src/types';
import { createFakeKv } from './fakes';

function makeEnv(overrides: { aiEnabled?: boolean; aiRun?: unknown; quotes?: Record<string, Partial<NormalizedQuote>> } = {}): Env {
  const config = createFakeKv();
  const cache = createFakeKv();
  if (overrides.aiEnabled !== false) {
    void config.put('runtime-config', JSON.stringify({ featureFlags: { aiBriefEnabled: true } }));
  }
  for (const [symbol, quote] of Object.entries(overrides.quotes ?? {})) {
    void cache.put(
      cacheKey('quote', symbol),
      JSON.stringify({ v: { symbol, price: 100, changePercent: 1, sessionStatus: 'open', ...quote }, cachedAt: Date.now() }),
    );
  }

  const run = overrides.aiRun ?? vi.fn(async () => ({ response: '' }));
  return {
    MKR_CONFIG: config,
    MKR_CACHE: cache,
    MKR_DB: {} as never,
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
});

describe('AI routes - handleAiAssetInsight', () => {
  it('requires a symbol', async () => {
    const env = makeEnv({ aiRun: vi.fn(async () => ({ response: VALID_INSIGHT_JSON })) });
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({}) });
    await expect(handleAiAssetInsight(req, env, 'r1')).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('grounds the prompt in that symbol\'s cached quote', async () => {
    const run = vi.fn(async () => ({ response: VALID_INSIGHT_JSON }));
    const env = makeEnv({ aiRun: run, quotes: { 'XAU/USD': { price: 4321 } } });
    const req = new Request('https://x/api/mkr/ai/asset-insight', { method: 'POST', body: JSON.stringify({ symbol: 'XAU/USD' }) });
    const res = await handleAiAssetInsight(req, env, 'r1');
    expect(res.status).toBe(200);
    const userMessage = userPromptFrom(run);
    expect(userMessage).toContain('XAU/USD: 4321');
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
