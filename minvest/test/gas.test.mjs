// MOCK tests of apps-script/Code.gs logic (in-memory Sheets). Not a real Google Sheets connection test.
import { describe, expect, it, beforeEach } from 'vitest';
import { createGas } from './gas-mock.mjs';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
let g;
beforeEach(() => { g = createGas(); g.call('setup'); });
const daily = () => g.ss.getSheetByName('Daily_Income');

describe('auth', () => {
  it('rejects a wrong secret and never reveals data', () => {
    const r = g.call('health', {}, 'wrong-secret-0123456789-abcdefghij');
    expect(r.ok).toBe(false); expect(r.error.code).toBe('UNAUTHORIZED');
  });
  it('rejects everything when the script secret is not configured / too short', () => {
    const g2 = createGas({ secret: 'short' });
    expect(g2.call('health', {}, 'short').error.code).toBe('UNAUTHORIZED');
  });
  it('doGet exposes nothing about the spreadsheet', () => {
    const out = JSON.parse(g.ctx.doGet().getContent());
    expect(out).toEqual({ ok: true, service: 'minvest' });
  });
  it('unknown action is a clean error', () => { expect(g.call('nope').error.code).toBe('BAD_ACTION'); });
});

describe('setup/health', () => {
  it('is idempotent, creates all sheets and forces Asia/Bangkok', () => {
    const second = g.call('setup');
    expect(second.data.createdSheets).toEqual([]);
    expect(g.ss.getSpreadsheetTimeZone()).toBe('Asia/Bangkok');
    for (const n of ['Daily_Income', 'Historical_Dime', 'Historical_StashAway', 'Historical_Webull', 'Settings', 'Dashboard_Data', 'Cashflows', 'Import_Review', 'Cashflow_Review']) expect(g.ss.getSheetByName(n)).not.toBeNull();
    const st = g.ss.getSheetByName('Settings');
    expect(st.getLastRow()).toBe(1 + 9);
  });
  it('keeps Daily_Income columns A-D exactly as specified', () => {
    expect(daily().getRange(1, 1, 1, 4).getValues()[0]).toEqual(['วันที่บันทึก', 'Dime THB', 'StashAway THB', 'Webull USD']);
  });
  it('never overwrites an existing header or existing data on re-setup', () => {
    daily().set(1, 2, 'My Own Header');
    g.call('addDaily', { requestId: U1, dime: 5, type: 'profit_loss' });
    g.call('setup');
    expect(daily().get(1, 2)).toBe('My Own Header');
    expect(daily().getLastRow()).toBe(2);
  });
  it('health reports names/counts/timezone and which spreadsheet source was used', () => {
    const h = g.call('health').data;
    expect(h.spreadsheetName).toBe('minvestment'); expect(h.spreadsheetSource).toBe('SPREADSHEET_ID'); expect(h.sheetTimezone).toBe('Asia/Bangkok');
    expect(createGas({ spreadsheetId: null }).call('health').data.spreadsheetSource).toBe('bound');
  });
});

