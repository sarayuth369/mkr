import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';

// Pure JSON parsing for Twelve Data's documented response shapes - no
// networking here, so this is unit-testable against fixture JSON (including
// malformed/missing-field/error/rate-limit shapes) with no live API key.

export function isTwelveDataError(json: unknown): json is { status: 'error'; code?: number; message?: string } {
  return !!json && typeof json === 'object' && (json as Record<string, unknown>).status === 'error';
}

export function isTwelveDataRateLimited(json: unknown): boolean {
  if (!isTwelveDataError(json)) return false;
  const code = (json as Record<string, unknown>).code;
  const message = String((json as Record<string, unknown>).message ?? '').toLowerCase();
  return code === 429 || message.includes('api credits') || message.includes('rate limit');
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

/** Returns `null` (never a fabricated quote) when the payload has no usable price. */
export function parseTwelveDataQuote(json: Record<string, unknown>, mkrSymbol: string): NormalizedQuote | null {
  if (isTwelveDataError(json)) return null;
  const price = num(json.close) ?? num(json.price);
  if (price === null) return null;

  const previousClose = num(json.previous_close);
  const change = num(json.change) ?? (previousClose !== null ? price - previousClose : null);
  const changePercent = num(json.percent_change) ?? (previousClose !== null && previousClose !== 0 && change !== null ? (change / previousClose) * 100 : null);

  return {
    symbol: mkrSymbol,
    name: typeof json.name === 'string' ? json.name : null,
    price,
    change,
    changePercent,
    open: num(json.open),
    high: num(json.high),
    low: num(json.low),
    previousClose,
    volume: num(json.volume),
    bid: null, // Twelve Data's /quote endpoint does not return a bid/ask spread
    ask: null,
    currency: typeof json.currency === 'string' ? json.currency : 'USD',
    timestamp: Date.now(),
    source: 'twelve_data',
    isLive: true,
    sessionStatus: json.is_market_open === true ? 'open' : json.is_market_open === false ? 'closed' : 'unknown',
  };
}

export function parseTwelveDataCandles(
  json: Record<string, unknown>,
  mkrSymbol: string,
  interval: MkrTimeframe,
): NormalizedCandle[] {
  if (isTwelveDataError(json)) return [];
  const values = json.values;
  if (!Array.isArray(values)) return [];

  const candles: NormalizedCandle[] = [];
  for (const entry of values) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const open = num(e.open);
    const high = num(e.high);
    const low = num(e.low);
    const close = num(e.close);
    const datetime = typeof e.datetime === 'string' ? e.datetime : null;
    if (open === null || high === null || low === null || close === null || datetime === null) continue;
    const timestamp = Date.parse(datetime);
    if (Number.isNaN(timestamp)) continue;
    candles.push({ symbol: mkrSymbol, interval, timestamp, open, high, low, close, volume: num(e.volume), source: 'twelve_data' });
  }
  // Twelve Data returns newest-first; MKR candle consumers expect oldest-first.
  return candles.reverse();
}

export function parseTwelveDataMarketStatus(json: Record<string, unknown> | null, mkrSymbol: string): NormalizedMarketStatus {
  if (!json || isTwelveDataError(json)) {
    return { symbol: mkrSymbol, market: null, exchange: null, session: 'unknown', isOpen: null, timestamp: Date.now(), source: 'twelve_data' };
  }
  const isOpen = json.is_market_open === true ? true : json.is_market_open === false ? false : null;
  return {
    symbol: mkrSymbol,
    market: typeof json.name === 'string' ? json.name : null,
    exchange: typeof json.exchange === 'string' ? json.exchange : null,
    session: isOpen === true ? 'open' : isOpen === false ? 'closed' : 'unknown',
    isOpen,
    timestamp: Date.now(),
    source: 'twelve_data',
  };
}

export function twelveDataInterval(timeframe: MkrTimeframe): string {
  const map: Record<MkrTimeframe, string> = {
    m1: '1min',
    m5: '5min',
    m15: '15min',
    h1: '1h',
    h4: '4h',
    d1: '1day',
    w1: '1week',
    mo1: '1month',
  };
  return map[timeframe];
}
