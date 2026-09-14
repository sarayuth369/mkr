import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';
import { recordProviderRequest } from '../quota-manager';
import { ProviderError, type MarketDataProvider } from '../types';
import {
  isTwelveDataError,
  isTwelveDataRateLimited,
  parseTwelveDataBatchQuotes,
  parseTwelveDataCandles,
  parseTwelveDataMarketStatus,
  parseTwelveDataQuote,
  twelveDataInterval,
} from './twelve-data-parser';

const BASE_URL = 'https://api.twelvedata.com';

/**
 * PRIMARY provider. Calls Twelve Data directly from the server only - the
 * API key never leaves this Worker (see [apiKey] below, sourced from the
 * `TWELVE_DATA_API_KEY` secret, never a `[vars]` entry, never logged, never
 * echoed in a response body).
 */
export class TwelveDataProvider implements MarketDataProvider {
  readonly id = 'twelve_data' as const;

  constructor(
    private readonly apiKey: string,
    // A bare `fetch` reference loses its required `this` binding once
    // stored on an instance and called as `this.fetchImpl(...)`, throwing
    // "Illegal invocation" in the Workers runtime (confirmed live during
    // deployment) - bind it to globalThis so the default is safe to call.
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private url(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ ...params, apikey: this.apiKey });
    return `${BASE_URL}${path}?${query.toString()}`;
  }

  /**
   * The one true choke point for "a real Twelve Data REST request just
   * happened" - every public method funnels through here, including every
   * individual chunk inside getBatchQuotes' fan-out. Task 6's review found
   * that recording usage once per manager-level admission undercounted a
   * batch call that internally issues multiple real HTTP requests; fixed
   * by recording HERE, where ground truth actually lives, instead of
   * guessing a count one level up. Records unconditionally, before the
   * fetch is attempted - a failed request still consumed real provider
   * quota (network error, timeout, 429, whatever) and must still count.
   */
  private async request(path: string, params: Record<string, string>, timeoutMs = 8000): Promise<Record<string, unknown>> {
    recordProviderRequest(this.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ProviderError('Twelve Data request timed out', 'timeout');
      // The underlying fetch error's own message/name is useful operational
      // detail (DNS failure vs. TLS vs. connection refused), kept server-
      // side only (mapProviderError never forwards it to Flutter) - but
      // some fetch implementations echo the request URL into their error
      // message, so the API key is stripped defensively before this touches
      // any log or the admin health API's lastErrorMessage field.
      const cause = err as Error;
      const safeMessage = `${cause.name}: ${cause.message}`.replace(/apikey=[^&\s"']+/gi, 'apikey=[redacted]');
      throw new ProviderError(`Twelve Data network error: ${safeMessage}`, 'network');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) throw new ProviderError('Twelve Data authentication failed', 'auth');
    if (response.status === 429) throw new ProviderError('Twelve Data rate limit exceeded', 'rate_limit');

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (isTwelveDataRateLimited(json)) throw new ProviderError('Twelve Data rate limit exceeded', 'rate_limit');
    if (isTwelveDataError(json)) throw new ProviderError(String(json.message ?? 'Twelve Data error'), 'unknown');
    return json;
  }

  async getQuote(providerSymbol: string, mkrSymbol: string): Promise<NormalizedQuote | null> {
    const json = await this.request('/quote', { symbol: providerSymbol });
    return parseTwelveDataQuote(json, mkrSymbol);
  }

  // Twelve Data Free's comma-separated /quote endpoint silently drops
  // symbols beyond some undocumented per-request cap (confirmed live: a
  // 25-symbol request came back with usable data for only the first few,
  // `null` for the rest - not an error, just missing from the response
  // object) rather than rejecting the request outright. Chunking keeps
  // each individual upstream call small and reliable while still using a
  // handful of concurrent requests instead of one per symbol.
  private static readonly BATCH_CHUNK_SIZE = 8;

  /** Many symbols in as few upstream calls as Twelve Data's per-request cap allows - see the interface doc comment for why this exists. */
  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    const providerSymbols = Object.keys(providerToMkr);
    if (providerSymbols.length === 0) return {};
    if (providerSymbols.length === 1) {
      const symbol = providerSymbols[0]!;
      return { [providerToMkr[symbol]!]: await this.getQuote(symbol, providerToMkr[symbol]!) };
    }

    const chunks: string[][] = [];
    for (let i = 0; i < providerSymbols.length; i += TwelveDataProvider.BATCH_CHUNK_SIZE) {
      chunks.push(providerSymbols.slice(i, i + TwelveDataProvider.BATCH_CHUNK_SIZE));
    }

    const settled = await Promise.allSettled(
      chunks.map(async (chunk) => {
        const chunkMap = Object.fromEntries(chunk.map((s) => [s, providerToMkr[s]!]));
        const json = await this.request('/quote', { symbol: chunk.join(',') });
        return parseTwelveDataBatchQuotes(json, chunkMap);
      }),
    );

    const result: Record<string, NormalizedQuote | null> = {};
    let allChunksFailed = settled.length > 0;
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        allChunksFailed = false;
        Object.assign(result, outcome.value);
      }
    }
    // Only a genuine, total failure (every chunk threw) should look like a
    // provider fault to the caller's failover logic; a partial chunk
    // failure just leaves those specific symbols out of `result`, which
    // the route handler already treats as "no data for this symbol".
    if (allChunksFailed) throw (settled[0] as PromiseRejectedResult).reason;
    return result;
  }

  async getCandles(providerSymbol: string, mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number): Promise<NormalizedCandle[]> {
    const json = await this.request('/time_series', {
      symbol: providerSymbol,
      interval: twelveDataInterval(timeframe),
      outputsize: String(Math.min(Math.max(outputSize, 1), 5000)),
    });
    return parseTwelveDataCandles(json, mkrSymbol, timeframe);
  }

  /**
   * Final Edit Task - Finding 3: this used to swallow EVERY error from
   * `request()` - network failure, timeout, auth failure, rate limit, or
   * an embedded API error - and convert all of them into a "successful"
   * unavailable-status result via `parseTwelveDataMarketStatus(null, ...)`.
   * That meant a genuine outage was never visible to
   * `MarketProviderManager.withFailover` (which only reacts to a REJECTED
   * promise) - failover and the circuit breaker could never trigger off a
   * market-status call, no matter how badly Twelve Data was actually down.
   *
   * `request()` only ever throws for a REAL failure (network/timeout/auth/
   * rate-limit/embedded-error - see its own doc comment); it never returns
   * successfully with a body that itself represents a failure. So there is
   * no legitimate "unavailable" case left to catch here - a genuinely
   * unsupported/sparse market-status response (e.g. missing
   * `is_market_open`) still resolves successfully with `json` populated,
   * and `parseTwelveDataMarketStatus` already turns that into the correct
   * non-fatal `session: 'unknown', isOpen: null` shape on its own, with no
   * try/catch required. Every real error now simply propagates.
   */
  async getMarketStatus(providerSymbol: string, mkrSymbol: string): Promise<NormalizedMarketStatus> {
    const json = await this.request('/quote', { symbol: providerSymbol });
    return parseTwelveDataMarketStatus(json, mkrSymbol);
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      // /api_usage is a lightweight, always-available Twelve Data endpoint -
      // cheaper than spending a real quote credit just to probe reachability.
      await this.request('/api_usage', {}, 4000);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
