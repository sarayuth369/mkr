import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';
import { ProviderError, type MarketDataProvider } from '../types';
import {
  isTwelveDataError,
  isTwelveDataRateLimited,
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
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ ...params, apikey: this.apiKey });
    return `${BASE_URL}${path}?${query.toString()}`;
  }

  private async request(path: string, params: Record<string, string>, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ProviderError('Twelve Data request timed out', 'timeout');
      throw new ProviderError('Twelve Data network error', 'network');
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

  async getCandles(providerSymbol: string, mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number): Promise<NormalizedCandle[]> {
    const json = await this.request('/time_series', {
      symbol: providerSymbol,
      interval: twelveDataInterval(timeframe),
      outputsize: String(Math.min(Math.max(outputSize, 1), 5000)),
    });
    return parseTwelveDataCandles(json, mkrSymbol, timeframe);
  }

  async getMarketStatus(providerSymbol: string, mkrSymbol: string): Promise<NormalizedMarketStatus> {
    try {
      const json = await this.request('/quote', { symbol: providerSymbol });
      return parseTwelveDataMarketStatus(json, mkrSymbol);
    } catch {
      return parseTwelveDataMarketStatus(null, mkrSymbol);
    }
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
