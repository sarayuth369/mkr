/**
 * minvest - Google Apps Script backend (Google Sheets = primary database).
 *
 * Deployed as a Web App (Execute as: me, Who has access: Anyone). It is NOT
 * public in practice: every request must carry the shared secret held in
 * Script Properties (MINVEST_SCRIPT_SECRET) which only the Cloudflare Worker
 * knows; the Worker itself sits behind owner authentication + rate limiting.
 *
 * Script Properties (Project Settings -> Script properties):
 *   MINVEST_SCRIPT_SECRET  (required) long random string, also set as a Worker secret
 *   SPREADSHEET_ID         (recommended) id of the `minvestment` spreadsheet.
 *                          If unset, the spreadsheet this script is bound to is used.
 *                          The script NEVER searches Drive by name.
 *
 * Contract: POST JSON {secret, action, payload} -> {ok:true,data} | {ok:false,error:{code,message}}
 * Plain-JS only (no modules) so the same file is unit-tested in Node with mocks.
 */

var MINVEST = {
  VERSION: '0.1.0',
  TZ: 'Asia/Bangkok',
  SHEETS: {
    DAILY: 'Daily_Income',
    HIST: { dime: 'Historical_Dime', stashaway: 'Historical_StashAway', webull: 'Historical_Webull' },
    CASHFLOWS: 'Cashflows',
    CASHFLOW_REVIEW: 'Cashflow_Review',
    IMPORT_REVIEW: 'Import_Review',
    DASH: 'Dashboard_Data',
    SETTINGS: 'Settings',
  },
  DAILY_HEADERS: ['วันที่บันทึก', 'Dime THB', 'StashAway THB', 'Webull USD', 'หมายเหตุ', 'entry_id', 'ชนิดข้อมูล', 'updated_at', 'request_id', 'status', 'revision', 'วันที่ของรายการ'],
  HIST_HEADERS: ['วันที่', 'ราคา(บาท)', 'ราคา(USD)', 'หมายเหตุ', 'ชนิดแถว', 'review_flag', 'source_sheet', 'source_row', 'raw_date', 'raw_บาท', 'raw_USD', 'raw_หมายเหตุ', 'import_key', 'entry_id', 'request_id', 'status', 'created_at'],
  CASHFLOW_HEADERS: ['วันที่', 'แพลตฟอร์ม', 'ประเภท', 'จำนวน', 'สกุลเงิน', 'หมายเหตุ', 'entry_id', 'request_id', 'status', 'created_at'],
  CASHFLOW_REVIEW_HEADERS: ['แพลตฟอร์ม', 'วันที่', 'source_row', 'ประเภทที่คาดว่า', 'จำนวน THB (จากหมายเหตุ)', 'จำนวน USD (จากหมายเหตุ)', 'หมายเหตุ', 'สถานะ', 'review_key'],
  REVIEW_HEADERS: ['แพลตฟอร์ม', 'source_row', 'ระดับ', 'เหตุผล', 'รายละเอียด', 'ค่าต้นฉบับ', 'review_key'],
  SETTINGS_DEFAULTS: [
    ['timezone', 'Asia/Bangkok', 'เขตเวลา (ห้ามเปลี่ยน)'],
    ['base_currency', 'THB', 'สกุลเงินหลัก'],
    ['goal_dime_thb', '', 'เป้าหมายพอร์ต Dime (THB)'],
    ['goal_stashaway_thb', '', 'เป้าหมายพอร์ต StashAway (THB)'],
    ['goal_webull_usd', '', 'เป้าหมายพอร์ต Webull (USD)'],
    ['usd_thb_rate', '', 'อัตรา USD/THB ที่คุณกำหนดเอง (เว้นว่าง = ไม่รวมสกุลเงิน)'],
    ['usd_thb_rate_date', '', 'วันที่ของอัตราแลกเปลี่ยนข้างต้น'],
    ['cashflows_confirmed_through', '', 'ยืนยันเงินฝาก/ถอนครบถึงวันที่ (yyyy-MM-dd) - ใช้คำนวณผลตอบแทนปรับเงินฝาก'],
    ['forecast_window_days', '180', 'จำนวนวันย้อนหลังที่ใช้ประมาณแนวโน้ม'],
  ],
  SETTINGS_EDITABLE: ['goal_dime_thb', 'goal_stashaway_thb', 'goal_webull_usd', 'usd_thb_rate', 'usd_thb_rate_date', 'cashflows_confirmed_through', 'forecast_window_days'],
  PLATFORMS: ['dime', 'stashaway', 'webull'],
  ENTRY_TYPES: ['profit_loss', 'cash_received'],
  CASHFLOW_TYPES: ['deposit', 'withdrawal', 'dividend'],
  MAX_AMOUNT: 1e9,
  MAX_NOTE: 500,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

// ───────────────────────── entry points ─────────────────────────

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!mv_authorized_(body.secret)) throw mv_err_('UNAUTHORIZED', 'unauthorized');
    out = { ok: true, data: mv_dispatch_(String(body.action || ''), body.payload || {}) };
  } catch (err) {
    out = { ok: false, error: { code: err && err.mvCode ? err.mvCode : 'INTERNAL', message: err && err.mvCode ? String(err.message) : 'internal error' } };
    if (!(err && err.mvCode)) console.error('minvest internal error: ' + (err && err.message));
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  // Never reveals data or configuration.
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'minvest' })).setMimeType(ContentService.MimeType.JSON);
}

