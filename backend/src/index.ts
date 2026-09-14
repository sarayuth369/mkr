import { refreshAlertIndex } from './alerts/alert-index';
import {
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
import { adminCorsHeaders, publicCorsHeaders } from './cors';
import { ApiError, errorResponse } from './errors';
import { handleHealth, handleVersion } from './health';
import { logError } from './logging';
import { handleCandles, handleMarketHealth, handleMarketStatus, handleQuote, handleQuotes } from './market/market-routes';
import { checkRateLimit, clientKeyFromRequest, rateLimitedResponse, rateLimitEnv } from './ratelimit';
import type { Env } from './types';
import { fetchPoolStatus, triggerAlertRefSync } from './ws/market-stream-do';
import { handleMarketStream } from './ws/ws-routes';

export { MarketStreamRoom } from './ws/market-stream-do';
export { RateLimiterRoom } from './ratelimit-do';

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

  throw new ApiError('NOT_FOUND', `No admin route for ${request.method} ${path}`);
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

  throw new ApiError('NOT_FOUND', `No market route for ${request.method} ${path}`);
}

export default {
  /** Refreshes the Alert Engine's KV-cached alert index (see alerts/alert-index.ts)
   * every minute (see wrangler.toml [triggers]) - a no-op when Supabase isn't
   * configured. This keeps tick evaluation in market-stream-do.ts reading
   * only KV, never querying Supabase per tick. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
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

    try {
      let response: Response;

      if (path === '/api/mkr/health') response = handleHealth();
      else if (path === '/api/mkr/version') response = handleVersion();
      else if (path.startsWith('/api/mkr/market/')) response = await routeMarket(request, env, path, id);
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
