import { cachedFetch, cacheKey, coalesced, getCached, putCached } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logError, logInfo } from '../logging';
import { catalogFor, type SymbolRow } from '../symbols/symbol-catalog';
import { isValidMkrSymbolFormat, mapSymbolFromRows, parseSymbolList } from '../symbols/symbol-mapper';
import type { Env, ProviderId } from '../types';
import { candleTtlFor, mapProviderError, parseTimeframe } from './normalize';
import { managerFor } from './provider-manager-factory';

export async function requireSymbolRow(env: Env, symbol: string): Promise<SymbolRow> {
  if (!isValidMkrSymbolFormat(symbol)) throw new ApiError('INVALID_SYMBOL', `Invalid symbol format: ${symbol}`);
  const row = await catalogFor(env).get(symbol);
  if (!row || row.enabled === 0) throw new ApiError('INVALID_SYMBOL', `Unknown or disabled symbol: ${symbol}`);
  return row;
}

export async function handleQuote(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!symbol) throw new ApiError('INVALID_SYMBOL', 'symbol query parameter is required');

  const row = await requireSymbolRow(env, symbol);
  const config = await getConfig(env);
  const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);
  const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;

  const start = Date.now();
  try {
    // Caches the bare NormalizedQuote (Task 4 fix) - the exact same shape
    // handleQuotes below caches under this exact same key, so the two
    // routes now safely share one cache entry per symbol instead of
    // competing with incompatible shapes. `source` is already a field on
    // NormalizedQuote, so nothing is lost by dropping the old wrapper.
    const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('quote', symbol), ttl, async () => {
      const manager = await managerFor(env, config);
      const { result } = await manager.getQuote(symbol, symbolFor, 'P1'); // user-requested market data
      return result;
    });
    logInfo('quote served', { requestId, route: 'quote', symbol, provider: value?.source, latencyMs: Date.now() - start });
    return jsonResponse(value);
  } catch (err) {
    const apiError = mapProviderError(err);
    logError('quote failed', {
      requestId,
      route: 'quote',
      symbol,
      errorCode: apiError.code,
      cause: (err as Error).message,
      latencyMs: Date.now() - start,
    });
    throw apiError;
  }
}

/**
 * Batches every uncached symbol into ONE upstream provider call instead of
 * N individual ones - see [MarketDataProvider.getBatchQuotes]'s doc comment
 * for why this matters (confirmed live: a client requesting its full ~28-
 * symbol catalog via N concurrent individual `/quote` calls exhausted
 * Twelve Data Free's rate limit almost immediately). Also resolves the
 * whole symbol catalog from D1 in ONE query rather than one `SELECT` per
 * requested symbol.
 *
 * Caches/reads the bare NormalizedQuote under `cacheKey('quote', symbol)` -
 * the exact same key and shape handleQuote above uses (Task 4 fix), so a
 * `/quote` call and a `/quotes` call for the same symbol now safely share
 * one cache entry instead of racing to overwrite each other with
 * incompatible shapes.
 */
