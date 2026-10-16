#!/usr/bin/env node
// Guarded one-shot production import: Excel -> Google Sheets via the deployed Worker.
//   node tools/production-import.mjs [--file "C:\...\value infox.xlsx"] [--base https://minvest.biz2success.workers.dev]
//
// Password: MINVEST_PASSWORD env var, else a HIDDEN prompt (never printed, never stored).
// Output: PASS/FAIL lines with COUNTS ONLY (no portfolio values) + data/import-result.json (git-ignored, counts/booleans only).
// Stops at the first failed gate; never pushes past a risk.
// The stage logic lives in public/js/importer.js (shared with the web UI import panel, which needs no terminal password).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadWorkbook } from './load-workbook.mjs';
import { runImport } from '../public/js/importer.js';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : (args[i + 1] ?? true); };
const file = opt('file', process.env.MINVEST_EXCEL ?? 'C:\\Users\\lsara\\Desktop\\value infox.xlsx');
const base = String(opt('base', process.env.MINVEST_URL ?? 'https://minvest.biz2success.workers.dev')).replace(/\/$/, '');
const outPath = resolve(opt('out', 'data/import-result.json'));

const result = { startedAt: new Date().toISOString(), base, checks: [], counts: {}, stoppedAt: null };
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  result.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
function finish(status) {
  result.status = status; result.finishedAt = new Date().toISOString(); result.failed = failed;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 1));
  console.log(`\nสรุป: ${status}${failed ? ` (ล้มเหลว ${failed})` : ''} — ผลแบบไม่มีตัวเลขพอร์ตบันทึกที่ ${outPath}`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}

function askHidden(prompt) {
  return new Promise((res) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { if (stdin.isTTY) stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return res(buf); }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const origin = new URL(base).origin;
  const sheets = await loadWorkbook(file);
  const password = process.env.MINVEST_PASSWORD || (await askHidden('รหัสผ่าน minvest (ไม่แสดงบนจอ): '));
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
  if (!check('login production', login.status === 200, `HTTP ${login.status}`)) { result.stoppedAt = 'login'; return finish('BLOCKED'); }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), origin, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!out.ok) throw new Error(`${method} ${path}: ${out.error?.code ?? 'error'} ${out.error?.message ?? ''}`.trim());
    return out.data;
  };
  const fetchPage = async () => { const r = await fetch(base + '/'); return { status: r.status, csp: r.headers.get('content-security-policy') ?? '' }; };
  const r = await runImport({ sheets, api, check, fetchPage });
  Object.assign(result, { counts: r.counts, stoppedAt: r.stoppedAt });
  await fetch(base + '/api/logout', { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: '{}' });
  finish(r.stoppedAt ? 'BLOCKED' : failed === 0 ? 'PASS' : 'PARTIAL');
}

main().catch((e) => { console.error(`ผิดพลาด: ${e.message}`); result.error = e.message; failed++; finish('BLOCKED'); });