function mv_dispatch_(action, p) {
  switch (action) {
    case 'health': return mv_health_();
    case 'setup': return mv_withLock_(mv_setup_);
    case 'getDashboardData': return mv_getDashboardData_();
    case 'listDaily': return mv_listDaily_(p);
    case 'addDaily': return mv_withLock_(function () { return mv_addDaily_(p); });
    case 'updateDaily': return mv_withLock_(function () { return mv_updateDaily_(p); });
    case 'voidDaily': return mv_withLock_(function () { return mv_voidDaily_(p); });
    case 'listPortfolio': return mv_listPortfolio_(p);
    case 'addPortfolioValue': return mv_withLock_(function () { return mv_addPortfolioValue_(p); });
    case 'addCashflow': return mv_withLock_(function () { return mv_addCashflow_(p); });
    case 'updateSettings': return mv_withLock_(function () { return mv_updateSettings_(p); });
    case 'importHistorical': return mv_withLock_(function () { return mv_importHistorical_(p); });
    case 'importReview': return mv_withLock_(function () { return mv_importSimple_(p, 'IMPORT_REVIEW'); });
    case 'importCashflowReview': return mv_withLock_(function () { return mv_importSimple_(p, 'CASHFLOW_REVIEW'); });
    case 'rebuildDashboardData': return mv_withLock_(mv_rebuildDashboardData_);
    default: throw mv_err_('BAD_ACTION', 'unknown action');
  }
}

// ───────────────────────── helpers ─────────────────────────

function mv_err_(code, message) { var e = new Error(message); e.mvCode = code; return e; }

function mv_authorized_(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty('MINVEST_SCRIPT_SECRET');
  if (!expected || expected.length < 24 || typeof secret !== 'string') return false;
  if (secret.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function mv_withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw mv_err_('BUSY', 'system busy, try again');
  try { return fn(); } finally { lock.releaseLock(); }
}

function mv_ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw mv_err_('NO_SPREADSHEET', 'spreadsheet not configured (set SPREADSHEET_ID)');
  return ss;
}

function mv_uuid_() { return Utilities.getUuid(); }
function mv_now_() { return new Date(); }

/** Neutralise spreadsheet-formula injection and control characters in free text. */
function mv_safeText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > (maxLen || MINVEST.MAX_NOTE)) throw mv_err_('VALIDATION', 'note too long');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/** blank -> null (NOT zero). Rejects NaN/Infinity/huge/over-precise values. */
function mv_amount_(v, label) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (typeof v === 'boolean' || !isFinite(n)) throw mv_err_('VALIDATION', label + ' is not a valid number');
  if (Math.abs(n) > MINVEST.MAX_AMOUNT) throw mv_err_('VALIDATION', label + ' out of range');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw mv_err_('VALIDATION', label + ' has more than 2 decimals');
  return Math.round(n * 100) / 100;
}