describe('Daily_Income writes', () => {
  it('stores positive, negative and explicit zero; blank stays blank (NOT zero)', () => {
    const r = g.call('addDaily', { requestId: U1, dime: -120.5, stashaway: '', webull: 0, type: 'profit_loss' });
    expect(r.ok).toBe(true);
    const row = daily().getRange(2, 1, 1, 4).getValues()[0];
    expect(row[1]).toBe(-120.5); expect(row[2]).toBe(''); expect(row[3]).toBe(0);
    expect(r.data.entry.stashaway).toBeNull(); expect(r.data.entry.webull).toBe(0);
  });
  it('requires at least one amount and a valid entry type', () => {
    expect(g.call('addDaily', { requestId: U1, type: 'profit_loss' }).error.code).toBe('VALIDATION');
    expect(g.call('addDaily', { requestId: U1, dime: 1 }).error.code).toBe('VALIDATION');
    expect(g.call('addDaily', { requestId: U1, dime: 1, type: 'income' }).error.code).toBe('VALIDATION');
  });
  it.each([['abc'], [NaN], [Infinity], [1e12], [12.345], [true]])('rejects malformed amount %s', (bad) => {
    expect(g.call('addDaily', { requestId: U1, dime: bad === NaN ? 'NaN' : bad, type: 'profit_loss' }).ok).toBe(false);
    expect(daily().getLastRow()).toBe(1);
  });
  it('is idempotent per requestId (double click / retry never duplicates)', () => {
    const a = g.call('addDaily', { requestId: U1, dime: 10, type: 'profit_loss' });
    const b = g.call('addDaily', { requestId: U1, dime: 10, type: 'profit_loss' });
    expect(a.data.duplicate).toBe(false); expect(b.data.duplicate).toBe(true);
    expect(b.data.entry.entryId).toBe(a.data.entry.entryId);
    expect(daily().getLastRow()).toBe(2);
  });
  it('requires a UUID requestId', () => { expect(g.call('addDaily', { requestId: 'x', dime: 1, type: 'profit_loss' }).error.code).toBe('VALIDATION'); });
  it('uses Asia/Bangkok for the timestamp and the default entry date', () => {
    const r = g.call('addDaily', { requestId: U1, dime: 1, type: 'cash_received' });
    expect(r.data.entry.recordedAt).toBe('16/10/2026 10:00'); expect(r.data.entry.entryDate).toBe('2026-10-16');
  });
  it('rolls the Bangkok business day over correctly (UTC 18:30 is already tomorrow in Bangkok)', () => {
    g.setNow(new Date('2026-10-15T18:30:00Z'));
    const r = g.call('addDaily', { requestId: U1, dime: 1, type: 'profit_loss' });
    expect(r.data.entry.entryDate).toBe('2026-10-16'); expect(r.data.entry.recordedAt).toBe('16/10/2026 1:30');
  });
  it('rejects dates far in the future and non-dates', () => {
    expect(g.call('addDaily', { requestId: U1, dime: 1, type: 'profit_loss', entryDate: '2026-12-31' }).error.code).toBe('VALIDATION');
    expect(g.call('addDaily', { requestId: U1, dime: 1, type: 'profit_loss', entryDate: '2026-02-30' }).error.code).toBe('VALIDATION');
  });
  it('neutralises formula injection and strips control characters in notes', () => {
    const r = g.call('addDaily', { requestId: U1, dime: 1, type: 'profit_loss', note: '=HYPERLINK("http://evil","x")\u0007' });
    expect(daily().get(2, 5)).toBe('\'=HYPERLINK("http://evil","x")');
    expect(r.data.entry.note).toBe('=HYPERLINK("http://evil","x")'); // display value has the guard stripped
    expect(g.call('addDaily', { requestId: U2, dime: 1, type: 'profit_loss', note: 'x'.repeat(501) }).error.code).toBe('VALIDATION');
  });
});

describe('edit / void', () => {
  it('updates with optimistic concurrency and bumps the revision', () => {
    const a = g.call('addDaily', { requestId: U1, dime: 10, type: 'profit_loss' }).data.entry;
    const u = g.call('updateDaily', { entryId: a.entryId, expectedRevision: 1, dime: 11, stashaway: 5, type: 'cash_received' });
    expect(u.ok).toBe(true); expect(u.data.entry.revision).toBe(2); expect(u.data.entry.dime).toBe(11); expect(u.data.entry.type).toBe('cash_received');
    expect(daily().getLastRow()).toBe(2); // edited in place, no duplicate row
    expect(g.call('updateDaily', { entryId: a.entryId, expectedRevision: 1, dime: 12, type: 'profit_loss' }).error.code).toBe('CONFLICT');
  });
  it('voiding keeps the row (audit) but removes it from lists and the dashboard', () => {
    const a = g.call('addDaily', { requestId: U1, dime: 10, type: 'profit_loss' }).data.entry;
    expect(g.call('voidDaily', { entryId: a.entryId, expectedRevision: 1 }).data.voided).toBe(true);
    expect(daily().getLastRow()).toBe(2);
    expect(g.call('listDaily').data.entries).toHaveLength(0);
    expect(g.call('listDaily', { includeVoid: true }).data.entries).toHaveLength(1);
    expect(g.call('getDashboardData').data.daily).toHaveLength(0);
    expect(g.call('updateDaily', { entryId: a.entryId, expectedRevision: 2, dime: 1, type: 'profit_loss' }).error.code).toBe('CONFLICT');
    expect(g.call('updateDaily', { entryId: U3, expectedRevision: 1, dime: 1, type: 'profit_loss' }).error.code).toBe('NOT_FOUND');
  });
});

