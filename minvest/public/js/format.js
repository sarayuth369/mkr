// Consistent Thai-friendly formatting for numbers, currency and dates (Gregorian year, matching the spreadsheet).
const nf = (min, max) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: min, maximumFractionDigits: max });
const n2 = nf(2, 2);
const n0 = nf(0, 0);

export const fmtNum = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : (digits === 0 ? n0 : n2).format(v));
export function fmtMoney(v, ccy, { sign = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sym = ccy === 'USD' ? '$' : '฿';
  const s = n2.format(Math.abs(v));
  const lead = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${lead}${sym}${s}`;
}
export const fmtPct = (v, { sign = true } = {}) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}${(Math.abs(v) * 100).toFixed(2)}%`);
/** yyyy-MM-dd -> dd/MM/yyyy */
export const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const signClass = (v) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'pos' : 'neg');

/** Bangkok "today" as yyyy-MM-dd and current time label, independent of the browser's timezone. */
export function bangkokNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, label: `${p.day}/${p.month}/${p.year} ${Number(p.hour)}:${p.minute}` };
}
