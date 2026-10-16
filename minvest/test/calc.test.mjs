import { describe, expect, it } from 'vitest';
import * as c from '../public/js/calc.js';
import { fmtMoney, fmtPct, fmtDate, bangkokNow } from '../public/js/format.js';

const TODAY = '2026-10-16';
const mkSeries = (n, start, v0, drift, notes = {}) => Array.from({ length: n }, (_, i) => ({ d: c.addDays(start, i), v: Math.round(v0 * Math.exp(drift * i) * 100) / 100, n: notes[i] ?? '' }));

describe('recorded income KPIs', () => {
  const entries = [
    { date: '2026-10-16', dime: 100, stashaway: null, webull: -5, type: 'profit_loss' },
    { date: '2026-10-10', dime: -30, stashaway: 20, webull: null, type: 'profit_loss' },
    { date: '2026-09-30', dime: 50, stashaway: 0, webull: 1, type: 'profit_loss' },
    { date: '2026-10-16', dime: 999, stashaway: null, webull: null, type: 'cash_received' },
    { date: '2026-10-20', dime: 777, stashaway: null, webull: null, type: 'profit_loss' },
  ];
  it('keeps THB and USD separate and never mixes cash received into profit', () => {
    expect(c.sumDaily(entries, TODAY, 'day')).toMatchObject({ dime: 100, stashaway: null, webull: -5, thb: 100, usd: -5 });
    expect(c.sumDaily(entries, TODAY, 'month')).toMatchObject({ dime: 70, stashaway: 20, thb: 90, usd: -5 });
    expect(c.sumDaily(entries, TODAY, 'year')).toMatchObject({ dime: 120, stashaway: 20, webull: -4, thb: 140, usd: -4 });
    expect(c.sumDaily(entries, TODAY, 'day', 'cash_received').dime).toBe(999);
  });
  it('blank is null (no data), an explicit 0 is a real zero; future-dated rows are ignored', () => {
    const s = c.sumDaily([{ date: TODAY, dime: null, stashaway: 0, webull: null, type: 'profit_loss' }], TODAY, 'day');
    expect(s.dime).toBeNull(); expect(s.stashaway).toBe(0); expect(s.webull).toBeNull();
    expect(c.sumDaily([{ date: '2026-10-20', dime: 5, stashaway: null, webull: null, type: 'profit_loss' }], TODAY, 'year').dime).toBeNull();
  });
  it('buckets and cumulates per platform', () => {
    const m = c.incomeByBucket(entries, 'month', 'profit_loss', TODAY);
    expect(m.map((x) => x.k)).toEqual(['2026-09', '2026-10']);
    expect(c.cumulative(m).at(-1)).toMatchObject({ dime: 70 + 50 + 0, stashaway: 20, webull: -4 });
  });
});

describe('totals, goals, value change', () => {
  const portfolio = { dime: [{ d: '2026-10-15', v: 1000 }], stashaway: [{ d: '2026-10-15', v: 500.5 }], webull: [{ d: '2026-10-15', v: 100 }] };
  it('per-currency totals never add USD to THB', () => {
    expect(c.totals(portfolio)).toEqual({ thb: 1500.5, usd: 100 });
  });
  it('goal progress and last updated', () => {
    const g = c.goalProgress(portfolio, { goal_dime_thb: '2000' });
    expect(g[0]).toMatchObject({ goal: 2000, pct: 0.5 }); expect(g[1].goal).toBeNull();
    expect(c.lastUpdated(portfolio)).toBe('2026-10-15');
  });
  it('value change is computed from values (labelled as value, not profit by the UI)', () => {
    const s = [{ d: '2026-10-01', v: 100 }, { d: '2026-10-08', v: 150 }];
    expect(c.valueChange(s, '2026-10-01')).toMatchObject({ abs: 50, pct: 0.5 });
    expect(c.valueChange([{ d: '2026-10-01', v: 1 }], '2026-10-01')).toBeNull();
  });
});

describe('cashflow-adjusted return (Modified Dietz)', () => {
  const s = [{ d: '2026-01-01', v: 1000 }, { d: '2026-01-11', v: 2100 }];
  it('removes deposits from the result', () => {
    const r = c.adjustedReturn(s, [{ platform: 'dime', type: 'deposit', amount: 1000, currency: 'THB', date: '2026-01-06' }], 'dime', '2026-01-11');
    expect(r).toMatchObject({ ok: true, pl: 100, netFlow: 1000 });
    expect(r.pct).toBeCloseTo(100 / 1500, 6);
  });
  it('refuses when cashflows are not confirmed or currencies differ (no guessing exchange rates)', () => {
    expect(c.adjustedReturn(s, [], 'dime', null).ok).toBe(false);
    const r = c.adjustedReturn(s, [{ platform: 'webull', type: 'deposit', amount: 500, currency: 'THB', date: '2026-01-06' }], 'webull', '2026-01-11');
    expect(r.ok).toBe(false); expect(r.reason).toContain('สกุลเงิน');
  });
  it('ignores dividends as cashflow (they are return) and data after the confirmation date', () => {
    const r = c.adjustedReturn([{ d: '2026-01-01', v: 1000 }, { d: '2026-01-11', v: 1100 }, { d: '2026-01-20', v: 5000 }], [{ platform: 'dime', type: 'dividend', amount: 50, currency: 'THB', date: '2026-01-05' }], 'dime', '2026-01-11');
    expect(r).toMatchObject({ ok: true, pl: 100, netFlow: 0, to: '2026-01-11' });
  });
});

