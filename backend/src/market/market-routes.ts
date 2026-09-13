import { cachedFetch, cacheKey } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logError, logInfo } from '../logging';
import { MarketProviderManager } from '../providers/provider-manager';
import { buildProvider } from '../providers/provider-registry';
import { catalogFor, type SymbolRow } from '../symbols/symbol-catalog';
import { isValidMkrSymbolFormat, mapSymbolFromRows, parseSymbolList } from '../symbols/symbol-mapper';
import type { Env, ProviderId } from '../types';
import { candleTtlFor, mapProviderError, parseTimeframe } from './normalize';

async function managerFor(env: Env, config: Awaited<ReturnType<typeof getConfig>>): Promise<MarketProviderManager> {
  const primary = buildProvider(config.primaryProvider, env);
  const secondary = config.secondaryProvider ? buildProvider(config.secondaryProvider, env) : null;
  return new MarketProviderManager(primary, secondary, config.secondaryEnabled);
}

async function requireSymbolRow(env: Env, symbol: string): Promise<SymbolRow> {
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
    const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('quote', symbol), ttl, async () => {
      const manager = await managerFor(env, config);
      const { result, source } = await manager.getQuote(symbol, symbolFor);
      return { quote: result, source };
    });
    logInfo('quote served', { requestId, route: 'quote', symbol, provider: value.source ?? undefined, latencyMs: Date.now() - start });
    return jsonResponse(value.quote);
  } catch (err) {
    const apiError = mapProviderError(err);
    logError('quote failed', { requestId, route: 'quote', symbol, errorCode: apiError.code, latencyMs: Date.now() - start });
    throw apiError;
  }
}

export async function handleQuotes(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const rawSymbols = url.searchParams.get('symbols') ?? '';
  const symbols = parseSymbolList(rawSymbols);
  if (symbols.length === 0) throw new ApiError('INVALID_SYMBOL', 'symbols query parameter is required (comma-separated)');
  if (symbols.length > 50) throw new ApiError('INVALID_PARAMETER', 'A maximum of 50 symbols may be requested at once');

  const config = await getConfig(env);
  const data: unknown[] = [];
  const errors: { symbol: string; code: string; message: string }[] = [];

  // Partial success: one bad/unavailable symbol never fails the whole batch.
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const row = await requireSymbolRow(env, symbol);
        const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);
        const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
        const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('quote', symbol), ttl, async () => {
          const manager = await managerFor(env, config);
          const { result } = await manager.getQuote(symbol, symbolFor);
          return result;
        });
        if (value) data.push(value);
      } catch (err) {
        const apiError = mapProviderError(err);
        errors.push({ symbol, code: apiError.code, message: apiError.message });
      }
    }),
  );

  logInfo('quotes batch served', { requestId, route: 'quotes', count: symbols.length, errorCount: errors.length });
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
      const { result, source } = await manager.getCandles(symbol, timeframe, outputSize, symbolFor);
      return { candles: result, source };
    });
    logInfo('candles served', { requestId, route: 'candles', symbol, provider: value.source, latencyMs: Date.now() - start });
    return jsonResponse(value.candles);
  } catch (err) {
    const apiError = mapProviderError(err);
    logError('candles failed', { requestId, route: 'candles', symbol, errorCode: apiError.code, latencyMs: Date.now() - start });
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
      const { result } = await manager.getMarketStatus(symbol, symbolFor);
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
  const { value } = await cachedFetch(env.MKR_CACHE, 'health-snapshot', 10, async () => {
    const manager = await managerFor(env, config);
    return manager.healthSnapshot();
  });
  return jsonResponse(value);
}
