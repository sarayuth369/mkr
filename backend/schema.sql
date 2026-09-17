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
--
-- 2026-09-17 Catalog Expansion task: SPX/NDX/DJI/RUT/VIX/SET/SET50/DXY/
-- US10Y/OIL are seeded `enabled=0` here (previously SPX/NDX/DJI/RUT/VIX/
-- SET/SET50 were seeded `enabled=1`, matching what a fresh DB used to
-- produce). Live verification against the real Twelve Data Basic-tier
-- account confirmed all ten genuinely fail on quote+candle: SPX/NDX/OIL
-- are plan-gated ("available starting with the Grow/Venture plan"),
-- DJI/RUT/VIX/DXY/US10Y are unrecognized symbol strings on this account,
-- and SET/SET50 have no real Twelve Data mapping at all (Thai XBKK
-- equities are plan-gated on Basic - see the catalog discovery report).
-- This seed is kept in sync with that live correction so a fresh DB
-- never reintroduces rows already proven dead - `INSERT OR IGNORE` won't
-- touch an existing live row, but a brand-new deployment must start from
-- the corrected, honest state, not the original guess.
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
  -- 2026-09-17 catalog expansion, revised after operator review: JPM..BND
  -- below only carry an Alpaca mapping (Twelve Data has no coverage for
  -- most of them on this Basic-tier account, and it was never actually
  -- verified for the rest). MarketProviderManager's `secondaryEnabled`
  -- flag is a GLOBAL activation gate for Alpaca (confirmed live: with it
  -- `false`, an Alpaca-only symbol has literally no usable route slot,
  -- not merely a lower-preference one) - enabling these while
  -- `secondaryEnabled` stays `false` in production would make every one
  -- of them a fresh dead symbol the instant its quote cache expires,
  -- which is exactly what this task forbids. Per the operator's explicit
  -- decision, these stay `enabled=0` (standby metadata, mapping
  -- preserved for the day Alpaca activation is approved) rather than
  -- live - re-enable only alongside a deliberate `secondaryEnabled=true`
  -- decision, never silently.
  ('JPM', 'JPMorgan Chase & Co', 'us_stock', 0, 0, 100, NULL, 'JPM', 'd1', strftime('%s','now')),
  ('V', 'Visa Inc', 'us_stock', 0, 0, 101, NULL, 'V', 'd1', strftime('%s','now')),
  ('MA', 'Mastercard Inc', 'us_stock', 0, 0, 102, NULL, 'MA', 'd1', strftime('%s','now')),
  ('UNH', 'UnitedHealth Group Inc', 'us_stock', 0, 0, 103, NULL, 'UNH', 'd1', strftime('%s','now')),
  ('HD', 'Home Depot Inc', 'us_stock', 0, 0, 104, NULL, 'HD', 'd1', strftime('%s','now')),
  ('PG', 'Procter & Gamble Co', 'us_stock', 0, 0, 105, NULL, 'PG', 'd1', strftime('%s','now')),
  ('JNJ', 'Johnson & Johnson', 'us_stock', 0, 0, 106, NULL, 'JNJ', 'd1', strftime('%s','now')),
  ('XOM', 'Exxon Mobil Corp', 'us_stock', 0, 0, 107, NULL, 'XOM', 'd1', strftime('%s','now')),
  ('CVX', 'Chevron Corp', 'us_stock', 0, 0, 108, NULL, 'CVX', 'd1', strftime('%s','now')),
  ('BAC', 'Bank of America Corp', 'us_stock', 0, 0, 109, NULL, 'BAC', 'd1', strftime('%s','now')),
  ('WMT', 'Walmart Inc', 'us_stock', 0, 0, 110, NULL, 'WMT', 'd1', strftime('%s','now')),
  ('KO', 'Coca-Cola Co', 'us_stock', 0, 0, 111, NULL, 'KO', 'd1', strftime('%s','now')),
  ('PEP', 'PepsiCo Inc', 'us_stock', 0, 0, 112, NULL, 'PEP', 'd1', strftime('%s','now')),
  ('DIS', 'Walt Disney Co', 'us_stock', 0, 0, 113, NULL, 'DIS', 'd1', strftime('%s','now')),
  ('NFLX', 'Netflix Inc', 'us_stock', 0, 0, 114, NULL, 'NFLX', 'd1', strftime('%s','now')),
  ('ADBE', 'Adobe Inc', 'us_stock', 0, 0, 115, NULL, 'ADBE', 'd1', strftime('%s','now')),
  ('CRM', 'Salesforce Inc', 'us_stock', 0, 0, 116, NULL, 'CRM', 'd1', strftime('%s','now')),
  ('ORCL', 'Oracle Corp', 'us_stock', 0, 0, 117, NULL, 'ORCL', 'd1', strftime('%s','now')),
  ('INTC', 'Intel Corp', 'us_stock', 0, 0, 118, NULL, 'INTC', 'd1', strftime('%s','now')),
  ('AMD', 'Advanced Micro Devices Inc', 'us_stock', 0, 0, 119, NULL, 'AMD', 'd1', strftime('%s','now')),
  ('IBM', 'International Business Machines Corp', 'us_stock', 0, 0, 120, NULL, 'IBM', 'd1', strftime('%s','now')),
  ('CSCO', 'Cisco Systems Inc', 'us_stock', 0, 0, 121, NULL, 'CSCO', 'd1', strftime('%s','now')),
  ('PFE', 'Pfizer Inc', 'us_stock', 0, 0, 122, NULL, 'PFE', 'd1', strftime('%s','now')),
  ('ABBV', 'AbbVie Inc', 'us_stock', 0, 0, 123, NULL, 'ABBV', 'd1', strftime('%s','now')),
  ('MRK', 'Merck & Co Inc', 'us_stock', 0, 0, 124, NULL, 'MRK', 'd1', strftime('%s','now')),
  ('T', 'AT&T Inc', 'us_stock', 0, 0, 125, NULL, 'T', 'd1', strftime('%s','now')),
  ('VZ', 'Verizon Communications Inc', 'us_stock', 0, 0, 126, NULL, 'VZ', 'd1', strftime('%s','now')),
  ('NKE', 'Nike Inc', 'us_stock', 0, 0, 127, NULL, 'NKE', 'd1', strftime('%s','now')),
  ('MCD', 'McDonald''s Corp', 'us_stock', 0, 0, 128, NULL, 'MCD', 'd1', strftime('%s','now')),
  ('COST', 'Costco Wholesale Corp', 'us_stock', 0, 0, 129, NULL, 'COST', 'd1', strftime('%s','now')),
  ('AVGO', 'Broadcom Inc', 'us_stock', 0, 0, 130, NULL, 'AVGO', 'd1', strftime('%s','now')),
  ('QCOM', 'Qualcomm Inc', 'us_stock', 0, 0, 131, NULL, 'QCOM', 'd1', strftime('%s','now')),
  ('TXN', 'Texas Instruments Inc', 'us_stock', 0, 0, 132, NULL, 'TXN', 'd1', strftime('%s','now')),
  ('BA', 'Boeing Co', 'us_stock', 0, 0, 133, NULL, 'BA', 'd1', strftime('%s','now')),
  ('SPY', 'SPDR S&P 500 ETF Trust', 'us_stock', 0, 0, 134, NULL, 'SPY', 'd1', strftime('%s','now')),
  ('VOO', 'Vanguard S&P 500 ETF', 'us_stock', 0, 0, 135, NULL, 'VOO', 'd1', strftime('%s','now')),
  ('VTI', 'Vanguard Total Stock Market ETF', 'us_stock', 0, 0, 136, NULL, 'VTI', 'd1', strftime('%s','now')),
  ('IVV', 'iShares Core S&P 500 ETF', 'us_stock', 0, 0, 137, NULL, 'IVV', 'd1', strftime('%s','now')),
  ('DIA', 'SPDR Dow Jones Industrial Average ETF', 'us_stock', 0, 0, 138, NULL, 'DIA', 'd1', strftime('%s','now')),
  ('IWM', 'iShares Russell 2000 ETF', 'us_stock', 0, 0, 139, NULL, 'IWM', 'd1', strftime('%s','now')),
  ('XLK', 'Technology Select Sector SPDR Fund', 'us_stock', 0, 0, 140, NULL, 'XLK', 'd1', strftime('%s','now')),
  ('XLF', 'Financial Select Sector SPDR Fund', 'us_stock', 0, 0, 141, NULL, 'XLF', 'd1', strftime('%s','now')),
  ('XLE', 'Energy Select Sector SPDR Fund', 'us_stock', 0, 0, 142, NULL, 'XLE', 'd1', strftime('%s','now')),
  ('XLV', 'Health Care Select Sector SPDR Fund', 'us_stock', 0, 0, 143, NULL, 'XLV', 'd1', strftime('%s','now')),
  ('ARKK', 'ARK Innovation ETF', 'us_stock', 0, 0, 144, NULL, 'ARKK', 'd1', strftime('%s','now')),
  ('GLD', 'SPDR Gold Shares', 'us_stock', 0, 0, 145, NULL, 'GLD', 'd1', strftime('%s','now')),
  ('SLV', 'iShares Silver Trust', 'us_stock', 0, 0, 146, NULL, 'SLV', 'd1', strftime('%s','now')),
  ('TLT', 'iShares 20+ Year Treasury Bond ETF', 'us_stock', 0, 0, 147, NULL, 'TLT', 'd1', strftime('%s','now')),
  ('HYG', 'iShares iBoxx High Yield Corporate Bond ETF', 'us_stock', 0, 0, 148, NULL, 'HYG', 'd1', strftime('%s','now')),
  ('LQD', 'iShares iBoxx Investment Grade Corporate Bond ETF', 'us_stock', 0, 0, 149, NULL, 'LQD', 'd1', strftime('%s','now')),
  ('AGG', 'iShares Core US Aggregate Bond ETF', 'us_stock', 0, 0, 150, NULL, 'AGG', 'd1', strftime('%s','now')),
  ('BND', 'Vanguard Total Bond Market ETF', 'us_stock', 0, 0, 151, NULL, 'BND', 'd1', strftime('%s','now')),
  ('SPX', 'S&P 500 Index', 'indices', 0, 0, 20, 'SPX', NULL, 'd1', strftime('%s','now')),
  ('NDX', 'Nasdaq 100 Index', 'indices', 0, 0, 21, 'NDX', NULL, 'd1', strftime('%s','now')),
  ('DJI', 'Dow Jones Industrial Average', 'indices', 0, 0, 22, 'DJI', NULL, 'd1', strftime('%s','now')),
  ('RUT', 'Russell 2000 Index', 'indices', 0, 0, 23, 'RUT', NULL, 'd1', strftime('%s','now')),
  ('VIX', 'CBOE Volatility Index', 'indices', 0, 0, 24, 'VIX', NULL, 'd1', strftime('%s','now')),
  ('BTC', 'Bitcoin', 'crypto', 1, 1, 30, 'BTC/USD', 'BTC/USD', 'd1', strftime('%s','now')),
  ('ETH', 'Ethereum', 'crypto', 1, 0, 31, 'ETH/USD', 'ETH/USD', 'd1', strftime('%s','now')),
  ('SOL', 'Solana', 'crypto', 1, 0, 32, 'SOL/USD', 'SOL/USD', 'd1', strftime('%s','now')),
  ('XRP', 'XRP', 'crypto', 1, 0, 33, 'XRP/USD', 'XRP/USD', 'd1', strftime('%s','now')),
  ('DOGE', 'Dogecoin', 'crypto', 1, 0, 200, 'DOGE/USD', 'DOGE/USD', 'd1', strftime('%s','now')),
  ('LTC', 'Litecoin', 'crypto', 1, 0, 201, 'LTC/USD', 'LTC/USD', 'd1', strftime('%s','now')),
  ('BCH', 'Bitcoin Cash', 'crypto', 1, 0, 202, 'BCH/USD', 'BCH/USD', 'd1', strftime('%s','now')),
  ('AVAX', 'Avalanche', 'crypto', 1, 0, 203, 'AVAX/USD', 'AVAX/USD', 'd1', strftime('%s','now')),
  ('LINK', 'Chainlink', 'crypto', 1, 0, 204, 'LINK/USD', 'LINK/USD', 'd1', strftime('%s','now')),
  ('UNI', 'Uniswap', 'crypto', 1, 0, 205, 'UNI/USD', 'UNI/USD', 'd1', strftime('%s','now')),
  ('AAVE', 'Aave', 'crypto', 1, 0, 206, 'AAVE/USD', 'AAVE/USD', 'd1', strftime('%s','now')),
  ('SHIB', 'Shiba Inu', 'crypto', 1, 0, 207, 'SHIB/USD', 'SHIB/USD', 'd1', strftime('%s','now')),
  ('DOT', 'Polkadot', 'crypto', 1, 0, 208, 'DOT/USD', 'DOT/USD', 'd1', strftime('%s','now')),
  ('EUR/USD', 'Euro / US Dollar', 'forex', 1, 0, 40, 'EUR/USD', NULL, 'd1', strftime('%s','now')),
  ('GBP/USD', 'British Pound / US Dollar', 'forex', 1, 0, 41, 'GBP/USD', NULL, 'd1', strftime('%s','now')),
  ('USD/JPY', 'US Dollar / Japanese Yen', 'forex', 1, 0, 42, 'USD/JPY', NULL, 'd1', strftime('%s','now')),
  ('AUD/USD', 'Australian Dollar / US Dollar', 'forex', 1, 0, 43, 'AUD/USD', NULL, 'd1', strftime('%s','now')),
  ('USD/CAD', 'US Dollar / Canadian Dollar', 'forex', 1, 0, 44, 'USD/CAD', NULL, 'd1', strftime('%s','now')),
  ('NZD/USD', 'New Zealand Dollar / US Dollar', 'forex', 1, 0, 210, 'NZD/USD', NULL, 'd1', strftime('%s','now')),
  ('EUR/GBP', 'Euro / British Pound', 'forex', 1, 0, 211, 'EUR/GBP', NULL, 'd1', strftime('%s','now')),
  ('EUR/JPY', 'Euro / Japanese Yen', 'forex', 1, 0, 212, 'EUR/JPY', NULL, 'd1', strftime('%s','now')),
  ('GBP/JPY', 'British Pound / Japanese Yen', 'forex', 1, 0, 213, 'GBP/JPY', NULL, 'd1', strftime('%s','now')),
  ('EUR/CHF', 'Euro / Swiss Franc', 'forex', 1, 0, 214, 'EUR/CHF', NULL, 'd1', strftime('%s','now')),
  ('SET', 'SET Index', 'thailand', 0, 0, 50, NULL, NULL, 'd1', strftime('%s','now')),
  ('SET50', 'SET50 Index', 'thailand', 0, 0, 51, NULL, NULL, 'd1', strftime('%s','now')),
  ('DXY', 'US Dollar Index', 'commodity', 0, 0, 60, NULL, NULL, 'd1', strftime('%s','now')),
  ('US10Y', 'US 10-Year Treasury Yield', 'rate', 0, 0, 61, NULL, NULL, 'd1', strftime('%s','now')),
  ('OIL', 'WTI Crude Oil', 'commodity', 0, 0, 62, NULL, NULL, 'd1', strftime('%s','now'));
