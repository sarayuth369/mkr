#!/usr/bin/env node
// Live smoke test for a deployed minvest Worker. Run it YOURSELF in your terminal:
//   node tools/live-smoke.mjs https://minvest.biz2success.workers.dev
// The password is read from MINVEST_PASSWORD or typed at a hidden prompt - it is never printed or stored.
// Prints only PASS/FAIL lines and non-sensitive facts (spreadsheet name, timezone, row counts).
//
// Write test: ONE clearly labelled Daily_Income row (0.01) is added, re-sent with the same requestId (must be
// de-duplicated), edited, then voided (row kept in the sheet as status=void, excluded from every KPI).
// It never writes portfolio values or cashflows (those cannot be voided).
import { randomUUID } from 'node:crypto';

const base = (process.argv[2] ?? process.env.MINVEST_URL ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('ใช้: node tools/live-smoke.mjs https://minvest.<...>.workers.dev'); process.exitCode = 2; }
else main().catch((e) => { console.error(`ผิดพลาด: ${e.message}`); process.exitCode = 1; });

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { if (stdin.isTTY) stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const origin = new URL(base).origin;
  let failed = 0;
  const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); return ok; };
  const raw = (method, path, { body, cookie, withOrigin = true } = {}) => fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(withOrigin ? { origin } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (res) => { try { return await res.json(); } catch { return {}; } };

  // ── public / unauthenticated behaviour ──
  const h = await raw('GET', '/api/health'); const hj = await j(h);
  check('health ตอบ 200 และ configured=true', h.status === 200 && hj.data?.configured === true, `configured=${hj.data?.configured}`);
  if (hj.data?.configured !== true) { console.log('ระบบยังตั้ง secret ไม่ครบ - หยุด'); process.exitCode = 1; return; }
  const hdr = (await raw('GET', '/')).headers;
  check('มี CSP + nosniff + frame deny', /script-src 'self'/.test(hdr.get('content-security-policy') ?? '') && hdr.get('x-content-type-options') === 'nosniff' && hdr.get('x-frame-options') === 'DENY');
  check('session ก่อน login = ไม่ authenticated', (await j(await raw('GET', '/api/session'))).data?.authenticated === false);
  check('dashboard โดยไม่มีสิทธิ์ = 401', (await raw('GET', '/api/dashboard')).status === 401);
  check('login ไม่มี Origin = 403 (CSRF)', (await raw('POST', '/api/login', { body: { password: 'x' }, withOrigin: false })).status === 403);
  check('OPTIONS ไม่มี CORS', (await raw('OPTIONS', '/api/dashboard')).headers.get('access-control-allow-origin') === null);
  check('login รหัสผ่านผิด = 401', (await raw('POST', '/api/login', { body: { password: `wrong-${randomUUID()}` } })).status === 401);

  // ── authenticated ──
  const password = process.env.MINVEST_PASSWORD || (await askHidden('รหัสผ่าน minvest (ไม่แสดงบนจอ): '));
  const login = await raw('POST', '/api/login', { body: { password } });
  if (!check('login รหัสผ่านถูก = 200', login.status === 200, `HTTP ${login.status}`)) { process.exitCode = 1; return; }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const setCookie = (login.headers.getSetCookie?.() ?? []).join(' ');
  const https = base.startsWith('https://');
  check(`คุกกี้ HttpOnly + SameSite=Strict${https ? ' + Secure + __Host-' : ' (HTTP ในเครื่อง: ไม่ตั้ง Secure ตามออกแบบ)'}`, /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && (!https || (/Secure/.test(setCookie) && /__Host-minvest_session/.test(setCookie))));
  check('session หลัง login = authenticated', (await j(await raw('GET', '/api/session', { cookie }))).data?.authenticated === true);

  const health = await j(await raw('GET', '/api/admin/health', { cookie }));
  check('Apps Script ตอบ (secret ตรงกัน)', health.ok === true, health.ok ? '' : `${health.error?.code}`);
  if (!health.ok) { process.exitCode = 1; return; }
  const d = health.data;
  console.log(`      สเปรดชีต="${d.spreadsheetName}" แหล่ง=${d.spreadsheetSource} เขตเวลาชีต=${d.sheetTimezone} เวอร์ชันสคริปต์=${d.version}`);
  check('สเปรดชีตชื่อ minvestment', d.spreadsheetName === 'minvestment');
  check('ตั้ง SPREADSHEET_ID ไว้ใน Script properties', d.spreadsheetSource === 'SPREADSHEET_ID');
  const setup = await j(await raw('POST', '/api/admin/setup', { body: {}, cookie }));
  check('setup (idempotent) สำเร็จ', setup.ok === true);
  const after = await j(await raw('GET', '/api/admin/health', { cookie }));
  check('เขตเวลาชีต = Asia/Bangkok หลัง setup', after.data?.sheetTimezone === 'Asia/Bangkok');
  console.log(`      จำนวนแถวต่อชีต: ${JSON.stringify(after.data?.rows)}`);

  // ── read ──
  const dash = await j(await raw('GET', '/api/dashboard', { cookie }));
  check('อ่าน dashboard จากชีตได้', dash.ok === true && dash.data?.portfolio && Array.isArray(dash.data?.daily));

  // ── write → dedupe → edit → void ──
  const requestId = randomUUID();
  const entry = { requestId, type: 'profit_loss', dime: 0.01, note: `[minvest-smoke-test ${new Date().toISOString()}] ลบ/ยกเลิกได้` };
  const a = await j(await raw('POST', '/api/daily', { body: entry, cookie }));
  check('เขียนรายการทดสอบลง Daily_Income', a.ok === true && a.data?.duplicate === false);
  const b = await j(await raw('POST', '/api/daily', { body: entry, cookie }));
  check('ส่งซ้ำ requestId เดิม = ไม่สร้างแถวซ้ำ', b.ok === true && b.data?.duplicate === true && b.data?.entry?.entryId === a.data?.entry?.entryId);
  const list1 = await j(await raw('GET', '/api/daily', { cookie }));
  check('อ่านรายการทดสอบกลับมาได้ (ค่าว่างยังเป็นว่าง ไม่เป็น 0)', list1.data?.entries?.some((e) => e.entryId === a.data?.entry?.entryId && e.stashaway === null && e.webull === null && e.dime === 0.01));
  const e1 = a.data?.entry;
  const upd = await j(await raw('PUT', `/api/daily/${e1?.entryId}`, { body: { type: 'profit_loss', dime: 0.02, note: entry.note, expectedRevision: e1?.revision }, cookie }));
  check('แก้ไขรายการ (revision ถูกต้อง)', upd.ok === true && upd.data?.entry?.revision === 2);
  const stale = await raw('PUT', `/api/daily/${e1?.entryId}`, { body: { type: 'profit_loss', dime: 0.03, note: entry.note, expectedRevision: 1 }, cookie });
  check('แก้ด้วย revision เก่า = 409 (ไม่เขียนทับ)', stale.status === 409);
  const voided = await j(await raw('POST', `/api/daily/${e1?.entryId}/void`, { body: { expectedRevision: 2 }, cookie }));
  check('ยกเลิก (void) รายการทดสอบ', voided.ok === true && voided.data?.voided === true);
  const list2 = await j(await raw('GET', '/api/daily', { cookie }));
  check('รายการที่ void ไม่ปรากฏใน KPI/รายการ active', !list2.data?.entries?.some((e) => e.entryId === e1?.entryId));
  await raw('POST', '/api/logout', { body: {}, cookie });

  console.log(failed === 0 ? '\nสรุป: ผ่านทั้งหมด ✅ (แถวทดสอบ 1 แถวถูกทำเครื่องหมาย void ในชีต Daily_Income - ลบทิ้งเองได้)' : `\nสรุป: ล้มเหลว ${failed} รายการ ❌`);
  if (failed) process.exitCode = 1;
}
