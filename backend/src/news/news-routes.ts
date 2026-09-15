import { cachedFetch } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import type { Env } from '../types';
import { FinnhubClient } from './finnhub-client';
import { parseFinnhubNews } from './finnhub-parser';

// News content doesn't need to be fresher than this - keeps Finnhub call
// volume low under real traffic (Finnhub's free tier is a shared,
// rate-limited resource just like Twelve Data's - see
// twelve-data-provider.ts's hard-won lessons from earlier this session).
// Economic Calendar has moved to its own module (src/calendar/) - see
// calendar-routes.ts - since Finnhub's economic-calendar endpoint is a
// paid-plan-only feature ("Economic Calendar Premium") never actually
// callable from this codebase's account.
const NEWS_TTL_SECONDS = 300;

async function requireNewsEnabled(env: Env): Promise<string> {
  const { featureFlags } = await getConfig(env);
  if (!featureFlags.newsEnabled) throw new ApiError('FEATURE_DISABLED', 'News is not enabled on this deployment.');
  if (!env.FINNHUB_API_KEY) throw new ApiError('FEATURE_DISABLED', 'News is not configured on this deployment.');
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