export async function handleQuotes(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const rawSymbols = url.searchParams.get('symbols') ?? '';
  const symbols = parseSymbolList(rawSymbols);
  if (symbols.length === 0) throw new ApiError('INVALID_SYMBOL', 'symbols query parameter is required (comma-separated)');
  if (symbols.length > 50) throw new ApiError('INVALID_PARAMETER', 'A maximum of 50 symbols may be requested at once');

  const config = await getConfig(env);
  const allRows = await catalogFor(env).all();
  const rowBySymbol = new Map(allRows.map((row) => [row.symbol, row]));

  const data: unknown[] = [];
  const errors: { symbol: string; code: string; message: string }[] = [];
  const uncached: string[] = [];

  for (const symbol of symbols) {
    const row = rowBySymbol.get(symbol);
    if (!row || row.enabled === 0) {
      errors.push({ symbol, code: 'INVALID_SYMBOL', message: `Unknown or disabled symbol: ${symbol}` });
      continue;
    }
    const cached = await getCached<unknown>(env.MKR_CACHE, cacheKey('quote', symbol));
    if (cached !== undefined) {
      if (cached) data.push(cached);
    } else {
      uncached.push(symbol);
    }
  }

  if (uncached.length > 0) {
    try {
      const manager = await managerFor(env, config);
      const providerSymbolFor = (id: ProviderId, mkrSymbol: string) => {
        const row = rowBySymbol.get(mkrSymbol);
        return row ? mapSymbolFromRows([row], mkrSymbol, id) : null;
      };
      // Single-flight: concurrent requests that land on the exact same
      // uncached-symbol set (the common case - same catalog, same cache
      // state, arriving within the same isolate near-simultaneously) share
      // one upstream call instead of each independently calling the
      // provider. This is what getCached/putCached above bypassed - see
      // coalesced()'s doc comment in cache-service.ts.
      const coalesceKey = `batch-quotes:${[...uncached].sort().join(',')}`;
      const { result } = await coalesced(coalesceKey, () => manager.getBatchQuotes(uncached, providerSymbolFor, 'P1')); // user-requested market data

      await Promise.all(
        uncached.map(async (symbol) => {
          // Both providers' getBatchQuotes only ever set `result[symbol]`
          // (possibly to `null`) for a symbol whose chunk/request actually
          // completed - a symbol whose chunk failed transiently (network/
          // timeout/rate_limit) is left OUT of `result` entirely, never
          // set to `null` (see TwelveDataProvider/AlpacaProvider.getBatchQuotes).
          // Collapsing that distinction via `result[symbol] ?? null` meant a
          // transient per-chunk failure was cached identically to a
          // provider-confirmed "no data for this symbol" - negative-caching
          // a transient fault for the full TTL (violates Decision 15: never
          // negative-cache a transient failure). Only cache/report success
          // for a symbol the provider actually resolved; a never-resolved
          // symbol is reported as an error and left uncached so a retry
          // within the TTL window can actually succeed.
          if (!(symbol in result)) {
            errors.push({ symbol, code: 'PROVIDER_UNAVAILABLE', message: 'Market data provider is currently unavailable.' });
            return;
          }
          const quote = result[symbol] ?? null;
          const row = rowBySymbol.get(symbol)!;
          const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
          await putCached(env.MKR_CACHE, cacheKey('quote', symbol), quote, ttl);
          if (quote) data.push(quote);
        }),
      );
    } catch (err) {
      const apiError = mapProviderError(err);
      for (const symbol of uncached) errors.push({ symbol, code: apiError.code, message: apiError.message });
    }
  }

  logInfo('quotes batch served', { requestId, route: 'quotes', count: symbols.length, uncached: uncached.length, errorCount: errors.length });
  return jsonResponse({ items: data, errors, source: config.primaryProvider, timestamp: Date.now() });
}

export async function handleCandles(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!symbol) throw new ApiError('INVALID_SYMBOL', 'symbol query parameter is required');
  const timeframe = parseTimeframe(url.searchParams.get('interval'));
  const outputSize = Math.min(Math.max(Number(url.searchParams.get('outputsize')) || 30, 1), 5000);

  const row = await requireSymbolRow(env, symbol);
  const config = await getConfig(env);
  const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);
  const ttl = row.cache_ttl_seconds ?? candleTtlFor(timeframe, config.cacheTtls);

  const start = Date.now();
  try {
    const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('candles', symbol, `${timeframe}:${outputSize}`), ttl, async () => {
      const manager = await managerFor(env, config);
      const { result, source } = await manager.getCandles(symbol, timeframe, outputSize, symbolFor, 'P1'); // user-requested market data
      return { candles: result, source };
    });
    logInfo('candles served', { requestId, route: 'candles', symbol, provider: value.source, latencyMs: Date.now() - start });
    return jsonResponse(value.candles);
  } catch (err) {
    const apiError = mapProviderError(err);
    logError('candles failed', {
      requestId,
      route: 'candles',
      symbol,
      errorCode: apiError.code,
      cause: (err as Error).message,
      latencyMs: Date.now() - start,
    });
    throw apiError;
  }
}

export async function handleMarketStatus(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!symbol) throw new ApiError('INVALID_SYMBOL', 'symbol query parameter is required');

  const row = await requireSymbolRow(env, symbol);
  const config = await getConfig(env);
  const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);

  try {
    const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('status', symbol), config.cacheTtls.statusSeconds, async () => {
      const manager = await managerFor(env, config);
      const { result } = await manager.getMarketStatus(symbol, symbolFor, 'P1'); // user-requested market data
      return result;
    });
    return jsonResponse(value);
  } catch (err) {
    logError('status failed', { requestId, route: 'status', symbol });
    throw mapProviderError(err);
  }
}

export async function handleMarketHealth(_request: Request, env: Env, _requestId: string): Promise<Response> {
  const config = await getConfig(env);
  const { value } = await cachedFetch(env.MKR_CACHE, 'health-snapshot', 60, async () => {
    const manager = await managerFor(env, config);
    return manager.healthSnapshot();
  });
  return jsonResponse(value);
}
