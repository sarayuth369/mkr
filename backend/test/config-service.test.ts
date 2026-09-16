import { describe, expect, it } from 'vitest';
import { getConfig, updateConfig } from '../src/config/config-service';
import { isValidDailyBudget, isValidRateLimit, isValidTtlSeconds } from '../src/config/defaults';
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

  it('Task 6 - both provider budgets default to 0 (unconfigured) when no env var is set - never a fabricated number', async () => {
    const config = await getConfig(makeEnv());
    expect(config.providerBudgets.twelveData.dailyRequestBudget).toBe(0);
    expect(config.providerBudgets.alpaca.dailyRequestBudget).toBe(0);
  });

  it('reads PROVIDER_TWELVE_DATA_DAILY_BUDGET / PROVIDER_ALPACA_DAILY_BUDGET when set', async () => {
    const env = { ...makeEnv(), PROVIDER_TWELVE_DATA_DAILY_BUDGET: '750', PROVIDER_ALPACA_DAILY_BUDGET: '200' };
    const config = await getConfig(env);
    expect(config.providerBudgets.twelveData.dailyRequestBudget).toBe(750);
    expect(config.providerBudgets.alpaca.dailyRequestBudget).toBe(200);
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
    await updateConfig(env, {
      featureFlags: {
        marketDataLive: true,
        demoMode: true,
        websocketEnabled: true,
        newsEnabled: false,
        economicCalendarEnabled: false,
        aiBriefEnabled: false,
        adsEnabled: true,
        maintenanceMode: false,
        userAuthEnabled: false,
        watchlistSyncEnabled: false,
        alertsEnabled: false,
        pushNotificationsEnabled: false,
        subscriptionEnabled: false,
        hybridRoutingEnabled: false,
        hybridCryptoRoutingEnabled: false,
      },
    });
    const config = await getConfig(env);
    expect(config.cacheTtls.quoteSeconds).toBe(90);
    expect(config.featureFlags.demoMode).toBe(true);
  });

  it('shallow-merges providerBudgets - updating one provider leaves the other untouched', async () => {
    const env = makeEnv();
    await updateConfig(env, { providerBudgets: { twelveData: { dailyRequestBudget: 500 }, alpaca: { dailyRequestBudget: 0 } } });
    await updateConfig(env, { providerBudgets: { twelveData: { dailyRequestBudget: 500 }, alpaca: { dailyRequestBudget: 100 } } });
    const config = await getConfig(env);
    expect(config.providerBudgets.twelveData.dailyRequestBudget).toBe(500);
    expect(config.providerBudgets.alpaca.dailyRequestBudget).toBe(100);
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

  it('isValidDailyBudget accepts 0 (unconfigured/disabled) unlike rate limits, but rejects negative/non-finite/implausibly large values', () => {
    expect(isValidDailyBudget(0)).toBe(true);
    expect(isValidDailyBudget(800)).toBe(true);
    expect(isValidDailyBudget(-1)).toBe(false);
    expect(isValidDailyBudget(NaN)).toBe(false);
    expect(isValidDailyBudget(100_000_000)).toBe(false);
  });
});
