import { FmpClient } from '../../news/fmp-client';
import { classifyEvent } from '../classification';
import type { EconomicEvent } from '../types';
import { eventTimeLocal } from '../timezone';
import { CalendarProviderError, type CalendarFetchRange, type EconomicCalendarProvider } from './types';

/**
 * FUTURE, NOT-YET-ACTIVE provider (target architecture: "Future providers
 * may include FXStreet, FMP, Finnhub, Trading Economics, etc. Only
 * activate a commercial provider after its commercial/redistribution
 * rights are verified"). Financial Modeling Prep's free-tier
 * `/stable/economic-calendar` endpoint was confirmed LIVE on 2026-09-15 to
 * return HTTP 402 Payment Required despite FMP's marketing page claiming
 * "Free Plan Access" - so this provider is not just "rights-unverified",
 * it is currently non-functional on the free tier and would require a
 * paid FMP plan to ever return data. It is implemented here (interface-
 * complete, unit-testable) purely as ready-to-activate scaffolding for a
 * future paid/verified-rights decision - `commercial: true` means
 * EconomicCalendarProviderManager never selects it unless explicitly
 * added to `CALENDAR_ACTIVE_PROVIDERS` (see provider-manager.ts), which
 * this task does NOT do (task constraint: no paid provider this task).
 */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseImportance(value: unknown): 'high' | 'medium' | 'low' | 'unknown' {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'high') return 'high';
    if (lower === 'medium' || lower === 'med') return 'medium';
    if (lower === 'low') return 'low';
  }
  return 'unknown';
}

/** FMP returns a bare JSON array of `{ date, country, event, currency, previous, estimate, actual, impact, unit, ... }`. `date` is "YYYY-MM-DD HH:mm:ss" with no explicit timezone marker - treated as UTC, matching every other timestamp this backend hands to Flutter. */
export function parseFmpCalendarEvents(json: unknown): EconomicEvent[] {
  if (!Array.isArray(json)) return [];

  const events: EconomicEvent[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const title = str(item.event);
    const country = str(item.country);
    const dateStr = str(item.date);
    if (!title || !country || !dateStr) continue; // never fabricate a missing event/country/date

    const eventTimeUtc = Date.parse(`${dateStr.replace(' ', 'T')}Z`);
    if (Number.isNaN(eventTimeUtc)) continue;

    const classification = classifyEvent(title);
    const sourceEventId = `${country}-${title}-${dateStr}`;
    events.push({
      id: `fmp:${sourceEventId}`,
      source: 'fmp',
      sourceEventId,
      country,
      currency: str(item.currency),
      title,
      category: classification.category,
      eventTimeUtc,
      eventTimeLocal: eventTimeLocal(eventTimeUtc, country),
      // FMP's own "impact" IS a commercial-provider label - deliberately
      // NOT used for `importance` (task constraint: never copy a
      // commercial provider's impact/analysis). MKR's own classification
      // is used instead; FMP's raw impact is simply discarded.
      importance: classification.importance,
      previous: num(item.previous),
      consensus: num(item.estimate),
      actual: num(item.actual),
      unit: str(item.unit),
      status: 'unknown',
      relatedAssets: classification.relatedAssets,
      sourceUrl: null,
      updatedAt: Date.now(),
    });
  }
  return events;
}

export class FmpCalendarProvider implements EconomicCalendarProvider {
  readonly id = 'fmp';
  readonly commercial = true;

  constructor(private readonly apiKey: string) {}

  async fetchEvents(range: CalendarFetchRange): Promise<EconomicEvent[]> {
    const client = new FmpClient(this.apiKey);
    const from = new Date(range.fromMs).toISOString().slice(0, 10);
    const to = new Date(range.toMs).toISOString().slice(0, 10);
    try {
      const json = await client.request('/economic-calendar', { from, to });
      return parseFmpCalendarEvents(json);
    } catch (err) {
      // FmpClient already classifies HTTP-level faults into ApiError - map
      // to this module's own error type so the manager's failure-isolation
      // logic never needs to know about news/fmp-client.ts's ApiError.
      const message = err instanceof Error ? err.message : 'FMP request failed';
      throw new CalendarProviderError(message, 'unavailable');
    }
  }
}
