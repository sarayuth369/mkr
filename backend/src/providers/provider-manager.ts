import type { MkrTimeframe, NormalizedCandle, NormalizedMarketStatus, NormalizedQuote, ProviderHealth, ProviderId } from '../types';
import { ProviderError, type MarketDataProvider } from './types';

interface InMemoryHealth {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  errorCount: number;
}

// Module-scope (isolate-lifetime, best-effort) health bookkeeping - reset on
// cold start. Deliberately NOT written to KV on every request (that would
// burn through KV's daily write quota under real traffic for no functional
// benefit); the manager's own failover decisions only need the CURRENT
// isolate's view, and /api/mkr/market/health does a live probe anyway (see
// [MarketProviderManager.healthSnapshot]).
const memoryHealth = new Map<ProviderId, InMemoryHealth>();

function healthEntry(id: ProviderId): InMemoryHealth {
  let entry = memoryHealth.get(id);
  if (!entry) {
    entry = { lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null, errorCount: 0 };
    memoryHealth.set(id, entry);
  }
  return entry;
}

function recordSuccess(id: ProviderId): void {
  healthEntry(id).lastSuccessAt = Date.now();
}

function recordFailure(id: ProviderId, message: string): void {
  const entry = healthEntry(id);
  entry.lastErrorAt = Date.now();
  entry.lastErrorMessage = message;
  entry.errorCount += 1;
}

/** Test-only: clears in-memory health state between test cases. */
export function _resetHealthForTests(): void {
  memoryHealth.clear();
}

/**
 * Server-side failover engine - the direct architectural counterpart of
 * Flutter Phase 1's `MarketProviderManager`
 * (lib/features/markets/data/market_provider_manager.dart), and of
 * `auc-backend`'s `crypto-providers/registry.ts` fallback pattern.
 *
 * Critical rule: failover only happens once a provider is CONFIRMED
 * unhealthy via [MarketDataProvider.healthCheck] - never merely because one
 * request happened to fail, and never because a healthy provider returned
 * an empty/no-data result (that is surfaced as `null`, not an exception -
 * see [MarketDataProvider.getQuote]).
 */
export class MarketProviderManager {
  constructor(
    private readonly primary: MarketDataProvider | null,
    private readonly secondary: MarketDataProvider | null,
    private readonly secondaryEnabled: boolean,
  ) {}

  private async withFailover<T>(
    call: (provider: MarketDataProvider, providerSymbol: string) => Promise<T>,
    symbolFor: (id: ProviderId) => string | null,
  ): Promise<{ result: T; source: ProviderId }> {
    if (this.primary) {
      const symbol = symbolFor(this.primary.id);
      if (symbol) {
        try {
          const result = await call(this.primary, symbol);
          recordSuccess(this.primary.id);
          return { result, source: this.primary.id };
        } catch (err) {
          recordFailure(this.primary.id, (err as Error).message);
          const probe = await this.primary.healthCheck();
          if (probe.healthy) {
            // Confirmed still reachable - a one-off/transient fault, not a
            // genuine outage. Do not fail over; propagate the real error.
            throw err;
          }
          // Confirmed unhealthy - fall through to the secondary below.
        }
      }
    }

    if (this.secondaryEnabled && this.secondary) {
      const symbol = symbolFor(this.secondary.id);
      if (symbol) {
        try {
          const result = await call(this.secondary, symbol);
          recordSuccess(this.secondary.id);
          return { result, source: this.secondary.id };
        } catch (err) {
          recordFailure(this.secondary.id, (err as Error).message);
          throw err;
        }
      }
    }

    throw new ProviderError('No healthy provider available for this symbol', 'unknown');
  }

  getQuote(mkrSymbol: string, symbolFor: (id: ProviderId) => string | null) {
    return this.withFailover<NormalizedQuote | null>((provider, symbol) => provider.getQuote(symbol, mkrSymbol), symbolFor);
  }

