// Pure normalization of the owner's `value infox.xlsx` rows into the minvest
// `Historical_*` model. No I/O, no Google/Cloudflare dependency - unit-testable.
//
// Hard rules (from the project brief):
//  * The Excel columns are PORTFOLIO VALUES (+ free-text notes), never income.
//    Nothing here converts a value change into profit.
//  * Never invent data. Unreadable cells are kept raw and flagged for review.
//  * Never convert USD <-> THB.
//  * Re-running on the same input must yield identical `import_key`s.

import { createHash } from 'node:crypto';

export const PLATFORMS = {
  Dime24: { key: 'dime', historicalSheet: 'Historical_Dime', primary: 'thb', ccy: 'THB', cols: { thb: 1, usd: 2, note: 3 } },
  StashAway: { key: 'stashaway', historicalSheet: 'Historical_StashAway', primary: 'thb', ccy: 'THB', cols: { thb: 1, usd: null, note: 2 } },
  WeBull: { key: 'webull', historicalSheet: 'Historical_Webull', primary: 'usd', ccy: 'USD', cols: { thb: null, usd: 1, note: 2 } },
};

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const MONTH_MARKER = /^[A-Za-z]{3,9}\.?\s+\d{2}$/;
const MIN_DATE = '2020-01-01';

export function parseDmy(text) {
  const m = DMY.exec(String(text).trim());
  if (!m) return null;
  let [, d, mo, y] = m;
  d = Number(d); mo = Number(mo); y = Number(y);
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return 'INVALID';
  return dt.toISOString().slice(0, 10);
}

/** Suggestion only (never auto-applied): "123456..78" -> 123456.78, "123.456.78" -> 123456.78 */
export function suggestNumber(text) {
  const s = String(text).trim().replace(/,/g, '');
  if (!/^[\d.]+$/.test(s) || !/\d/.test(s)) return null;
  const last = s.lastIndexOf('.');
  if (last === -1) return Number(s);
  const intPart = s.slice(0, last).replace(/\./g, '');
  const n = Number(`${intPart}.${s.slice(last + 1)}`);
  return Number.isFinite(n) ? n : null;
}

const KW = {
  deposit: /deposit|ฝาก|เพิ่มทุน/i,
  withdrawal: /\bwd\b|withdraw|ถอน/i,
  dividend: /ปันผล|dividend/i,
};
const WITHDRAW_ONLY = KW.withdrawal;

export function classifyNote(note) {
  if (!note) return [];
  const out = [];
  for (const [type, re] of Object.entries(KW)) if (re.test(note)) out.push(type);
  return out;
}

