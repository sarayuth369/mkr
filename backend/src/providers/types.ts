import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderId } from '../types';

/**
 * Server-side provider abstraction - mirrors the Flutter-side
 * `MarketDataProvider` interface from Phase 1 (lib/features/markets/domain/market_data_provider.dart)
 * so the same mental model applies on both sides of the wire. Routes only
 * ever call [MarketProviderManager], never a concrete provider directly
 * (see src/providers/provider-manager.ts) - this is what makes adding a
 * future provider (Tiingo, Polygon, a licensed SET feed, ...) a matter of
 * implementing this interface and registering it, not rewriting routes.
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