/** Imports keep the owner's source precision (up to 4 decimals) - historical data is never rounded or altered. */
function mv_importAmount_(v, label) {
  if (v === null || v === undefined || v === '') return '';
  var n = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'boolean' || !isFinite(n) || Math.abs(n) > MINVEST.MAX_AMOUNT) throw mv_err_('VALIDATION', label + ' is not a valid number');
  if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) throw mv_err_('VALIDATION', label + ' has more than 4 decimals');
  return n;
}

function mv_dateStr_(v, label, allowFutureDays) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw mv_err_('VALIDATION', label + ' must be yyyy-MM-dd');
  var p = v.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) throw mv_err_('VALIDATION', label + ' is not a real date');
  var today = mv_todayStr_();
  var max = mv_addDays_(today, allowFutureDays === undefined ? 1 : allowFutureDays);
  if (v < '2000-01-01' || v > max) throw mv_err_('VALIDATION', label + ' out of allowed range');
  return v;
}

function mv_todayStr_() { return Utilities.formatDate(mv_now_(), MINVEST.TZ, 'yyyy-MM-dd'); }
function mv_addDays_(s, n) {
  var p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function mv_toDateStr_(cell) {
  if (cell instanceof Date) return Utilities.formatDate(cell, MINVEST.TZ, 'yyyy-MM-dd');
  return cell === '' || cell === null || cell === undefined ? null : String(cell).slice(0, 10);
}
function mv_dateCell_(s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 5, 0, 0)); } // 12:00 Bangkok -> stable date in any TZ rendering

function mv_enum_(v, list, label) {
  if (list.indexOf(v) === -1) throw mv_err_('VALIDATION', label + ' invalid');
  return v;
}
function mv_uuid_check_(v, label) {
  if (typeof v !== 'string' || !MINVEST.UUID_RE.test(v)) throw mv_err_('VALIDATION', label + ' must be a UUID');
  return v.toLowerCase();
}

function mv_sheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers) {
    var have = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0] : [];
    var empty = have.every(function (c) { return c === '' || c === null; });
    if (empty) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  }
  return sh;
}

/** setValues beyond the grid throws in Sheets; grow the sheet first (default grid is only 1000 rows). */
function mv_ensureRows_(sh, lastNeededRow) {
  var max = sh.getMaxRows();
  if (lastNeededRow > max) sh.insertRowsAfter(max, lastNeededRow - max);
}

function mv_rows_(sh, ncols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ncols).getValues();
}

// ───────────────────────── setup / health ─────────────────────────

function mv_setup_() {
  var ss = mv_ss_();
  var created = [];
  function ensure(name, headers) { var existed = !!ss.getSheetByName(name); var sh = mv_sheet_(ss, name, headers); if (!existed) created.push(name); return sh; }
  var daily = ensure(MINVEST.SHEETS.DAILY, MINVEST.DAILY_HEADERS);
  daily.getRange(2, 1, Math.max(daily.getMaxRows() - 1, 1), 1).setNumberFormat('dd/MM/yyyy H:mm');
  MINVEST.PLATFORMS.forEach(function (p) { ensure(MINVEST.SHEETS.HIST[p], MINVEST.HIST_HEADERS); });
  ensure(MINVEST.SHEETS.CASHFLOWS, MINVEST.CASHFLOW_HEADERS);
  ensure(MINVEST.SHEETS.CASHFLOW_REVIEW, MINVEST.CASHFLOW_REVIEW_HEADERS);
  ensure(MINVEST.SHEETS.IMPORT_REVIEW, MINVEST.REVIEW_HEADERS);
  ensure(MINVEST.SHEETS.DASH, null);
  var st = ensure(MINVEST.SHEETS.SETTINGS, ['key', 'value', 'คำอธิบาย']);
  var existing = {};
  mv_rows_(st, 3).forEach(function (r) { existing[String(r[0])] = true; });
  MINVEST.SETTINGS_DEFAULTS.forEach(function (d) { if (!existing[d[0]]) st.appendRow(d); });
  if (ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone() !== MINVEST.TZ) ss.setSpreadsheetTimeZone(MINVEST.TZ);
  return { createdSheets: created, spreadsheetName: ss.getName(), timezone: MINVEST.TZ };
}

