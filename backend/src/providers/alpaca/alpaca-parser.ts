import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';

// Pure JSON parsing for Alpaca's documented Market Data API shapes.
// STANDBY only (see AlpacaProvider) but parsed with the same defensive
// discipline as the Twelve Data parser so it is ready to activate later.

export function isAlpacaError(json: Record<string, unknown>): boolean {
  return 'code' in json && 'message' in json && !('bars' in json) && !('latestTrade' in json);
}

/**
 * Alpaca's crypto and stock market data live under entirely different API
 * families (v1beta3/crypto/us/... vs v2/stocks/...). The D1 catalog's own
 * `alpaca_symbol` mapping already encodes which family a symbol belongs
 * to - every crypto row is seeded `"BTC/USD"`-style (contains `/`), every
 * us_stock row a bare ticker (schema.sql) - so that existing signal is
 * reused here instead of inventing a second catalog/asset-class param.
 */
export function isAlpacaCryptoSymbol(providerSymbol: string): boolean {
  return providerSymbol.includes('/');
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// A snapshot object's shape is identical whether it arrives as the
// top-level body (stock: GET /v2/stocks/{symbol}/snapshot) or nested one
// level under `snapshots[providerSymbol]` (crypto: GET
// /v1beta3/crypto/us/snapshots?symbols=...) - shared here so both families
// parse through one path instead of two copies drifting apart.
function parseSnapshotObject(snapshot: Record<string, unknown>, mkrSymbol: string): NormalizedQuote | null {
  const latestTrade = snapshot.latestTrade as Record<string, unknown> | undefined;
  const price = latestTrade ? num(latestTrade.p) : null;
  if (price === null) return null;

  const prevDailyBar = snapshot.prevDailyBar as Record<string, unknown> | undefined;
  const previousClose = prevDailyBar ? num(prevDailyBar.c) : null;
  const change = previousClose !== null ? price - previousClose : null;
  const changePercent = previousClose !== null && previousClose !== 0 && change !== null ? (change / previousClose) * 100 : null;

  const latestQuote = snapshot.latestQuote as Record<string, unknown> | undefined;
  const dailyBar = snapshot.dailyBar as Record<string, unknown> | undefined;

  return {
    symbol: mkrSymbol,
    name: null,
    price,
    change,
    changePercent,
    open: dailyBar ? num(dailyBar.o) : null,
    high: dailyBar ? num(dailyBar.h) : null,
    low: dailyBar ? num(dailyBar.l) : null,
    previousClose,
    volume: dailyBar ? num(dailyBar.v) : null,
    bid: latestQuote ? num(latestQuote.bp) : null,
    ask: latestQuote ? num(latestQuote.ap) : null,
    currency: 'USD',
    timestamp: Date.now(),
    source: 'alpaca',
    isLive: true,
    sessionStatus: 'unknown',
  };
}

export function parseAlpacaSnapshot(json: Record<string, unknown>, mkrSymbol: string): NormalizedQuote | null {
  if (isAlpacaError(json)) return null;
  return parseSnapshotObject(json, mkrSymbol);
}

/**
 * Crypto snapshots are always wrapped: `{ snapshots: { "BTC/USD": {...} } }`
 * (https://docs.alpaca.markets/us/reference/cryptosnapshots-1) - even a
 * single-symbol request returns this shape, unlike the stock endpoint's
 * flat body. A symbol genuinely missing from the map (unmapped/unknown to
 * Alpaca) resolves to `null`, the same honest "no data" outcome as a stock
 * 404 - never fabricated.
 */
export function parseAlpacaCryptoSnapshot(json: Record<string, unknown>, providerSymbol: string, mkrSymbol: string): NormalizedQuote | null {
  if (isAlpacaError(json)) return null;
  const snapshots = json.snapshots;
  if (!snapshots || typeof snapshots !== 'object') return null;
  const snap = (snapshots as Record<string, unknown>)[providerSymbol];
  if (!snap || typeof snap !== 'object') return null;
  return parseSnapshotObject(snap as Record<string, unknown>, mkrSymbol);
}

function parseBarsArray(bars: unknown, mkrSymbol: string, interval: MkrTimeframe): NormalizedCandle[] {
  if (!Array.isArray(bars)) return [];

  const candles: NormalizedCandle[] = [];
  for (const entry of bars) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const open = num(e.o);
    const high = num(e.h);
    const low = num(e.l);
    const close = num(e.c);
    const t = typeof e.t === 'string' ? e.t : null;
    if (open === null || high === null || low === null || close === null || t === null) continue;
    const timestamp = Date.parse(t);
    if (Number.isNaN(timestamp)) continue;
    candles.push({ symbol: mkrSymbol, interval, timestamp, open, high, low, close, volume: num(e.v), source: 'alpaca' });
  }
  return candles;
}

