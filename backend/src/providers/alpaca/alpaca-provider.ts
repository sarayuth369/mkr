import { logError } from '../../logging';
import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';
import { recordProviderRequest } from '../quota-manager';
import { ProviderError, type MarketDataProvider } from '../types';
import {
  alpacaMarketStatusUnavailable,
  alpacaTimeframe,
  isAlpacaCryptoSymbol,
  parseAlpacaBars,
  parseAlpacaCryptoBars,
  parseAlpacaCryptoSnapshot,
  parseAlpacaSnapshot,
} from './alpaca-parser';

const STOCK_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
// Crypto market data is a separate API family from stocks - not a
// path/query variant of the same one. See alpaca-parser.ts's
// isAlpacaCryptoSymbol doc comment for how a symbol is routed here.
const CRYPTO_BASE_URL = 'https://data.alpaca.markets/v1beta3/crypto/us';

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

  /**
   * The one true choke point for "a real Alpaca REST request just
   * happened" - see the identical comment/fix in twelve-data-provider.ts.
   * getBatchQuotes fans out to N calls of getQuote, each of which reaches
   * here once - recording here (not at the manager's one-per-batch-call
   * admission) is what makes usage accounting correct. getMarketStatus
   * makes no HTTP call at all (Alpaca has no market-status endpoint used
   * here) and correctly records nothing, for the same reason.
   */
  private async request(url: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
    recordProviderRequest(this.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers(), signal: controller.signal });
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
    if (isAlpacaCryptoSymbol(providerSymbol)) {
      const json = await this.request(`${CRYPTO_BASE_URL}/snapshots?symbols=${encodeURIComponent(providerSymbol)}`);
      return parseAlpacaCryptoSnapshot(json, providerSymbol, mkrSymbol);
    }
    const json = await this.request(`${STOCK_BASE_URL}/${encodeURIComponent(providerSymbol)}/snapshot`);
    return parseAlpacaSnapshot(json, mkrSymbol);
  }

  async getCandles(providerSymbol: string, mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number): Promise<NormalizedCandle[]> {
    const limit = Math.min(Math.max(outputSize, 1), 1000);
    if (isAlpacaCryptoSymbol(providerSymbol)) {
      const json = await this.request(`${CRYPTO_BASE_URL}/bars?symbols=${encodeURIComponent(providerSymbol)}&timeframe=${alpacaTimeframe(timeframe)}&limit=${limit}`);
      return parseAlpacaCryptoBars(json, providerSymbol, mkrSymbol, timeframe);
    }
    const json = await this.request(`${STOCK_BASE_URL}/${encodeURIComponent(providerSymbol)}/bars?timeframe=${alpacaTimeframe(timeframe)}&limit=${limit}`);
    return parseAlpacaBars(json, mkrSymbol, timeframe);
  }

  /**
   * Splits by asset family before doing anything else - crypto and stock
   * are different API families with different batch semantics, not a
   * single loop with a per-symbol branch:
   *
   * - Crypto: Alpaca's `/v1beta3/crypto/us/snapshots` genuinely accepts a
   *   comma-separated `symbols` list and returns all of them from ONE real
   *   HTTP request (https://docs.alpaca.markets/us/reference/
   *   cryptosnapshots-1) - using that materially reduces request count for
   *   a multi-crypto batch, so all crypto symbols in this call share a
   *   single request. A symbol missing from the returned map resolves to
   *   `null` (parseAlpacaCryptoSnapshot) without affecting siblings; only
   *   a totally failed HTTP request (thrown) drops the whole crypto group
   *   from `result`, isolated from the stock group below.
   * - Stock: unchanged from before this task - Alpaca's stock snapshot
   *   endpoint has no documented batch form, so N stock symbols still need
   *   N sequential, per-symbol-isolated requests (see the class's original
   *   2026-09-15 review fix, preserved as-is here).
   */
  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    const entries = Object.entries(providerToMkr);
    if (entries.length === 0) return {};

    const cryptoEntries = entries.filter(([providerSymbol]) => isAlpacaCryptoSymbol(providerSymbol));
    const stockEntries = entries.filter(([providerSymbol]) => !isAlpacaCryptoSymbol(providerSymbol));

    const result: Record<string, NormalizedQuote | null> = {};
    let anySucceeded = false;
    let lastFailure: unknown;

    if (cryptoEntries.length > 0) {
      try {
        const symbolsParam = cryptoEntries.map(([providerSymbol]) => encodeURIComponent(providerSymbol)).join(',');
        const json = await this.request(`${CRYPTO_BASE_URL}/snapshots?symbols=${symbolsParam}`);
        for (const [providerSymbol, mkrSymbol] of cryptoEntries) {
          result[mkrSymbol] = parseAlpacaCryptoSnapshot(json, providerSymbol, mkrSymbol);
        }
        anySucceeded = true;
      } catch (err) {
        lastFailure = err;
        logError('crypto batch quote group failed', { symbols: cryptoEntries.map(([p]) => p).join(','), message: (err as Error).message });
      }
    }

    for (const [providerSymbol, mkrSymbol] of stockEntries) {
      try {
        result[mkrSymbol] = await this.getQuote(providerSymbol, mkrSymbol);
        anySucceeded = true;
      } catch (err) {
        lastFailure = err;
        // Deliberately not thrown here - only a genuine, total failure
        // (every symbol threw) should look like a provider fault to the
        // caller's failover logic; a per-symbol failure just leaves that
        // one symbol out of `result`, which the route handler already
        // treats as "no data for this symbol". Logged so a recurring
        // per-symbol failure is actually visible server-side.
        logError('batch quote symbol failed', { symbol: providerSymbol, message: (err as Error).message });
      }
    }
    if (!anySucceeded) throw lastFailure;
    return result;
  }

  async getMarketStatus(_providerSymbol: string, mkrSymbol: string): Promise<NormalizedMarketStatus> {
    return alpacaMarketStatusUnavailable(mkrSymbol);
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.request(`${STOCK_BASE_URL}/AAPL/snapshot`, 4000);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