export function extractAmounts(note) {
  const thb = [...String(note).matchAll(/([\d][\d,]*(?:\.\d+)?)\s*thb/gi)].map((m) => Number(m[1].replace(/,/g, '')));
  const usd = [...String(note).matchAll(/([\d][\d,]*(?:\.\d+)?)\s*(?:usd|\$)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
  return { thb, usd };
}

const asText = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? v : String(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function importKey(platform, sourceRow, raw) {
  return createHash('sha256')
    .update([platform, sourceRow, raw.date ?? '', raw.thb ?? '', raw.usd ?? '', raw.note ?? ''].join('␟'))
    .digest('hex')
    .slice(0, 32);
}

/**
 * @param {string} sheetName  one of PLATFORMS keys
 * @param {Array<Array<any>>} rows  raw rows INCLUDING header row (index 0 = header)
 */
export function normalizeSheet(sheetName, rows, { today = new Date() } = {}) {
  const cfg = PLATFORMS[sheetName];
  if (!cfg) throw new Error(`Unknown sheet ${sheetName}`);
  const maxDate = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const out = [];
  const review = [];
  const stats = { sourceRows: 0, nonEmptyRows: 0, dateRows: 0, markerRows: 0, blankRows: 0, unrecognizedRows: 0 };

  // pass 1: classify every row
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const sourceRow = i + 1;
    stats.sourceRows++;
    const a = r[0];
    const cells = r.slice(0, 4);
    if (cells.every((c) => c === null || c === undefined || c === '')) { stats.blankRows++; continue; }
    stats.nonEmptyRows++;
    const aText = asText(a)?.trim() ?? '';
    const iso = parseDmy(aText);
    if (iso === null) {
      if (MONTH_MARKER.test(aText) && cells.slice(1).every((c) => c === null || c === undefined || c === '')) {
        stats.markerRows++;
        review.push({ platform: cfg.key, sourceRow, severity: 'info', reason: 'month_marker', detail: aText, raw: aText });
      } else {
        stats.unrecognizedRows++;
        review.push({ platform: cfg.key, sourceRow, severity: 'warn', reason: 'unrecognized_row', detail: 'ไม่ใช่วันที่หรือหัวข้อเดือน เก็บค่าต้นฉบับไว้', raw: cells.map(asText).join(' | ') });
      }
      continue;
    }
    stats.dateRows++;
    const rawThb = cfg.cols.thb === null ? null : r[cfg.cols.thb] ?? null;
    const rawUsd = cfg.cols.usd === null ? null : r[cfg.cols.usd] ?? null;
    const rawNote = r[cfg.cols.note] ?? null;
    parsed.push({ sourceRow, aText, iso, rawThb, rawUsd, rawNote });
  }

  // last row index per date (to decide the day's closing value)
  const lastValueRowOfDate = new Map();
  for (const p of parsed) {
    const primary = cfg.primary === 'thb' ? p.rawThb : p.rawUsd;
    if (isNum(primary)) lastValueRowOfDate.set(p.iso, p.sourceRow);
  }

  let prevIso = null;
  for (const p of parsed) {
    const flags = [];
    if (p.iso === 'INVALID') flags.push('วันที่ไม่มีอยู่จริง');
    else {
      if (p.iso < MIN_DATE || p.iso > maxDate) flags.push('วันที่อยู่นอกช่วงที่คาดไว้');
      if (prevIso && p.iso < prevIso) flags.push('วันที่ย้อนหลังจากแถวก่อนหน้า');
      prevIso = p.iso > (prevIso ?? '') ? p.iso : prevIso;
    }

    // map raw cells -> numbers / text notes
    const noteParts = [];
    let thb = null, usd = null, kind = 'note_only', suggested = null;
    const takeText = (v) => { if (typeof v === 'string' && v.trim() !== '') noteParts.push(v.trim()); };

    const primaryRaw = cfg.primary === 'thb' ? p.rawThb : p.rawUsd;
    if (cfg.cols.thb !== null) { if (isNum(p.rawThb)) thb = p.rawThb; }
    if (cfg.cols.usd !== null) { if (isNum(p.rawUsd)) usd = p.rawUsd; }
    if (typeof primaryRaw === 'string' && primaryRaw.trim() !== '') {
      const sug = suggestNumber(primaryRaw);
      if (sug !== null) { suggested = sug; kind = 'value_unparsed'; flags.push(`ตัวเลขผิดรูปแบบ "${primaryRaw}" - ระบบไม่แก้เอง (ค่าที่น่าจะเป็น ${sug})`); }
      else takeText(primaryRaw);
    }
    // text sitting in the *non-primary* numeric column (Dime col C) is a note
    if (cfg.cols.usd !== null && cfg.primary === 'thb') takeText(p.rawUsd);
    takeText(p.rawNote);
    const note = noteParts.length ? noteParts.join(' | ') : null;

    const primaryNum = isNum(primaryRaw) ? primaryRaw : null;
    if (kind !== 'value_unparsed') {
      if (primaryNum !== null) {
        const laterSameDay = lastValueRowOfDate.get(p.iso) !== p.sourceRow;
        if (laterSameDay) {
          if (note && WITHDRAW_ONLY.test(note)) { kind = 'event_amount'; flags.push('จำนวนเงินถอน ไม่ใช่มูลค่าพอร์ต (มีแถวใหม่ของวันเดียวกันตามมา)'); }
          else { kind = 'superseded'; flags.push('มีแถวของวันเดียวกันตามมา ใช้แถวสุดท้ายของวันเป็นมูลค่าปิด'); }
        } else kind = 'value';
      } else if (cfg.primary === 'thb' && usd !== null) {
        kind = 'usd_event';
      } else if (note) kind = 'note_only';
      else kind = 'note_only';
    }
    for (const [label, val] of [['บาท', thb], ['USD', usd]]) if (val !== null && Math.abs(val * 100 - Math.round(val * 100)) > 1e-6) flags.push(`ค่า${label}มีทศนิยมมากกว่า 2 ตำแหน่ง (เก็บค่าเดิมไว้ ไม่ปัดเศษ)`);
    if (cfg.key === 'dime' && usd !== null) flags.push('คอลัมน์ ราคา(USD) ของ Dime เป็นจำนวนธุรกรรม ไม่ใช่มูลค่าพอร์ต - ตรวจสอบ');
    if (kind === 'note_only' && !note) flags.push('แถวไม่มีตัวเลขและไม่มีหมายเหตุ');

    const raw = { date: p.aText, thb: asText(p.rawThb), usd: asText(p.rawUsd), note: asText(p.rawNote) };
    const rec = {
      platform: cfg.key,
      sheet: cfg.historicalSheet,
      date: p.iso === 'INVALID' ? null : p.iso,
      thb,
      usd,
      note,
      kind,
      sourceSheet: sheetName,
      sourceRow: p.sourceRow,
      raw,
      reviewFlag: flags.length ? flags.join('; ') : '',
      importKey: importKey(cfg.key, p.sourceRow, raw),
    };
    if (suggested !== null) rec.suggestedValue = suggested;
    out.push(rec);
    if (flags.length && kind !== 'superseded') {
      review.push({ platform: cfg.key, sourceRow: p.sourceRow, severity: kind === 'value_unparsed' || p.iso === 'INVALID' ? 'error' : 'warn', reason: kind, detail: flags.join('; '), raw: [raw.date, raw.thb, raw.usd, raw.note].filter(Boolean).join(' | ') });
    }
  }

  // cashflow hints from notes (suggestions only - owner must confirm)
  const cashflowReview = [];
  for (const rec of out) {
    const types = classifyNote(rec.note);
    for (const t of types) {
      const amt = extractAmounts(rec.note);
      cashflowReview.push({
        platform: rec.platform, date: rec.date, sourceRow: rec.sourceRow, suggestedType: t,
        suggestedAmountThb: amt.thb.length ? amt.thb[0] : null,
        suggestedAmountUsd: amt.usd.length ? amt.usd[0] : null,
        note: rec.note, status: 'pending_owner_confirmation',
      });
    }
  }

  const sumPrimary = out.reduce((s, r) => s + (cfg.primary === 'thb' ? r.thb ?? 0 : r.usd ?? 0), 0);
  const valueRows = out.filter((r) => r.kind === 'value');
  const dated = out.filter((r) => r.date).map((r) => r.date).sort();
  return {
    key: cfg.key, sheet: sheetName, historicalSheet: cfg.historicalSheet, ccy: cfg.ccy, rows: out, review, cashflowReview,
    summary: {
      ...stats,
      importedRows: out.length,
      valueRows: valueRows.length,
      kinds: out.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {}),
      firstDate: dated[0] ?? null, lastDate: dated[dated.length - 1] ?? null,
      duplicateDates: [...new Set(out.filter((r, i) => out.findIndex((x) => x.date === r.date) !== i).map((r) => r.date))].length,
      primaryNumericSum: Math.round(sumPrimary * 100) / 100,
    },
  };
}

/** Check that nothing was silently dropped: every non-empty source row is imported or recorded in review. */
export function reconcile(sheet) {
  const s = sheet.summary;
  const accounted = s.dateRows + s.markerRows + s.unrecognizedRows;
  return {
    sheet: sheet.sheet,
    ok: accounted === s.nonEmptyRows && s.importedRows === s.dateRows && s.nonEmptyRows + s.blankRows === s.sourceRows,
    nonEmptyRows: s.nonEmptyRows, accounted, importedRows: s.importedRows, dateRows: s.dateRows,
  };
}
