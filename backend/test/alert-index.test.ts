import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAlertIndex, refreshAlertIndex } from '../src/alerts/alert-index';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function trackPuts(kv: ReturnType<typeof createFakeKv>) {
  const calls: string[] = [];
  const originalPut = kv.put.bind(kv);
  (kv as unknown as { put: typeof kv.put }).put = (async (key: string, value: string, opts?: KVNamespacePutOptions) => {
    calls.push(key);
    return originalPut(key, value, opts);
  }) as typeof kv.put;
  return calls;
}

function makeEnv(cache: KVNamespace): Env {
  return {
    MKR_CONFIG: {} as never,
    MKR_CACHE: cache,
    MKR_DB: {} as never,
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
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-not-real',
  };
}

const alertRow = {
  id: 'a1',
  symbol: 'XAU/USD',
  condition_type: 'price_above',
  target_value: 3450,
  enabled: true,
  cooldown_seconds: 3600,
  last_triggered_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshAlertIndex - Phase 0.A KV quota fix', () => {
  it('does not touch KV at all when Supabase is not configured', async () => {
    const kv = createFakeKv();
    const puts = trackPuts(kv);
    const env = { ...makeEnv(kv), SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
    const result = await refreshAlertIndex(env);
    expect(result).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it('writes on the first refresh (no existing index cached yet)', async () => {
    const kv = createFakeKv();
    const puts = trackPuts(kv);
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes([alertRow])));

    const index = await refreshAlertIndex(makeEnv(kv));

    expect(puts).toEqual(['alerts:index']);
    expect(index?.bySymbol['XAU/USD']).toHaveLength(1);
  });

  it('skips the KV write on a subsequent tick when the alert set is unchanged', async () => {
    const kv = createFakeKv();
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes([alertRow])));
    await refreshAlertIndex(makeEnv(kv)); // first write seeds the cache

    const puts = trackPuts(kv);
    const second = await refreshAlertIndex(makeEnv(kv));

    expect(puts).toHaveLength(0); // the guaranteed-write-every-tick bug this fixes
    expect(second?.bySymbol['XAU/USD']).toHaveLength(1);
  });

  it('writes again once the alert set actually changes', async () => {
    const kv = createFakeKv();
    const fetchSpy = vi.fn(async () => jsonRes([alertRow]));
    vi.stubGlobal('fetch', fetchSpy);
    await refreshAlertIndex(makeEnv(kv));

    const changedRow = { ...alertRow, id: 'a2', target_value: 3500 };
    fetchSpy.mockImplementation(async () => jsonRes([alertRow, changedRow]));
    const puts = trackPuts(kv);
    const result = await refreshAlertIndex(makeEnv(kv));

    expect(puts).toEqual(['alerts:index']);
    expect(result?.bySymbol['XAU/USD']).toHaveLength(2);
  });

  it('writes a keepalive refresh once the last write is old enough, even with unchanged content', async () => {
    const kv = createFakeKv();
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes([alertRow])));
    await refreshAlertIndex(makeEnv(kv));

    // Backdate the cached builtAt past the keepalive threshold (5 minutes) without changing content.
    const stale = await getAlertIndex(makeEnv(kv));
    await kv.put('alerts:index', JSON.stringify({ ...stale, builtAt: Date.now() - 301_000 }));

    const puts = trackPuts(kv);
    await refreshAlertIndex(makeEnv(kv));

    expect(puts).toEqual(['alerts:index']); // TTL-refresh write, not a content-change write
  });

  it('does not throw when the KV write itself fails (e.g. quota exhausted) - degrades, not fatal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes([alertRow])));
    const failingKv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV PUT quota exceeded');
      },
    } as unknown as KVNamespace;

    const result = await refreshAlertIndex(makeEnv(failingKv)); // throws here if not handled - test fails
    expect(result?.bySymbol['XAU/USD']).toHaveLength(1);
  });
});
