-- MKR backend D1 schema. Structured, admin-managed data only - fast/hot
-- runtime config (feature flags, provider toggles, cache TTLs, rate limits)
-- lives in the MKR_CONFIG KV namespace instead (see src/config/config-service.ts).
-- Apply with: wrangler d1 execute mkr-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS symbols (
  symbol TEXT PRIMARY KEY,           -- MKR internal symbol, e.g. "XAU/USD"
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,            -- gold | us_stock | indices | forex | crypto | thailand | commodity | rate | other
  enabled INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  twelve_data_symbol TEXT,           -- NULL = not supported by this provider
  alpaca_symbol TEXT,                -- NULL = not supported by this provider
  default_timeframe TEXT NOT NULL DEFAULT 'd1',
  cache_ttl_seconds INTEGER,         -- NULL = use the category default
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,               -- admin identifier (there is currently one shared admin login)
  action TEXT NOT NULL,              -- e.g. "provider.secondary_enabled.changed"
  target TEXT,                       -- e.g. "alpaca", "XAU/USD"
  old_value TEXT,                    -- JSON-encoded; NEVER a secret (enforced in code, see audit-log.ts)
  new_value TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_symbols_category ON symbols (category);

-- Economic Calendar (2026-09-15 hybrid-architecture task) - D1 is the
-- canonical store; MKR_CACHE (KV) only ever caches a read of this table,
-- never authoritative on its own (see src/calendar/).
CREATE TABLE IF NOT EXISTS economic_events (
  id TEXT PRIMARY KEY,               -- deterministic: `${source}:${sourceEventId}` - see src/calendar/types.ts
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  country TEXT NOT NULL,
  currency TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,            -- MKR-owned classification, never a copied provider label
  event_time_utc INTEGER NOT NULL,   -- epoch ms
  importance TEXT NOT NULL,          -- high | medium | low | unknown
  previous REAL,                     -- NULL = source did not supply a value - never fabricated
  consensus REAL,
  actual REAL,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', -- scheduled | released | cancelled | unknown
  related_assets TEXT NOT NULL DEFAULT '[]', -- JSON array of MKR symbols
  source_url TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economic_events_time ON economic_events (event_time_utc);
CREATE INDEX IF NOT EXISTS idx_economic_events_country ON economic_events (country);
CREATE INDEX IF NOT EXISTS idx_economic_events_source ON economic_events (source);

-- One row per collector/provider - last success/failure + event count, for
-- the calendar freshness policy (src/calendar/freshness.ts) and minimal
-- admin observability (GET /api/mkr/admin/calendar).
CREATE TABLE IF NOT EXISTS calendar_source_state (
  source TEXT PRIMARY KEY,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  last_error_message TEXT,
  last_event_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Seed the Phase 1 catalog so Admin Web has something to manage on day one.
INSERT OR IGNORE INTO symbols (symbol, display_name, category, enabled, featured, sort_order, twelve_data_symbol, alpaca_symbol, default_timeframe, updated_at) VALUES
  ('XAU/USD', 'Gold Spot', 'gold', 1, 1, 0, 'XAU/USD', NULL, 'd1', strftime('%s','now')),
  ('NVDA', 'NVIDIA Corp', 'us_stock', 1, 1, 10, 'NVDA', 'NVDA', 'd1', strftime('%s','now')),
  ('AAPL', 'Apple Inc', 'us_stock', 1, 0, 11, 'AAPL', 'AAPL', 'd1', strftime('%s','now')),
  ('MSFT', 'Microsoft Corp', 'us_stock', 1, 0, 12, 'MSFT', 'MSFT', 'd1', strftime('%s','now')),
  ('AMZN', 'Amazon.com Inc', 'us_stock', 1, 0, 13, 'AMZN', 'AMZN', 'd1', strftime('%s','now')),
  ('META', 'Meta Platforms Inc', 'us_stock', 1, 0, 14, 'META', 'META', 'd1', strftime('%s','now')),
  ('GOOGL', 'Alphabet Inc', 'us_stock', 1, 0, 15, 'GOOGL', 'GOOGL', 'd1', strftime('%s','now')),
  ('TSLA', 'Tesla Inc', 'us_stock', 1, 0, 16, 'TSLA', 'TSLA', 'd1', strftime('%s','now')),
  ('QQQ', 'Invesco QQQ Trust', 'us_stock', 1, 0, 17, 'QQQ', 'QQQ', 'd1', strftime('%s','now')),
  ('SPX', 'S&P 500 Index', 'indices', 1, 1, 20, 'SPX', NULL, 'd1', strftime('%s','now')),
  ('NDX', 'Nasdaq 100 Index', 'indices', 1, 0, 21, 'NDX', NULL, 'd1', strftime('%s','now')),
  ('DJI', 'Dow Jones Industrial Average', 'indices', 1, 0, 22, 'DJI', NULL, 'd1', strftime('%s','now')),
  ('RUT', 'Russell 2000 Index', 'indices', 1, 0, 23, 'RUT', NULL, 'd1', strftime('%s','now')),
  ('VIX', 'CBOE Volatility Index', 'indices', 1, 0, 24, 'VIX', NULL, 'd1', strftime('%s','now')),
  ('BTC', 'Bitcoin', 'crypto', 1, 1, 30, 'BTC/USD', 'BTC/USD', 'd1', strftime('%s','now')),
  ('ETH', 'Ethereum', 'crypto', 1, 0, 31, 'ETH/USD', 'ETH/USD', 'd1', strftime('%s','now')),
  ('SOL', 'Solana', 'crypto', 1, 0, 32, 'SOL/USD', 'SOL/USD', 'd1', strftime('%s','now')),
  ('XRP', 'XRP', 'crypto', 1, 0, 33, 'XRP/USD', 'XRP/USD', 'd1', strftime('%s','now')),
  ('EUR/USD', 'Euro / US Dollar', 'forex', 1, 0, 40, 'EUR/USD', NULL, 'd1', strftime('%s','now')),
  ('GBP/USD', 'British Pound / US Dollar', 'forex', 1, 0, 41, 'GBP/USD', NULL, 'd1', strftime('%s','now')),
  ('USD/JPY', 'US Dollar / Japanese Yen', 'forex', 1, 0, 42, 'USD/JPY', NULL, 'd1', strftime('%s','now')),
  ('AUD/USD', 'Australian Dollar / US Dollar', 'forex', 1, 0, 43, 'AUD/USD', NULL, 'd1', strftime('%s','now')),
  ('USD/CAD', 'US Dollar / Canadian Dollar', 'forex', 1, 0, 44, 'USD/CAD', NULL, 'd1', strftime('%s','now')),
  ('SET', 'SET Index', 'thailand', 1, 0, 50, NULL, NULL, 'd1', strftime('%s','now')),
  ('SET50', 'SET50 Index', 'thailand', 1, 0, 51, NULL, NULL, 'd1', strftime('%s','now')),
  ('DXY', 'US Dollar Index', 'commodity', 0, 0, 60, NULL, NULL, 'd1', strftime('%s','now')),
  ('US10Y', 'US 10-Year Treasury Yield', 'rate', 0, 0, 61, NULL, NULL, 'd1', strftime('%s','now')),
  ('OIL', 'WTI Crude Oil', 'commodity', 0, 0, 62, NULL, NULL, 'd1', strftime('%s','now'));
