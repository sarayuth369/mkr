import { refreshAlertIndex } from './alerts/alert-index';
import { handleAiAsk, handleAiAssetInsight, handleAiBrief, handleAiEventImpact, handleAiNewsSummary } from './ai/ai-routes';
import { handleVerifyPurchase } from './billing/verify-purchase-route';
import { handlePrivacyPage } from './pages/privacy-page';
import { handleAppAdsTxt } from './pages/app-ads-txt';
import { handleDeveloperWebsite } from './pages/developer-website-page';
import {
  handleAdminAuditLog,
  handleAdminCacheGet,
  handleAdminCacheUpdate,
  handleAdminDashboard,
  handleAdminFeaturesGet,
  handleAdminFeaturesUpdate,
  handleAdminHealth,
  handleAdminLogin,
  handleAdminLogs,
  handleAdminProvidersGet,
  handleAdminProvidersUpdate,
  handleAdminRateLimitsGet,
  handleAdminRateLimitsUpdate,
  handleAdminSettings,
  handleAdminSymbolsBulkUpdate,
  handleAdminSymbolsGet,
  handleAdminSymbolsUpdate,
} from './admin/admin-routes';
import { handleAdminAlertsGet, handleAdminAlertToggle, handleAdminNotificationLogs, handleAdminSubscriptionsGet } from './admin/admin-alerts-routes';
import { requireAdmin } from './admin/auth';
import { handleAdminPushAnnouncement, handleAdminPushTest } from './admin/admin-push-routes';
import {
  handleAdminUserDelete,
  handleAdminUserDetail,
  handleAdminUsersGet,
  handleAdminUserSuspend,
  handleAdminUserUnsuspend,
  handleAdminUserUpdate,
} from './admin/admin-users-routes';
import { handleAdminCalendar } from './admin/admin-calendar-routes';
import { handleAdminAlpacaCapabilityTest } from './admin/admin-alpaca-capability-routes';
import { handleAdminCatalogDiscoveryReference, handleAdminCatalogDiscoveryVerify } from './admin/admin-catalog-discovery-routes';
import { handleCalendarEvents, handleCalendarToday, handleCalendarWeek } from './calendar/calendar-routes';
import { runCalendarIngestion } from './calendar/ingestion';
import { adminCorsHeaders, publicCorsHeaders } from './cors';
import { ApiError, errorResponse } from './errors';
import { handleHealth, handleVersion } from './health';
import { logError } from './logging';
import { handleCandles, handleMarketHealth, handleMarketStatus, handleMarketSymbols, handleQuote, handleQuotes } from './market/market-routes';
import { handleNews, handleNewsRelated } from './news/news-routes';
import { checkRateLimit, clientKeyFromRequest, rateLimitedResponse, rateLimitEnv } from './ratelimit';
import type { Env } from './types';
import { fetchPoolStatus, triggerAlertRefSync } from './ws/market-stream-do';
import { handleMarketStream } from './ws/ws-routes';

export { MarketStreamRoom } from './ws/market-stream-do';
export { RateLimiterRoom } from './ratelimit-do';

const CALENDAR_INGESTION_CRON = '0 */6 * * *';

function requestId(): string {
  return crypto.randomUUID();
}

