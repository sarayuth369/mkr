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

/**
 * A permanent, symbol-specific failure - the requested symbol is invalid,
 * or genuinely unavailable on this Twelve Data plan tier - as opposed to a
 * transient/infrastructure fault (network, timeout, auth, real rate limit).
 * Confirmed live (2026-09-15): a handful of misconfigured/plan-restricted
 * symbols in MKR's catalog (stock indices requiring a paid Twelve Data
 * plan; a couple of wrong symbol codes) were classified as generic
 * 'unknown' provider errors, which made every request for one of them
 * trigger the circuit breaker's healthCheck() confirmation - and once
 * enough of those piled up, tripped the circuit for the ENTIRE provider,
 * taking down every other (perfectly valid) symbol along with it. This is
 * what actually distinguishes "this one symbol will never work" (retrying
 * it, on this account/plan, changes nothing - never a provider health
 * signal) from "the provider itself is unwell" (see provider-manager.ts's
 * withFailover, which skips circuit-breaker involvement entirely for
 * this kind).
 */
export function isTwelveDataSymbolError(json: unknown): boolean {
  if (!isTwelveDataError(json)) return false;
  if (isTwelveDataRateLimited(json)) return false; // rate limits are transient, never symbol-specific
  const code = (json as Record<string, unknown>).code;
  const message = String((json as Record<string, unknown>).message ?? '').toLowerCase();
  return (
    code === 400 ||
    code === 404 ||
    message.includes('missing or invalid') ||
    message.includes('available starting with') ||
    message.includes('not found') ||
    message.includes('not supported')
  );
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

/**
 * Twelve Data's multi-symbol `/quote?symbol=A,B,C` response is an object
 * keyed by provider symbol (each value shaped like the single-symbol
 * response) - NOT an array, and NOT the same shape as a single-symbol
 * request. [providerToMkr] maps each requested provider symbol back to its
 * MKR symbol so the result can be keyed the way the rest of the app expects.
 * A symbol Twelve Data returned an explicit entry for (a real quote object,
 * or a per-symbol error object) maps to a parsed quote or `null` - never
 * fabricated.
 *
 * 2026-09-16 Closed Testing readiness task (root cause, provider capacity):
 * a symbol whose key is entirely ABSENT from `json` is NOT the same thing
 * as a confirmed "no data" answer - see TwelveDataProvider.getBatchQuotes's
 * own doc comment: Twelve Data Free's comma-separated endpoint silently
 * drops symbols beyond an undocumented per-request/per-minute capacity
 * limit, rather than including an explicit null/error entry for them.
 * Confirmed live (2026-09-16): a 3-symbol single-chunk request came back
 * with only 1 symbol present in the response object at all - the other 2
 * were not merely empty, they were bytes-absent from the JSON, immediately
 * after an unrelated request had just used up the provider's per-minute
 * headroom. Previously this function mapped an absent key to `null`
 * identically to an explicit error/empty entry, so market-routes.ts's
 * handleQuotes cached it as CONFIRMED no-data for the full quote TTL and
 * never reported it as an error - a transient capacity artifact became a
 * false, silently-persisted "this symbol has no data" answer, which is
 * exactly the user-visible "opens with no market content" symptom this
 * task traces to its root. An absent key is now left OUT of the returned
 * record entirely, reusing the EXACT SAME "symbol not in result" contract
 * TwelveDataProvider.getBatchQuotes already uses for a whole-chunk network/
 * rate-limit failure (see its own catch block) - market-routes.ts already
 * treats that case correctly: reported as a PROVIDER_UNAVAILABLE error, and
 * deliberately never cached, so the very next request gets a fresh chance
 * once capacity recovers instead of being poisoned for the TTL window.
 */
export function parseTwelveDataBatchQuotes(
  json: Record<string, unknown>,
  providerToMkr: Record<string, string>,
): Record<string, NormalizedQuote | null> {
  const result: Record<string, NormalizedQuote | null> = {};
  for (const [providerSymbol, mkrSymbol] of Object.entries(providerToMkr)) {
    if (!(providerSymbol in json)) continue; // absent key - ambiguous/capacity-dropped, never a confirmed answer - see doc comment above
    const entry = json[providerSymbol];
    result[mkrSymbol] = entry && typeof entry === 'object' ? parseTwelveDataQuote(entry as Record<string, unknown>, mkrSymbol) : null;
  }
  return result;
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
