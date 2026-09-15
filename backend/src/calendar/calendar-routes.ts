import { getCached, putCached } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import type { Env } from '../types';
import { computeFreshness, mostRecentSuccessAt } from './freshness';
import { isoWeekKey, runCalendarIngestion } from './ingestion';
import { calendarStoreFor } from './store';
import { eventTimeLocal } from './timezone';
import type { CalendarEventFilters, CalendarResponseMeta, EconomicEvent, EventImportance } from './types';

// Cache is a read-through convenience over D1 (the canonical store), never
// authoritative on its own - see ingestion.ts's bounded delete-on-ingest
// invalidation. 30 minutes is generous headroom above the 6h ingestion
// cadence's actual data-change rate (curated schedule dates essentially
// never change) while still comfortably clearing KV's 60s floor.
const CALENDAR_CACHE_TTL_SECONDS = 1800;

interface CalendarPayload {
  items: EconomicEvent[];
  meta: CalendarResponseMeta;
}

async function requireCalendarEnabled(env: Env): Promise<void> {
  const { featureFlags } = await getConfig(env);
  if (!featureFlags.economicCalendarEnabled) throw new ApiError('FEATURE_DISABLED', 'The economic calendar is not enabled on this deployment.');
}

/** Self-heals a brand-new deployment (empty D1, cron hasn't ticked yet) with one inline ingestion - a pure in-memory computation for the always-on curated provider, so this costs no external network call and stays fast. Only runs once: after the first successful ingestion, `calendar_source_state` is non-empty and this is skipped forever after, leaving the cron as the sole ongoing refresh mechanism. */
async function ensureIngestedAtLeastOnce(env: Env): Promise<void> {
  const store = calendarStoreFor(env);
  const states = await store.allSourceStates();
  if (states.length > 0) return;
  await runCalendarIngestion(env, []);
}

function withLocalTime(event: EconomicEvent): EconomicEvent {
  return { ...event, eventTimeLocal: eventTimeLocal(event.eventTimeUtc, event.country) };
}

async function fetchEventsAndMeta(env: Env, filters: CalendarEventFilters): Promise<CalendarPayload> {
  await ensureIngestedAtLeastOnce(env);
  const store = calendarStoreFor(env);
  const [events, sources, totalCount] = await Promise.all([store.query(filters), store.allSourceStates(), store.query({}).then((all) => all.length)]);
  return {
    items: events.map(withLocalTime),
    meta: {
      freshness: computeFreshness(sources, totalCount > 0),
      lastUpdatedAt: mostRecentSuccessAt(sources),
      sources,
    },
  };
}

async function cachedOrFetch(env: Env, cacheKey: string, filters: CalendarEventFilters): Promise<CalendarPayload> {
  const cached = await getCached<CalendarPayload>(env.MKR_CACHE, cacheKey);
  if (cached !== undefined) return cached;
  const payload = await fetchEventsAndMeta(env, filters);
  await putCached(env.MKR_CACHE, cacheKey, payload, CALENDAR_CACHE_TTL_SECONDS);
  return payload;
}

function parseImportanceParam(raw: string | null): EventImportance | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return lower === 'high' || lower === 'medium' || lower === 'low' || lower === 'unknown' ? lower : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDateOrUndefined(raw: string | null, paramName: string): string | undefined {
  if (!raw) return undefined;
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new ApiError('INVALID_PARAMETER', `${paramName} must be a valid YYYY-MM-DD date`);
  }
  return raw;
}

function filtersFromUrl(url: URL): CalendarEventFilters {
  const params = url.searchParams;
  return {
    date: validDateOrUndefined(params.get('date'), 'date'),
    from: validDateOrUndefined(params.get('from'), 'from'),
    to: validDateOrUndefined(params.get('to'), 'to'),
    country: params.get('country')?.trim().toUpperCase() || undefined,
    currency: params.get('currency')?.trim().toUpperCase() || undefined,
    importance: parseImportanceParam(params.get('importance')),
    category: params.get('category')?.trim().toLowerCase() || undefined,
  };
}

/** GET /api/mkr/calendar/events - filters: date, from, to, country, currency, importance, category. */
export async function handleCalendarEvents(request: Request, env: Env): Promise<Response> {
  await requireCalendarEnabled(env);
  const filters = filtersFromUrl(new URL(request.url));
  // Every distinct filter combination is its own cache entry (versioned by
  // the exact filters) - the day/week convenience routes below use the
  // task's specified fixed key names instead.
  const cacheKey = `calendar:v1:events:${JSON.stringify(filters)}`;
  const payload = await cachedOrFetch(env, cacheKey, filters);
  return jsonResponse(payload);
}

/** GET /api/mkr/calendar/today - UTC calendar day. */
export async function handleCalendarToday(_request: Request, env: Env): Promise<Response> {
  await requireCalendarEnabled(env);
  const todayKey = new Date().toISOString().slice(0, 10);
  const payload = await cachedOrFetch(env, `calendar:v1:day:${todayKey}`, { date: todayKey });
  return jsonResponse(payload);
}

/** GET /api/mkr/calendar/week - the current ISO-8601 week (UTC-based, Mon-Sun), matching `calendar:v1:week:YYYY-Www`. */
export async function handleCalendarWeek(_request: Request, env: Env): Promise<Response> {
  await requireCalendarEnabled(env);
  const now = new Date();
  const { from, to } = weekBoundsUtc(now);
  const payload = await cachedOrFetch(env, `calendar:v1:week:${isoWeekKey(now)}`, { from, to });
  return jsonResponse(payload);
}

/** Monday-Sunday UTC week bounds (`to` inclusive) containing `now`. */
function weekBoundsUtc(now: Date): { from: string; to: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // 1=Mon .. 7=Sun
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayNum + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
