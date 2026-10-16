// minvest Worker: serves the static dashboard and a small authenticated JSON API in front of the
// Google Apps Script / Google Sheets backend. Deliberately separate from `mkr-backend`.
import { cookieName, createSessionToken, readCookie, safeEqual, sessionCookie, verifySessionToken } from './auth';
import { HttpError, type Env } from './types';
import { callScript, isConfigured } from './upstream';
import * as v from './validate';

export interface Deps { fetchImpl?: typeof fetch; now?: () => number }

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Robots-Tag': 'noindex, nofollow',
};

function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const h = new Headers(res.headers);
  for (const [k, val] of Object.entries({ ...SECURITY_HEADERS, ...extra })) h.set(k, val);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return withHeaders(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }), { 'Cache-Control': 'private, no-store', ...extra });
}
const ok = (data: unknown, extra?: Record<string, string>) => json(200, { ok: true, data }, extra);
const fail = (status: number, code: string, message: string, extra?: Record<string, string>) => json(status, { ok: false, error: { code, message } }, extra);

// Best-effort per-isolate fallback when the Workers Rate Limiting binding is unavailable (local dev/tests).
const memHits = new Map<string, number[]>();
async function allow(binding: RateLimit | undefined, key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  if (binding) {
    try { return (await binding.limit({ key })).success; } catch { /* fall back to memory */ }
  }
  const hits = (memHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { memHits.set(key, hits); return false; }
  hits.push(now); memHits.set(key, hits);
  if (memHits.size > 5000) memHits.clear();
  return true;
}
export function _resetRateLimitForTests() { memHits.clear(); }

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'ต้องส่งเป็น application/json');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'TOO_LARGE', 'ข้อมูลใหญ่เกินไป');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'TOO_LARGE', 'ข้อมูลใหญ่เกินไป');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'BAD_JSON', 'JSON ไม่ถูกต้อง'); }
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return serveStatic(request, env, url);
  try {
    return await api(request, env, url, deps);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message);
    console.error('minvest unhandled error'); // no payload/credentials in logs
    return fail(500, 'INTERNAL', 'เกิดข้อผิดพลาดภายในระบบ');
  }
}

async function serveStatic(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return withHeaders(new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }));
  const res = await env.ASSETS.fetch(request);
  const type = res.headers.get('content-type') ?? '';
  const noCache = /html|javascript|css|json/.test(type) || url.pathname === '/';
  return withHeaders(res, noCache ? { 'Cache-Control': 'no-cache' } : {});
}

