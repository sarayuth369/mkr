import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';
import { ProviderError, type MarketDataProvider } from '../types';
import { alpacaMarketStatusUnavailable, alpacaTimeframe, parseAlpacaBars, parseAlpacaSnapshot } from './alpaca-parser';

const BASE_URL = 'https://data.alpaca.markets/v2/stocks';

/**
 * SECONDARY/standby provider. Fully implemented and wired the same way as
 * [TwelveDataProvider], but [MarketProviderManager] only ever calls it when
 * `MARKET_SECONDARY_ENABLED` is explicitly `true` - see the class-level
 * constraint there. This class itself has no "enabled" flag of its own; the
 * activation decision is deliberately kept out of the provider and owned by
 * the manager/admin config, so this class can be tested in isolation.
 *
 * Alpaca's commercial redistribution/display rights have not been
 * confirmed for MKR - do not flip `MARKET_SECONDARY_ENABLED=true` in
 * production until that is settled (see docs/MKR-PHASE2-ARCHITECTURE.md).
 */
export class AlpacaProvider implements MarketDataProvider {
  readonly id = 'alpaca' as const;

  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
    // See the identical fix/comment in twelve-data-provider.ts - a bare
    // `fetch` reference throws "Illegal invocation" once called as
    // `this.fetchImpl(...)` in the Workers runtime.
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private headers(): HeadersInit {
    return { 'APCA-API-KEY-ID': this.keyId, 'APCA-API-SECRET-KEY': this.secretKey };
  }

  private async request(path: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, { headers: this.headers(), signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ProviderError('Alpaca request timed out', 'timeout');
      throw new ProviderError('Alpaca network error', 'network');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) throw new ProviderError('Alpaca authentication failed', 'auth');
    if (response.status === 429) throw new ProviderError('Alpaca rate limit exceeded', 'rate_limit');
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }

  async getQuote(providerSymbol: string, mkrSymbol: string): Promise<NormalizedQuote | null> {
    const json = await this.request(`/${encodeURIComponent(providerSymbol)}/snapshot`);
    return parseAlpacaSnapshot(json, mkrSymbol);
  }

  async getCandles(providerSymbol: string, mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number): Promise<NormalizedCandle[]> {
    const limit = Math.min(Math.max(outputSize, 1), 1000);
    const json = await this.request(`/${encodeURIComponent(providerSymbol)}/bars?timeframe=${alpacaTimeframe(timeframe)}&limit=${limit}`);
    return parseAlpacaBars(json, mkrSymbol, timeframe);
  }

  /**
   * Alpaca's snapshot endpoint is per-symbol only (no documented
   * comma-separated batch form used here) - standby-only anyway, so this
   * stays a simple concurrent loop rather than adding batching complexity
   * for a provider that isn't in the live traffic path.
   */
  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    const entries = await Promise.all(
      Object.entries(providerToMkr).map(async ([providerSymbol, mkrSymbol]) => [mkrSymbol, await this.getQuote(providerSymbol, mkrSymbol)] as const),
    );
    return Object.fromEntries(entries);
  }

  async getMarketStatus(_providerSymbol: string, mkrSymbol: string): Promise<NormalizedMarketStatus> {
    return alpacaMarketStatusUnavailable(mkrSymbol);
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.request('/AAPL/snapshot', 4000);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
