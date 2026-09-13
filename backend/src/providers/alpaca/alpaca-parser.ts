import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';

// Pure JSON parsing for Alpaca's documented Market Data API shapes.
// STANDBY only (see AlpacaProvider) but parsed with the same defensive
// discipline as the Twelve Data parser so it is ready to activate later.

export function isAlpacaError(json: Record<string, unknown>): boolean {
  return 'code' in json && 'message' in json && !('bars' in json) && !('latestTrade' in json);
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

export function parseAlpacaSnapshot(json: Record<string, unknown>, mkrSymbol: string): NormalizedQuote | null {
  if (isAlpacaError(json)) return null;
  const latestTrade = json.latestTrade as Record<string, unknown> | undefined;
  const price = latestTrade ? num(latestTrade.p) : null;
  if (price === null) return null;

  const prevDailyBar = json.prevDailyBar as Record<string, unknown> | undefined;
  const previousClose = prevDailyBar ? num(prevDailyBar.c) : null;
  const change = previousClose !== null ? price - previousClose : null;
  const changePercent = previousClose !== null && previousClose !== 0 && change !== null ? (change / previousClose) * 100 : null;

  const latestQuote = json.latestQuote as Record<string, unknown> | undefined;
  const dailyBar = json.dailyBar as Record<string, unknown> | undefined;

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

export function parseAlpacaBars(json: Record<string, unknown>, mkrSymbol: string, interval: MkrTimeframe): NormalizedCandle[] {
  if (isAlpacaError(json)) return [];
  const bars = json.bars;
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
