// Automatic P/L from consecutive portfolio values (TEST data only).
import { describe, expect, it } from 'vitest';
import * as c from '../public/js/calc.js';

const P = (d, v, n = '') => ({ d, v, n });
const dep = (date, amount, platform = 'dime', type = 'deposit', currency = 'THB') => ({ date, amount, platform, type, currency });

describe('periodPL', () => {
  it('no deposit/withdrawal recorded: the whole value change is P/L (auto)', () => {
    const r = c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 1012.5), [], 'dime');
    expect(r).toMatchObject({ status: 'auto', pl: 12.5, change: 12.5, days: 1 });
    expect(r.pct).toBeCloseTo(0.0125, 6);
  });
  it('a loss is a negative P/L', () => {
    expect(c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 990), [], 'dime')).toMatchObject({ status: 'auto', pl: -10 });
  });
  it('deposit in the period: net deposit is removed, only the remainder is P/L', () => {
    const r = c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 2005), [dep('2026-10-16', 1000)], 'dime');
    expect(r).toMatchObject({ status: 'adjusted', change: 1005, netFlow: 1000, pl: 5, flows: 1 });
  });
  it('withdrawal: removed value is added back (withdrawing is not a loss)', () => {
    const r = c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 505), [dep('2026-10-16', 500, 'dime', 'withdrawal')], 'dime');
    expect(r).toMatchObject({ status: 'adjusted', netFlow: -500, pl: 5 });
  });
  it('dividends are income, not a deposit: they stay in P/L', () => {
    expect(c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 1010), [dep('2026-10-16', 10, 'dime', 'dividend')], 'dime')).toMatchObject({ status: 'auto', pl: 10 });
  });
  it('cashflows of other platforms or outside the period are ignored', () => {
    const flows = [dep('2026-10-16', 999, 'stashaway'), dep('2026-10-15', 999), dep('2026-10-17', 999)];
    expect(c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 1001), flows, 'dime')).toMatchObject({ status: 'auto', pl: 1 });
  });
  it('suspicious jump with NO recorded cashflow is not counted as profit (check)', () => {
    const r = c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 1500), [], 'dime');
    expect(r.status).toBe('check'); expect(r.pl).toBeUndefined(); expect(r.reason).toContain('50.0%');
  });
  it('a note mentioning deposit/withdraw without a recorded cashflow is a check', () => {
    expect(c.periodPL(P('2026-10-15', 1000), P('2026-10-16', 1010, 'ฝากเพิ่ม'), [], 'dime').status).toBe('check');
  });
  it('currency mismatch between cashflow and portfolio is a check (no FX guessing)', () => {
    expect(c.periodPL(P('2026-10-15', 100), P('2026-10-16', 150), [dep('2026-10-16', 50, 'webull', 'deposit', 'THB')], 'webull').status).toBe('check');
  });
  it('multi-day gap is labelled with its length', () => {
    expect(c.periodPL(P('2026-10-10', 1000), P('2026-10-16', 1010), [], 'dime').days).toBe(6);
  });
});

describe('autoPL', () => {
  const series = [P('2026-09-01', 1000), P('2026-09-02', 1010), P('2026-09-03', 1600, 'ฝาก'), P('2026-09-04', 1610), P('2026-10-10', 1620)];
  it('needs at least two values', () => { expect(c.autoPL([P('2026-10-16', 1)], [], 'dime').ok).toBe(false); });
  it('sums countable periods in the window and reports what it skipped', () => {
    const r = c.autoPL(series.slice(0, 4), [], 'dime', { windowDays: 30 });
    expect(r).toMatchObject({ ok: true, periods: 3, counted: 2, skipped: 1, sum: 20 }); // +10, (check skipped), +10
    expect(r.latest).toMatchObject({ status: 'auto', pl: 10 });
  });
  it('with the deposit recorded the same jump becomes countable', () => {
    const r = c.autoPL(series.slice(0, 4), [dep('2026-09-03', 580)], 'dime', { windowDays: 30 });
    expect(r).toMatchObject({ counted: 3, skipped: 0, sum: 10 + 10 + 10 });
  });
  it('only periods inside the window count', () => {
    expect(c.autoPL(series, [], 'dime', { windowDays: 5 }).periods).toBe(1);
  });
});
