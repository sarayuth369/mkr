// MOCK tests (in-memory Sheets) for portfolio record edit / soft delete / restore in apps-script/Code.gs.
import { beforeEach, describe, expect, it } from 'vitest';
import { createGas } from './gas-mock.mjs';

const U1 = '11111111-1111-4111-8111-111111111111';
let g;
beforeEach(() => { g = createGas(); g.call('setup'); });

const key = (n) => n.toString(16).padStart(32, '0');
const imp = (n, over = {}) => ({ date: `2026-09-0${n}`, thb: 1000 + n, usd: null, note: null, kind: 'value', sourceSheet: 'Dime24', sourceRow: n + 1, raw: { date: `${n}/9/26`, thb: String(1000 + n), usd: null, note: null }, reviewFlag: '', importKey: key(n), ...over });
const hist = (name) => g.ss.getSheetByName(name);
const list = (p) => g.call('listPortfolio', { platform: p }).data.entries;
const seed = () => { g.call('importHistorical', { platform: 'dime', rows: [imp(1), imp(2), imp(3), imp(4, { thb: null, kind: 'value_unparsed', raw: { date: '4/9/26', thb: '12.34.56', usd: null, note: null }, reviewFlag: 'ตัวเลขผิดรูปแบบ' })] }); };

describe('portfolio record edit / soft delete / restore (stable ids, revisions, audit)', () => {
  it('migration: a pre-existing 17-column sheet only gains the missing header cells', () => {
    const sh = hist('Historical_Dime');
    seed();
    for (let c = 18; c <= 19; c++) sh.set(1, c, '');
    g.call('setup');
    expect(sh.get(1, 18)).toBe('revision'); expect(sh.get(1, 19)).toBe('updated_at');
    expect(list('dime')).toHaveLength(4); // data untouched
  });
  it('lists a stable recordId (import_key for imports, entry_id for app rows) and revision 1', () => {
    seed(); g.call('addPortfolioValue', { platform: 'dime', requestId: U1, value: 5, date: '2026-09-09' });
    const e = list('dime');
    expect(e[0].recordId).toBe(key(1)); expect(e[0].revision).toBe(1);
    expect(e[4].recordId).toMatch(/^[0-9a-f-]{36}$/); expect(e[4].recordId).toBe(e[4].entryId);
  });
  it('edits by recordId, bumps revision, keeps raw text, preserves the other currency column, writes an audit row', () => {
    seed();
    const target = list('dime')[1];
    const r = g.call('updatePortfolioRecord', { platform: 'dime', recordId: target.recordId, expectedRevision: 1, date: '2026-09-02', value: 2222.5, note: 'แก้ไข', kind: 'value' });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data.entry).toMatchObject({ thb: 2222.5, usd: null, note: 'แก้ไข', revision: 2, rawThb: '1002' });
    const audit = hist('Audit_Log');
    expect(audit.getLastRow()).toBe(2); expect(audit.get(2, 2)).toBe('edit'); expect(audit.get(2, 5)).toBe(2);
    expect(JSON.parse(audit.get(2, 6)).thb).toBe(1002); expect(JSON.parse(audit.get(2, 7)).thb).toBe(2222.5);
  });
  it("the amount always lands in the platform's OWN currency column (Webull = USD) and a record cannot be edited via the wrong platform", () => {
    g.call('importHistorical', { platform: 'webull', rows: [{ ...imp(1), thb: null, usd: 1500, sourceSheet: 'WeBull', raw: { date: '1/9/26', thb: null, usd: '1500', note: null } }] });
    seed();
    const w = list('webull')[0];
    expect(g.call('updatePortfolioRecord', { platform: 'webull', recordId: w.recordId, expectedRevision: 1, date: '2026-09-01', value: 1600, note: '', kind: 'value' }).ok).toBe(true);
    const after = list('webull')[0]; expect(after.usd).toBe(1600); expect(after.thb).toBeNull();
    // the same import_key exists in Dime (different sheet): editing through the wrong platform must not touch it
    const d = list('dime')[0];
    expect(g.call('updatePortfolioRecord', { platform: 'stashaway', recordId: d.recordId, expectedRevision: 1, date: '2026-09-01', value: 1, note: '', kind: 'value' }).error.code).toBe('NOT_FOUND');
    expect(list('dime')[0].thb).toBe(1001);
  });
  it('rejects stale revisions, malformed input and forbidden kinds without changing anything', () => {
    seed();
    const t = list('dime')[0];
    const bad = (over) => g.call('updatePortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 1, date: '2026-09-01', value: 10, note: '', kind: 'value', ...over });
    expect(bad({ expectedRevision: 7 }).error.code).toBe('CONFLICT');
    expect(bad({ value: -1 }).error.code).toBe('VALIDATION');
    expect(bad({ value: null }).error.code).toBe('VALIDATION');
    expect(bad({ value: 1.234 }).error.code).toBe('VALIDATION');
    expect(bad({ date: '2026-02-30' }).error.code).toBe('VALIDATION');
    expect(bad({ date: '2030-01-01' }).error.code).toBe('VALIDATION');
    expect(bad({ kind: 'value_unparsed' }).error.code).toBe('VALIDATION');
    expect(bad({ recordId: 'not-an-id' }).error.code).toBe('VALIDATION');
    expect(list('dime')[0]).toMatchObject({ thb: 1001, revision: 1 });
    expect(hist('Audit_Log').getLastRow()).toBeLessThan(2);
  });
  it('fixes a malformed import row on purpose: becomes a value, enters the series, flag marks the owner edit', () => {
    seed();
    const bad = list('dime').find((e) => e.kind === 'value_unparsed');
    expect(g.call('getDashboardData').data.portfolio.dime).toHaveLength(3);
    const r = g.call('updatePortfolioRecord', { platform: 'dime', recordId: bad.recordId, expectedRevision: 1, date: '2026-09-04', value: 123456.78, note: '', kind: 'value' });
    expect(r.data.entry).toMatchObject({ kind: 'value', thb: 123456.78, rawThb: '12.34.56' });
    expect(r.data.entry.reviewFlag).toContain('แก้ไขแล้ว');
    expect(g.call('getDashboardData').data.portfolio.dime.map((p) => p.d)).toContain('2026-09-04');
  });
  it('soft delete: excluded from series/KPIs, row kept, audited, cannot be edited until restored, restore brings it back', () => {
    seed();
    const t = list('dime')[2];
    const del = g.call('voidPortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 1 });
    expect(del.data.entry.status).toBe('void');
    expect(hist('Historical_Dime').getLastRow()).toBe(5); // nothing physically removed
    expect(g.call('getDashboardData').data.portfolio.dime.map((p) => p.d)).not.toContain(t.date);
    expect(g.call('voidPortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 2 }).error.code).toBe('CONFLICT');
    expect(g.call('updatePortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 2, date: t.date, value: 5, note: '', kind: 'value' }).error.code).toBe('CONFLICT');
    const back = g.call('restorePortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 2 });
    expect(back.data.entry).toMatchObject({ status: 'active', revision: 3 });
    expect(g.call('getDashboardData').data.portfolio.dime.map((p) => p.d)).toContain(t.date);
    const a = hist('Audit_Log'); expect([a.get(2, 2), a.get(3, 2)]).toEqual(['delete', 'restore']);
  });
  it('identity is the id, not the row position: still finds and edits the right record after rows are reordered', () => {
    seed();
    const sh = hist('Historical_Dime');
    const target = list('dime')[0];
    const body = sh.data.slice(1); body.reverse(); sh.data = [sh.data[0], ...body]; // simulate the owner sorting the sheet
    const r = g.call('updatePortfolioRecord', { platform: 'dime', recordId: target.recordId, expectedRevision: 1, date: '2026-09-01', value: 777, note: '', kind: 'value' });
    expect(r.ok).toBe(true);
    expect(list('dime').find((e) => e.recordId === target.recordId).thb).toBe(777);
    expect(list('dime').filter((e) => e.thb === 777)).toHaveLength(1);
  });
  it('neutralises formula injection in edited notes', () => {
    seed(); const t = list('dime')[0];
    g.call('updatePortfolioRecord', { platform: 'dime', recordId: t.recordId, expectedRevision: 1, date: '2026-09-01', value: 5, note: '=HYPERLINK("x")', kind: 'value' });
    expect(hist('Historical_Dime').get(2, 4)).toBe('\'=HYPERLINK("x")');
    expect(list('dime')[0].note).toBe('=HYPERLINK("x")');
  });
});
