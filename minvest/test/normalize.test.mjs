import { describe, expect, it } from 'vitest';
import { normalizeSheet, parseDmy, suggestNumber, classifyNote, extractAmounts, reconcile } from '../tools/normalize.mjs';

const TODAY = new Date('2026-10-16T00:00:00Z');
const H = ['วันที่', 'ราคา(บาท)', 'ราคา(USD)', 'หมายเหตุ'];

describe('primitive parsers', () => {
  it('parses d/m/yy and d/m/yyyy, rejects impossible dates', () => {
    expect(parseDmy('14/6/24')).toBe('2024-06-14'); expect(parseDmy('5/10/2026')).toBe('2026-10-05');
    expect(parseDmy('31/2/25')).toBe('INVALID'); expect(parseDmy('AUG 25')).toBeNull();
  });
  it('only SUGGESTS corrections for malformed numbers', () => {
    expect(suggestNumber('123456..78')).toBe(123456.78); expect(suggestNumber('123.456.78')).toBe(123456.78); expect(suggestNumber('abc')).toBeNull();
  });
  it('detects cash-movement hints and amounts in Thai/English notes', () => {
    expect(classifyNote('deposit 1000thb')).toEqual(['deposit']); expect(classifyNote('ถอนเงินออก')).toEqual(['withdrawal']); expect(classifyNote('ปันผล XLE 16.77')).toEqual(['dividend']); expect(classifyNote('buy voo')).toEqual([]);
    expect(extractAmounts('ฝากเงินเข้า50,000THB').thb).toEqual([50000]); expect(extractAmounts('buy WSM 200usd').usd).toEqual([200]);
  });
});

describe('normalizeSheet', () => {
  it('keeps every row: markers, malformed numbers, notes and blanks are accounted for (nothing silently dropped)', () => {
    const rows = [H, ['JULY 24'], ['1/7/24', 100], ['2/7/24', '123456..78'], ['3/7/24', 120, null, 'deposit 50000thb'], [null, null], ['???', 5]];
    const s = normalizeSheet('Dime24', rows, { today: TODAY });
    expect(s.summary).toMatchObject({ nonEmptyRows: 5, markerRows: 1, dateRows: 3, unrecognizedRows: 1, blankRows: 1, importedRows: 3 });
    expect(reconcile(s).ok).toBe(true);
    expect(s.rows.map((r) => r.kind)).toEqual(['value', 'value_unparsed', 'value']);
    const bad = s.rows[1];
    expect(bad.thb).toBeNull(); expect(bad.raw.thb).toBe('123456..78'); expect(bad.suggestedValue).toBe(123456.78); expect(bad.reviewFlag).toContain('ไม่แก้เอง');
    expect(s.review.some((r) => r.reason === 'month_marker')).toBe(true);
    expect(s.review.some((r) => r.reason === 'unrecognized_row' && r.severity === 'warn')).toBe(true);
    expect(s.cashflowReview).toEqual([expect.objectContaining({ suggestedType: 'deposit', suggestedAmountThb: 50000, status: 'pending_owner_confirmation' })]);
  });
  it('uses the day-closing value on multi-row dates and never treats a withdrawal amount as a portfolio value', () => {
    const rows = [H, ['4/7/24', 31000.5], ['4/7/24', null, 300, 'ซื้อ MSFT'], ['4/7/24', 4000.25, 109, 'ถอนเงินออกเข้า KBANK'], ['4/7/24', 27000.75, null, 'มูลค่าในพอร์ตใหม่']];
    const s = normalizeSheet('Dime24', rows, { today: TODAY });
    expect(s.rows.map((r) => r.kind)).toEqual(['superseded', 'usd_event', 'event_amount', 'value']);
    expect(s.rows.filter((r) => r.kind === 'value').map((r) => r.thb)).toEqual([27000.75]);
  });
  it('treats text in the Dime USD column as a note, and maps Webull to USD / StashAway to THB', () => {
    const d = normalizeSheet('Dime24', [H, ['31/1/25', 30000.1, 'ซื้อ VOO ETF']], { today: TODAY }).rows[0];
    expect(d.note).toBe('ซื้อ VOO ETF'); expect(d.usd).toBeNull(); expect(d.kind).toBe('value');
    const w = normalizeSheet('WeBull', [['วันที่', 'ราคา(USD)', 'หมายเหตุ'], ['15/8/25', 1543.91, 'deposit 18000thb']], { today: TODAY }).rows[0];
    expect(w).toMatchObject({ usd: 1543.91, thb: null, kind: 'value' });
    const st = normalizeSheet('StashAway', [['วันที่', 'ราคา(บาท)', 'หมายเหตุ'], ['2/5/25', 1000, 'deposit']], { today: TODAY }).rows[0];
    expect(st).toMatchObject({ thb: 1000, usd: null });
  });
  it('is deterministic: identical input gives identical import keys (idempotent import)', () => {
    const rows = [H, ['1/7/24', 100], ['2/7/24', 101]];
    const a = normalizeSheet('Dime24', rows, { today: TODAY }).rows.map((r) => r.importKey);
    const b = normalizeSheet('Dime24', rows, { today: TODAY }).rows.map((r) => r.importKey);
    expect(a).toEqual(b); expect(new Set(a).size).toBe(2);
    expect(normalizeSheet('Dime24', [H, ['1/7/24', 100], ['2/7/24', 102]], { today: TODAY }).rows[1].importKey).not.toBe(a[1]);
  });
  it('flags impossible, out-of-range and out-of-order dates instead of guessing', () => {
    const s = normalizeSheet('StashAway', [['วันที่', 'ราคา(บาท)', 'หมายเหตุ'], ['10/6/25', 1], ['9/6/25', 2], ['31/2/25', 3], ['1/1/45', 4]], { today: TODAY });
    expect(s.rows[1].reviewFlag).toContain('ย้อนหลัง'); expect(s.rows[2].date).toBeNull(); expect(s.rows[2].reviewFlag).toContain('ไม่มีอยู่จริง'); expect(s.rows[3].reviewFlag).toContain('นอกช่วง');
  });
});

describe('precision', () => {
  it('keeps values with >2 decimals unchanged and flags them for the owner', () => {
    const r = normalizeSheet('StashAway', [['วันที่', 'ราคา(บาท)', 'หมายเหตุ'], ['1/7/25', 50000.255]], { today: TODAY }).rows[0];
    expect(r.thb).toBe(50000.255); expect(r.kind).toBe('value'); expect(r.reviewFlag).toContain('ทศนิยมมากกว่า 2');
  });
});
