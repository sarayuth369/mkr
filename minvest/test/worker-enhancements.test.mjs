// Worker tests for: portfolio record edit/delete/restore routes, password change (Durable Object AuthStore), FX (FxStore).
// Upstream = in-memory Apps Script MOCK; Durable Objects = the REAL classes over an in-memory storage fake.
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, _resetRateLimitForTests } from '../src/index.ts';
import { AuthStore } from '../src/auth-store.ts';
import { FxStore } from '../src/fx-store.ts';
import { checkPassword as serverCheck } from '../src/password-policy.ts';
import { checkPassword as clientCheck } from '../public/js/password-policy.js';
import { createGas } from './gas-mock.mjs';

const ORIGIN = 'https://minvest.example.workers.dev';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxTESTTESTTEST/exec';
const SCRIPT_SECRET = 'test-secret-0123456789-abcdefghij';
const OLD_PW = 'correct horse battery';
const NEW_PW = 'Gr@nite-Lantern-4471-ok';

const memStorage = () => { const m = new Map(); return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, structuredClone(v)); } }; };
function fakeNs(make) {
  const objs = new Map();
  return { objs, idFromName: (n) => n, get: (id) => { if (!objs.has(id)) objs.set(id, make()); const o = objs.get(id); return { fetch: (url, init) => o.fetch(new Request(url, init)) }; } };
}

let gas, calls, env, fxCalls, fxBehaviour, clock;
const upstream = async (_url, init) => { const b = JSON.parse(init.body); calls.push(b.action); return new Response(JSON.stringify(gas.call(b.action, b.payload, b.secret)), { headers: { 'content-type': 'application/json' } }); };
const providerFetch = async (url) => {
  fxCalls.push(String(url));
  if (fxBehaviour.fail) throw new Error('network down');
  if (String(url).includes('/latest')) return new Response(JSON.stringify({ amount: 1, base: 'USD', date: fxBehaviour.date ?? '2026-10-15', rates: { THB: fxBehaviour.rate ?? 33.54 } }), { status: 200 });
  return new Response(JSON.stringify({ rates: { '2026-10-01': { THB: 33.1 }, '2026-10-02': { THB: 33.2 }, '2026-10-05': { THB: 33.4 } } }), { status: 200 });
};
// The DO sees whatever env is "deployed" right now (lets a test simulate a secret/epoch change on a long-lived DO).
const liveEnv = new Proxy({}, { get: (_t, k) => mkEnv.cur?.[k] });
function mkEnv(over = {}) {
  const auth = fakeNs(() => new AuthStore({ storage: memStorage() }, liveEnv, () => clock));
  const fx = fakeNs(() => new FxStore({ storage: memStorage() }, liveEnv, providerFetch, () => clock));
  const e = {
    ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) },
    MINVEST_PASSWORD: OLD_PW, MINVEST_SESSION_SECRET: 'session-secret-abcdefghijklmnopqrstuvwxyz-0123456789',
    MINVEST_SCRIPT_URL: SCRIPT_URL, MINVEST_SCRIPT_SECRET: SCRIPT_SECRET, AUTH_STORE: auth, FX_STORE: fx, ...over,
  };
  mkEnv.cur = e; return e;
}
const req = (path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) =>
  new Request(ORIGIN + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), 'cf-connecting-ip': '9.9.9.9' }, body: body === undefined ? undefined : JSON.stringify(body) });
