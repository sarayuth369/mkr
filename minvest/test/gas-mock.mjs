// In-memory mock of the Google Apps Script services used by apps-script/Code.gs.
// These are MOCK tests of logic only - they say nothing about the real Google Sheets connection.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const SRC = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function fmtDate(d, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  const H = String(Number(parts.hour));
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour.padStart(2, '0')).replace('H', H).replace('mm', parts.minute);
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sheet.get(this.r, this.c); }
  setValues(v) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, v[i][j]); return this; }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
  get(r, c) { const v = (this.data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); this.data[r - 1][c - 1] = v; }
  getLastRow() { let last = 0; this.data.forEach((row, i) => { if (row.some((x) => x !== undefined && x !== '')) last = i + 1; }); return last; }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.set(r, j + 1, v)); }
  setFrozenRows() {}
  clearContents() { this.data = []; }
}

class Spreadsheet {
  constructor(name = 'minvestment') { this.sheets = new Map(); this.name = name; this.tz = 'America/Los_Angeles'; }
  getName() { return this.name; }
  getSheetByName(n) { return this.sheets.get(n) ?? null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.set(n, s); return s; }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
}

export function createGas({ secret = 'test-secret-0123456789-abcdefghij', now = new Date('2026-10-16T03:00:00Z'), spreadsheetId = 'SHEET_ID_1', ss = new Spreadsheet() } = {}) {
  const props = { MINVEST_SCRIPT_SECRET: secret, ...(spreadsheetId ? { SPREADSHEET_ID: spreadsheetId } : {}) };
  let clock = now;
  const ctx = {
    console,
    Date,
    Utilities: { formatDate: fmtDate, getUuid: () => randomUUID() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // override clock used by the script
  vm.runInContext('mv_now_ = function () { return __clock(); };', Object.assign(ctx, { __clock: () => clock }));
  return {
    ss, props, ctx,
    setNow: (d) => { clock = d; },
    call(action, payload = {}, sec = secret) {
      const out = ctx.doPost({ postData: { contents: JSON.stringify({ secret: sec, action, payload }) } });
      return JSON.parse(out.getContent());
    },
  };
}