  /**
   * One upstream call for many symbols instead of N - see the interface
   * doc comment on [MarketDataProvider.getBatchQuotes] for why this exists
   * (Twelve Data Free's rate limit is exhausted almost immediately by N
   * concurrent individual quote calls for one client's full catalog load).
   * Same failover discipline as [withFailover]: only falls to secondary
   * after the primary throws AND a healthCheck confirms it's genuinely
   * down, never merely because some symbols in the batch came back null.
   */
  async getBatchQuotes(
    mkrSymbols: string[],
    providerSymbolFor: (id: ProviderId, mkrSymbol: string) => string | null,
  ): Promise<{ result: Record<string, NormalizedQuote | null>; source: ProviderId | null }> {
    const buildMap = (id: ProviderId): Record<string, string> => {
      const map: Record<string, string> = {};
      for (const mkrSymbol of mkrSymbols) {
        const providerSymbol = providerSymbolFor(id, mkrSymbol);
        if (providerSymbol) map[providerSymbol] = mkrSymbol;
      }
      return map;
    };

    if (this.primary) {
      const map = buildMap(this.primary.id);
      if (Object.keys(map).length > 0) {
        try {
          const result = await this.primary.getBatchQuotes(map);
          recordSuccess(this.primary.id);
          return { result, source: this.primary.id };
        } catch (err) {
          recordFailure(this.primary.id, (err as Error).message);
          const probe = await this.primary.healthCheck();
          if (probe.healthy) throw err; // transient - propagate, don't fail over
        }
      }
    }

    if (this.secondaryEnabled && this.secondary) {
      const map = buildMap(this.secondary.id);
      if (Object.keys(map).length > 0) {
        try {
          const result = await this.secondary.getBatchQuotes(map);
          recordSuccess(this.secondary.id);
          return { result, source: this.secondary.id };
        } catch (err) {
          recordFailure(this.secondary.id, (err as Error).message);
          throw err;
        }
      }
    }

    // Nothing mapped for either provider - a mapping outcome, not a fault.
    return { result: Object.fromEntries(mkrSymbols.map((s) => [s, null])), source: null };
  }

  getCandles(mkrSymbol: string, timeframe: MkrTimeframe, outputSize: number, symbolFor: (id: ProviderId) => string | null) {
    return this.withFailover<NormalizedCandle[]>((provider, symbol) => provider.getCandles(symbol, mkrSymbol, timeframe, outputSize), symbolFor);
  }

  getMarketStatus(mkrSymbol: string, symbolFor: (id: ProviderId) => string | null) {
    return this.withFailover<NormalizedMarketStatus>((provider, symbol) => provider.getMarketStatus(symbol, mkrSymbol), symbolFor);
  }

  /** Live probe of both providers, for GET /api/mkr/market/health - callers should cache this briefly (see cache-service.ts). */
  async healthSnapshot(): Promise<{ primary: ProviderHealth | null; secondary: ProviderHealth | null }> {
    const build = async (provider: MarketDataProvider | null, enabled: boolean): Promise<ProviderHealth | null> => {
      if (!provider) return null;
      const mem = healthEntry(provider.id);
      if (!enabled) {
        return {
          provider: provider.id,
          status: 'disabled',
          latencyMs: null,
          lastSuccessAt: mem.lastSuccessAt,
          lastErrorAt: mem.lastErrorAt,
          lastErrorMessage: mem.lastErrorMessage,
          errorCount: mem.errorCount,
        };
      }
      const probe = await provider.healthCheck();
      return {
        provider: provider.id,
        status: probe.healthy ? 'healthy' : 'unhealthy',
        latencyMs: probe.latencyMs,
        lastSuccessAt: mem.lastSuccessAt,
        lastErrorAt: mem.lastErrorAt,
        lastErrorMessage: mem.lastErrorMessage,
        errorCount: mem.errorCount,
      };
    };

    return {
      primary: await build(this.primary, true),
      secondary: await build(this.secondary, this.secondaryEnabled),
    };
  }
}
