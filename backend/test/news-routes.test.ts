import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetInFlightForTests } from '../src/cache/cache-service';
import { handleCalendarEvents, handleNews, handleNewsRelated } from '../src/news/news-routes';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

function makeEnv(overrides: { newsEnabled?: boolean; calendarEnabled?: boolean; apiKey?: string | null } = {}): Env {
  const config = createFakeKv();
  void config.put(
    'runtime-config',
    JSON.stringify({
      featureFlags: {
        newsEnabled: overrides.newsEnabled ?? true,
        economicCalendarEnabled: overrides.calendarEnabled ?? true,
      },
    }),
  );
  return {
    MKR_CONFIG: config,
    MKR_CACHE: createFakeKv(),
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
    FINNHUB_API_KEY: overrides.apiKey === null ? undefined : (overrides.apiKey ?? 'fake-finnhub-key-not-real'),
  };
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetInFlightForTests();
});

describe('handleNews', () => {
  it('throws FEATURE_DISABLED when newsEnabled is off, even with a key configured', async () => {
    const env = makeEnv({ newsEnabled: false });
    await expect(handleNews(new Request('https://x/api/mkr/news'), env)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('throws FEATURE_DISABLED when the flag is on but FINNHUB_API_KEY is missing', async () => {
    const env = makeEnv({ apiKey: null });
    await expect(handleNews(new Request('https://x/api/mkr/news'), env)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('returns parsed, normalized articles on success', async () => {
    const fetchSpy = jsonFetch([
      { headline: 'Gold hits record high', summary: 'Bullion rallied.', datetime: 1700000000, source: 'Reuters', category: 'general', related: 'GOLD' },
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const res = await handleNews(new Request('https://x/api/mkr/news'), env);
    const body = (await res.json()) as { success: boolean; data: unknown[] };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('is a cache hit on the second call within the TTL - fetch runs once', async () => {
    const fetchSpy = jsonFetch([{ headline: 'X', summary: 'Y', datetime: 1 }]);
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleNews(new Request('https://x/api/mkr/news'), env);
    await handleNews(new Request('https://x/api/mkr/news'), env);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('handleNewsRelated', () => {
  it('requires a symbol query parameter', async () => {
    const env = makeEnv();
    await expect(handleNewsRelated(new Request('https://x/api/mkr/news/related'), env)).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('filters the shared cached article set by affected asset, case-insensitively', async () => {
    const fetchSpy = jsonFetch([
      { headline: 'Gold news', summary: 'S', datetime: 1, related: 'GOLD,XAU' },
      { headline: 'Unrelated news', summary: 'S', datetime: 2, related: 'NVDA' },
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const res = await handleNewsRelated(new Request('https://x/api/mkr/news/related?symbol=gold'), env);
    const body = (await res.json()) as { data: { headline: string }[] };

    expect(body.data.map((a) => a.headline)).toEqual(['Gold news']);
  });

  it('shares the same cache entry as handleNews - one real fetch serves both routes', async () => {
    const fetchSpy = jsonFetch([{ headline: 'Gold news', summary: 'S', datetime: 1, related: 'GOLD' }]);
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleNews(new Request('https://x/api/mkr/news'), env);
    await handleNewsRelated(new Request('https://x/api/mkr/news/related?symbol=gold'), env);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('handleCalendarEvents', () => {
  it('throws FEATURE_DISABLED when economicCalendarEnabled is off', async () => {
    const env = makeEnv({ calendarEnabled: false });
    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('throws FEATURE_DISABLED when the flag is on but FINNHUB_API_KEY is missing', async () => {
    const env = makeEnv({ calendarEnabled: true, apiKey: null });
    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('returns parsed, normalized events on success', async () => {
    const fetchSpy = jsonFetch({
      economicCalendar: [{ country: 'US', event: 'CPI (YoY)', impact: 'high', time: '2026-01-15 19:30:00', prev: 3.1, estimate: 2.9 }],
    });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    const body = (await res.json()) as { success: boolean; data: { title: string; impact: string }[] };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ title: 'CPI (YoY)', impact: 'high' });
  });

  it('is a cache hit on the second call within the TTL - fetch runs once', async () => {
    const fetchSpy = jsonFetch({ economicCalendar: [] });
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv();

    await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates PROVIDER_UNAVAILABLE on a non-2xx Finnhub response rather than crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    const env = makeEnv();

    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