function mv_health_() {
  var ss = mv_ss_();
  var counts = {};
  [MINVEST.SHEETS.DAILY, MINVEST.SHEETS.HIST.dime, MINVEST.SHEETS.HIST.stashaway, MINVEST.SHEETS.HIST.webull, MINVEST.SHEETS.CASHFLOWS, MINVEST.SHEETS.SETTINGS].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    counts[n] = sh ? Math.max(sh.getLastRow() - 1, 0) : null;
  });
  return {
    version: MINVEST.VERSION, spreadsheetName: ss.getName(),
    spreadsheetSource: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') ? 'SPREADSHEET_ID' : 'bound',
    timezone: MINVEST.TZ, sheetTimezone: ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : null,
    rows: counts, serverTime: Utilities.formatDate(mv_now_(), MINVEST.TZ, 'dd/MM/yyyy H:mm'),
  };
}

// ───────────────────────── Daily_Income ─────────────────────────
// cols (0-based): 0 A time | 1 Dime | 2 Stash | 3 Webull | 4 note | 5 entry_id | 6 type | 7 updated | 8 request_id | 9 status | 10 revision | 11 entry_date

function mv_dailyFromRow_(r, rowNum) {
  return {
    row: rowNum, recordedAt: r[0] instanceof Date ? Utilities.formatDate(r[0], MINVEST.TZ, 'dd/MM/yyyy H:mm') : String(r[0]),
    dime: r[1] === '' ? null : Number(r[1]), stashaway: r[2] === '' ? null : Number(r[2]), webull: r[3] === '' ? null : Number(r[3]),
    note: String(r[4] || '').replace(/^'/, ''), entryId: String(r[5]), type: String(r[6]), updatedAt: r[7] instanceof Date ? Utilities.formatDate(r[7], MINVEST.TZ, 'dd/MM/yyyy H:mm') : String(r[7]),
    status: String(r[9] || 'active'), revision: Number(r[10] || 1), entryDate: mv_toDateStr_(r[11]) || mv_toDateStr_(r[0]),
  };
}

function mv_parseDailyInput_(p, partial) {
  var amounts = { dime: mv_amount_(p.dime, 'Dime'), stashaway: mv_amount_(p.stashaway, 'StashAway'), webull: mv_amount_(p.webull, 'Webull') };
  if (amounts.dime === null && amounts.stashaway === null && amounts.webull === null) throw mv_err_('VALIDATION', 'at least one amount is required');
  return {
    amounts: amounts,
    type: mv_enum_(p.type, MINVEST.ENTRY_TYPES, 'type'),
    note: mv_safeText_(p.note),
    entryDate: p.entryDate ? mv_dateStr_(p.entryDate, 'entryDate', 1) : mv_todayStr_(),
  };
}

function mv_addDaily_(p) {
  var requestId = mv_uuid_check_(p.requestId, 'requestId');
  var parsed = mv_parseDailyInput_(p);
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.DAILY, MINVEST.DAILY_HEADERS);
  var rows = mv_rows_(sh, MINVEST.DAILY_HEADERS.length);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][8]).toLowerCase() === requestId) return { duplicate: true, entry: mv_dailyFromRow_(rows[i], i + 2) };
  }
  var entryId = mv_uuid_();
  var now = mv_now_();
  var row = [now, parsed.amounts.dime === null ? '' : parsed.amounts.dime, parsed.amounts.stashaway === null ? '' : parsed.amounts.stashaway,
    parsed.amounts.webull === null ? '' : parsed.amounts.webull, parsed.note, entryId, parsed.type, now, requestId, 'active', 1, mv_dateCell_(parsed.entryDate)];
  sh.appendRow(row);
  var rowNum = sh.getLastRow();
  sh.getRange(rowNum, 1).setNumberFormat('dd/MM/yyyy H:mm');
  return { duplicate: false, entry: mv_dailyFromRow_(row, rowNum) };
}

