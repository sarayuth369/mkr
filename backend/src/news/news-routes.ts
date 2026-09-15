import { cachedFetch } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import type { Env } from '../types';
import { FinnhubClient } from './finnhub-client';
import { parseFinnhubEconomicCalendar, parseFinnhubNews } from './finnhub-parser';

// News/calendar content doesn't need to be fresher than this - keeps
// Finnhub call volume low under real traffic (Finnhub's free tier is a
// shared, rate-limited resource just like Twelve Data's - see
// twelve-data-provider.ts's hard-won lessons from earlier this session).
const NEWS_TTL_SECONDS = 300;
const CALENDAR_TTL_SECONDS = 900;

async function requireNewsEnabled(env: Env): Promise<string> {
  const { featureFlags } = await getConfig(env);
  if (!featureFlags.newsEnabled) throw new ApiError('FEATURE_DISABLED', 'News is not enabled on this deployment.');
  if (!env.FINNHUB_API_KEY) throw new ApiError('FEATURE_DISABLED', 'News is not configured on this deployment.');
  return env.FINNHUB_API_KEY;
}

async function requireCalendarEnabled(env: Env): Promise<string> {
  const { featureFlags } = await getConfig(env);
  if (!featureFlags.economicCalendarEnabled) throw new ApiError('FEATURE_DISABLED', 'The economic calendar is not enabled on this deployment.');
  if (!env.FINNHUB_API_KEY) throw new ApiError('FEATURE_DISABLED', 'The economic calendar is not configured on this deployment.');
  return env.FINNHUB_API_KEY;
}

export async function handleNews(_request: Request, env: Env): Promise<Response> {
  const apiKey = await requireNewsEnabled(env);
  const { value } = await cachedFetch(env.MKR_CACHE, 'news:general', NEWS_TTL_SECONDS, async () => {
    const client = new FinnhubClient(apiKey);
    const json = await client.request('/news', { category: 'general' });
    return parseFinnhubNews(json);
  });
  return jsonResponse(value);
}

/** Filters the same cached general-news set by ticker/asset name rather
 * than issuing a second real Finnhub call per symbol - `related` is
 * already a client-visible field on every article. */
export async function handleNewsRelated(request: Request, env: Env): Promise<Response> {
  const apiKey = await requireNewsEnabled(env);
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim();
  if (!symbol) throw new ApiError('INVALID_PARAMETER', 'symbol query parameter is required');

  const { value } = await cachedFetch(env.MKR_CACHE, 'news:general', NEWS_TTL_SECONDS, async () => {
    const client = new FinnhubClient(apiKey);
    const json = await client.request('/news', { category: 'general' });
    return parseFinnhubNews(json);
  });
  const related = value.filter((a) => a.affectedAssets.some((asset) => asset.toLowerCase() === symbol.toLowerCase()));
  return jsonResponse(related);
}

export async function handleCalendarEvents(_request: Request, env: Env): Promise<Response> {
  const apiKey = await requireCalendarEnabled(env);
  const { value } = await cachedFetch(env.MKR_CACHE, 'calendar:events', CALENDAR_TTL_SECONDS, async () => {
    const client = new FinnhubClient(apiKey);
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const json = await client.request('/calendar/economic', { from, to });
    return parseFinnhubEconomicCalendar(json);
  });
  return jsonResponse(value);
}
