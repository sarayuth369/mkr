/** Cloudflare Worker bindings + non-secret vars, declared once and reused everywhere. */
export interface Env {
  MKR_CONFIG: KVNamespace;
  MKR_CACHE: KVNamespace;
  MKR_DB: D1Database;
  MARKET_STREAM: DurableObjectNamespace;

  MARKET_PRIMARY_PROVIDER: string;
  MARKET_SECONDARY_PROVIDER: string;
  MARKET_SECONDARY_ENABLED: string;
  CACHE_QUOTE_TTL_SECONDS: string;
  CACHE_CANDLE_INTRADAY_TTL_SECONDS: string;
  CACHE_CANDLE_DAILY_TTL_SECONDS: string;
  CACHE_STATUS_TTL_SECONDS: string;
  STALE_THRESHOLD_SECONDS: string;
  RATE_LIMIT_PUBLIC_PER_MINUTE: string;
  RATE_LIMIT_ADMIN_PER_MINUTE: string;
  RATE_LIMIT_WS_MAX_CONNECTIONS: string;
  /** Admin Web's deployed origin, e.g. "https://mkr-admin.pages.dev" - admin CORS never uses "*". */
  ADMIN_WEB_ORIGIN: string;

  // Secrets - never logged, never returned in any API response body.
  TWELVE_DATA_API_KEY?: string;
  ALPACA_API_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}

/** Which upstream actually produced a quote/candle. */
export type MarketDataSource = 'twelve_data' | 'alpaca' | 'unavailable';

export type MarketSessionStatus = 'open' | 'closed' | 'pre_market' | 'after_hours' | 'unknown';

/** MKR-normalized quote - the ONLY shape Flutter ever sees, matching lib/domain/market_quote.dart. */
export interface NormalizedQuote {
  symbol: string;
  name: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  currency: string;
  timestamp: number; // epoch ms
  source: MarketDataSource;
  isLive: boolean;
  sessionStatus: MarketSessionStatus;
}

/** MKR-normalized candle - matches lib/domain/market_candle.dart. */
export interface NormalizedCandle {
  symbol: string;
  interval: MkrTimeframe;
  timestamp: number; // epoch ms, candle open time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: MarketDataSource;
}

export interface NormalizedMarketStatus {
  symbol: string;
  market: string | null;
  exchange: string | null;
  session: MarketSessionStatus;
  isOpen: boolean | null; // null = unknown, never guessed
  timestamp: number;
  source: MarketDataSource;
}

export type MkrTimeframe = 'm1' | 'm5' | 'm15' | 'h1' | 'h4' | 'd1' | 'w1' | 'mo1';

export const MKR_TIMEFRAMES: readonly MkrTimeframe[] = ['m1', 'm5', 'm15', 'h1', 'h4', 'd1', 'w1', 'mo1'];

export type ProviderId = 'twelve_data' | 'alpaca';

export type ProviderHealthStatus = 'healthy' | 'unhealthy' | 'disabled' | 'unknown';

export interface ProviderHealth {
  provider: ProviderId;
  status: ProviderHealthStatus;
  latencyMs: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  errorCount: number;
}
