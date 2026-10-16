// Server-side input validation. Apps Script re-validates everything; this keeps bad input from ever leaving the Worker.
import { HttpError } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PLATFORMS = ['dime', 'stashaway', 'webull'] as const;
export const ENTRY_TYPES = ['profit_loss', 'cash_received'] as const;
export const CASHFLOW_TYPES = ['deposit', 'withdrawal', 'dividend'] as const;
const bad = (m: string) => new HttpError(400, 'VALIDATION', m);

export function uuid(v: unknown, label: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`${label} ต้องเป็น UUID`);
  return v.toLowerCase();
}
export function oneOf<T extends readonly string[]>(v: unknown, list: T, label: string): T[number] {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw bad(`${label} ไม่ถูกต้อง`);
  return v;
}
/** blank/undefined/null -> null (blank is NOT zero). */
export function amount(v: unknown, label: string): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'number' && typeof v !== 'string') throw bad(`${label} ไม่ใช่ตัวเลข`);
  const n = typeof v === 'number' ? v : Number(v.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) throw bad(`${label} ไม่ใช่ตัวเลข`);
  if (Math.abs(n) > 1e9) throw bad(`${label} เกินช่วงที่รับได้`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw bad(`${label} ทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
  return Math.round(n * 100) / 100;
}
export function dateStr(v: unknown, label: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${label} ต้องเป็น yyyy-MM-dd`);
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw bad(`${label} ไม่ใช่วันที่จริง`);
  if (v < '2000-01-01') throw bad(`${label} เก่าเกินไป`);
  return v;
}
export function note(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') throw bad('หมายเหตุต้องเป็นข้อความ');
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > 500) throw bad('หมายเหตุยาวเกิน 500 ตัวอักษร');
  return s;
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('รูปแบบข้อมูลไม่ถูกต้อง');
  return v as Record<string, unknown>;
}

export function parseDaily(body: unknown, opts: { requireRequestId: boolean }) {
  const b = obj(body);
  const out: Record<string, unknown> = {
    dime: amount(b.dime, 'Dime'), stashaway: amount(b.stashaway, 'StashAway'), webull: amount(b.webull, 'Webull'),
    type: oneOf(b.type, ENTRY_TYPES, 'ชนิดข้อมูล'), note: note(b.note),
  };
  if (out.dime === null && out.stashaway === null && out.webull === null) throw bad('ต้องกรอกอย่างน้อย 1 บัญชี');
  if (b.entryDate !== undefined && b.entryDate !== null && b.entryDate !== '') out.entryDate = dateStr(b.entryDate, 'วันที่ของรายการ');
  if (opts.requireRequestId) out.requestId = uuid(b.requestId, 'requestId');
  return out;
}
export function parsePortfolio(body: unknown) {
  const b = obj(body);
  const value = amount(b.value, 'มูลค่าพอร์ต');
  if (value === null || value < 0) throw bad('มูลค่าพอร์ตต้องเป็นตัวเลขไม่ติดลบ');
  const out: Record<string, unknown> = { platform: oneOf(b.platform, PLATFORMS, 'แพลตฟอร์ม'), value, note: note(b.note), requestId: uuid(b.requestId, 'requestId') };
  if (b.date) out.date = dateStr(b.date, 'วันที่');
  return out;
}
export const HIST_KINDS = ['value', 'superseded', 'event_amount', 'note_only', 'usd_event'] as const;
/** Stable record id: app rows use a UUID entry_id, imported rows use a 32-hex import_key. Never a row number. */
export function recordId(v: unknown): string {
  if (typeof v !== 'string' || !(UUID.test(v) || /^[0-9a-f]{32}$/i.test(v))) throw bad('recordId ไม่ถูกต้อง');
  return v.toLowerCase();
}
/** Edit of an existing history record. The platform comes from the URL and can never be changed; amount is in that platform's own currency. */
export function parsePortfolioEdit(body: unknown) {
  const b = obj(body);
  const value = amount(b.value, 'จำนวนเงิน');
  const kind = oneOf(b.kind ?? 'value', HIST_KINDS, 'ชนิดรายการ');
  if (value !== null && value < 0) throw bad('จำนวนเงินต้องไม่ติดลบ');
  if (kind === 'value' && value === null) throw bad('รายการมูลค่าพอร์ตต้องมีจำนวนเงิน');
  return { date: dateStr(b.date, 'วันที่'), value, kind, note: note(b.note), expectedRevision: parseRevision(b.expectedRevision) };
}
export function parsePasswordChange(body: unknown) {
  const b = obj(body);
  const str = (x: unknown, l: string) => { if (typeof x !== 'string' || x.length < 1 || x.length > 256) throw bad(`${l} ไม่ถูกต้อง`); return x; };
  const current = str(b.current, 'รหัสผ่านปัจจุบัน'), next = str(b.next, 'รหัสผ่านใหม่');
  if (b.confirm !== undefined && b.confirm !== next) throw bad('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
  return { current, next };
}
export function parseCashflow(body: unknown) {
  const b = obj(body);
  const amt = amount(b.amount, 'จำนวนเงิน');
  if (amt === null || amt <= 0) throw bad('จำนวนเงินต้องมากกว่า 0');
  return { platform: oneOf(b.platform, PLATFORMS, 'แพลตฟอร์ม'), type: oneOf(b.type, CASHFLOW_TYPES, 'ประเภท'), amount: amt, currency: oneOf(b.currency, ['THB', 'USD'] as const, 'สกุลเงิน'), date: dateStr(b.date, 'วันที่'), note: note(b.note), requestId: uuid(b.requestId, 'requestId') };
}
export function parseSettings(body: unknown) {
  const b = obj(body);
  const allowed = ['goal_dime_thb', 'goal_stashaway_thb', 'goal_webull_usd', 'usd_thb_rate', 'usd_thb_rate_date', 'cashflows_confirmed_through', 'forecast_window_days'];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!allowed.includes(k)) throw bad(`ตั้งค่า ${k} แก้ไขไม่ได้`);
    out[k] = v === '' ? null : v;
  }
  if (!Object.keys(out).length) throw bad('ไม่มีค่าที่จะบันทึก');
  return out;
}
export function parseRevision(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1e6) throw bad('revision ไม่ถูกต้อง');
  return n;
}
export function parseImport(body: unknown) {
  const b = obj(body);
  const kind = oneOf(b.kind, ['historical', 'review', 'cashflowReview'] as const, 'kind');
  if (kind === 'historical') {
    if (!Array.isArray(b.rows) || b.rows.length < 1 || b.rows.length > 200) throw bad('rows ต้องมี 1-200 รายการ');
    return { action: 'importHistorical', payload: { platform: oneOf(b.platform, PLATFORMS, 'แพลตฟอร์ม'), rows: b.rows } };
  }
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 200) throw bad('items ต้องมี 1-200 รายการ');
  return { action: kind === 'review' ? 'importReview' : 'importCashflowReview', payload: { items: b.items } };
}