const run = (r, e = env) => handle(r, e, { fetchImpl: upstream, now: () => clock });
async function login(pw = OLD_PW, e = env) {
  const res = await run(req('/api/login', { method: 'POST', body: { password: pw } }), e);
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const post = (path, body, cookie) => run(req(path, { method: 'POST', body, cookie }));

beforeEach(() => { clock = Date.parse('2026-10-16T05:00:00Z'); gas = createGas({ secret: SCRIPT_SECRET }); gas.call('setup'); calls = []; fxCalls = []; fxBehaviour = {}; env = mkEnv(); _resetRateLimitForTests(); });

// ───────────────────────── record edit / delete / restore ─────────────────────────
const key = (n) => n.toString(16).padStart(32, '0');
const imp = (n) => ({ date: `2026-09-0${n}`, thb: 1000 + n, usd: null, note: null, kind: 'value', sourceSheet: 'Dime24', sourceRow: n + 1, raw: { date: `${n}/9/26`, thb: String(1000 + n), usd: null, note: null }, reviewFlag: '', importKey: key(n) });
const listed = (p) => gas.call('listPortfolio', { platform: p }).data.entries;

describe('portfolio record routes', () => {
  beforeEach(() => { gas.call('importHistorical', { platform: 'dime', rows: [imp(1), imp(2), imp(3)] }); });
  const put = (cookie, id, body, platform = 'dime') => run(req(`/api/portfolio/${platform}/${id}`, { method: 'PUT', body, cookie }));

  it('requires a session and a same-origin request', async () => {
    const id = listed('dime')[0].recordId;
    expect((await put(undefined, id, { date: '2026-09-01', value: 5, expectedRevision: 1 })).status).toBe(401);
    const { cookie } = await login();
    const evil = await run(req(`/api/portfolio/dime/${id}`, { method: 'PUT', body: { date: '2026-09-01', value: 5, expectedRevision: 1 }, cookie, origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    expect(listed('dime')[0].thb).toBe(1001);
  });
  it('edits by stable id and returns the new revision; the audit trail records it', async () => {
    const { cookie } = await login();
    const t = listed('dime')[1];
    const res = await put(cookie, t.recordId, { date: '2026-09-02', value: 4321.5, kind: 'value', note: 'fix', expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).data.entry).toMatchObject({ thb: 4321.5, revision: 2, note: 'fix' });
    expect(calls).toContain('updatePortfolioRecord');
    expect(gas.ss.getSheetByName('Audit_Log').getLastRow()).toBe(2);
  });
  it('maps errors: stale revision 409, unknown/wrong-portfolio id 404, bad input 400, bad id 400', async () => {
    const { cookie } = await login();
    const t = listed('dime')[0];
    const ok = { date: '2026-09-01', value: 5, kind: 'value', expectedRevision: 1 };
    expect((await put(cookie, t.recordId, { ...ok, expectedRevision: 9 })).status).toBe(409);
    expect((await put(cookie, t.recordId, ok, 'stashaway')).status).toBe(404);
    expect((await put(cookie, t.recordId, { ...ok, value: -5 })).status).toBe(400);
    expect((await put(cookie, t.recordId, { ...ok, value: 1.234 })).status).toBe(400);
    expect((await put(cookie, t.recordId, { ...ok, date: '2026-02-30' })).status).toBe(400);
    expect((await put(cookie, t.recordId, { ...ok, kind: 'value_unparsed' })).status).toBe(400);
    expect((await put(cookie, t.recordId, { ...ok, value: null })).status).toBe(400);
    expect((await put(cookie, 'a'.repeat(32), ok)).status).toBe(404);
    expect((await put(cookie, 'zz'.repeat(16), ok)).status).toBe(404); // not even routable
    expect((await put(cookie, '1'.repeat(40), ok)).status).toBe(404);
    expect((await put(cookie, 'a'.repeat(36), ok)).status).toBe(400); // routable but not a UUID
    expect(listed('dime')[0]).toMatchObject({ thb: 1001, revision: 1 });
  });
  it('soft delete removes it from the dashboard series, restore brings it back, double delete conflicts', async () => {
    const { cookie } = await login();
    const t = listed('dime')[2];
    const del = await post(`/api/portfolio/dime/${t.recordId}/void`, { expectedRevision: 1 }, cookie);
    expect(del.status).toBe(200);
    const dash = async () => (await (await run(req('/api/dashboard', { cookie }))).json()).data.portfolio.dime.map((p) => p.d);
    expect(await dash()).not.toContain(t.date);
    expect((await post(`/api/portfolio/dime/${t.recordId}/void`, { expectedRevision: 2 }, cookie)).status).toBe(409);
    expect((await post(`/api/portfolio/dime/${t.recordId}/restore`, { expectedRevision: 2 }, cookie)).status).toBe(200);
    expect(await dash()).toContain(t.date);
    expect(gas.ss.getSheetByName('Historical_Dime').getLastRow()).toBe(4); // nothing physically deleted
  });
});

// ───────────────────────── password change ─────────────────────────
const change = (cookie, body) => post('/api/password/change', body, cookie);

describe('password change (Durable Object, PBKDF2)', () => {
  it('unauthenticated callers cannot change it', async () => {
    expect((await change(undefined, { current: OLD_PW, next: NEW_PW })).status).toBe(401);
  });
  it('wrong current password is rejected (403) and nothing changes', async () => {
    const { cookie } = await login();
    const r = await change(cookie, { current: 'not-the-password', next: NEW_PW });
    expect(r.status).toBe(403); expect((await r.json()).error.code).toBe('INVALID_CURRENT');
    expect((await login(OLD_PW)).res.status).toBe(200);
  });
  it('weak new password is rejected with reasons; same-as-old and mismatched confirm are rejected', async () => {
    const { cookie } = await login();
    const weak = await change(cookie, { current: OLD_PW, next: 'short1' });
    expect(weak.status).toBe(400); expect((await weak.json()).error.code).toBe('WEAK_PASSWORD');
    expect((await change(cookie, { current: OLD_PW, next: OLD_PW })).status).toBe(400);
    expect((await change(cookie, { current: OLD_PW, next: NEW_PW, confirm: 'different' })).status).toBe(400);
    expect((await login(OLD_PW)).res.status).toBe(200);
  });
  it('success: keeps this browser signed in, kills every older session, old password dies, new password works', async () => {
    const a = await login(); const b = await login(); // two sessions (two browsers)
    const r = await change(a.cookie, { current: OLD_PW, next: NEW_PW, confirm: NEW_PW });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data).toEqual({ changed: true, otherSessionsSignedOut: true });
    expect(JSON.stringify(body)).not.toContain(NEW_PW);
    const newCookie = r.headers.get('set-cookie').split(';')[0];
    expect((await run(req('/api/dashboard', { cookie: newCookie }))).status).toBe(200); // this browser still in
    expect((await run(req('/api/dashboard', { cookie: a.cookie }))).status).toBe(401);   // the pre-change cookie is dead
    expect((await run(req('/api/dashboard', { cookie: b.cookie }))).status).toBe(401);   // other browser is dead
    expect((await login(OLD_PW)).res.status).toBe(401);                                  // even the Worker-secret password is no longer accepted
    const again = await login(NEW_PW);
    expect(again.res.status).toBe(200);
    const s = await (await run(req('/api/session', { cookie: again.cookie }))).json();
    expect(s.data).toMatchObject({ authenticated: true, passwordSource: 'stored', passwordChangeAvailable: true });
  });
  it('persists across Worker restarts: a fresh env bound to the same Durable Object still honours the stored hash', async () => {
    const a = await login();
    await change(a.cookie, { current: OLD_PW, next: NEW_PW });
    const restarted = { ...env, MINVEST_PASSWORD: OLD_PW }; // same bindings, same secrets = a new isolate
    expect((await login(OLD_PW, restarted)).res.status).toBe(401);
    expect((await login(NEW_PW, restarted)).res.status).toBe(200);
  });
  it('the stored record has a random salt + hash only: no plaintext anywhere in storage', async () => {
    const a = await login();
    await change(a.cookie, { current: OLD_PW, next: NEW_PW });
    const store = env.AUTH_STORE.objs.get('owner');
    // reach the in-memory storage of the real AuthStore instance
    const dump = JSON.stringify([...store.state.storage.m.entries()]);
    expect(dump).not.toContain(NEW_PW); expect(dump).not.toContain(OLD_PW);
    const pw = store.state.storage.m.get('pw');
    expect(pw).toMatchObject({ algo: 'pbkdf2-sha256', iter: 100000 });
    expect(atob(pw.salt).length).toBe(16);
  });
  it('recovery: bumping the MINVEST_PASSWORD_EPOCH secret makes the secret password work again and supersedes the stored hash', async () => {
    const a = await login();
    await change(a.cookie, { current: OLD_PW, next: NEW_PW });
    const recovered = { ...env, MINVEST_PASSWORD_EPOCH: 'epoch-2' };
    mkEnv.cur = recovered;
    expect((await login(NEW_PW, recovered)).res.status).toBe(401);
    const r = await login(OLD_PW, recovered);
    expect(r.res.status).toBe(200);
    expect((await (await run(req('/api/session', { cookie: r.cookie }), recovered)).json()).data.passwordSource).toBe('env');
  });
  it('unavailable (503) rather than fake success when the Durable Object binding is missing', async () => {
    const e = mkEnv({ AUTH_STORE: undefined });
    const { cookie } = await login(OLD_PW, e);
    const r = await run(req('/api/password/change', { method: 'POST', body: { current: OLD_PW, next: NEW_PW }, cookie }), e);
    expect(r.status).toBe(503);
  });
  it('is rate limited per IP', async () => {
    const { cookie } = await login();
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await change(cookie, { current: 'wrong-wrong-wrong', next: NEW_PW })).status;
    expect(last).toBe(429);
  });
  it('CSRF: needs a same-origin Origin header', async () => {
    const { cookie } = await login();
    const r = await run(req('/api/password/change', { method: 'POST', body: { current: OLD_PW, next: NEW_PW }, cookie, origin: 'https://evil.example' }));
    expect(r.status).toBe(403);
    expect((await login(OLD_PW)).res.status).toBe(200);
  });
});

describe('AuthStore brute-force lock', () => {
  it('locks after 10 failures within 15 min (login and change share the counter), unlocks later, success resets', async () => {
    let t = 1_000_000;
    const store = new AuthStore({ storage: memStorage() }, { MINVEST_PASSWORD: OLD_PW, MINVEST_SESSION_SECRET: 'abcdefghijklmnopqrstuvwxyz012345' }, () => t);
    const call = async (path, body) => (await store.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) }))).json();
    for (let i = 0; i < 10; i++) expect((await call('/verify', { password: 'bad' + i })).ok).toBe(false);
    const locked = await call('/verify', { password: OLD_PW }); // correct password is also refused while locked
    expect(locked).toMatchObject({ ok: false, locked: true }); expect(locked.retryAfter).toBeGreaterThan(0);
    expect((await call('/change', { current: OLD_PW, next: NEW_PW })).locked).toBe(true);
    t += 16 * 60_000;
    expect((await call('/verify', { password: OLD_PW })).ok).toBe(true);
  });
});