async function routeAdmin(request: Request, env: Env, path: string, id: string): Promise<Response> {
  // Login is the one admin endpoint that must work without a session token
  // yet - but it gets a much stricter rate limit to resist brute-forcing.
  if (path === '/api/mkr/admin/login' && request.method === 'POST') {
    const key = `admin-login:${clientKeyFromRequest(request)}`;
    const limit = await checkRateLimit(env.RATE_LIMITER, key, 5, 60);
    if (!limit.allowed) return rateLimitedResponse(limit);
    return handleAdminLogin(request, env);
  }

  await requireAdmin(request, env);
  const { limit: adminLimit } = rateLimitEnv(env, 'admin');
  const rl = await checkRateLimit(env.RATE_LIMITER, `admin:${clientKeyFromRequest(request)}`, adminLimit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  // A real per-admin identity would come from the session token/SSO once
  // multi-admin support exists; for now there is one shared admin login.
  const actor = 'admin';

  if (path === '/api/mkr/admin/dashboard' && request.method === 'GET') return handleAdminDashboard(request, env);
  if (path === '/api/mkr/admin/providers' && request.method === 'GET') return handleAdminProvidersGet(request, env);
  if (path === '/api/mkr/admin/providers' && request.method === 'POST') return handleAdminProvidersUpdate(request, env, actor);
  if (path === '/api/mkr/admin/symbols' && request.method === 'GET') return handleAdminSymbolsGet(request, env);
  if (path === '/api/mkr/admin/symbols' && request.method === 'POST') return handleAdminSymbolsUpdate(request, env, actor);
  if (path === '/api/mkr/admin/symbols/bulk' && request.method === 'POST') return handleAdminSymbolsBulkUpdate(request, env, actor);
  if (path === '/api/mkr/admin/audit-log' && request.method === 'GET') return handleAdminAuditLog(request, env);
  if (path === '/api/mkr/admin/cache' && request.method === 'GET') return handleAdminCacheGet(request, env);
  if (path === '/api/mkr/admin/cache' && request.method === 'POST') return handleAdminCacheUpdate(request, env, actor);
  if (path === '/api/mkr/admin/rate-limits' && request.method === 'GET') return handleAdminRateLimitsGet(request, env);
  if (path === '/api/mkr/admin/rate-limits' && request.method === 'POST') return handleAdminRateLimitsUpdate(request, env, actor);
  if (path === '/api/mkr/admin/features' && request.method === 'GET') return handleAdminFeaturesGet(request, env);
  if (path === '/api/mkr/admin/features' && request.method === 'POST') return handleAdminFeaturesUpdate(request, env, actor);
  if (path === '/api/mkr/admin/health' && request.method === 'GET') return handleAdminHealth(request, env);
  if (path === '/api/mkr/admin/logs' && request.method === 'GET') return handleAdminLogs(request, env);
  if (path === '/api/mkr/admin/settings' && request.method === 'GET') return handleAdminSettings(request, env);

  // Phase 2.4 admin expansion - every route below fails safely with
  // { configured: false } when Supabase isn't set up, rather than erroring.
  if (path === '/api/mkr/admin/users' && request.method === 'GET') return handleAdminUsersGet(request, env);
  if (path.startsWith('/api/mkr/admin/users/')) {
    const rest = decodeURIComponent(path.slice('/api/mkr/admin/users/'.length));
    const [userId, action] = rest.split('/');
    if (userId && !action && request.method === 'GET') return handleAdminUserDetail(request, env, userId);
    if (userId && !action && request.method === 'PATCH') return handleAdminUserUpdate(request, env, userId, actor);
    if (userId && !action && request.method === 'DELETE') return handleAdminUserDelete(request, env, userId, actor);
    if (userId && action === 'suspend' && request.method === 'POST') return handleAdminUserSuspend(request, env, userId, actor);
    if (userId && action === 'unsuspend' && request.method === 'POST') return handleAdminUserUnsuspend(request, env, userId, actor);
  }
  if (path === '/api/mkr/admin/alerts' && request.method === 'GET') return handleAdminAlertsGet(request, env);
  if (path === '/api/mkr/admin/alerts/toggle' && request.method === 'POST') return handleAdminAlertToggle(request, env, actor);
  if (path === '/api/mkr/admin/push/test' && request.method === 'POST') return handleAdminPushTest(request, env, actor);
  if (path === '/api/mkr/admin/push/announcement' && request.method === 'POST') return handleAdminPushAnnouncement(request, env, actor);
  if (path === '/api/mkr/admin/notification-logs' && request.method === 'GET') return handleAdminNotificationLogs(request, env);
  if (path === '/api/mkr/admin/subscriptions' && request.method === 'GET') return handleAdminSubscriptionsGet(request, env);

  // Phase 11 (partial) - Market Pool observability, reusing the existing
  // admin auth/routing rather than a separate endpoint/auth mechanism.
  if (path === '/api/mkr/admin/market-pool' && request.method === 'GET') {
    const status = await fetchPoolStatus(env);
    return new Response(JSON.stringify({ success: true, data: status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Economic Calendar observability (2026-09-15 hybrid-architecture task) -
  // source status, last success/failure, event counts - minimal, reusing
  // the existing admin auth/routing rather than a separate subsystem.
  if (path === '/api/mkr/admin/calendar' && request.method === 'GET') return handleAdminCalendar(request, env);

  // Hybrid Provider Architecture task (2026-09-16), item 4 - real,
  // sequential Alpaca capability test against a small representative
  // symbol set, gated by the SAME admin auth as every other route here.
  // Read-only: makes real Alpaca REST calls but never changes any config
  // or routing flag - see admin-alpaca-capability-routes.ts's own doc
  // comment.
  if (path === '/api/mkr/admin/alpaca-capability-test' && request.method === 'GET') return handleAdminAlpacaCapabilityTest(request, env);

  // 2026-09-17 Catalog Expansion task - real, bounded, sequential candidate
  // verification against Twelve Data/Alpaca before any new catalog row is
  // enabled - see admin-catalog-discovery-routes.ts's own doc comment.
  if (path === '/api/mkr/admin/catalog-discovery/verify' && request.method === 'POST') return handleAdminCatalogDiscoveryVerify(request, env);
  if (path === '/api/mkr/admin/catalog-discovery/reference' && request.method === 'GET') return handleAdminCatalogDiscoveryReference(request, env);

  throw new ApiError('NOT_FOUND', `No admin route for ${request.method} ${path}`);
}

async function routeCalendar(request: Request, env: Env, path: string): Promise<Response> {
  const { limit } = rateLimitEnv(env, 'public');
  const rl = await checkRateLimit(env.RATE_LIMITER, `public:${clientKeyFromRequest(request)}`, limit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  if (path === '/api/mkr/calendar/events' && request.method === 'GET') return handleCalendarEvents(request, env);
  if (path === '/api/mkr/calendar/today' && request.method === 'GET') return handleCalendarToday(request, env);
  if (path === '/api/mkr/calendar/week' && request.method === 'GET') return handleCalendarWeek(request, env);

  throw new ApiError('NOT_FOUND', `No calendar route for ${request.method} ${path}`);
}

async function routeMarket(request: Request, env: Env, path: string, id: string): Promise<Response> {
  // '/api/mkr/market/stream' is intercepted earlier in fetch(), before this
  // function is ever called - see the comment there for why.
  const { limit } = rateLimitEnv(env, 'public');
  const rl = await checkRateLimit(env.RATE_LIMITER, `public:${clientKeyFromRequest(request)}`, limit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  if (path === '/api/mkr/market/quote') return handleQuote(request, env, id);
  if (path === '/api/mkr/market/quotes') return handleQuotes(request, env, id);
  if (path === '/api/mkr/market/candles') return handleCandles(request, env, id);
  if (path === '/api/mkr/market/status') return handleMarketStatus(request, env, id);
  if (path === '/api/mkr/market/health') return handleMarketHealth(request, env, id);
  if (path === '/api/mkr/market/symbols') return handleMarketSymbols(request, env, id);

  throw new ApiError('NOT_FOUND', `No market route for ${request.method} ${path}`);
}

async function routeAi(request: Request, env: Env, path: string, id: string): Promise<Response> {
  // Same public rate limit bucket as market routes - AI calls are heavier
  // per-request (LLM inference) but the abuse surface is identical (any
  // client, no auth), so there is no reason to give it a separate budget.
  const { limit } = rateLimitEnv(env, 'public');
  const rl = await checkRateLimit(env.RATE_LIMITER, `public:${clientKeyFromRequest(request)}`, limit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  if (path === '/api/mkr/ai/brief' && request.method === 'POST') return handleAiBrief(request, env, id);
  if (path === '/api/mkr/ai/asset-insight' && request.method === 'POST') return handleAiAssetInsight(request, env, id);
  if (path === '/api/mkr/ai/news-summary' && request.method === 'POST') return handleAiNewsSummary(request, env, id);
  if (path === '/api/mkr/ai/event-impact' && request.method === 'POST') return handleAiEventImpact(request, env, id);
  if (path === '/api/mkr/ai/ask' && request.method === 'POST') return handleAiAsk(request, env, id);

  throw new ApiError('NOT_FOUND', `No AI route for ${request.method} ${path}`);
}

async function routeNews(request: Request, env: Env, path: string): Promise<Response> {
  const { limit } = rateLimitEnv(env, 'public');
  const rl = await checkRateLimit(env.RATE_LIMITER, `public:${clientKeyFromRequest(request)}`, limit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  if (path === '/api/mkr/news' && request.method === 'GET') return handleNews(request, env);
  if (path === '/api/mkr/news/related' && request.method === 'GET') return handleNewsRelated(request, env);

  throw new ApiError('NOT_FOUND', `No news route for ${request.method} ${path}`);
}

/**
 * 2026-09-17 AdMob + Billing task - see verify-purchase-route.ts's own doc
 * comment for why this honestly reports "not configured" rather than a
 * real check (no Google Play Developer API service account exists yet).
 * Same public rate-limit bucket as every other client-facing route.
 */
async function routeBilling(request: Request, env: Env, path: string, id: string): Promise<Response> {
  const { limit } = rateLimitEnv(env, 'public');
  const rl = await checkRateLimit(env.RATE_LIMITER, `public:${clientKeyFromRequest(request)}`, limit, 60);
  if (!rl.allowed) return rateLimitedResponse(rl);

  if (path === '/api/mkr/billing/verify-purchase' && request.method === 'POST') return handleVerifyPurchase(request, env, id);

  throw new ApiError('NOT_FOUND', `No billing route for ${request.method} ${path}`);
}

export default {
  /** Two independent cron schedules share this one handler (wrangler.toml
   * [triggers]), distinguished by `event.cron`:
   * - every minute: refreshes the Alert Engine's KV-cached alert index
   *   (alerts/alert-index.ts) - a no-op when Supabase isn't configured.
   *   Keeps tick evaluation in market-stream-do.ts reading only KV, never
   *   querying Supabase per tick.
   * - every 6 hours: re-runs Economic Calendar ingestion
   *   (calendar/ingestion.ts) - cheap (the curated provider does no
   *   network I/O at all) and idempotent, so this just keeps D1 in sync
   *   with the curated dataset/any future live provider without a
   *   per-request cost. */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === CALENDAR_INGESTION_CRON) {
      ctx.waitUntil(
        runCalendarIngestion(env, []).catch((err) => logError('calendar ingestion cron failed', { message: (err as Error).message })),
      );
      return;
    }
    ctx.waitUntil(
      refreshAlertIndex(env)
        .then(() => triggerAlertRefSync(env))
        .then(() => undefined),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    const path = url.pathname;
    const isAdminRoute = path.startsWith('/api/mkr/admin/');
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      const headers = isAdminRoute ? adminCorsHeaders(origin, env.ADMIN_WEB_ORIGIN) : publicCorsHeaders();
      return new Response(null, { status: 204, headers });
    }

    // The WebSocket upgrade response (HTTP 101, carrying a `webSocket` pair)
    // must be returned untouched - mutating its headers afterward (adding
    // CORS/X-Request-Id below) breaks the handshake and the client sees an
    // immediate abnormal close (code 1006). Confirmed against the live
    // deployment, not a theoretical concern.
    if (path === '/api/mkr/market/stream') {
      return handleMarketStream(request, env);
    }

    // 2026-09-17 Hosted Privacy Policy task - a plain public webpage, not
    // an `/api/mkr/*` JSON endpoint: no auth, no CORS envelope, no request
    // ID header needed (this is a normal browser page load, not a
    // cross-origin API fetch) - returned directly, ahead of the JSON
    // try/catch below, same as the WebSocket upgrade case above.
    if (path === '/privacy' && request.method === 'GET') {
      return handlePrivacyPage();
    }

    // 2026-09-18 app-ads.txt + Developer Website task - same reasoning as
    // /privacy above: plain public pages, not `/api/mkr/*` JSON endpoints,
    // returned directly ahead of the JSON try/catch. `/app-ads.txt` must be
    // plain text with no auth/redirect/JSON wrapper per the IAB spec and
    // AdMob's crawler requirements; `/` is the Developer Website root Play
    // Console needs on record for that crawler to trust app-ads.txt at all.
    if (path === '/app-ads.txt' && request.method === 'GET') {
      return handleAppAdsTxt();
    }

    if (path === '/' && request.method === 'GET') {
      return handleDeveloperWebsite();
    }

    try {
      let response: Response;

      if (path === '/api/mkr/health') response = handleHealth();
      else if (path === '/api/mkr/version') response = handleVersion();
      else if (path.startsWith('/api/mkr/market/')) response = await routeMarket(request, env, path, id);
      else if (path.startsWith('/api/mkr/ai/')) response = await routeAi(request, env, path, id);
      else if (path === '/api/mkr/news' || path === '/api/mkr/news/related') response = await routeNews(request, env, path);
      else if (path.startsWith('/api/mkr/calendar/')) response = await routeCalendar(request, env, path);
      else if (path.startsWith('/api/mkr/billing/')) response = await routeBilling(request, env, path, id);
      else if (isAdminRoute) response = await routeAdmin(request, env, path, id);
      else throw new ApiError('NOT_FOUND', `No route for ${request.method} ${path}`);

      const corsHeaders = isAdminRoute ? adminCorsHeaders(origin, env.ADMIN_WEB_ORIGIN) : publicCorsHeaders();
      for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      response.headers.set('X-Request-Id', id);
      return response;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError('INTERNAL_ERROR', 'Unexpected server error.');
      if (apiError.code === 'INTERNAL_ERROR') {
        logError('unhandled error', { requestId: id, route: path, message: (err as Error).message });
      }
      const corsHeaders = isAdminRoute ? adminCorsHeaders(origin, env.ADMIN_WEB_ORIGIN) : publicCorsHeaders();
      const response = errorResponse(apiError, corsHeaders);
      response.headers.set('X-Request-Id', id);
      return response;
    }
  },
};