function mv_findByEntryId_(sh, entryId, idCol, ncols) {
  var rows = mv_rows_(sh, ncols);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][idCol]).toLowerCase() === entryId) return { index: i, rowNum: i + 2, row: rows[i] };
  return null;
}

function mv_updateDaily_(p) {
  var entryId = mv_uuid_check_(p.entryId, 'entryId');
  var parsed = mv_parseDailyInput_(p);
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.DAILY, MINVEST.DAILY_HEADERS);
  var f = mv_findByEntryId_(sh, entryId, 5, MINVEST.DAILY_HEADERS.length);
  if (!f) throw mv_err_('NOT_FOUND', 'entry not found');
  if (String(f.row[9]) === 'void') throw mv_err_('CONFLICT', 'entry was voided');
  if (Number(f.row[10] || 1) !== Number(p.expectedRevision)) throw mv_err_('CONFLICT', 'entry changed elsewhere, reload');
  var a = parsed.amounts;
  var upd = [[a.dime === null ? '' : a.dime, a.stashaway === null ? '' : a.stashaway, a.webull === null ? '' : a.webull, parsed.note]];
  sh.getRange(f.rowNum, 2, 1, 4).setValues(upd);
  sh.getRange(f.rowNum, 7).setValue(parsed.type);
  sh.getRange(f.rowNum, 8).setValue(mv_now_());
  sh.getRange(f.rowNum, 11).setValue(Number(f.row[10] || 1) + 1);
  sh.getRange(f.rowNum, 12).setValue(mv_dateCell_(parsed.entryDate));
  return { entry: mv_dailyFromRow_(sh.getRange(f.rowNum, 1, 1, MINVEST.DAILY_HEADERS.length).getValues()[0], f.rowNum) };
}

function mv_voidDaily_(p) {
  var entryId = mv_uuid_check_(p.entryId, 'entryId');
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.DAILY, MINVEST.DAILY_HEADERS);
  var f = mv_findByEntryId_(sh, entryId, 5, MINVEST.DAILY_HEADERS.length);
  if (!f) throw mv_err_('NOT_FOUND', 'entry not found');
  if (Number(f.row[10] || 1) !== Number(p.expectedRevision)) throw mv_err_('CONFLICT', 'entry changed elsewhere, reload');
  sh.getRange(f.rowNum, 10).setValue('void');
  sh.getRange(f.rowNum, 8).setValue(mv_now_());
  sh.getRange(f.rowNum, 11).setValue(Number(f.row[10] || 1) + 1);
  return { voided: true }; // row is kept (audit trail), excluded from KPIs
}

function mv_listDaily_(p) {
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.DAILY, MINVEST.DAILY_HEADERS);
  var includeVoid = !!(p && p.includeVoid);
  var out = [];
  mv_rows_(sh, MINVEST.DAILY_HEADERS.length).forEach(function (r, i) {
    var e = mv_dailyFromRow_(r, i + 2);
    if (e.status === 'active' || includeVoid) out.push(e);
  });
  out.sort(function (a, b) { return a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : b.row - a.row; });
  return { entries: out };
}

// ───────────────────────── Portfolio values (Historical_*) ─────────────────────────
// cols: 0 date|1 thb|2 usd|3 note|4 kind|5 review_flag|6 source_sheet|7 source_row|8 raw_date|9 raw_thb|10 raw_usd|11 raw_note|12 import_key|13 entry_id|14 request_id|15 status|16 created_at

var MV_VALUE_CCY = { dime: 'thb', stashaway: 'thb', webull: 'usd' };

