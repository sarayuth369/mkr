import { logError } from '../logging';
import type { CalendarFetchRange, EconomicCalendarProvider } from './providers/types';
import type { EconomicEvent, EventStatus } from './types';

export interface ProviderFetchOutcome {
  providerId: string;
  ok: boolean;
  eventCount: number;
  errorMessage: string | null;
}

export interface ManagerFetchResult {
  events: EconomicEvent[];
  outcomes: ProviderFetchOutcome[];
}

/**
 * Provider selection, per-provider failure isolation, dedupe, and status
 * computation - the one place that decides which providers are active and
 * combines their output (target architecture's "Calendar Collectors" ->
 * "Normalization + validation" stage). Deliberately does NOT decide
 * caching or persistence - see ingestion.ts/store.ts for those.
 *
 * "Do not blindly merge incompatible datasets": events are identified by
 * `${source}:${sourceEventId}` (see types.ts), so two providers' views of
 * what a human would consider "the same" real-world release never
 * collide into one fabricated merged row - each stays its own row, tagged
 * by its own source. A future live provider disagreeing with the curated
 * schedule is visible as two distinct events, not silently reconciled.
 */
export class EconomicCalendarProviderManager {
  constructor(private readonly providers: EconomicCalendarProvider[]) {}

  async fetchAll(range: CalendarFetchRange, now: number = Date.now()): Promise<ManagerFetchResult> {
    const outcomes: ProviderFetchOutcome[] = [];
    const byId = new Map<string, EconomicEvent>();

    for (const provider of this.providers) {
      try {
        const events = await provider.fetchEvents(range);
        for (const event of events) {
          byId.set(event.id, { ...event, status: computeStatus(event, now) });
        }
        outcomes.push({ providerId: provider.id, ok: true, eventCount: events.length, errorMessage: null });
      } catch (err) {
        // Per-provider isolation (matching MarketDataProvider's discipline,
        // src/providers/provider-manager.ts) - one provider's failure never
        // discards another provider's already-fetched events.
        const message = err instanceof Error ? err.message : 'Unknown calendar provider error';
        logError('calendar provider fetch failed', { provider: provider.id, message });
        outcomes.push({ providerId: provider.id, ok: false, eventCount: 0, errorMessage: message });
      }
    }

    return { events: [...byId.values()], outcomes };
  }
}

/** Centralized status derivation - never per-provider, so every source agrees on what "released" means. A curated/schedule-only source has no live signal for `cancelled`, so it can only ever resolve to scheduled/released/unknown; a future live provider MAY report `cancelled` via its own normalization (not implemented by any active provider in this task). */
function computeStatus(event: EconomicEvent, now: number): EventStatus {
  if (event.status === 'cancelled') return 'cancelled'; // a provider's own explicit signal always wins
  return event.eventTimeUtc <= now ? 'released' : 'scheduled';
}

/** Config-driven provider construction - see calendar-routes.ts/ingestion.ts callers. Curated is always included; FMP (or any future commercial provider) is added ONLY when explicitly listed AND its secret is configured - never activated by default (task constraint: no paid provider this task). */
export function activeProviderIds(configuredIds: string[], availableCommercialIds: Set<string>): string[] {
  const ids = new Set<string>(['curated_official']);
  for (const id of configuredIds) {
    if (id === 'curated_official' || availableCommercialIds.has(id)) ids.add(id);
  }
  return [...ids];
}