describe('portfolio values / cashflows / settings', () => {
  it('writes the value into the platform currency column and is idempotent', () => {
    const w = g.call('addPortfolioValue', { platform: 'webull', requestId: U1, value: 2400.5, date: '2026-10-16' });
    const d = g.call('addPortfolioValue', { platform: 'dime', requestId: U2, value: 700000 });
    expect(g.ss.getSheetByName('Historical_Webull').getRange(2, 2, 1, 2).getValues()[0]).toEqual(['', 2400.5]);
    expect(g.ss.getSheetByName('Historical_Dime').getRange(2, 2, 1, 2).getValues()[0]).toEqual([700000, '']);
    expect(g.call('addPortfolioValue', { platform: 'webull', requestId: U1, value: 2400.5 }).data.duplicate).toBe(true);
    expect(w.ok && d.ok).toBe(true);
    expect(g.call('addPortfolioValue', { platform: 'dime', requestId: U3, value: -1 }).ok).toBe(false);
    expect(g.call('addPortfolioValue', { platform: 'nope', requestId: U3, value: 1 }).ok).toBe(false);
  });
  it('records cashflows separately from profit and validates them', () => {
    expect(g.call('addCashflow', { platform: 'webull', type: 'deposit', amount: 500, currency: 'USD', date: '2026-10-01', requestId: U1 }).ok).toBe(true);
    expect(g.call('addCashflow', { platform: 'webull', type: 'deposit', amount: 500, currency: 'USD', date: '2026-10-01', requestId: U1 }).data.duplicate).toBe(true);
    expect(g.call('addCashflow', { platform: 'dime', type: 'deposit', amount: 0, currency: 'THB', date: '2026-10-01', requestId: U2 }).ok).toBe(false);
    expect(g.call('getDashboardData').data.cashflows).toEqual([{ date: '2026-10-01', platform: 'webull', type: 'deposit', amount: 500, currency: 'USD' }]);
  });
  it('only whitelisted settings are editable and values are validated', () => {
    expect(g.call('updateSettings', { goal_dime_thb: 1000000 }).data.settings.goal_dime_thb).toBe('1000000');
    expect(g.call('updateSettings', { timezone: 'UTC' }).ok).toBe(false);
    expect(g.call('updateSettings', { cashflows_confirmed_through: '2026-13-01' }).ok).toBe(false);
    expect(g.call('updateSettings', { forecast_window_days: 5 }).ok).toBe(false);
    expect(g.call('updateSettings', { usd_thb_rate: -3 }).ok).toBe(false);
  });
});

describe('historical import', () => {
  const key = (n) => n.toString(16).padStart(32, '0');
  const row = (n, over = {}) => ({ date: '2026-10-0' + n, thb: 1000 * n, usd: null, note: n === 2 ? '=cmd|x' : null, kind: 'value', sourceSheet: 'Dime24', sourceRow: n + 1, raw: { date: `${n}/10/26`, thb: String(1000 * n), usd: null, note: null }, reviewFlag: '', importKey: key(n), ...over });
  it('inserts once, then skips everything on re-run (idempotent) and keeps formulas neutral', () => {
    const rows = [row(1), row(2), row(3)];
    expect(g.call('importHistorical', { platform: 'dime', rows }).data).toEqual({ inserted: 3, skipped: 0 });
    expect(g.call('importHistorical', { platform: 'dime', rows }).data).toEqual({ inserted: 0, skipped: 3 });
    expect(g.ss.getSheetByName('Historical_Dime').getLastRow()).toBe(4);
    expect(g.ss.getSheetByName('Historical_Dime').get(3, 4)).toBe("'=cmd|x");
  });
  it('keeps unparsed values raw with the flag, and rejects a bad key or oversize batch', () => {
    const bad = row(4, { thb: null, kind: 'value_unparsed', raw: { date: '4/10/26', thb: '123456..78', usd: null, note: null }, reviewFlag: 'ตัวเลขผิดรูปแบบ' });
    g.call('importHistorical', { platform: 'dime', rows: [bad] });
    const sh = g.ss.getSheetByName('Historical_Dime');
    expect(sh.get(2, 2)).toBe(''); expect(sh.get(2, 10)).toBe('123456..78'); expect(sh.get(2, 6)).toBe('ตัวเลขผิดรูปแบบ');
    expect(g.call('importHistorical', { platform: 'dime', rows: [row(5, { importKey: 'zz' })] }).ok).toBe(false);
    expect(g.call('importHistorical', { platform: 'dime', rows: Array.from({ length: 201 }, (_, i) => row(1, { importKey: key(i + 100) })) }).ok).toBe(false);
  });
  it('review / cashflow-review imports are idempotent too', () => {
    const items = [{ platform: 'dime', sourceRow: 15, severity: 'info', reason: 'month_marker', detail: 'JULY 24', raw: 'JULY 24' }];
    expect(g.call('importReview', { items }).data).toEqual({ inserted: 1, skipped: 0 });
    expect(g.call('importReview', { items }).data).toEqual({ inserted: 0, skipped: 1 });
    const cf = [{ platform: 'stashaway', date: '2025-05-15', sourceRow: 5, suggestedType: 'deposit', suggestedAmountThb: 1000, suggestedAmountUsd: null, note: 'deposit 1000thb' }];
    expect(g.call('importCashflowReview', { items: cf }).data).toEqual({ inserted: 1, skipped: 0 });
    expect(g.call('importCashflowReview', { items: cf }).data).toEqual({ inserted: 0, skipped: 1 });
  });
});

