import { describe, expect, it } from 'vitest';
import { getConfig, updateConfig } from '../src/config/config-service';
import { isValidRateLimit, isValidTtlSeconds } from '../src/config/defaults';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

function makeEnv(): Env {
  return {
    MKR_CONFIG: createFakeKv(),
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
  } as unknown as Env;
}

describe('getConfig', () => {
  it('falls back to wrangler.toml-derived defaults when KV has nothing yet', async () => {
    const env = makeEnv();
    const config = await getConfig(env);
    expect(config.primaryProvider).toBe('twelve_data');
    expect(config.secondaryEnabled).toBe(false);
    expect(config.cacheTtls.quoteSeconds).toBe(60);
  });

  it('Alpaca stays disabled by default, matching the licensing-safety requirement', async () => {
    const config = await getConfig(makeEnv());
    expect(config.secondaryEnabled).toBe(false);
  });
});

describe('updateConfig', () => {
  it('persists a partial update and merges it with existing config on the next read', async () => {
    const env = makeEnv();
    await updateConfig(env, { secondaryEnabled: true });
    const config = await getConfig(env);
    expect(config.secondaryEnabled).toBe(true);
    expect(config.primaryProvider).toBe('twelve_data'); // untouched fields survive
  });

  it('shallow-merges nested objects like cacheTtls instead of replacing the whole object', async () => {
    const env = makeEnv();
    await updateConfig(env, { cacheTtls: { quoteSeconds: 90, candleIntradaySeconds: 60, candleDailySeconds: 600, statusSeconds: 60, staleThresholdSeconds: 90 } });
    await updateConfig(env, { featureFlags: { marketDataLive: true, demoMode: true, websocketEnabled: true, newsEnabled: false, economicCalendarEnabled: false, aiBriefEnabled: false, adsEnabled: true, maintenanceMode: false } });
    const config = await getConfig(env);
    expect(config.cacheTtls.quoteSeconds).toBe(90);
    expect(config.featureFlags.demoMode).toBe(true);
  });
});

describe('validation helpers', () => {
  it('rejects zero/negative/unbounded TTLs, and anything under the KV 60s floor', () => {
    expect(isValidTtlSeconds(0)).toBe(false);
    expect(isValidTtlSeconds(-5)).toBe(false);
    expect(isValidTtlSeconds(999_999)).toBe(false);
    expect(isValidTtlSeconds(30)).toBe(false);
    expect(isValidTtlSeconds(60)).toBe(true);
  });

  it('rejects zero/negative/unbounded rate limits', () => {
    expect(isValidRateLimit(0)).toBe(false);
    expect(isValidRateLimit(-1)).toBe(false);
    expect(isValidRateLimit(1_000_001)).toBe(false);
    expect(isValidRateLimit(60)).toBe(true);
  });
});
