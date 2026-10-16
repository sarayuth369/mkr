// Runs ONLY when the owner's real Excel file is present (set MINVEST_EXCEL or use the default Desktop path).
// Asserts invariants / reconciliation on REAL data. Prints no portfolio values.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWorkbook } from '../tools/load-workbook.mjs';
import { reconcile } from '../tools/normalize.mjs';
import { forecast } from '../public/js/calc.js';

const FILE = process.env.MINVEST_EXCEL || 'C:\\Users\\lsara\\Desktop\\value infox.xlsx';
const present = existsSync(FILE);
const sheets = present ? await loadWorkbook(FILE) : [];
const by = Object.fromEntries(sheets.map((s) => [s.key, s]));
const d = present ? describe : describe.skip;

d('REAL value infox.xlsx', () => {
  it('reads all three sheets and reconciles every non-empty row', () => {
    expect(sheets.map((s) => s.sheet)).toEqual(['Dime24', 'StashAway', 'WeBull']);
    for (const s of sheets) { expect(reconcile(s).ok, s.sheet).toBe(true); expect(s.summary.unrecognizedRows).toBe(0); expect(s.summary.importedRows).toBe(s.summary.dateRows); }
  });
  it('every date row is a real date inside the expected range, none dropped, series chronological', () => {
    for (const s of sheets) {
      expect(s.rows.every((r) => r.date && r.date >= '2024-06-01' && r.date <= '2026-12-31'), s.sheet).toBe(true);
      const vals = s.rows.filter((r) => r.kind === 'value').map((r) => r.date);
      expect([...vals].sort()).toEqual(vals);
    }
  });
  it('known data traps are caught: malformed numbers kept raw, withdrawal amount not treated as a value', () => {
    const unparsed = by.dime.rows.filter((r) => r.kind === 'value_unparsed');
    expect(unparsed.length).toBeGreaterThanOrEqual(2);
    for (const r of unparsed) { expect(r.thb).toBeNull(); expect(r.raw.thb).toBeTruthy(); expect(r.suggestedValue).toBeGreaterThan(1000); }
    const jul4 = by.dime.rows.filter((r) => r.date === '2024-07-04');
    expect(jul4.some((r) => r.kind === 'event_amount')).toBe(true);
    expect(jul4.filter((r) => r.kind === 'value')).toHaveLength(1);
  });
  it('Dime USD-column amounts are never used as portfolio values; Webull is USD-only, StashAway THB-only', () => {
    expect(by.dime.rows.filter((r) => r.kind === 'value').every((r) => r.thb !== null)).toBe(true);
    expect(by.webull.rows.every((r) => r.thb === null)).toBe(true);
    expect(by.stashaway.rows.every((r) => r.usd === null)).toBe(true);
  });
  it('deposit hints are captured for owner confirmation (never auto-confirmed)', () => {
    const all = sheets.flatMap((s) => s.cashflowReview);
    expect(all.some((x) => x.suggestedType === 'deposit' && x.suggestedAmountThb > 0)).toBe(true);
    expect(all.every((x) => x.status === 'pending_owner_confirmation')).toBe(true);
  });
  it('forecast runs on the real series, removes real deposit jumps over full history, never produces NaN', () => {
    for (const s of sheets) {
      const seen = new Map();
      for (const r of s.rows) if (r.kind === 'value') seen.set(r.date, { d: r.date, v: s.key === 'webull' ? r.usd : r.thb, n: r.note ?? '' });
      const series = [...seen.keys()].sort().map((k) => seen.get(k));
      const f = forecast(series, [], s.key, '2026-10-16');
      expect(f.sufficient, s.key).toBe(true);
      for (const h of f.horizons) for (const v of [h.mid, h.lo, h.hi]) expect(Number.isFinite(v)).toBe(true);
      // Over the FULL history the real deposits must be detected and removed from the trend estimate.
      const full = forecast(series, [], s.key, '2026-10-16', { windowDays: 2000 });
      expect(full.sufficient, s.key).toBe(true);
      expect(full.excluded, s.key).toBeGreaterThan(0);
    }
  });
});
