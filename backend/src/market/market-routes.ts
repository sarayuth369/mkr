import { cachedFetch, cacheKey, coalesced, getCachedWithFreshness, putCachedWithGrace } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logError, logInfo } from '../logging';
import { resolvePreferredProvider } from '../providers/capability';
import { catalogFor, type SymbolRow } from '../symbols/symbol-catalog';
import { isValidMkrSymbolFormat, mapSymbolFromRows, parseSymbolList } from '../symbols/symbol-mapper';
import type { Env, ProviderId } from '../types';
import { candleTtlFor, mapProviderError, parseTimeframe } from './normalize';
import { managerFor } from './provider-manager-factory';

/** Hybrid Provider Architecture task (2026-09-16) - the one place a request route resolves a symbol row's routing preference, so `handleQuote`/`handleQuotes`/`handleCandles` all derive it the exact same way. `undefined` (never `null`) matches `MarketProviderManager`'s optional-param contract. */
function preferredProviderForRow(row: SymbolRow, featureFlags: Awaited<ReturnType<typeof getConfig>>['featureFlags']): ProviderId | undefined {
  return resolvePreferredProvider(row.category, row.alpaca_symbol !== null, featureFlags) ?? undefined;
}

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
  const preferredProvider = preferredProviderForRow(row, config.featureFlags);
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
      const { result } = await manager.getQuote(symbol, symbolFor, 'P1', preferredProvider); // user-requested market data
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
  // 2026-09-16 Final Full-System One-Pass audit finding: a confirmed
  // provider "no data for this symbol" result previously vanished from the
  // response entirely (neither `data` nor `errors`) - indistinguishable
  // from a symbol that silently failed. Reported explicitly here instead.
  const noData: string[] = [];
  const uncached: string[] = [];
  // 2026-09-16 audit finding: still-physically-present-but-logically-stale
  // values remembered per symbol, so a symbol that fails to refresh can
  // degrade to stale data instead of a hard PROVIDER_UNAVAILABLE error -
  // the same bounded stale-while-revalidate cachedFetch does internally,
  // applied here since the batch path manages its own cache reads/writes.
  const staleFallback = new Map<string, unknown>();

  for (const symbol of symbols) {
    const row = rowBySymbol.get(symbol);
    if (!row || row.enabled === 0) {
      errors.push({ symbol, code: 'INVALID_SYMBOL', message: `Unknown or disabled symbol: ${symbol}` });
      continue;
    }
    const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
    const cached = await getCachedWithFreshness<unknown>(env.MKR_CACHE, cacheKey('quote', symbol), ttl);
    if (cached && cached.fresh) {
      if (cached.value) data.push(cached.value);
      else noData.push(symbol);
    } else {
      if (cached) staleFallback.set(symbol, cached.value);
      uncached.push(symbol);
    }
  }

  if (uncached.length > 0) {
    try {
      const manager = await managerFor(env, config);

      // 2026-09-16 Final Full-System One-Pass audit finding: a lone
      // uncached symbol now shares the EXACT same cache key and in-flight
      // coalescing key `handleQuote` uses (`cachedFetch`'s own `inFlight`
      // map, keyed by the KV cache key itself) - previously this route
      // always coalesced under a `batch-quotes:<sorted-list>`-shaped key,
      // so a concurrent `/quote?symbol=AAPL` and `/quotes?symbols=AAPL`
      // landing on the same isolate at the same instant did NOT share
      // their in-flight request, each independently calling the provider
      // for the same symbol. A multi-symbol batch keeps its own batch
      // coalescing below - there is no clean single-request equivalent to
      // join a genuine multi-symbol upstream call against.
      if (uncached.length === 1) {
        const symbol = uncached[0]!;
        const row = rowBySymbol.get(symbol)!;
        const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
        const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);
        const preferredProvider = preferredProviderForRow(row, config.featureFlags);
        const { value: quote } = await cachedFetch(env.MKR_CACHE, cacheKey('quote', symbol), ttl, async () => {
          const { result } = await manager.getQuote(symbol, symbolFor, 'P1', preferredProvider); // user-requested market data
          return result;
        });
        if (quote) data.push(quote);
        else noData.push(symbol);
      } else {
        const providerSymbolFor = (id: ProviderId, mkrSymbol: string) => {
          const row = rowBySymbol.get(mkrSymbol);
          return row ? mapSymbolFromRows([row], mkrSymbol, id) : null;
        };
        // Hybrid Provider Architecture task - per-symbol routing preference,
        // derived the exact same way handleQuote/handleCandles do (see
        // preferredProviderForRow). `null` (not `undefined`) for a symbol
        // whose row somehow isn't in rowBySymbol - matches
        // resolvePreferredProvider's own "no mapping, no preference" default.
        const preferredProviderFor = (mkrSymbol: string): ProviderId | null => {
          const row = rowBySymbol.get(mkrSymbol);
          return row ? (preferredProviderForRow(row, config.featureFlags) ?? null) : null;
        };
        // Single-flight: concurrent requests that land on the exact same
        // uncached-symbol set (the common case - same catalog, same cache
        // state, arriving within the same isolate near-simultaneously) share
        // one upstream call instead of each independently calling the
        // provider. This is what plain getCached/putCached reads bypassed -
        // see coalesced()'s doc comment in cache-service.ts.
        const coalesceKey = `batch-quotes:${[...uncached].sort().join(',')}`;
        const { result } = await coalesced(coalesceKey, () => manager.getBatchQuotes(uncached, providerSymbolFor, 'P1', preferredProviderFor)); // user-requested market data

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
            // for a symbol the provider actually resolved.
            if (!(symbol in result)) {
              // Bounded stale-while-revalidate fallback (see staleFallback's
              // own doc comment) before falling back further to an explicit
              // error - a still-physically-present stale value beats a hard
              // failure when the fresh refetch attempt itself came up empty
              // for this one symbol.
              if (staleFallback.has(symbol)) {
                const stale = staleFallback.get(symbol);
                if (stale) data.push(stale);
                else noData.push(symbol);
                return;
              }
              errors.push({ symbol, code: 'PROVIDER_UNAVAILABLE', message: 'Market data provider is currently unavailable.' });
              return;
            }
            const quote = result[symbol] ?? null;
            const row = rowBySymbol.get(symbol)!;
            const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
            await putCachedWithGrace(env.MKR_CACHE, cacheKey('quote', symbol), quote, ttl);
            if (quote) data.push(quote);
            else noData.push(symbol);
          }),
        );
      }
    } catch (err) {
      const apiError = mapProviderError(err);
      for (const symbol of uncached) {
        if (staleFallback.has(symbol)) {
          const stale = staleFallback.get(symbol);
          if (stale) data.push(stale);
          else noData.push(symbol);
          continue;
        }
        errors.push({ symbol, code: apiError.code, message: apiError.message });
      }
    }
  }

  logInfo('quotes batch served', { requestId, route: 'quotes', count: symbols.length, uncached: uncached.length, errorCount: errors.length, noDataCount: noData.length });
  return jsonResponse({ items: data, errors, noData, source: config.primaryProvider, timestamp: Date.now() });
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
  const preferredProvider = preferredProviderForRow(row, config.featureFlags);
  const ttl = row.cache_ttl_seconds ?? candleTtlFor(timeframe, config.cacheTtls);

  const start = Date.now();
  try {
    const { value } = await cachedFetch(env.MKR_CACHE, cacheKey('candles', symbol, `${timeframe}:${outputSize}`), ttl, async () => {
      const manager = await managerFor(env, config);
      const { result, source } = await manager.getCandles(symbol, timeframe, outputSize, symbolFor, 'P1', preferredProvider); // user-requested market data
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

export interface PublicSymbol {
  symbol: string;
  displayName: string;
  category: string;
  featured: boolean;
  sortOrder: number;
  defaultTimeframe: string;
}

/**
 * 2026-09-15 frontend hardening task: the public, read-only counterpart to
 * `GET /api/mkr/admin/symbols` - reuses the SAME D1 `symbols` table (no
 * second catalog database), filtered to `enabled = 1` and stripped to only
 * the fields a client actually needs (display metadata + asset category).
 * Provider-specific mapping (`twelve_data_symbol`/`alpaca_symbol`) is
 * deliberately NOT exposed here - Flutter sends plain MKR symbols to
 * `/quote(s)`/`/candles`/`/status`; the backend already does provider
 * mapping server-side (see provider-manager.ts), so the client has no need
 * for (and should never special-case) a provider symbol.
 *
 * This is what lets production Flutter stop treating `MockMarketCatalog`
 * as the source of truth for which symbols to request - it can now build
 * its own real-mode catalog from exactly what this deployment's backend
 * currently has enabled, so a disabled/removed symbol is never requested
 * and a newly-enabled one appears without an app update.
 */
export async function handleMarketSymbols(_request: Request, env: Env, _requestId: string): Promise<Response> {
  const { value } = await cachedFetch(env.MKR_CACHE, 'market:symbols:v1', 300, async () => {
    const rows = await catalogFor(env).all();
    const symbols: PublicSymbol[] = rows
      .filter((row) => row.enabled !== 0)
      .map((row) => ({
        symbol: row.symbol,
        displayName: row.display_name,
        category: row.category,
        featured: row.featured !== 0,
        sortOrder: row.sort_order,
        defaultTimeframe: row.default_timeframe,
      }));
    return symbols;
  });
  return jsonResponse(value);
}
