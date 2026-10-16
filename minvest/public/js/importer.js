// Guarded historical import, shared by the web UI (same-origin session) and tools/production-import.mjs.
// Browser-safe (no node imports). Reports COUNTS and PASS/FAIL only - never portfolio values.
//
// Stages - stops at the first failed gate and never writes past a risk:
//  1 health: spreadsheet must be "minvestment" via SPREADSHEET_ID; idempotent setup
//  2 destination pre-state: existing rows must be app entries or earlier imports (else STOP, nothing overwritten)
//  3 CANARY: 3 rows -> re-send (must insert 0) -> read back, compare field by field
//  4 full import in 150-row batches; review/cashflow suggestions go to their own sheets only
//  5 read back EVERYTHING and compare with the normalized data
//  6 idempotency re-check (spread sample must insert 0; review items must all be skipped; counts unchanged)
//  7 Dashboard: series equal the cleaned data, Daily_Income/KPIs untouched, nothing auto-confirmed as cashflow
import * as calc from './calc.js';

const BATCH = 150;
const KNOWN_KINDS = new Set(['value', 'superseded', 'event_amount', 'usd_event', 'note_only', 'value_unparsed']);
const HIST = { dime: 'Historical_Dime', stashaway: 'Historical_StashAway', webull: 'Historical_Webull' };
// same cleaning Apps Script applies to free text before storing
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
class Stop extends Error {}

export function reconcileSheet(s) {
  const x = s.summary, accounted = x.dateRows + x.markerRows + x.unrecognizedRows;
  return accounted === x.nonEmptyRows && x.importedRows === x.dateRows && x.nonEmptyRows + x.blankRows === x.sourceRows && s.rows.length === x.importedRows;
}

/** Minimal shape check for a normalized.json produced by tools/import-excel.mjs (the file is untrusted input). */
export function validateNormalized(data) {
  if (!data || !Array.isArray(data.sheets) || data.sheets.length !== 3) return 'ไฟล์ไม่ใช่ normalized.json ที่ถูกต้อง (ต้องมี 3 ชีต)';
  for (const s of data.sheets) {
    if (!['dime', 'stashaway', 'webull'].includes(s.key) || !Array.isArray(s.rows) || !Array.isArray(s.review) || !Array.isArray(s.cashflowReview) || !s.summary) return 'โครงสร้างข้อมูลในไฟล์ไม่ถูกต้อง';
    for (const r of s.rows) if (typeof r.importKey !== 'string' || !/^[0-9a-f]{32}$/.test(r.importKey) || !KNOWN_KINDS.has(r.kind) || typeof r.sourceRow !== 'number') return 'พบแถวที่รูปแบบไม่ถูกต้องในไฟล์';
  }
  return null;
}

/**
 * @param {{sheets: any[], api: (method:string, path:string, body?:any)=>Promise<any>, check:(name:string, ok:boolean, detail?:string)=>boolean,
 *          fetchPage?: ()=>Promise<{status:number, csp:string}>}} p
 * @returns {Promise<{stoppedAt: string|null, counts: object}>}
 */
