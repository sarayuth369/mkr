import type { EconomicEvent } from '../types';

export interface CalendarFetchRange {
  fromMs: number;
  toMs: number;
}

export type CalendarProviderErrorKind = 'network' | 'timeout' | 'auth' | 'rate_limit' | 'unavailable';

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: CalendarProviderErrorKind,
  ) {
    super(message);
    this.name = 'CalendarProviderError';
  }
}

/**
 * Provider-neutral collector interface (target architecture: "Official
 * Sources / Licensed Providers -> Calendar Collectors -> Normalization").
 * A provider's ONLY job is producing [EconomicEvent]s for a date range -
 * classification (src/calendar/classification.ts), D1 persistence
 * (store.ts), and caching (calendar-routes.ts) are all handled centrally,
 * never duplicated per-provider.
 *
 * `fetchEvents` must throw [CalendarProviderError] for a genuine fetch
 * fault (network/timeout/auth/rate_limit/unavailable) - EconomicCalendarProviderManager
 * uses this for per-provider failure isolation, matching the exact
 * discipline already established for MarketDataProvider (see
 * src/providers/types.ts). Never return a fabricated/guessed event; skip
 * anything that can't be honestly normalized.
 */
export interface EconomicCalendarProvider {
  readonly id: string;
  /** True for a provider whose commercial/redistribution rights have NOT
   * yet been verified for MKR - EconomicCalendarProviderManager never
   * selects one of these unless explicitly enabled by config (see
   * provider-manager.ts). Curated official-source data is always
   * `commercial: false`. */
  readonly commercial: boolean;
  fetchEvents(range: CalendarFetchRange): Promise<EconomicEvent[]>;
}