export function parseAlpacaBars(json: Record<string, unknown>, mkrSymbol: string, interval: MkrTimeframe): NormalizedCandle[] {
  if (isAlpacaError(json)) return [];
  return parseBarsArray(json.bars, mkrSymbol, interval);
}

/**
 * Crypto bars are also always wrapped: `{ bars: { "BTC/USD": [...] } }`
 * (https://docs.alpaca.markets/us/reference/cryptobars-1), keyed by symbol
 * rather than the stock endpoint's flat array - unlike the stock case,
 * `isAlpacaError` still applies at the top level (a genuine error response
 * has no `bars` key at all either way).
 */
export function parseAlpacaCryptoBars(json: Record<string, unknown>, providerSymbol: string, mkrSymbol: string, interval: MkrTimeframe): NormalizedCandle[] {
  if (isAlpacaError(json)) return [];
  const barsMap = json.bars;
  if (!barsMap || typeof barsMap !== 'object') return [];
  return parseBarsArray((barsMap as Record<string, unknown>)[providerSymbol], mkrSymbol, interval);
}

export function alpacaMarketStatusUnavailable(mkrSymbol: string): NormalizedMarketStatus {
  return { symbol: mkrSymbol, market: null, exchange: null, session: 'unknown', isOpen: null, timestamp: Date.now(), source: 'alpaca' };
}

export function alpacaTimeframe(timeframe: MkrTimeframe): string {
  const map: Record<MkrTimeframe, string> = {
    m1: '1Min',
    m5: '5Min',
    m15: '15Min',
    h1: '1Hour',
    h4: '4Hour',
    d1: '1Day',
    w1: '1Week',
    mo1: '1Month',
  };
  return map[timeframe];
}

/**
 * 2026-09-16 Alpaca Credential E2E Test task: live-confirmed root cause of
 * every stock `/bars` request returning an empty array regardless of
 * symbol - Alpaca's own docs (docs.alpaca.markets/reference/stockbars)
 * state `start` defaults to "the beginning of the current day" when
 * omitted. A `timeframe=1Day` request with no explicit `start` therefore
 * asks for TODAY's own daily bar, which does not exist until the trading
 * day closes - an honest, permanent "no results in this window" for every
 * daily-candle request, not a symbol-specific or capability problem
 * (crypto bars are unaffected - a different endpoint with its own,
 * apparently more permissive, default). Computes an explicit `start` far
 * enough back to actually contain `limit` bars for the given timeframe,
 * generously buffered for market closures (weekends/holidays for daily+,
 * ~6.5h/24h trading sessions for intraday) - never assumes every calendar
 * unit produced a bar.
 */
export function alpacaBarsStart(timeframe: MkrTimeframe, limit: number): string {
  const msPerUnit: Record<MkrTimeframe, number> = {
    m1: 60_000,
    m5: 5 * 60_000,
    m15: 15 * 60_000,
    h1: 60 * 60_000,
    h4: 4 * 60 * 60_000,
    d1: 24 * 60 * 60_000,
    w1: 7 * 24 * 60 * 60_000,
    mo1: 30 * 24 * 60 * 60_000,
  };
  // Daily/weekly/monthly bars only miss ~2/7 calendar days (weekends) plus
  // a handful of holidays - 3x covers that comfortably. Intraday bars only
  // occur during regular trading hours (~6.5 of 24h, further reduced by
  // weekends) - a much larger multiplier is needed to guarantee `limit`
  // bars actually fall inside the window.
  const isIntraday = timeframe === 'm1' || timeframe === 'm5' || timeframe === 'm15' || timeframe === 'h1' || timeframe === 'h4';
  const bufferMultiplier = isIntraday ? 12 : 3;
  const windowMs = msPerUnit[timeframe] * limit * bufferMultiplier;
  return new Date(Date.now() - windowMs).toISOString();
}
