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
  /** Phase 2.2+ flags. Each one gates its feature independently of whether
   * the underlying external credential (Supabase/FCM) is actually
   * configured - a route must fail safely (return a clean "not configured"
   * or "disabled" state, never an error or fabricated success) whenever
   * either the flag is off OR the credential is missing. */
  userAuthEnabled: boolean;
  watchlistSyncEnabled: boolean;
  alertsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  subscriptionEnabled: boolean;
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

/** Task 6 - one entry per provider, kept isolated so Twelve Data and Alpaca can differ without changing any caller. `dailyRequestBudget: 0` means "unconfigured" - the quota guard fails open until an operator sets a real number from their own provider account (see quota-manager.ts; never a fabricated default). */
export interface ProviderBudgets {
  twelveData: { dailyRequestBudget: number };
  alpaca: { dailyRequestBudget: number };
}

export interface RuntimeConfig {
  primaryProvider: ProviderId;
  secondaryProvider: ProviderId | null;
  secondaryEnabled: boolean;
  cacheTtls: CacheTtls;
  rateLimits: RateLimits;
  providerBudgets: ProviderBudgets;
  featureFlags: FeatureFlags;
}

export function defaultConfig(env: Env): RuntimeConfig {
  return {
    primaryProvider: (env.MARKET_PRIMARY_PROVIDER as ProviderId) || 'twelve_data',
    secondaryProvider: (env.MARKET_SECONDARY_PROVIDER as ProviderId) || 'alpaca',
    secondaryEnabled: env.MARKET_SECONDARY_ENABLED === 'true',
    cacheTtls: {
      // Cloudflare KV rejects any expirationTtl under 60 seconds (a hard
      // platform floor, confirmed during deployment) - defaults are 60+
      // accordingly. A Cache-API-backed path is the documented upgrade if
      // sub-60s quote freshness is ever needed (see the architecture doc).
      quoteSeconds: Number(env.CACHE_QUOTE_TTL_SECONDS) || 60,
      candleIntradaySeconds: Number(env.CACHE_CANDLE_INTRADAY_TTL_SECONDS) || 60,
      candleDailySeconds: Number(env.CACHE_CANDLE_DAILY_TTL_SECONDS) || 600,
      statusSeconds: Number(env.CACHE_STATUS_TTL_SECONDS) || 60,
      staleThresholdSeconds: Number(env.STALE_THRESHOLD_SECONDS) || 90,
    },
    rateLimits: {
      publicPerMinute: Number(env.RATE_LIMIT_PUBLIC_PER_MINUTE) || 60,
      adminPerMinute: Number(env.RATE_LIMIT_ADMIN_PER_MINUTE) || 120,
      wsMaxConnections: Number(env.RATE_LIMIT_WS_MAX_CONNECTIONS) || 500,
    },
    // Both default to 0 (unconfigured/guard-inactive) - this codebase has
    // no reliable source for either provider's actual plan limits, and
    // Task 6 explicitly forbids fabricating one. An operator sets these
    // (env var or Admin Web) once they know their real limits.
    providerBudgets: {
      twelveData: { dailyRequestBudget: Number(env.PROVIDER_TWELVE_DATA_DAILY_BUDGET) || 0 },
      alpaca: { dailyRequestBudget: Number(env.PROVIDER_ALPACA_DAILY_BUDGET) || 0 },
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
      // Default OFF: these gate brand-new Phase 2.2/2.3 surfaces that need
      // real Supabase/FCM credentials to do anything - an admin opts in
      // once those are actually configured, rather than the flag silently
      // flipping on for a fresh deploy with nothing behind it yet.
      userAuthEnabled: false,
      watchlistSyncEnabled: false,
      alertsEnabled: false,
      pushNotificationsEnabled: false,
      subscriptionEnabled: false,
    },
  };
}

/**
 * Cache TTL validation - refuses dangerous unlimited/zero values (spec 21)
 * and anything under KV's hard 60-second `expirationTtl` floor, which the
 * platform rejects outright rather than rounding up.
 */
export function isValidTtlSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 60 && value <= 24 * 60 * 60;
}

export function isValidRateLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100_000;
}

/** `0` is valid and means "unconfigured/guard inactive" (see ProviderBudgets doc) - only negative, non-finite, or implausibly large values are rejected. */
export function isValidDailyBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
}
