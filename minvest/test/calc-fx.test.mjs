// FX / Total THB / window changes / history filters / CSV (TEST data only - no real portfolio values).
import { describe, expect, it } from 'vitest';
import * as c from '../public/js/calc.js';

describe('FX: Webull USD -> THB conversion and Total THB', () => {
  const hist = { status: 'fresh', rates: { '2026-10-01': 30, '2026-10-02': 31, '2026-10-05': 32 }, priorDate: '2026-09-30', priorRate: 29 };
  const idx = c.fxIndex(hist);
  const pf = {
    dime: [{ d: '2026-10-01', v: 1000 }, { d: '2026-10-05', v: 1100 }],
    stashaway: [{ d: '2026-10-01', v: 500 }, { d: '2026-10-05', v: 520 }],
    webull: [{ d: '2026-10-01', v: 100 }, { d: '2026-10-04', v: 110 }, { d: '2026-10-05', v: 120 }],
  };

  it('rate lookup: exact day, carry-forward on weekend/holiday, none before the first rate', () => {
    expect(c.fxRateFor(idx, '2026-10-02')).toEqual({ rate: 31, rateDate: '2026-10-02', carried: false });
    expect(c.fxRateFor(idx, '2026-10-04')).toEqual({ rate: 31, rateDate: '2026-10-02', carried: true });
    expect(c.fxRateFor(idx, '2026-09-30')).toMatchObject({ rate: 29, carried: false });
    expect(c.fxRateFor(idx, '2026-09-29')).toBeNull();
    expect(c.fxIndex({ status: 'unavailable', rates: {} })).toBeNull();
    expect(c.fxRateFor(null, '2026-10-02')).toBeNull();
  });
  it("USD history is converted with EACH date's own rate and the USD original is preserved", () => {
    const r = c.convertUsdSeries(pf.webull, idx);
    expect(r.points.map((p) => [p.d, p.usd, p.rate, p.v, p.carried])).toEqual([['2026-10-01', 100, 30, 3000, false], ['2026-10-04', 110, 31, 3410, true], ['2026-10-05', 120, 32, 3840, false]]);
    expect(pf.webull[0]).toEqual({ d: '2026-10-01', v: 100 }); // input untouched
    const early = c.convertUsdSeries([{ d: '2026-09-01', v: 5 }], idx);
    expect(early.points).toHaveLength(0); expect(early.missing).toBe(1); // no rate -> not converted, never today's rate
  });
  it('Total THB = Dime + StashAway + Webull USD x rate (never USD + THB directly)', () => {
    const n = c.totalThbNow(pf, { status: 'fresh', rate: 33.5, rateDate: '2026-10-15' });
    expect(n.webullThb).toBe(4020); // 120 x 33.5
    expect(n.total).toBe(1100 + 520 + 4020);
    expect(n.total).not.toBe(1100 + 520 + 120); // the forbidden direct sum
    expect(n).toMatchObject({ webullUsd: 120, rate: 33.5, rateDate: '2026-10-15', stale: false, blocked: false, partial: false });
  });
  it('unavailable rate: no total, no guess; THB-only subtotal is still shown separately', () => {
    const n = c.totalThbNow(pf, { status: 'unavailable' });
    expect(n.total).toBeNull(); expect(n.webullThb).toBeNull(); expect(n.blocked).toBe(true); expect(n.thbSubtotal).toBe(1620);
    expect(c.totalThbNow(pf, null).total).toBeNull();
  });
  it('stale rate is used but flagged; partial data is flagged and lists what is missing', () => {
    expect(c.totalThbNow(pf, { status: 'stale', rate: 30, rateDate: '2026-10-01' })).toMatchObject({ stale: true, total: 1100 + 520 + 3600 });
    const p = c.totalThbNow({ ...pf, stashaway: [] }, { status: 'fresh', rate: 30, rateDate: '2026-10-15' });
    expect(p).toMatchObject({ partial: true, missing: ['stashaway'], total: 1100 + 3600 });
  });
  it('allocation shares sum to 1 and use the converted total', () => {
    const a = c.allocation(c.totalThbNow(pf, { status: 'fresh', rate: 30, rateDate: '2026-10-15' }));
    expect(a.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
    expect(a.find((x) => x.platform === 'webull').thb).toBe(3600);
    expect(c.allocation({ total: null })).toBeNull();
  });
  it('historical total starts when ALL three exist, uses each date rate, carries portfolio values and flags carried rates', () => {
    const s = c.totalThbSeries(pf, idx);
    expect(s.start).toBe('2026-10-01');
    expect(s.points.map((p) => [p.d, p.total, p.rate, p.carried])).toEqual([
      ['2026-10-01', 1000 + 500 + 3000, 30, false],
      ['2026-10-04', 1000 + 500 + 3410, 31, true], // dime/stashaway carried from 10-01, webull has a record, weekend rate carried
      ['2026-10-05', 1100 + 520 + 3840, 32, false],
    ]);
    expect(c.totalThbSeries({ ...pf, dime: [] }, idx).points).toEqual([]); // not all three -> no fabricated total
    expect(c.totalThbSeries(pf, null).points).toEqual([]);
  });
  it('window change: value effect + FX effect = total change; FX movement is split out, not presented as profit', () => {
    const s = c.totalThbSeries(pf, idx).points;
    const w = c.totalWindowChange(s, '2026-10-01');
    expect(w.ok).toBe(true);
    expect(w.abs).toBe(1100 + 520 + 3840 - (1000 + 500 + 3000));
    expect(w.fxEffect).toBe(100 * (32 - 30));
    expect(w.valueEffect + w.fxEffect).toBeCloseTo(w.abs, 2);
  });
  it('constant rate => FX effect is exactly 0 (no FX-derived P/L)', () => {
    const flat = c.fxIndex({ rates: { '2026-10-01': 30, '2026-10-05': 30 } });
    expect(c.totalWindowChange(c.totalThbSeries(pf, flat).points, '2026-10-01').fxEffect).toBe(0);
  });
});

describe('window changes are strict (no silent shorter baseline)', () => {
  const s = [{ d: '2026-07-01', v: 100 }, { d: '2026-09-20', v: 120 }, { d: '2026-10-15', v: 150 }];
  it('7/30/90/YTD windows', () => {
    expect(c.windowStart('2026-10-16', '30d')).toBe('2026-09-16'); expect(c.windowStart('2026-10-16', 'ytd')).toBe('2026-01-01');
    expect(c.windowChange(s, '2026-09-20')).toMatchObject({ ok: true, from: '2026-09-20', abs: 30 });
  });
  it('refuses when history does not reach the window start or the baseline is too old', () => {
    expect(c.windowChange(s, '2026-01-01').ok).toBe(false);
    expect(c.windowChange(s, '2026-08-20').ok).toBe(false); // baseline 07-01 is >10 days older
    expect(c.windowChange([], '2026-10-01').ok).toBe(false);
  });
});

describe('history filters + CSV export', () => {
  const rows = [
    { date: '2026-09-01', kind: 'value', status: 'active', thb: 1, note: 'a' },
    { date: '2026-09-02', kind: 'event_amount', status: 'active', thb: 2, note: 'b' },
    { date: '2026-09-03', kind: 'value', status: 'void', thb: 3, note: 'c' },
  ];
  it('hides deleted by default and filters kind/date range', () => {
    expect(c.filterHistory(rows).map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(c.filterHistory(rows, { showVoid: true }).length).toBe(3);
    expect(c.filterHistory(rows, { kind: 'value', showVoid: true }).length).toBe(2);
    expect(c.filterHistory(rows, { from: '2026-09-02', to: '2026-09-02' }).map((r) => r.date)).toEqual(['2026-09-02']);
  });
  it('CSV keeps ISO dates + original currency, quotes text, and neutralises formula injection', () => {
    const csv = c.toCsv([['date', 'date'], ['amount', 'amt'], ['currency', 'ccy', true], ['note', 'note', true]], [
      { date: '2026-09-01', amt: -12.5, ccy: 'USD', note: '=HYPERLINK("x")' },
      { date: '2026-09-02', amt: 3, ccy: 'THB', note: 'a,"b"' },
      { date: '2026-09-03', amt: null, ccy: 'THB', note: '@cmd' },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('2026-09-01,-12.5,"USD","\'=HYPERLINK(""x"")"');
    expect(lines[2]).toBe('2026-09-02,3,"THB","a,""b"""');
    expect(lines[3]).toBe('2026-09-03,,"THB","\'@cmd"');
  });
});