describe('dashboard data', () => {
  it('series only contains real value snapshots; the last row of a date wins; events/superseded are excluded', () => {
    const mk = (n, d, thb, kind) => ({ date: d, thb, usd: null, note: null, kind, sourceSheet: 'Dime24', sourceRow: n, raw: {}, reviewFlag: '', importKey: n.toString(16).padStart(32, '0') });
    g.call('importHistorical', { platform: 'dime', rows: [mk(2, '2026-07-04', 31000, 'superseded'), mk(3, '2026-07-04', 4000.25, 'event_amount'), mk(4, '2026-07-04', 27000, 'value'), mk(5, '2026-07-05', 26900, 'value'), mk(6, '2026-07-06', null, 'value_unparsed')] });
    const s = g.call('getDashboardData').data.portfolio.dime;
    expect(s.map((p) => [p.d, p.v])).toEqual([['2026-07-04', 27000], ['2026-07-05', 26900]]);
  });
  it('rebuildDashboardData writes month-end values without touching source sheets', () => {
    g.call('addPortfolioValue', { platform: 'dime', requestId: U1, value: 100, date: '2026-09-10' });
    g.call('addPortfolioValue', { platform: 'dime', requestId: U2, value: 120, date: '2026-09-20' });
    g.call('addPortfolioValue', { platform: 'webull', requestId: U3, value: 50, date: '2026-09-21' });
    const before = g.ss.getSheetByName('Historical_Dime').getLastRow();
    expect(g.call('rebuildDashboardData').data.months).toBe(1);
    expect(g.ss.getSheetByName('Dashboard_Data').getRange(2, 1, 1, 4).getValues()[0]).toEqual(['2026-09', 120, '', 50]);
    expect(g.ss.getSheetByName('Historical_Dime').getLastRow()).toBe(before);
  });
});

describe('import precision (regression: 3-decimal source values must not abort a batch)', () => {
  it('keeps source precision up to 4 decimals but still rejects junk', () => {
    const row = (n, thb) => ({ date: '2026-10-0' + n, thb, usd: null, note: null, kind: 'value', sourceSheet: 'Dime24', sourceRow: n, raw: {}, reviewFlag: '', importKey: n.toString(16).padStart(32, '0') });
    expect(g.call('importHistorical', { platform: 'dime', rows: [row(1, 100000.522), row(2, 100.1)] }).data).toEqual({ inserted: 2, skipped: 0 });
    expect(g.ss.getSheetByName('Historical_Dime').get(2, 2)).toBe(100000.522);
    expect(g.call('importHistorical', { platform: 'dime', rows: [row(3, 1.23456)] }).ok).toBe(false);
    expect(g.call('importHistorical', { platform: 'dime', rows: [row(4, 1e12)] }).ok).toBe(false);
  });
});
