// Worker tests. The upstream is the in-memory Apps Script MOCK (see gas-mock.mjs) - these prove the Worker's
// auth/validation/contract logic, NOT a live Google Sheets connection.
import { describe, expect, it, beforeEach } from 'vitest';
import { handle, _resetRateLimitForTests } from '../src/index.ts';
import { createSessionToken, verifySessionToken } from '../src/auth.ts';
import { createGas } from './gas-mock.mjs';

const ORIGIN = 'https://minvest.example.workers.dev';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxTESTTESTTEST/exec';
const SCRIPT_SECRET = 'test-secret-0123456789-abcdefghij';
const U = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

let gas, calls, env;
const upstream = async (_url, init) => {
  const b = JSON.parse(init.body); calls.push(b.action);
  return new Response(JSON.stringify(gas.call(b.action, b.payload, b.secret)), { headers: { 'content-type': 'application/json' } });
};
const mkEnv = (over = {}) => ({
  ASSETS: { fetch: async () => new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } }) },
  MINVEST_PASSWORD: 'correct horse battery', MINVEST_SESSION_SECRET: 'session-secret-abcdefghijklmnopqrstuvwxyz-0123456789',
  MINVEST_SCRIPT_URL: SCRIPT_URL, MINVEST_SCRIPT_SECRET: SCRIPT_SECRET, ...over,
});
const req = (path, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} } = {}) =>
  new Request(ORIGIN + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), 'cf-connecting-ip': '1.2.3.4', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const run = (r, e = env) => handle(r, e, { fetchImpl: upstream });
async function login(e = env) {
  const res = await run(req('/api/login', { method: 'POST', body: { password: 'correct horse battery' } }), e);
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie').split(';')[0];
}

beforeEach(() => { gas = createGas({ secret: SCRIPT_SECRET }); gas.call('setup'); calls = []; env = mkEnv(); _resetRateLimitForTests(); });