function mv_histFromRow_(r, rowNum, platform) {
  return { row: rowNum, platform: platform, date: mv_toDateStr_(r[0]), thb: r[1] === '' ? null : Number(r[1]), usd: r[2] === '' ? null : Number(r[2]), note: String(r[3] || '').replace(/^'/, ''),
    kind: String(r[4]), reviewFlag: String(r[5] || ''), sourceRow: r[7] === '' ? null : Number(r[7]), entryId: String(r[13] || ''), status: String(r[15] || 'active') };
}

function mv_addPortfolioValue_(p) {
  var platform = mv_enum_(p.platform, MINVEST.PLATFORMS, 'platform');
  var requestId = mv_uuid_check_(p.requestId, 'requestId');
  var value = mv_amount_(p.value, 'value');
  if (value === null || value < 0) throw mv_err_('VALIDATION', 'value must be a non-negative number');
  var date = p.date ? mv_dateStr_(p.date, 'date', 1) : mv_todayStr_();
  var note = mv_safeText_(p.note);
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.HIST[platform], MINVEST.HIST_HEADERS);
  var rows = mv_rows_(sh, MINVEST.HIST_HEADERS.length);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][14]).toLowerCase() === requestId) return { duplicate: true, entry: mv_histFromRow_(rows[i], i + 2, platform) };
  var ccy = MV_VALUE_CCY[platform];
  var row = [mv_dateCell_(date), ccy === 'thb' ? value : '', ccy === 'usd' ? value : '', note, 'value', '', 'app', '', '', '', '', '', '', mv_uuid_(), requestId, 'active', mv_now_()];
  sh.appendRow(row);
  var rowNum = sh.getLastRow();
  sh.getRange(rowNum, 1).setNumberFormat('dd/MM/yyyy');
  return { duplicate: false, entry: mv_histFromRow_(row, rowNum, platform) };
}

function mv_listPortfolio_(p) {
  var platform = mv_enum_(p && p.platform, MINVEST.PLATFORMS, 'platform');
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.HIST[platform], MINVEST.HIST_HEADERS);
  var items = mv_rows_(sh, MINVEST.HIST_HEADERS.length).map(function (r, i) { return mv_histFromRow_(r, i + 2, platform); });
  return { entries: items };
}

// ───────────────────────── Cashflows ─────────────────────────
function mv_addCashflow_(p) {
  var platform = mv_enum_(p.platform, MINVEST.PLATFORMS, 'platform');
  var type = mv_enum_(p.type, MINVEST.CASHFLOW_TYPES, 'type');
  var requestId = mv_uuid_check_(p.requestId, 'requestId');
  var amount = mv_amount_(p.amount, 'amount');
  if (amount === null || amount <= 0) throw mv_err_('VALIDATION', 'amount must be > 0');
  var ccy = mv_enum_(p.currency, ['THB', 'USD'], 'currency');
  var date = mv_dateStr_(p.date, 'date', 1);
  var note = mv_safeText_(p.note);
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.CASHFLOWS, MINVEST.CASHFLOW_HEADERS);
  var rows = mv_rows_(sh, MINVEST.CASHFLOW_HEADERS.length);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][7]).toLowerCase() === requestId) return { duplicate: true };
  sh.appendRow([mv_dateCell_(date), platform, type, amount, ccy, note, mv_uuid_(), requestId, 'active', mv_now_()]);
  return { duplicate: false };
}

// ───────────────────────── Settings ─────────────────────────
function mv_settings_() {
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.SETTINGS, ['key', 'value', 'คำอธิบาย']);
  var out = {};
  mv_rows_(sh, 3).forEach(function (r) { out[String(r[0])] = r[1] === '' ? null : (r[1] instanceof Date ? mv_toDateStr_(r[1]) : String(r[1])); });
  return out;
}

function mv_updateSettings_(p) {
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.SETTINGS, ['key', 'value', 'คำอธิบาย']);
  var changed = [];
  var rows = mv_rows_(sh, 3);
  Object.keys(p || {}).forEach(function (key) {
    if (MINVEST.SETTINGS_EDITABLE.indexOf(key) === -1) throw mv_err_('VALIDATION', 'setting not editable: ' + key);
    var v = p[key];
    var clean;
    if (v === null || v === '') clean = '';
    else if (key.slice(-5) === '_date' || key === 'cashflows_confirmed_through') clean = mv_dateStr_(String(v), key, 0);
    else if (key === 'forecast_window_days') { var n = Number(v); if (!(n >= 30 && n <= 730) || n % 1 !== 0) throw mv_err_('VALIDATION', 'forecast_window_days 30-730'); clean = n; }
    else { var a = mv_amount_(v, key); if (a === null || a < 0) throw mv_err_('VALIDATION', key + ' must be >= 0'); clean = a; }
    var idx = -1;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === key) idx = i;
    if (idx === -1) { sh.appendRow([key, clean, '']); rows.push([key, clean, '']); } else sh.getRange(idx + 2, 2).setValue(clean);
    changed.push(key);
  });
  return { changed: changed, settings: mv_settings_() };
}

