// minvest Worker: serves the static dashboard and a small authenticated JSON API in front of the
// Google Apps Script / Google Sheets backend. Deliberately separate from `mkr-backend`.
import { cookieName, createSessionToken, readCookie, readSessionToken, safeEqual, sessionCookie } from './auth';
import { HttpError, type Env } from './types';
import { callScript, isConfigured } from './upstream';
import * as v from './validate';

export { AuthStore } from './auth-store';
export { FxStore } from './fx-store';

export interface Deps { fetchImpl?: typeof fetch; now?: () => number }

/** Call a Durable Object by name; the DO is the single source of truth for password hash / session version / FX cache. */
async function doCall<T>(ns: DurableObjectNamespace, name: string, path: string, body?: unknown): Promise<T> {
  const res = await ns.get(ns.idFromName(name)).fetch(`https://do.internal${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
  return (await res.json()) as T;
}
interface VerifyResult { ok: boolean; ver?: number; locked?: boolean; retryAfter?: number }
interface ChangeResult { ok: boolean; ver?: number; locked?: boolean; retryAfter?: number; code?: string; reasons?: string[] }
const FX_UNAVAILABLE = { status: 'unavailable', error: 'ยังไม่ได้เปิดใช้บริการอัตราแลกเปลี่ยน' };

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
    if (pw === '') return fail(401, 'INVALID_CREDENTIALS', 'รหัสผ่านไม่ถูกต้อง');
    let ver = 0;
    if (env.AUTH_STORE) {
      const r = await doCall<VerifyResult>(env.AUTH_STORE, 'owner', '/verify', { password: pw });
      if (r.locked) return fail(429, 'LOCKED', 'ลองรหัสผิดหลายครั้ง ระบบล็อกชั่วคราว โปรดลองใหม่ภายหลัง', { 'Retry-After': String(r.retryAfter ?? 900) });
      if (!r.ok) return fail(401, 'INVALID_CREDENTIALS', 'รหัสผ่านไม่ถูกต้อง');
      ver = r.ver ?? 0;
    } else if (!(await safeEqual(pw, env.MINVEST_PASSWORD!, env.MINVEST_SESSION_SECRET!))) {
      return fail(401, 'INVALID_CREDENTIALS', 'รหัสผ่านไม่ถูกต้อง');
    }
    const ttl = Math.min(Math.max(Number(env.SESSION_TTL_SECONDS) || 43200, 600), 604800);
    const token = await createSessionToken(env.MINVEST_SESSION_SECRET!, ttl, now, ver);
    return ok({ authenticated: true }, { 'Set-Cookie': sessionCookie(cookieName(isHttps), token, ttl, isHttps) });
  }
  if (path === '/api/logout' && method === 'POST') {
    return ok({ authenticated: false }, { 'Set-Cookie': sessionCookie(cookieName(isHttps), '', 0, isHttps) });
  }

  const sess = isConfigured(env) ? await readSessionToken(env.MINVEST_SESSION_SECRET!, readCookie(request.headers.get('cookie'), cookieName(isHttps)), now) : null;
  let authed = sess !== null;
  let passwordSource: 'env' | 'stored' = 'env';
  if (sess && env.AUTH_STORE) {
    // A password change bumps the stored version: any session issued under an older version is dead.
    const s = await doCall<{ ver: number; source: 'env' | 'stored' }>(env.AUTH_STORE, 'owner', '/session');
    authed = s.ver === sess.ver;
    passwordSource = s.source;
  }
  if (path === '/api/session' && method === 'GET') return ok({ authenticated: authed, configured: isConfigured(env), ...(authed ? { passwordSource, passwordChangeAvailable: Boolean(env.AUTH_STORE) } : {}) });
  if (!authed) return fail(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

  const f = deps.fetchImpl ?? fetch;
  const up = <T = unknown>(action: string, payload: unknown = {}) => callScript<T>(env, action, payload, f);

  if (path === '/api/password/change' && method === 'POST') {
    if (!env.AUTH_STORE) throw new HttpError(503, 'NOT_AVAILABLE', 'ยังไม่ได้เปิดใช้ที่เก็บรหัสผ่านถาวร (Durable Object) จึงเปลี่ยนรหัสผ่านจากหน้าเว็บไม่ได้');
    if (!(await allow(env.LOGIN_LIMITER, `pwchange:${ip}`, 5, 60_000, now))) return fail(429, 'RATE_LIMITED', 'ลองเปลี่ยนรหัสผ่านบ่อยเกินไป รอ 1 นาที', { 'Retry-After': '60' });
    const { current, next } = v.parsePasswordChange(await readJson(request, 2048));
    const r = await doCall<ChangeResult>(env.AUTH_STORE, 'owner', '/change', { current, next });
    if (r.locked) return fail(429, 'LOCKED', 'ลองรหัสผิดหลายครั้ง ระบบล็อกชั่วคราว โปรดลองใหม่ภายหลัง', { 'Retry-After': String(r.retryAfter ?? 900) });
    if (!r.ok) {
      if (r.code === 'INVALID_CURRENT') return fail(403, 'INVALID_CURRENT', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (r.code === 'SAME_PASSWORD') return fail(400, 'SAME_PASSWORD', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
      if (r.code === 'WEAK_PASSWORD') return fail(400, 'WEAK_PASSWORD', `รหัสผ่านใหม่ไม่ปลอดภัยพอ: ${(r.reasons ?? []).join(' / ')}`);
      throw new HttpError(500, 'INTERNAL', 'เกิดข้อผิดพลาดภายในระบบ');
    }
    // Keep THIS browser signed in under the new version; every other session is now invalid.
    const ttl = Math.min(Math.max(Number(env.SESSION_TTL_SECONDS) || 43200, 600), 604800);
    const token = await createSessionToken(env.MINVEST_SESSION_SECRET!, ttl, now, r.ver ?? 0);
    return ok({ changed: true, otherSessionsSignedOut: true }, { 'Set-Cookie': sessionCookie(cookieName(isHttps), token, ttl, isHttps) });
  }

  if (path === '/api/fx' && method === 'GET') return ok(env.FX_STORE ? await doCall(env.FX_STORE, 'usdthb', '/latest') : FX_UNAVAILABLE);
  if (path === '/api/fx/refresh' && method === 'POST') return ok(env.FX_STORE ? await doCall(env.FX_STORE, 'usdthb', '/latest?force=1') : FX_UNAVAILABLE);
  if (path === '/api/fx/history' && method === 'GET') {
    const from = v.dateStr(url.searchParams.get('from'), 'from'), to = v.dateStr(url.searchParams.get('to'), 'to');
    if (from > to) throw new HttpError(400, 'VALIDATION', 'ช่วงวันที่ไม่ถูกต้อง');
    return ok(env.FX_STORE ? await doCall(env.FX_STORE, 'usdthb', `/history?from=${from}&to=${to}`) : FX_UNAVAILABLE);
  }

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
  const recMatch = /^\/api\/portfolio\/(dime|stashaway|webull)\/([0-9a-fA-F-]{32,36})(\/void|\/restore)?$/.exec(path);
  if (recMatch) {
    const platform = recMatch[1]!, recordId = v.recordId(recMatch[2]);
    if (!recMatch[3] && method === 'PUT') return ok(await up('updatePortfolioRecord', { platform, recordId, ...v.parsePortfolioEdit(await readJson(request, 4096)) }));
    if (recMatch[3] && method === 'POST') {
      const body = (await readJson(request, 1024)) as Record<string, unknown>;
      return ok(await up(recMatch[3] === '/void' ? 'voidPortfolioRecord' : 'restorePortfolioRecord', { platform, recordId, expectedRevision: v.parseRevision(body?.expectedRevision) }));
    }
  }
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
