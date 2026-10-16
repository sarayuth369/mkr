// Guarded importer (public/js/importer.js) driven through the real Worker + Apps Script logic (MOCK Sheets, synthetic data).
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, _resetRateLimitForTests } from '../src/index.ts';
import { runImport, validateNormalized } from '../public/js/importer.js';
import { normalizeSheet } from '../tools/normalize.mjs';
import { createGas } from './gas-mock.mjs';

const ORIGIN = 'https://minvest.example.workers.dev';
const SECRET = 'test-secret-0123456789-abcdefghij';
const env = {
  ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) },
  MINVEST_PASSWORD: 'pw-for-tests-only', MINVEST_SESSION_SECRET: 'session-secret-abcdefghijklmnopqrstuvwxyz-0123456789',
  MINVEST_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxTESTTEST/exec', MINVEST_SCRIPT_SECRET: SECRET,
};

// synthetic data only (no personal figures)
const TODAY = new Date('2026-10-16T00:00:00Z');
const dmy = (i) => { const d = new Date(Date.UTC(2026, 5, 1 + i)); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`; };
const series = (base, n) => Array.from({ length: n }, (_, i) => base * (1 + 0.0004 * i) * (1 + (i % 2 ? 0.002 : -0.002)));
function build() {
  const dime = [['วันที่', 'ราคา(บาท)', 'ราคา(USD)', 'หมายเหตุ'], ['JUNE 26'], ...series(100000.1234, 120).map((v, i) => [dmy(i), Math.round(v * 100) / 100, null, i === 40 ? 'deposit 5000thb' : null])];
  dime.push(['30/9/26', '12.34.56'], ['30/9/26', 123456.789, null, 'ซื้อ XYZ']);
  const stash = [['วันที่', 'ราคา(บาท)', 'หมายเหตุ'], ...series(5000.5, 120).map((v, i) => [dmy(i), Math.round(v * 100) / 100])];
  const webull = [['วันที่', 'ราคา(USD)', 'หมายเหตุ'], ...series(1500.25, 120).map((v, i) => [dmy(i), Math.round(v * 100) / 100])];
  return [normalizeSheet('Dime24', dime, { today: TODAY }), normalizeSheet('StashAway', stash, { today: TODAY }), normalizeSheet('WeBull', webull, { today: TODAY })];
}

let gas, cookie, logs;
const apiFor = () => async (method, path, body) => {
  const res = await handle(new Request(ORIGIN + path, { method, headers: { origin: ORIGIN, cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'cf-connecting-ip': '9.9.9.9' }, body: body === undefined ? undefined : JSON.stringify(body) }), env,
    { fetchImpl: async (_u, init) => { const b = JSON.parse(init.body); return new Response(JSON.stringify(gas.call(b.action, b.payload, b.secret))); } });
  const out = await res.json();
  if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
  return out.data;
};
const run = (sheets) => { logs = []; let failed = 0; const check = (name, ok, detail = '') => { if (!ok) failed++; logs.push({ name, ok, detail }); return ok; };
  return runImport({ sheets, api: apiFor(), check, fetchPage: async () => ({ status: 200, csp: "default-src 'self'; script-src 'self'" }) }).then((r) => ({ ...r, failed })); };

beforeEach(async () => {
  _resetRateLimitForTests();
  gas = createGas({ secret: SECRET, now: new Date('2026-10-16T03:00:00Z') });
  const res = await handle(new Request(ORIGIN + '/api/login', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ password: 'pw-for-tests-only' }) }), env);
  cookie = res.headers.get('set-cookie').split(';')[0];
});

describe('guarded importer', () => {
  it('imports everything, reads it all back, and every gate passes (fresh destination)', async () => {
    const sheets = build();
    const r = await run(sheets);
    expect(r.stoppedAt).toBeNull();
    expect(logs.filter((l) => !l.ok), JSON.stringify(logs.filter((l) => !l.ok))).toEqual([]);
    const total = sheets.reduce((n, s) => n + s.rows.length, 0);
    const h = r.counts.import.historical;
    const inserted = h.dime.inserted + h.stashaway.inserted + h.webull.inserted, skipped = h.dime.skipped + h.stashaway.skipped + h.webull.skipped;
    expect(inserted + skipped).toBe(total); expect(skipped).toBe(3); // the 3 canary rows were already written by the canary stage
    expect(gas.ss.getSheetByName('Historical_Dime').getLastRow()).toBe(1 + sheets[0].rows.length);
    expect(r.counts.import.review.inserted).toBe(sheets.reduce((n, s) => n + s.review.length, 0));
  });
  it('is idempotent: a second run inserts nothing and still passes', async () => {
    await run(build());
    const before = gas.call('health').data.rows;
    const r = await run(build());
    expect(r.stoppedAt).toBeNull(); expect(r.failed).toBe(0);
    expect(r.counts.import.historical.dime.inserted).toBe(0); expect(r.counts.import.review.inserted).toBe(0);
    expect(gas.call('health').data.rows).toEqual(before);
  });
  it('never writes unconfirmed data into Daily_Income, Cashflows, or the KPI inputs', async () => {
    await run(build());
    expect(gas.call('health').data.rows.Daily_Income).toBe(0);
    expect(gas.call('health').data.rows.Cashflows).toBe(0);
    const d = gas.call('getDashboardData').data;
    expect(d.daily).toEqual([]); expect(d.cashflows).toEqual([]);
    expect(d.portfolio.dime.length).toBeGreaterThan(100); // series exist, but only as portfolio VALUES
  });
  it('keeps malformed values out of the series and the unparsed raw text in the sheet', async () => {
    await run(build());
    const sh = gas.ss.getSheetByName('Historical_Dime');
    const rows = Array.from({ length: sh.getLastRow() - 1 }, (_, i) => sh.getRange(i + 2, 1, 1, 17).getValues()[0]);
    const bad = rows.find((r) => r[4] === 'value_unparsed');
    expect(bad[1]).toBe(''); expect(bad[9]).toBe('12.34.56');
    expect(gas.call('getDashboardData').data.portfolio.dime.some((p) => p.d === '2026-09-30' && p.v === 12.3456)).toBe(false);
  });
  it('STOPS (writes nothing) when the destination holds rows it does not recognise', async () => {
    gas.call('setup');
    const sh = gas.ss.getSheetByName('Historical_Dime');
    sh.appendRow([new Date(), 'x', 'y', 'z', 'weird', '', '', 'notanumber', '', '', '', '', '', '', '', 'active', new Date()]);
    const r = await run(build());
    expect(r.stoppedAt).toContain('ไม่รู้จัก');
    expect(sh.getLastRow()).toBe(2); // untouched
    expect(gas.ss.getSheetByName('Historical_StashAway').getLastRow()).toBe(1);
  });
  it('STOPS when the connected spreadsheet is not "minvestment"', async () => {
    gas.ss.name = 'Some Other Sheet';
    const r = await run(build());
    expect(r.stoppedAt).toBe('spreadsheet identity');
    expect(gas.ss.getSheetByName('Historical_Dime')).toBeNull();
  });
  it('STOPS when the source data fails reconcile', async () => {
    const sheets = build(); sheets[0].summary.nonEmptyRows += 1;
    expect((await run(sheets)).stoppedAt).toContain('reconcile');
  });
  it('log lines contain counts/dates only - no portfolio values', async () => {
    const sheets = build();
    await run(sheets);
    const text = JSON.stringify(logs);
    for (const s of sheets) for (const r of s.rows.slice(0, 50)) for (const v of [r.thb, r.usd]) if (v !== null && Math.abs(v) >= 1000) expect(text).not.toContain(String(v));
  });
});

describe('validateNormalized (untrusted file)', () => {
  it('rejects junk and malformed shapes, accepts the real shape', () => {
    expect(validateNormalized(null)).toBeTruthy(); expect(validateNormalized({ sheets: [] })).toBeTruthy();
    const ok = { sheets: build() };
    expect(validateNormalized(ok)).toBeNull();
    ok.sheets[0].rows[0].importKey = 'nothex'; expect(validateNormalized(ok)).toBeTruthy();
    const bad = { sheets: build() }; bad.sheets[1].rows[0].kind = 'drop table'; expect(validateNormalized(bad)).toBeTruthy();
  });
});
