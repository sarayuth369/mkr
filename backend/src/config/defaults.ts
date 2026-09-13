import type { Env, ProviderId } from '../types';

export interface FeatureFlags {
  marketDataLive: boolean;
  demoMode: boolean;
  websocketEnabled: boolean;
  newsEnabled: boolean;
  economicCalendarEnabled: boolean;
  aiBriefEnabled: boolean;
  adsEnabled: boolean;
  maintenanceMode: boolean;
}

export interface CacheTtls {
  quoteSeconds: number;
  candleIntradaySeconds: number;
  candleDailySeconds: number;
  statusSeconds: number;
  staleThresholdSeconds: number;
}

export interface RateLimits {
  publicPerMinute: number;
  adminPerMinute: number;
  wsMaxConnections: number;
}

export interface RuntimeConfig {
  primaryProvider: ProviderId;
  secondaryProvider: ProviderId | null;
  secondaryEnabled: boolean;
  cacheTtls: CacheTtls;
  rateLimits: RateLimits;
  featureFlags: FeatureFlags;
}

export function defaultConfig(env: Env): RuntimeConfig {
  return {
    primaryProvider: (env.MARKET_PRIMARY_PROVIDER as ProviderId) || 'twelve_data',
    secondaryProvider: (env.MARKET_SECONDARY_PROVIDER as ProviderId) || 'alpaca',
    secondaryEnabled: env.MARKET_SECONDARY_ENABLED === 'true',
    cacheTtls: {
      quoteSeconds: Number(env.CACHE_QUOTE_TTL_SECONDS) || 15,
      candleIntradaySeconds: Number(env.CACHE_CANDLE_INTRADAY_TTL_SECONDS) || 30,
      candleDailySeconds: Number(env.CACHE_CANDLE_DAILY_TTL_SECONDS) || 600,
      statusSeconds: Number(env.CACHE_STATUS_TTL_SECONDS) || 60,
      staleThresholdSeconds: Number(env.STALE_THRESHOLD_SECONDS) || 60,
    },
    rateLimits: {
      publicPerMinute: Number(env.RATE_LIMIT_PUBLIC_PER_MINUTE) || 60,
      adminPerMinute: Number(env.RATE_LIMIT_ADMIN_PER_MINUTE) || 120,
      wsMaxConnections: Number(env.RATE_LIMIT_WS_MAX_CONNECTIONS) || 500,
    },
    featureFlags: {
      marketDataLive: true,
      demoMode: false,
      websocketEnabled: true,
      newsEnabled: false,
      economicCalendarEnabled: false,
      aiBriefEnabled: false,
      adsEnabled: true,
      maintenanceMode: false,
    },
  };
}

/** Cache TTL validation - refuses dangerous unlimited/zero values (spec 21). */
export function isValidTtlSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 24 * 60 * 60;
}

export function isValidRateLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100_000;
}
