import { describe, expect, it } from 'vitest';
import { refreshAlertIndex } from '../src/alerts/alert-index';
import { supabaseConfigFrom } from '../src/supabase/supabase-client';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MKR_CONFIG: {} as never,
    MKR_CACHE: { put: async () => {}, get: async () => null } as never,
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

describe('supabaseConfigFrom', () => {
  it('is null when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not set - never assumes a project', () => {
    expect(supabaseConfigFrom(makeEnv())).toBeNull();
  });

  it('is null when only one of the two required values is set', () => {
    expect(supabaseConfigFrom(makeEnv({ SUPABASE_URL: 'https://x.supabase.co' }))).toBeNull();
  });

  it('strips a trailing slash from the URL once both values are set', () => {
    const config = supabaseConfigFrom(makeEnv({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'key' }));
    expect(config?.url).toBe('https://x.supabase.co');
  });
});

describe('refreshAlertIndex', () => {
  it('returns null (Alert Engine disabled) rather than throwing when Supabase is not configured', async () => {
    const index = await refreshAlertIndex(makeEnv());
    expect(index).toBeNull();
  });
});
