#!/usr/bin/env node
// Excel -> minvest importer.
//
//   node tools/import-excel.mjs --file "C:\path\value infox.xlsx"            (dry run: report + data/normalized.json)
//   MINVEST_URL=https://... MINVEST_PASSWORD=... node tools/import-excel.mjs --file ... --push
//
// The Excel file and data/normalized.json contain personal financial data and
// are git-ignored. The password is read from the environment only - never
// from a file, never printed. Re-running with the same file inserts nothing
// new (idempotent by importKey, enforced server-side in Apps Script).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { reconcile } from './normalize.mjs';
import { loadWorkbook } from './load-workbook.mjs';

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : (args[i + 1] ?? true); };
const file = opt('file', process.env.MINVEST_EXCEL);
const outPath = resolve(opt('out', 'data/normalized.json'));
const push = args.includes('--push');
const BATCH = 150;

if (!file) { console.error('ระบุไฟล์ด้วย --file "<path ไปยัง value infox.xlsx>"'); process.exit(2); }

function buildReport(sheets) {
  return sheets.map((s) => ({ sheet: s.sheet, ...s.summary, reconcile: reconcile(s), reviewItems: s.review.length, cashflowHints: s.cashflowReview.length }));
}

async function pushAll(sheets) {
  const base = process.env.MINVEST_URL?.replace(/\/$/, '');
  const password = process.env.MINVEST_PASSWORD;
  if (!base || !password) throw new Error('ต้องตั้ง MINVEST_URL และ MINVEST_PASSWORD เป็น environment variable ก่อน --push');
  const origin = new URL(base).origin;
  const loginRes = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
  if (!loginRes.ok) throw new Error(`เข้าสู่ระบบไม่สำเร็จ (HTTP ${loginRes.status})`);
  const cookie = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('ไม่ได้รับ session cookie');
  const call = async (body) => {
    const url = body.__setup ? `${base}/api/admin/setup` : `${base}/api/admin/import`;
    if (body.__setup) body = {};
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(`import ล้มเหลว HTTP ${res.status}: ${json?.error?.message ?? 'unknown'}`);
    return json.data;
  };
  // Safety: refuse to write into the wrong spreadsheet (never searched by name - the id is configured in Apps Script).
  const expected = opt('expect-name', 'minvestment');
  const health = await (await fetch(`${base}/api/admin/health`, { headers: { cookie, origin } })).json();
  if (!health.ok) throw new Error(`ตรวจสุขภาพระบบไม่ผ่าน: ${health.error?.message}`);
  if (health.data.spreadsheetName !== expected) throw new Error(`สเปรดชีตที่เชื่อมอยู่ชื่อ "${health.data.spreadsheetName}" ไม่ใช่ "${expected}" - หยุดเพื่อความปลอดภัย (ตรวจ SPREADSHEET_ID)`);
  console.log(`เชื่อมสเปรดชีต "${health.data.spreadsheetName}" (เขตเวลา ${health.data.sheetTimezone}) ✓`);
  await call({ __setup: true });
  const totals = { historical: { inserted: 0, skipped: 0 }, review: { inserted: 0, skipped: 0 }, cashflowReview: { inserted: 0, skipped: 0 } };
  const add = (k, d) => { totals[k].inserted += d.inserted ?? 0; totals[k].skipped += d.skipped ?? 0; };
  for (const s of sheets) {
    for (let i = 0; i < s.rows.length; i += BATCH) add('historical', await call({ kind: 'historical', platform: s.key, rows: s.rows.slice(i, i + BATCH) }));
    for (let i = 0; i < s.review.length; i += BATCH) add('review', await call({ kind: 'review', items: s.review.slice(i, i + BATCH) }));
    for (let i = 0; i < s.cashflowReview.length; i += BATCH) add('cashflowReview', await call({ kind: 'cashflowReview', items: s.cashflowReview.slice(i, i + BATCH) }));
  }
  return totals;
}

async function main() {
  const sheets = await loadWorkbook(file);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sheets }, null, 1));
  const report = buildReport(sheets);
  console.log('--- รายงานการ normalize (ไม่มีข้อมูลตัวเลขพอร์ตในรายงานนี้) ---');
  for (const r of report) {
    console.log(`${r.sheet}: แถวต้นทาง ${r.sourceRows}, ไม่ว่าง ${r.nonEmptyRows}, วันที่ ${r.dateRows}, หัวเดือน ${r.markerRows}, ว่าง ${r.blankRows}, ไม่รู้จัก ${r.unrecognizedRows}`);
    console.log(`   นำเข้า ${r.importedRows} แถว | kinds ${JSON.stringify(r.kinds)} | ${r.firstDate} → ${r.lastDate} | วันที่ซ้ำ ${r.duplicateDates} | review ${r.reviewItems} | cashflow hints ${r.cashflowHints} | reconcile ${r.reconcile.ok ? 'OK' : 'FAIL'}`);
  }
  console.log(`บันทึก normalized JSON (ภายในเครื่อง ห้าม commit): ${outPath}`);
  if (!report.every((r) => r.reconcile.ok)) throw new Error('Reconcile ไม่ผ่าน - หยุด');
  if (push) {
    const totals = await pushAll(sheets);
    console.log('--- ผลการ push ---', JSON.stringify(totals));
  } else console.log('Dry run เท่านั้น (ไม่ได้ส่งข้อมูลไปที่ใด) - ใช้ --push เมื่อพร้อม');

}

// Never call process.exit() with fetch handles still closing (libuv assertion on Windows) - set exitCode instead.
main().catch((e) => { console.error(`ผิดพลาด: ${e.message}`); process.exitCode = 1; });
