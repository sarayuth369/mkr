import { computeFreshness, mostRecentSuccessAt } from '../calendar/freshness';
import { calendarStoreFor } from '../calendar/store';
import { jsonResponse } from '../errors';
import type { Env } from '../types';

/**
 * Minimal Economic Calendar observability (task constraint: "Do not build
 * a large admin subsystem") - source status, last success/failure, event
 * counts, upcoming high-impact count, freshness. Reuses the existing
 * admin auth/rate-limit/routing (see index.ts's routeAdmin) rather than a
 * separate mechanism, same pattern as the Market Pool admin route.
 */
export async function handleAdminCalendar(_request: Request, env: Env): Promise<Response> {
  const store = calendarStoreFor(env);
  const [sources, allEvents] = await Promise.all([store.allSourceStates(), store.query({})]);

  const now = Date.now();
  const upcomingHighImportanceCount = allEvents.filter((e) => e.eventTimeUtc >= now && e.importance === 'high').length;

  return jsonResponse({
    freshness: computeFreshness(sources, allEvents.length > 0),
    lastUpdatedAt: mostRecentSuccessAt(sources),
    totalEventCount: allEvents.length,
    upcomingHighImportanceCount,
    sources,
  });
}
