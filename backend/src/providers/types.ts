import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderId } from '../types';

/**
 * Server-side provider abstraction - mirrors the Flutter-side
 * `MarketDataProvider` interface from Phase 1 (lib/features/markets/domain/market_data_provider.dart)
 * so the same mental model applies on both sides of the wire. Routes only
 * ever call [MarketProviderManager], never a concrete provider directly
 * (see src/providers/provider-manager.ts) - this is what makes adding a
 * future provider (Tiingo, Polygon, a licensed SET feed, ...) a matter of
 * implementing this interface and registering it, not rewriting routes.
 *
 * Quota accounting contract (Task 6, corrected after review): implementers
 * are responsible for calling `recordProviderRequest(this.id)` (see
 * quota-manager.ts) exactly once per REAL upstream HTTP request they
 * actually make - not once per public method call. A method that fans out
 * into N real requests (e.g. Twelve Data's getBatchQuotes chunking, or
 * Alpaca's getBatchQuotes issuing one request per symbol) must record N
 * times; a method that makes no real request at all (e.g. Alpaca's
 * getMarketStatus, which has no such endpoint here) must record zero.
 * `MarketProviderManager` only checks admission before calling in - it
 * does not and cannot know how many real requests a given call will turn
 * into, so it deliberately leaves recording to the implementation that
 * actually knows. See twelve-data-provider.ts / alpaca-provider.ts's own
 * `request()` methods for the reference implementation of this contract.
 */
export interface MarketDataProvider {
  readonly id: ProviderId;

  /**
   * `null` means "reached the provider fine, it just has nothing for this
   * symbol right now" (e.g. a quiet/closed market) - a healthy-but-empty
   * result, which [MarketProviderManager] must NOT treat as a failure.
   * Throwing [ProviderError] is reserved for genuine connectivity/auth/
   * timeout/rate-limit faults.
   */
  getQuote(providerSymbol: string, mkrSymbol: string): Promise<NormalizedQuote | null>;

  /**
   * Fetches many quotes in as few upstream requests as the provider allows
   * (ideally one) - keyed by MKR symbol. Critical for avoiding a "one
   * upstream call per catalog symbol per client" storm: MKR's Home/Markets
   * screens legitimately want ~28 quotes on a single load, and firing that
   * many individual REST calls concurrently exhausts Twelve Data Free's
   * rate limit almost immediately (confirmed live during deployment - every
   * quote came back PROVIDER_UNAVAILABLE under that load). [providerToMkr]
   * maps each provider symbol to request back to its MKR symbol.
   */
  getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>>;

  getCandles(providerSymbol: string, mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number): Promise<NormalizedCandle[]>;

  getMarketStatus(providerSymbol: string, mkrSymbol: string): Promise<NormalizedMarketStatus>;

  /** Cheap liveness probe - genuine reachability only, never conflated with market-closed. */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'rate_limit' | 'auth' | 'network' | 'not_found' | 'unknown',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