describe('forecast', () => {
  it('recovers the true drift and excludes a deposit jump flagged by its note', () => {
    const s = mkSeries(200, '2026-01-01', 1000, 0.001);
    for (let i = 120; i < 200; i++) s[i].v = Math.round(s[i].v * 1.5 * 100) / 100; // +50% deposit on day 120
    s[120].n = 'deposit 50000thb';
    const f = c.forecast(s, [], 'dime', TODAY);
    expect(f.sufficient).toBe(true);
    expect(f.dailyDrift).toBeCloseTo(0.001, 4); // deposit step excluded -> drift unbiased
    expect(f.excluded).toBeGreaterThanOrEqual(1);
    const [eom, eoy, y1, y2, y3] = f.horizons;
    expect(y1.mid).toBeGreaterThan(eom.mid); expect(y3.mid).toBeGreaterThan(y2.mid);
    for (const h of f.horizons) { expect(h.lo).toBeLessThanOrEqual(h.mid); expect(h.hi).toBeGreaterThanOrEqual(h.mid); }
    expect(eoy.date).toMatch(/-12-31$/);
    expect(f.assumptions.join(' ')).toContain('ไม่มีเงินฝาก');
  });
  it('excludes small deposits that are only identifiable from a confirmed cashflow or a note', () => {
    const s = mkSeries(150, '2026-01-01', 1000, 0.0005);
    for (let i = 100; i < 150; i++) s[i].v = Math.round((s[i].v + 20) * 100) / 100; // +2% deposit (below the 8% jump threshold)
    const without = c.forecast(s, [], 'dime', TODAY);
    const withFlow = c.forecast(s, [{ platform: 'dime', type: 'deposit', amount: 20, currency: 'THB', date: s[100].d }], 'dime', TODAY);
    expect(withFlow.dailyDrift).toBeLessThan(without.dailyDrift);
    expect(withFlow.dailyDrift).toBeCloseTo(0.0005, 4);
  });
  it('says the data is insufficient instead of inventing numbers', () => {
    const f = c.forecast(mkSeries(20, '2026-09-01', 1000, 0.001), [], 'dime', TODAY);
    expect(f.sufficient).toBe(false); expect(f.reason).toContain('ข้อมูลยังไม่เพียงพอ');
    expect(c.forecast([], [], 'dime', TODAY).sufficient).toBe(false);
    expect(c.projectionPath(f, 365)).toEqual([]);
  });
  it('projection path widens with time', () => {
    const f = c.forecast(mkSeries(200, '2026-01-01', 1000, 0.001).map((p, i) => ({ ...p, v: p.v * (1 + (i % 2 ? 0.003 : -0.003)) })), [], 'dime', TODAY);
    const path = c.projectionPath(f, 365, 30);
    expect(path[0].lo).toBeCloseTo(path[0].hi, 6);
    expect(path.at(-1).hi - path.at(-1).lo).toBeGreaterThan(path[1].hi - path[1].lo);
  });
});

describe('alerts and table helpers', () => {
  it('flags stale data, sharp value drops (with a withdrawal caveat) and missing entries', () => {
    const portfolio = { dime: [{ d: '2026-10-01', v: 100 }, { d: '2026-10-05', v: 80, n: 'ถอนเงิน' }], stashaway: [{ d: '2026-10-15', v: 1 }], webull: [] };
    const a = c.buildAlerts(portfolio, [], TODAY).map((x) => x.text).join('\n');
    expect(a).toContain('Dime: ข้อมูลมูลค่าล่าสุด'); expect(a).toContain('มูลค่าลดลง'); expect(a).toContain('อาจมีการถอนเงิน'); expect(a).toContain('Webull: ยังไม่มีข้อมูล'); expect(a).toContain('ยังไม่มีการบันทึกกำไร/ขาดทุน');
  });
  it('searches, sorts and paginates', () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: i, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, note: i % 5 === 0 ? 'ฝาก' : '' }));
    expect(c.tableView(rows, { pageSize: 20, page: 3 })).toMatchObject({ total: 45, pages: 3, page: 3 });
    expect(c.tableView(rows, { query: 'ฝาก', searchKeys: ['note'] }).total).toBe(9);
    const sorted = c.tableView(rows, { sortKey: 'id', dir: 'asc', pageSize: 3 }).rows.map((r) => r.id);
    expect(sorted).toEqual([0, 1, 2]);
    expect(c.tableView(rows, { page: 99, pageSize: 20 }).page).toBe(3);
  });
});

describe('formatting', () => {
  it('formats money/pct/date consistently', () => {
    expect(fmtMoney(-1234.5, 'THB')).toBe('−฿1,234.50'); expect(fmtMoney(5, 'USD', { sign: true })).toBe('+$5.00'); expect(fmtMoney(null, 'THB')).toBe('—');
    expect(fmtPct(0.0123)).toBe('+1.23%'); expect(fmtPct(-0.5)).toBe('−50.00%'); expect(fmtDate('2026-10-16')).toBe('16/10/2026');
  });
  it('computes the Bangkok date regardless of the machine timezone', () => {
    expect(bangkokNow(new Date('2026-10-15T18:30:00Z')).date).toBe('2026-10-16');
    expect(bangkokNow(new Date('2026-10-16T16:59:00Z')).date).toBe('2026-10-16');
  });
});
