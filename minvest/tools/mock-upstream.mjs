#!/usr/bin/env node
// LOCAL TESTING ONLY. A stand-in for the Google Apps Script web app: runs the real apps-script/Code.gs against an
// in-memory spreadsheet so the Worker + UI can be exercised without Google. It is NOT the real Google Sheets.
//
//   node tools/mock-upstream.mjs [--excel data/normalized.json] [--demo-income]
//
// --excel        seeds Historical_* from the normalized import (real data, local memory only)
// --demo-income  adds clearly-labelled sample Daily_Income rows so the income charts can be eyeballed
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createGas } from '../test/gas-mock.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1] ?? true; };
const PORT = Number(opt('port', 8799));
const SECRET = process.env.MINVEST_SCRIPT_SECRET || 'dev-script-secret-0123456789-abcdefghij';

const rawGas = createGas({ secret: SECRET, now: new Date() });
const gas = { call(a, p, s) { const r = rawGas.call(a, p, s); if (!r.ok && !s) console.error('[mock] seed call failed:', a, r.error); return r; } };
gas.call('setup');

const dataFile = opt('excel', 'data/normalized.json');
if (existsSync(dataFile)) {
  const { sheets } = JSON.parse(readFileSync(dataFile, 'utf8'));
  for (const s of sheets) {
    for (let i = 0; i < s.rows.length; i += 150) gas.call('importHistorical', { platform: s.key, rows: s.rows.slice(i, i + 150) });
    for (let i = 0; i < s.review.length; i += 150) gas.call('importReview', { items: s.review.slice(i, i + 150) });
    for (let i = 0; i < s.cashflowReview.length; i += 150) gas.call('importCashflowReview', { items: s.cashflowReview.slice(i, i + 150) });
  }
  console.log(`[mock] seeded from ${dataFile}`);
} else console.log('[mock] no normalized data found - starting empty');

if (args.includes('--demo-income')) {
  const today = new Date();
  for (let i = 40; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const wave = Math.sin(i / 3);
    gas.call('addDaily', { requestId: randomUUID(), entryDate: d, type: 'profit_loss', dime: Math.round((300 * wave + 20) * 100) / 100, stashaway: i % 2 ? Math.round(80 * wave * 100) / 100 : null, webull: i % 3 ? Math.round(4 * Math.cos(i / 4) * 100) / 100 : null, note: i === 0 ? 'ตัวอย่างสำหรับทดสอบหน้าจอ (mock)' : '' });
  }
  console.log('[mock] added DEMO income rows (not real data)');
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/macros/s/')) { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const b = JSON.parse(body);
      const out = rawGas.call(b.action, b.payload, b.secret);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch { res.writeHead(400).end('{"ok":false}'); }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[mock] Apps Script stand-in on http://127.0.0.1:${PORT}/macros/s/MOCK/exec`));