describe('static + headers', () => {
  it('serves the shell with strict security headers', async () => {
    const res = await run(req('/', { origin: null }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('rejects non-GET on static paths', async () => { expect((await run(req('/', { method: 'POST', body: {} }))).status).toBe(405); });
  it('grants no CORS and API responses are never cacheable', async () => {
    const pre = await run(req('/api/dashboard', { method: 'OPTIONS' }));
    expect(pre.status).toBe(405); expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const res = await run(req('/api/health', { origin: null }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('auth', () => {
  it('health is public but reveals only whether it is configured', async () => {
    const res = await run(req('/api/health', { origin: null }));
    expect(await res.json()).toEqual({ ok: true, data: { service: 'minvest', configured: true } });
    const un = await run(req('/api/health', { origin: null }), mkEnv({ MINVEST_SCRIPT_URL: undefined }));
    expect((await un.json()).data.configured).toBe(false);
  });
  it('refuses to log in when secrets are not configured (503, not an open door)', async () => {
    const res = await run(req('/api/login', { method: 'POST', body: { password: 'x' } }), mkEnv({ MINVEST_PASSWORD: undefined }));
    expect(res.status).toBe(503);
  });
  it('rejects wrong password; accepts the right one with a hardened cookie', async () => {
    expect((await run(req('/api/login', { method: 'POST', body: { password: 'nope' } }))).status).toBe(401);
    const ok = await run(req('/api/login', { method: 'POST', body: { password: 'correct horse battery' } }));
    const cookie = ok.headers.get('set-cookie');
    expect(cookie).toMatch(/^__Host-minvest_session=/);
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) expect(cookie).toContain(flag);
    expect(JSON.stringify(await ok.json())).not.toContain('correct horse');
  });
  it('CSRF: state-changing calls need a same-origin Origin header', async () => {
    expect((await run(req('/api/login', { method: 'POST', body: { password: 'x' }, origin: null }))).status).toBe(403);
    expect((await run(req('/api/login', { method: 'POST', body: { password: 'x' }, origin: 'https://evil.example' }))).status).toBe(403);
  });
  it('requires JSON content-type and bounded body size', async () => {
    const r = new Request(ORIGIN + '/api/login', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: 'password=x' });
    expect((await run(r)).status).toBe(415);
    const big = await run(req('/api/login', { method: 'POST', body: { password: 'x'.repeat(5000) } }));
    expect(big.status).toBe(413);
  });
  it('rate limits login attempts (5/min) then returns 429', async () => {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await run(req('/api/login', { method: 'POST', body: { password: 'wrong' + i } }))).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]); expect(codes.slice(5)).toEqual([429, 429]);
  });
  it('session cookie: valid works, tampered/expired/garbage do not', async () => {
    const cookie = await login();
    const s = await (await run(req('/api/session', { cookie }))).json();
    expect(s.data.authenticated).toBe(true);
    const tampered = cookie.slice(0, -3) + 'AAA';
    expect((await (await run(req('/api/session', { cookie: tampered }))).json()).data.authenticated).toBe(false);
    expect((await (await run(req('/api/session', { cookie: '__Host-minvest_session=garbage' }))).json()).data.authenticated).toBe(false);
    const secret = env.MINVEST_SESSION_SECRET;
    const old = await createSessionToken(secret, 60, Date.now() - 120_000);
    expect(await verifySessionToken(secret, old)).toBe(false);
    expect(await verifySessionToken('other-secret-other-secret-other-secret', await createSessionToken(secret, 60))).toBe(false);
  });
  it('every data endpoint is 401 without a session and never reaches the upstream', async () => {
    const targets = [['GET', '/api/dashboard'], ['GET', '/api/daily'], ['POST', '/api/daily'], ['PUT', `/api/daily/${U(1)}`], ['POST', `/api/daily/${U(1)}/void`], ['GET', '/api/portfolio?platform=dime'],
      ['POST', '/api/portfolio'], ['POST', '/api/cashflows'], ['PUT', '/api/settings'], ['GET', '/api/admin/health'], ['POST', '/api/admin/setup'], ['POST', '/api/admin/import'], ['POST', '/api/admin/rebuild']];
    for (const [method, path] of targets) {
      const res = await run(req(path, { method, body: method === 'GET' ? undefined : {} }));
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(calls).toEqual([]);
  });
  it('logout clears the cookie', async () => {
    const res = await run(req('/api/logout', { method: 'POST', body: {} }));
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('authenticated flows (Worker -> Apps Script mock)', () => {
  let cookie;
  beforeEach(async () => { cookie = await login(); });
  const post = (path, body, method = 'POST') => run(req(path, { method, body, cookie }));

  it('adds a daily entry; blank stays blank; double submit does not duplicate', async () => {
    const body = { requestId: U(1), dime: '-120.50', stashaway: '', webull: 0, type: 'profit_loss', note: 'ทดสอบ' };
    const a = await (await post('/api/daily', body)).json();
    const b = await (await post('/api/daily', body)).json();
    expect(a.data.entry).toMatchObject({ dime: -120.5, stashaway: null, webull: 0, type: 'profit_loss' });
    expect(a.data.duplicate).toBe(false); expect(b.data.duplicate).toBe(true);
    expect((await (await run(req('/api/daily', { cookie }))).json()).data.entries).toHaveLength(1);
  });
  it('invalid input is rejected at the Worker and never forwarded', async () => {
    calls.length = 0;
    for (const bad of [{ requestId: U(1), dime: 'abc', type: 'profit_loss' }, { requestId: U(1), type: 'profit_loss' }, { requestId: 'x', dime: 1, type: 'profit_loss' }, { requestId: U(1), dime: 1, type: 'income' }, { requestId: U(1), dime: 1.234, type: 'profit_loss' }, { requestId: U(1), dime: 1, type: 'profit_loss', entryDate: '2026-02-30' }]) {
      const res = await post('/api/daily', bad);
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
  it('edit uses revision; stale edit is a 409; void removes it from the list', async () => {
    const e = (await (await post('/api/daily', { requestId: U(2), dime: 5, type: 'profit_loss' })).json()).data.entry;
    const ok = await post(`/api/daily/${e.entryId}`, { dime: 6, type: 'cash_received', expectedRevision: 1 }, 'PUT');
    expect(ok.status).toBe(200);
    expect((await post(`/api/daily/${e.entryId}`, { dime: 7, type: 'profit_loss', expectedRevision: 1 }, 'PUT')).status).toBe(409);
    expect((await post(`/api/daily/${e.entryId}/void`, { expectedRevision: 2 })).status).toBe(200);
    expect((await (await run(req('/api/daily', { cookie }))).json()).data.entries).toHaveLength(0);
  });
  it('portfolio value / cashflow / settings / dashboard round-trip', async () => {
    expect((await post('/api/portfolio', { platform: 'webull', requestId: U(3), value: 2400.5, date: '2026-10-16' })).status).toBe(200);
    expect((await post('/api/cashflows', { platform: 'webull', type: 'deposit', amount: 500, currency: 'USD', date: '2026-10-01', requestId: U(4) })).status).toBe(200);
    expect((await post('/api/settings', { goal_dime_thb: 1000000 }, 'PUT')).status).toBe(200);
    expect((await post('/api/settings', { timezone: 'UTC' }, 'PUT')).status).toBe(400);
    const d = (await (await run(req('/api/dashboard', { cookie }))).json()).data;
    expect(d.portfolio.webull).toEqual([{ d: '2026-10-16', v: 2400.5, n: '' }]); expect(d.cashflows).toHaveLength(1); expect(d.settings.goal_dime_thb).toBe('1000000');
  });
  it('import endpoint is idempotent end-to-end and validates batch shape', async () => {
    const row = { date: '2026-10-01', thb: 100, usd: null, note: null, kind: 'value', sourceSheet: 'Dime24', sourceRow: 2, raw: { date: '1/10/26', thb: '100' }, reviewFlag: '', importKey: 'a'.repeat(32) };
    const first = await (await post('/api/admin/import', { kind: 'historical', platform: 'dime', rows: [row] })).json();
    const second = await (await post('/api/admin/import', { kind: 'historical', platform: 'dime', rows: [row] })).json();
    expect(first.data).toEqual({ inserted: 1, skipped: 0 }); expect(second.data).toEqual({ inserted: 0, skipped: 1 });
    expect((await post('/api/admin/import', { kind: 'historical', platform: 'dime', rows: [] })).status).toBe(400);
    expect((await post('/api/admin/import', { kind: 'other' })).status).toBe(400);
  });
  it('admin health/setup work and expose no secrets', async () => {
    const h = await (await run(req('/api/admin/health', { cookie }))).json();
    expect(h.data.spreadsheetName).toBe('minvestment');
    expect(JSON.stringify(h)).not.toContain(SCRIPT_SECRET);
  });
});

describe('upstream failure handling', () => {
  it('never leaks upstream errors, URL or secret to the browser', async () => {
    const cookie = await login();
    const unauthorized = async () => new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'leaky detail ' + SCRIPT_SECRET } }));
    const res = await handle(req('/api/dashboard', { cookie }), env, { fetchImpl: unauthorized });
    const text = await res.text();
    expect(res.status).toBe(502); expect(text).not.toContain(SCRIPT_SECRET); expect(text).not.toContain('script.google.com'); expect(text).not.toContain('leaky');
  });
  it('maps network failure to 504 and bad payloads to 502', async () => {
    const cookie = await login();
    expect((await handle(req('/api/dashboard', { cookie }), env, { fetchImpl: async () => { throw new Error('boom'); } })).status).toBe(504);
    expect((await handle(req('/api/dashboard', { cookie }), env, { fetchImpl: async () => new Response('<html>nope</html>') })).status).toBe(502);
  });
  it('refuses a script URL that is not a Google Apps Script /exec URL (SSRF guard)', async () => {
    const bad = mkEnv({ MINVEST_SCRIPT_URL: 'https://evil.example.com/macros/s/abc/exec' });
    const cookie = await login(bad);
    const res = await handle(req('/api/dashboard', { cookie }), bad, { fetchImpl: upstream });
    expect(res.status).toBe(503); expect(calls).toEqual([]);
  });
  it('loopback script URL is refused unless the local-testing flag is set (never on the deployed Worker)', async () => {
    const local = mkEnv({ MINVEST_SCRIPT_URL: 'http://127.0.0.1:8799/macros/s/MOCK/exec' });
    const cookie = await login(local);
    expect((await handle(req('/api/dashboard', { cookie }), local, { fetchImpl: upstream })).status).toBe(503);
    const flagged = { ...local, MINVEST_ALLOW_LOCAL_SCRIPT: '1' };
    expect((await handle(req('/api/dashboard', { cookie }), flagged, { fetchImpl: upstream })).status).toBe(200);
    const nonLoopback = { ...flagged, MINVEST_SCRIPT_URL: 'http://10.0.0.5:8799/macros/s/MOCK/exec' };
    expect((await handle(req('/api/dashboard', { cookie }), nonLoopback, { fetchImpl: upstream })).status).toBe(503);
  });
  it('unknown API path is 404 JSON (after auth)', async () => {
    const cookie = await login();
    expect((await run(req('/api/nope', { cookie }))).status).toBe(404);
  });
});
