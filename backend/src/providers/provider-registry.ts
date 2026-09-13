import type { Env, ProviderId } from '../types';
import { AlpacaProvider } from './alpaca/alpaca-provider';
import { TwelveDataProvider } from './twelve-data/twelve-data-provider';
import type { MarketDataProvider } from './types';

/**
 * Pluggable provider construction. Adding a future provider (Tiingo,
 * Polygon, a licensed Thai SET feed, ...) means implementing
 * [MarketDataProvider] and adding one case here - routes and
 * [MarketProviderManager] never change.
 */
export function buildProvider(id: ProviderId, env: Env): MarketDataProvider | null {
  switch (id) {
    case 'twelve_data':
      return env.TWELVE_DATA_API_KEY ? new TwelveDataProvider(env.TWELVE_DATA_API_KEY) : null;
    case 'alpaca':
      return env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY ? new AlpacaProvider(env.ALPACA_API_KEY_ID, env.ALPACA_API_SECRET_KEY) : null;
    default:
      return null;
  }
}
