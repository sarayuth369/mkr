import { logError } from '../../logging';
import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote } from '../../types';
import { recordProviderRequest } from '../quota-manager';
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

  /**
   * The one true choke point for "a real Alpaca REST request just
   * happened" - see the identical comment/fix in twelve-data-provider.ts.
   * getBatchQuotes fans out to N calls of getQuote, each of which reaches
   * here once - recording here (not at the manager's one-per-batch-call
   * admission) is what makes usage accounting correct. getMarketStatus
   * makes no HTTP call at all (Alpaca has no market-status endpoint used
   * here) and correctly records nothing, for the same reason.
   */
  private async request(path: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
    recordProviderRequest(this.id);
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
   * comma-separated batch form used here), so N symbols genuinely need N
   * real HTTP requests - this cannot be reduced to fewer calls the way
   * TwelveDataProvider's chunking does. What it CAN control is
   * concurrency and failure isolation, which the original implementation
   * got wrong the same way TwelveDataProvider originally did:
   *
   * - `Promise.all` over N concurrent `getQuote()` calls fires every
   *   request at once with no concurrency limit - unsafe under an unknown
   *   real Alpaca rate limit (this provider has never been activated in
   *   production, so no real limit has ever been observed/confirmed - see
   *   the class doc comment; "do not invent provider quota values" means
   *   not assuming N-way concurrency is safe either).
   * - `Promise.all` is also fail-fast: ONE symbol throwing a transient
   *   ProviderError (timeout/network/rate_limit) would reject the whole
   *   batch immediately, discarding every other symbol's already-fetched
   *   result - the exact "one bad element takes the whole batch down"
   *   failure class TwelveDataProvider's chunk-batching fix addressed,
   *   just via a different mechanism (there: one bad chunk poisoning up
   *   to 7 sibling symbols; here: one bad symbol poisoning all of them).
   *
   * Fixed the same way: sequential requests (matching the primary
   * provider's now-sequential chunking - the safe default absent a known
   * real concurrency limit), with per-symbol failure isolated via
   * try/catch rather than letting one rejection cancel the rest. A
   * symbol whose own parseAlpacaSnapshot/isAlpacaError already resolves
   * to a graceful `null` (see alpaca-parser.ts - Alpaca's own "invalid
   * symbol" responses were already handled this way, never thrown) is
   * unaffected either way; this specifically fixes a genuine transient
   * failure (timeout/network/rate_limit) on one symbol no longer taking
   * every other symbol's result down with it. Only a TOTAL failure
   * (every symbol threw) propagates to the caller, exactly mirroring
   * TwelveDataProvider.getBatchQuotes's "any chunk succeeded" rule - this
   * is what MarketProviderManager's existing confirmed-unhealthy/circuit
   * logic keys off of.
   */
  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    const entries = Object.entries(providerToMkr);
    if (entries.length === 0) return {};

    const result: Record<string, NormalizedQuote | null> = {};
    let anySucceeded = false;
    let lastFailure: unknown;
    for (const [providerSymbol, mkrSymbol] of entries) {
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
      await this.request('/AAPL/snapshot', 4000);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