export async function runImport({ sheets, api, check, fetchPage }) {
  const counts = {};
  const stop = (gate) => { throw new Stop(gate); };
  const by = Object.fromEntries(sheets.map((s) => [s.key, s]));
  const keys = Object.keys(by);
  const push = (b) => api('POST', '/api/admin/import', b);
  const listP = async (p) => (await api('GET', `/api/portfolio?platform=${p}`)).entries;
  try {
    counts.source = Object.fromEntries(sheets.map((s) => [s.key, { sourceRows: s.summary.sourceRows, dateRows: s.summary.dateRows, markers: s.summary.markerRows, imported: s.summary.importedRows, kinds: s.summary.kinds, review: s.review.length, cashflowHints: s.cashflowReview.length, firstDate: s.summary.firstDate, lastDate: s.summary.lastDate, duplicateDates: s.summary.duplicateDates }]));
    if (!check('ข้อมูลต้นทางครบ 3 แหล่งและ reconcile ทุกแถว', sheets.length === 3 && sheets.every(reconcileSheet), sheets.map((s) => `${s.key} ${s.summary.dateRows} แถววันที่`).join(', '))) stop('ข้อมูลต้นทางไม่ผ่าน reconcile');

    // ── 1 health ──
    const health = await api('GET', '/api/admin/health');
    check('Apps Script ตอบและ secret ตรงกัน', true, `เวอร์ชันสคริปต์ ${health.version}`);
    if (!check('สเปรดชีตชื่อ "minvestment" และใช้ SPREADSHEET_ID', health.spreadsheetName === 'minvestment' && health.spreadsheetSource === 'SPREADSHEET_ID', `ชื่อ="${health.spreadsheetName}" แหล่ง=${health.spreadsheetSource}`)) stop('spreadsheet identity');
    await api('POST', '/api/admin/setup', {});
    const h2 = await api('GET', '/api/admin/health');
    check('เขตเวลาชีต = Asia/Bangkok', h2.sheetTimezone === 'Asia/Bangkok', h2.sheetTimezone);

    // ── 2 pre-state + gates ──
    const pre = {}, preApp = {};
    for (const p of keys) {
      pre[p] = await listP(p);
      const alien = pre[p].filter((e) => !(e.sourceRow === null && e.kind === 'value') && !(KNOWN_KINDS.has(e.kind) && typeof e.sourceRow === 'number'));
      preApp[p] = pre[p].filter((e) => e.sourceRow === null).length;
      if (!check(`ปลายทาง ${HIST[p]}: ไม่มีแถวแปลกปลอม`, alien.length === 0, `มีอยู่ ${pre[p].length} แถว (บันทึกจากแอป ${preApp[p]}, จากการนำเข้า ${pre[p].length - preApp[p]})`)) stop(`ปลายทาง ${p} มีข้อมูลที่ไม่รู้จัก - ไม่เขียนทับ`);
    }
    const dailyPre = (await api('GET', '/api/daily?includeVoid=1')).entries;
    const dashPre = await api('GET', '/api/dashboard');
    counts.pre = { historical: Object.fromEntries(keys.map((p) => [p, pre[p].length])), dailyActive: dailyPre.filter((e) => e.status === 'active').length, dailyVoid: dailyPre.filter((e) => e.status === 'void').length, cashflows: dashPre.cashflows.length };
    check('Daily_Income: ไม่มีแถวทดสอบ smoke ที่ยัง active', !dailyPre.some((e) => e.status === 'active' && String(e.note).includes('[minvest-smoke-test')), `active ${counts.pre.dailyActive}, void ${counts.pre.dailyVoid}`);

    const diffRows = (entries, expected) => {
      const bad = [];
      for (const x of expected) {
        const e = entries.find((r) => r.sourceRow === x.sourceRow);
        if (!e) { bad.push(`#${x.sourceRow}:missing`); continue; }
        const d = [];
        if ((e.date ?? null) !== (x.date ?? null)) d.push('date');
        if ((e.thb ?? null) !== (x.thb ?? null)) d.push('thb');
        if ((e.usd ?? null) !== (x.usd ?? null)) d.push('usd');
        if (e.kind !== x.kind) d.push('kind');
        if (clean(e.note) !== clean(x.note)) d.push('note');
        if (clean(e.reviewFlag) !== clean(x.reviewFlag)) d.push('reviewFlag');
        if (d.length) bad.push(`#${x.sourceRow}:${d.join('+')}`);
      }
      return bad;
    };

    // ── 3 canary ──
    const canaryPlatform = keys.includes('dime') ? 'dime' : keys[0];
    const canary = by[canaryPlatform].rows.slice(0, 3);
    const c1 = await push({ kind: 'historical', platform: canaryPlatform, rows: canary });
    check(`canary: นำเข้า 3 แถวแรก (${canaryPlatform})`, c1.inserted + c1.skipped === 3, `inserted ${c1.inserted}, skipped ${c1.skipped}`);
    const c2 = await push({ kind: 'historical', platform: canaryPlatform, rows: canary });
    if (!check('canary: ส่งซ้ำ = ไม่เพิ่มแถว (idempotent)', c2.inserted === 0 && c2.skipped === 3, `inserted ${c2.inserted}, skipped ${c2.skipped}`)) stop('canary idempotency');
    const canBad = diffRows(await listP(canaryPlatform), canary);
    if (!check('canary: อ่านกลับจากชีตตรงต้นทางทุกฟิลด์ (schema/คอลัมน์ถูกต้อง)', canBad.length === 0, canBad.join(', '))) stop('canary readback (schema ไม่ตรง?)');
    const afterCanary = (await listP(canaryPlatform)).length;
    check('canary: จำนวนแถวเพิ่มไม่เกิน 3', afterCanary - pre[canaryPlatform].length <= 3, `${pre[canaryPlatform].length} → ${afterCanary}`);

    // ── 4 full import ──
    const totals = { historical: {}, review: { inserted: 0, skipped: 0 }, cashflowReview: { inserted: 0, skipped: 0 } };
    for (const s of sheets) {
      const t = { inserted: 0, skipped: 0 };
      for (let i = 0; i < s.rows.length; i += BATCH) { const r = await push({ kind: 'historical', platform: s.key, rows: s.rows.slice(i, i + BATCH) }); t.inserted += r.inserted; t.skipped += r.skipped; }
      totals.historical[s.key] = t;
      check(`นำเข้า ${s.key}: ทุกแถวถูกเพิ่มหรือมีอยู่แล้ว`, t.inserted + t.skipped === s.rows.length, `source ${s.rows.length} = inserted ${t.inserted} + skipped ${t.skipped}`);
      for (let i = 0; i < s.review.length; i += BATCH) { const r = await push({ kind: 'review', items: s.review.slice(i, i + BATCH) }); totals.review.inserted += r.inserted; totals.review.skipped += r.skipped; }
      for (let i = 0; i < s.cashflowReview.length; i += BATCH) { const r = await push({ kind: 'cashflowReview', items: s.cashflowReview.slice(i, i + BATCH) }); totals.cashflowReview.inserted += r.inserted; totals.cashflowReview.skipped += r.skipped; }
    }
    const expReview = sheets.reduce((n, s) => n + s.review.length, 0), expCf = sheets.reduce((n, s) => n + s.cashflowReview.length, 0);
    check('Import_Review: ครบทุกรายการ', totals.review.inserted + totals.review.skipped === expReview, `expected ${expReview}: inserted ${totals.review.inserted}, skipped ${totals.review.skipped}`);
    check('Cashflow_Review: ครบทุกรายการ (สถานะ pending ไม่ใช่เงินฝากที่ยืนยัน)', totals.cashflowReview.inserted + totals.cashflowReview.skipped === expCf, `expected ${expCf}: inserted ${totals.cashflowReview.inserted}, skipped ${totals.cashflowReview.skipped}`);
    counts.import = totals;

    // ── 5 read back everything ──
    const post = {};
    for (const s of sheets) {
      post[s.key] = await listP(s.key);
      const imported = post[s.key].filter((e) => e.sourceRow !== null);
      const appRows = post[s.key].length - imported.length;
      check(`อ่านกลับ ${HIST[s.key]}: จำนวนแถวนำเข้า = ต้นทาง`, imported.length === s.rows.length && appRows === preApp[s.key], `${s.rows.length} แถว (แถวจากแอปเดิม ${appRows})`);
      check(`อ่านกลับ ${s.key}: sourceRow ไม่ซ้ำ`, new Set(imported.map((e) => e.sourceRow)).size === imported.length);
      const bad = diffRows(post[s.key], s.rows);
      check(`อ่านกลับ ${s.key}: วันที่/THB/USD/kind/หมายเหตุ/ธง ตรงต้นทางทุกแถว`, bad.length === 0, bad.slice(0, 15).join(', '));
      const dates = imported.map((e) => e.date).filter(Boolean).sort();
      check(`ช่วงวันที่ ${s.key}`, dates[0] === s.summary.firstDate && dates.at(-1) === s.summary.lastDate, `${dates[0]} → ${dates.at(-1)}`);
      const wrong = s.key === 'webull' ? imported.filter((e) => e.thb !== null) : s.key === 'stashaway' ? imported.filter((e) => e.usd !== null) : imported.filter((e) => e.kind === 'value' && e.thb === null);
      check(`หน่วยเงิน ${s.key} (${s.ccy}) ถูกต้อง`, wrong.length === 0);
    }
    const h3 = await api('GET', '/api/admin/health');
    counts.postHealthRows = h3.rows;
    check('นับแถวต่อชีตจาก Google Sheets ตรงกับที่อ่านกลับ', keys.every((p) => h3.rows[HIST[p]] === post[p].length));

    // ── 6 idempotency re-check ──
    let resent = 0, reinserted = 0;
    for (const s of sheets) {
      const sample = s.rows.filter((_, i) => i % Math.max(1, Math.floor(s.rows.length / 40)) === 0).slice(0, BATCH);
      const r = await push({ kind: 'historical', platform: s.key, rows: sample });
      resent += sample.length; reinserted += r.inserted;
    }
    check('idempotency: ส่งแถวตัวอย่างซ้ำ (กระจายทุกชีต) = ไม่เพิ่มแถว', reinserted === 0, `ส่งซ้ำ ${resent} แถว, เพิ่ม ${reinserted}`);
    let rvS = 0, rvI = 0, cfS = 0, cfI = 0;
    for (const s of sheets) {
      for (let i = 0; i < s.review.length; i += BATCH) { const r = await push({ kind: 'review', items: s.review.slice(i, i + BATCH) }); rvS += r.skipped; rvI += r.inserted; }
      for (let i = 0; i < s.cashflowReview.length; i += BATCH) { const r = await push({ kind: 'cashflowReview', items: s.cashflowReview.slice(i, i + BATCH) }); cfS += r.skipped; cfI += r.inserted; }
    }
    check('อ่านกลับ review: Import_Review ทุกรายการมีอยู่ในชีตแล้ว', rvI === 0 && rvS === expReview, `skipped ${rvS}/${expReview}`);
    check('อ่านกลับ review: Cashflow_Review ทุกรายการมีอยู่ในชีตแล้ว', cfI === 0 && cfS === expCf, `skipped ${cfS}/${expCf}`);
    const h4 = await api('GET', '/api/admin/health');
    check('จำนวนแถวหลังตรวจ idempotency ไม่เปลี่ยน', JSON.stringify(h4.rows) === JSON.stringify(h3.rows));

    // ── 7 production dashboard ──
    const dash = await api('GET', '/api/dashboard');
    for (const s of sheets) {
      const m = new Map();
      for (const r of s.rows) if (r.kind === 'value' && r.date) { const v = s.key === 'webull' ? r.usd : r.thb; if (v !== null) m.set(r.date, v); } // later row of a date wins (same rule as Apps Script)
      const expected = [...m.keys()].sort().map((d) => ({ d, v: m.get(d) }));
      const got = dash.portfolio[s.key] ?? [];
      const at = expected.findIndex((e, i) => !got[i] || got[i].d !== e.d || got[i].v !== e.v);
      check(`Dashboard ${s.key}: ซีรีส์มูลค่า = ข้อมูลที่ยืนยันแล้วของต้นทาง`, got.length === expected.length && at === -1, `${got.length}/${expected.length} จุด${at === -1 ? '' : ` ต่างที่ลำดับ ${at}`}, ${got[0]?.d} → ${got.at(-1)?.d}`);
    }
    const t = dash.today, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('Daily_Income/KPI ไม่ถูกแตะ: รายการ active เท่าเดิม', dash.daily.length === counts.pre.dailyActive && same(dash.daily, dashPre.daily));
    check('KPI กำไร/ขาดทุน วันนี้/เดือน/ปี เท่าเดิม (ไม่นับการเปลี่ยนมูลค่าพอร์ตเป็นรายได้)', ['day', 'month', 'year'].every((k) => same(calc.sumDaily(dash.daily, t, k), calc.sumDaily(dashPre.daily, t, k))));
    check('ไม่มีแถว smoke-test ใน KPI/รายการ active', !(await api('GET', '/api/daily')).entries.some((e) => String(e.note).includes('[minvest-smoke-test')));
    check('Cashflows ที่ยืนยันแล้ว = เท่าเดิม (ไม่มีการยืนยันอัตโนมัติจากหมายเหตุ)', dash.cashflows.length === counts.pre.cashflows);
    check('ผลตอบแทนปรับเงินฝาก "ยังไม่พร้อม" จนกว่าเจ้าของยืนยัน', keys.every((p) => calc.adjustedReturn(dash.portfolio[p], dash.cashflows, p, dash.settings.cashflows_confirmed_through).ok === false) || !!dash.settings.cashflows_confirmed_through);
    const fc = Object.fromEntries(keys.map((p) => [p, calc.forecast(dash.portfolio[p], dash.cashflows, p, t).sufficient]));
    check('พยากรณ์: มีข้อมูลเพียงพอทั้ง 3 พอร์ต', Object.values(fc).every(Boolean), JSON.stringify(fc));
    if (fetchPage) { const pg = await fetchPage(); check('หน้าเว็บ production ตอบ 200 พร้อม CSP', pg.status === 200 && /script-src 'self'/.test(pg.csp ?? '')); }
    return { stoppedAt: null, counts };
  } catch (e) {
    if (e instanceof Stop) return { stoppedAt: e.message, counts };
    check(`ข้อผิดพลาดระหว่างทำงาน: ${String(e.message).slice(0, 160)}`, false);
    return { stoppedAt: 'error', counts };
  }
}