// ───────────────────────── Import (idempotent) ─────────────────────────
function mv_importHistorical_(p) {
  var platform = mv_enum_(p.platform, MINVEST.PLATFORMS, 'platform');
  if (!Array.isArray(p.rows) || p.rows.length === 0 || p.rows.length > 200) throw mv_err_('VALIDATION', 'rows must be 1-200 items');
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.HIST[platform], MINVEST.HIST_HEADERS);
  var seen = {};
  mv_rows_(sh, MINVEST.HIST_HEADERS.length).forEach(function (r) { if (r[12]) seen[String(r[12])] = true; });
  var toAdd = [];
  var skipped = 0;
  p.rows.forEach(function (x) {
    if (typeof x.importKey !== 'string' || !/^[0-9a-f]{32}$/.test(x.importKey)) throw mv_err_('VALIDATION', 'bad importKey');
    if (seen[x.importKey]) { skipped++; return; }
    seen[x.importKey] = true;
    var date = x.date ? mv_dateStr_(x.date, 'date', 1) : null;
    var raw = x.raw || {};
    toAdd.push([date ? mv_dateCell_(date) : '', mv_importAmount_(x.thb, 'thb'), mv_importAmount_(x.usd, 'usd'),
      mv_safeText_(x.note, 2000), mv_enum_(x.kind, ['value', 'superseded', 'event_amount', 'usd_event', 'note_only', 'value_unparsed'], 'kind'), mv_safeText_(x.reviewFlag, 2000),
      mv_safeText_(x.sourceSheet), Number(x.sourceRow) || '', mv_safeText_(raw.date), mv_safeText_(raw.thb), mv_safeText_(raw.usd), mv_safeText_(raw.note, 2000), x.importKey, '', '', 'active', mv_now_()]);
  });
  if (toAdd.length) {
    var start = sh.getLastRow() + 1;
    mv_ensureRows_(sh, start + toAdd.length - 1);
    sh.getRange(start, 1, toAdd.length, MINVEST.HIST_HEADERS.length).setValues(toAdd);
    sh.getRange(start, 1, toAdd.length, 1).setNumberFormat('dd/MM/yyyy');
  }
  return { inserted: toAdd.length, skipped: skipped };
}

function mv_importSimple_(p, which) {
  if (!Array.isArray(p.items) || p.items.length === 0 || p.items.length > 200) throw mv_err_('VALIDATION', 'items must be 1-200');
  var isReview = which === 'IMPORT_REVIEW';
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS[which], isReview ? MINVEST.REVIEW_HEADERS : MINVEST.CASHFLOW_REVIEW_HEADERS);
  var keyCol = isReview ? 6 : 8;
  var ncols = isReview ? MINVEST.REVIEW_HEADERS.length : MINVEST.CASHFLOW_REVIEW_HEADERS.length;
  var seen = {};
  mv_rows_(sh, ncols).forEach(function (r) { seen[String(r[keyCol])] = true; });
  var toAdd = [], skipped = 0;
  p.items.forEach(function (x) {
    var platform = mv_enum_(x.platform, MINVEST.PLATFORMS, 'platform');
    var key = isReview ? platform + '|' + Number(x.sourceRow) + '|' + mv_safeText_(x.reason) : platform + '|' + Number(x.sourceRow) + '|' + mv_safeText_(x.suggestedType);
    if (seen[key]) { skipped++; return; }
    seen[key] = true;
    if (isReview) toAdd.push([platform, Number(x.sourceRow), mv_safeText_(x.severity), mv_safeText_(x.reason), mv_safeText_(x.detail, 2000), mv_safeText_(x.raw, 2000), key]);
    else toAdd.push([platform, x.date ? mv_dateCell_(mv_dateStr_(x.date, 'date', 1)) : '', Number(x.sourceRow), mv_safeText_(x.suggestedType),
      x.suggestedAmountThb === null || x.suggestedAmountThb === undefined ? '' : mv_amount_(x.suggestedAmountThb, 'thb'), x.suggestedAmountUsd === null || x.suggestedAmountUsd === undefined ? '' : mv_amount_(x.suggestedAmountUsd, 'usd'),
      mv_safeText_(x.note, 2000), 'pending_owner_confirmation', key]);
  });
  if (toAdd.length) { mv_ensureRows_(sh, sh.getLastRow() + toAdd.length); sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, ncols).setValues(toAdd); }
  return { inserted: toAdd.length, skipped: skipped };
}