async function api(request: Request, env: Env, url: URL, deps: Deps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const path = url.pathname;
  const method = request.method;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const isHttps = url.protocol === 'https:';

  if (method === 'OPTIONS') return fail(405, 'NO_CORS', 'same-origin only'); // no CORS is ever granted
  if (!(await allow(env.API_LIMITER, `api:${ip}`, 120, 60_000, now))) return fail(429, 'RATE_LIMITED', 'คำขอถี่เกินไป โปรดรอสักครู่', { 'Retry-After': '60' });

  const unsafe = method !== 'GET' && method !== 'HEAD';
  if (unsafe) {
    // CSRF: browsers always send Origin on cross-site POST/PUT; it must match this deployment exactly.
    if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'BAD_ORIGIN', 'คำขอไม่ได้มาจากหน้าเว็บของระบบนี้');
  }

  if (path === '/api/health' && method === 'GET') return ok({ service: 'minvest', configured: isConfigured(env) });

  if (path === '/api/login' && method === 'POST') {
    if (!isConfigured(env)) throw new HttpError(503, 'NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่ารหัสผ่านและการเชื่อมต่อ (ดูคู่มือ)');
    if (!(await allow(env.LOGIN_LIMITER, `login:${ip}`, 5, 60_000, now))) return fail(429, 'RATE_LIMITED', 'ลองเข้าสู่ระบบบ่อยเกินไป รอ 1 นาที', { 'Retry-After': '60' });
    const body = (await readJson(request, 2048)) as { password?: unknown };
    const pw = typeof body?.password === 'string' && body.password.length <= 256 ? body.password : '';
    const good = pw !== '' && (await safeEqual(pw, env.MINVEST_PASSWORD!, env.MINVEST_SESSION_SECRET!));
    if (!good) return fail(401, 'INVALID_CREDENTIALS', 'รหัสผ่านไม่ถูกต้อง');
    const ttl = Math.min(Math.max(Number(env.SESSION_TTL_SECONDS) || 43200, 600), 604800);
    const token = await createSessionToken(env.MINVEST_SESSION_SECRET!, ttl, now);
    return ok({ authenticated: true }, { 'Set-Cookie': sessionCookie(cookieName(isHttps), token, ttl, isHttps) });
  }
  if (path === '/api/logout' && method === 'POST') {
    return ok({ authenticated: false }, { 'Set-Cookie': sessionCookie(cookieName(isHttps), '', 0, isHttps) });
  }

  const authed = isConfigured(env) && (await verifySessionToken(env.MINVEST_SESSION_SECRET!, readCookie(request.headers.get('cookie'), cookieName(isHttps)), now));
  if (path === '/api/session' && method === 'GET') return ok({ authenticated: authed, configured: isConfigured(env) });
  if (!authed) return fail(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

  const f = deps.fetchImpl ?? fetch;
  const up = <T = unknown>(action: string, payload: unknown = {}) => callScript<T>(env, action, payload, f);

  if (path === '/api/dashboard' && method === 'GET') return ok(await up('getDashboardData'));
  if (path === '/api/daily' && method === 'GET') return ok(await up('listDaily', { includeVoid: url.searchParams.get('includeVoid') === '1' }));
  if (path === '/api/daily' && method === 'POST') return ok(await up('addDaily', v.parseDaily(await readJson(request, 8192), { requireRequestId: true })));
  const dailyMatch = /^\/api\/daily\/([0-9a-fA-F-]{36})(\/void)?$/.exec(path);
  if (dailyMatch) {
    const entryId = v.uuid(dailyMatch[1], 'entryId');
    const body = (await readJson(request, 8192)) as Record<string, unknown>;
    if (dailyMatch[2] && method === 'POST') return ok(await up('voidDaily', { entryId, expectedRevision: v.parseRevision(body?.expectedRevision) }));
    if (!dailyMatch[2] && method === 'PUT') return ok(await up('updateDaily', { ...v.parseDaily(body, { requireRequestId: false }), entryId, expectedRevision: v.parseRevision(body?.expectedRevision) }));
  }
  if (path === '/api/portfolio' && method === 'GET') return ok(await up('listPortfolio', { platform: v.oneOf(url.searchParams.get('platform'), v.PLATFORMS, 'แพลตฟอร์ม') }));
  if (path === '/api/portfolio' && method === 'POST') return ok(await up('addPortfolioValue', v.parsePortfolio(await readJson(request, 4096))));
  if (path === '/api/cashflows' && method === 'POST') return ok(await up('addCashflow', v.parseCashflow(await readJson(request, 4096))));
  if (path === '/api/settings' && method === 'PUT') return ok(await up('updateSettings', v.parseSettings(await readJson(request, 4096))));

  if (path === '/api/admin/health' && method === 'GET') return ok(await up('health'));
  if (path === '/api/admin/setup' && method === 'POST') return ok(await up('setup'));
  if (path === '/api/admin/rebuild' && method === 'POST') return ok(await up('rebuildDashboardData'));
  if (path === '/api/admin/import' && method === 'POST') {
    const parsed = v.parseImport(await readJson(request, 512 * 1024));
    return ok(await up(parsed.action, parsed.payload));
  }
  return fail(404, 'NOT_FOUND', 'ไม่พบ endpoint');
}

export default { fetch: (request: Request, env: Env) => handle(request, env) } satisfies ExportedHandler<Env>;