describe('password policy parity (server authority = client mirror)', () => {
  it.each(['', 'short', 'alllowercaseletters', 'Password123456', 'MINVESTminvest99!', 'aaaaaaaaaaaaaaaa', 'abcabcabcabcabc', 'Gr@nite-Lantern-4471-ok', 'a long passphrase with spaces only', 'x'.repeat(130)])('same verdict for %j', (pw) => {
    expect(clientCheck(pw)).toEqual(serverCheck(pw));
  });
  it('accepts strong, rejects weak', () => {
    expect(serverCheck(NEW_PW).ok).toBe(true);
    expect(serverCheck('Password123456').ok).toBe(false);
    expect(serverCheck('short').ok).toBe(false);
  });
});

// ───────────────────────── FX ─────────────────────────
describe('FX (server-side USD->THB reference rate)', () => {
  const getFx = async (cookie, path = '/api/fx') => (await run(req(path, { cookie }))).json();
  it('requires a session', async () => { expect((await run(req('/api/fx'))).status).toBe(401); });
  it('fetches server-side, labels source/date/timestamp, and caches (no second provider call within 1h)', async () => {
    const { cookie } = await login();
    const a = (await getFx(cookie)).data;
    expect(a).toMatchObject({ status: 'fresh', rate: 33.54, rateDate: '2026-10-15' });
    expect(a.source).toContain('ECB'); expect(a.fetchedAt).toBe(new Date(clock).toISOString());
    await getFx(cookie); await getFx(cookie);
    expect(fxCalls).toHaveLength(1);
    clock += 61 * 60_000; await getFx(cookie);
    expect(fxCalls).toHaveLength(2);
  });
  it('manual refresh forces a fetch but cannot hammer the provider (60 s floor)', async () => {
    const { cookie } = await login();
    await getFx(cookie);
    clock += 30_000;
    const early = (await (await post('/api/fx/refresh', {}, cookie)).json()).data;
    expect(early.note).toBeTruthy(); expect(fxCalls).toHaveLength(1);
    clock += 31_000; fxBehaviour.rate = 34.01;
    const r = (await (await post('/api/fx/refresh', {}, cookie)).json()).data;
    expect(r.rate).toBe(34.01); expect(fxCalls).toHaveLength(2);
  });
  it('provider down WITH cache: keeps the old value but flags it stale + error (never silently current)', async () => {
    const { cookie } = await login();
    await getFx(cookie);
    clock += 2 * 3_600_000; fxBehaviour.fail = true;
    const d = (await getFx(cookie)).data;
    expect(d).toMatchObject({ status: 'stale', rate: 33.54, rateDate: '2026-10-15' }); expect(d.error).toContain('ไม่สำเร็จ');
  });
  it('provider down WITHOUT cache: unavailable, no rate invented', async () => {
    const { cookie } = await login(); fxBehaviour.fail = true;
    const d = (await getFx(cookie)).data;
    expect(d.status).toBe('unavailable'); expect(d.rate).toBeUndefined();
  });
  it('a very old rateDate is flagged stale even if the fetch itself succeeded', async () => {
    const { cookie } = await login(); fxBehaviour.date = '2026-10-01';
    expect((await getFx(cookie)).data.status).toBe('stale');
  });
  it('rejects garbage provider payloads (zero/negative/huge rate)', async () => {
    const { cookie } = await login(); fxBehaviour.rate = 0;
    expect((await getFx(cookie)).data.status).toBe('unavailable');
  });
  it('history returns published business days (+ prior rate for carry-forward) and validates the range', async () => {
    const { cookie } = await login();
    const h = (await getFx(cookie, '/api/fx/history?from=2026-10-01&to=2026-10-06')).data;
    expect(h.status).toBe('fresh'); expect(Object.keys(h.rates)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05']);
    expect((await run(req('/api/fx/history?from=2026-10-06&to=2026-10-01', { cookie }))).status).toBe(400);
    expect((await run(req('/api/fx/history?from=bad&to=2026-10-01', { cookie }))).status).toBe(400);
    await getFx(cookie, '/api/fx/history?from=2026-10-02&to=2026-10-05');
    expect(fxCalls).toHaveLength(1); // covered by the cached range
  });
  it('without the FX binding it reports unavailable instead of crashing', async () => {
    const e = mkEnv({ FX_STORE: undefined });
    const { cookie } = await login(OLD_PW, e);
    expect((await (await run(req('/api/fx', { cookie }), e)).json()).data.status).toBe('unavailable');
  });
});