// ───────────────────────── Dashboard data ─────────────────────────
function mv_cleanSeries_(platform) {
  var sh = mv_sheet_(mv_ss_(), MINVEST.SHEETS.HIST[platform], MINVEST.HIST_HEADERS);
  var ccy = MV_VALUE_CCY[platform];
  var points = [];
  mv_rows_(sh, MINVEST.HIST_HEADERS.length).forEach(function (r, i) {
    if (String(r[4]) !== 'value' || String(r[15] || 'active') !== 'active') return;
    var v = ccy === 'thb' ? r[1] : r[2];
    if (v === '' || v === null) return;
    var d = mv_toDateStr_(r[0]);
    if (d) points.push({ d: d, v: Number(v), row: i + 2, n: String(r[3] || '').replace(/^'/, '') });
  });
  points.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.row - b.row; });
  var byDate = {};
  points.forEach(function (pt) { byDate[pt.d] = pt; }); // later row of the same date wins
  return Object.keys(byDate).sort().map(function (d) { return { d: d, v: byDate[d].v, n: byDate[d].n }; });
}

function mv_getDashboardData_() {
  var data = { generatedAt: Utilities.formatDate(mv_now_(), MINVEST.TZ, 'yyyy-MM-dd HH:mm'), today: mv_todayStr_(), currency: { dime: 'THB', stashaway: 'THB', webull: 'USD' }, portfolio: {}, daily: [], cashflows: [], settings: mv_settings_() };
  MINVEST.PLATFORMS.forEach(function (p) { data.portfolio[p] = mv_cleanSeries_(p); });
  data.daily = mv_listDaily_({}).entries.map(function (e) { return { id: e.entryId, date: e.entryDate, dime: e.dime, stashaway: e.stashaway, webull: e.webull, type: e.type }; });
  mv_rows_(mv_sheet_(mv_ss_(), MINVEST.SHEETS.CASHFLOWS, MINVEST.CASHFLOW_HEADERS), MINVEST.CASHFLOW_HEADERS.length).forEach(function (r) {
    if (String(r[8]) === 'active') data.cashflows.push({ date: mv_toDateStr_(r[0]), platform: String(r[1]), type: String(r[2]), amount: Number(r[3]), currency: String(r[4]) });
  });
  return data;
}

/** Materialises a monthly summary into Dashboard_Data for viewing in Sheets (originals are never modified). */
function mv_rebuildDashboardData_() {
  var ss = mv_ss_();
  var sh = mv_sheet_(ss, MINVEST.SHEETS.DASH, null);
  var months = {};
  MINVEST.PLATFORMS.forEach(function (p) {
    mv_cleanSeries_(p).forEach(function (pt) { var m = pt.d.slice(0, 7); months[m] = months[m] || {}; months[m][p] = pt.v; }); // last value of month wins (series is date-sorted)
  });
  var keys = Object.keys(months).sort();
  var rows = keys.map(function (m) { return [m, months[m].dime === undefined ? '' : months[m].dime, months[m].stashaway === undefined ? '' : months[m].stashaway, months[m].webull === undefined ? '' : months[m].webull]; });
  sh.clearContents();
  sh.getRange(1, 1, 1, 4).setValues([['เดือน (มูลค่าปิดเดือน)', 'Dime THB', 'StashAway THB', 'Webull USD']]);
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows);
  return { months: rows.length };
}
