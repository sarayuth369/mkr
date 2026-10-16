// minvest dashboard controller. All dynamic text goes through textContent (no innerHTML) -> no XSS surface.
import { api, get, post, put, ApiError } from './api.js';
import * as calc from './calc.js';
import { barChart, cumulativeChart, forecastChart, valueChart } from './charts.js';
import { initImportUi } from './import-ui.js';
import { bangkokNow, fmtDate, fmtMoney, fmtNum, fmtPct, signClass } from './format.js';

const $ = (id) => document.getElementById(id);
const PLATFORMS = calc.PLATFORMS;
const LABEL = calc.PLATFORM_LABEL;
const TYPE_LABEL = { profit_loss: 'กำไร/ขาดทุน', cash_received: 'เงินสดรับจริง' };
const KIND_LABEL = { value: 'มูลค่า', superseded: 'ถูกแทนที่ (วันเดียวกัน)', event_amount: 'จำนวนธุรกรรม', usd_event: 'ธุรกรรม USD', note_only: 'หมายเหตุ', value_unparsed: 'ตัวเลขผิดรูปแบบ - ตรวจสอบ' };
const RANGES = [['7d', '7 วัน'], ['30d', '30 วัน'], ['90d', '90 วัน'], ['1y', '1 ปี'], ['all', 'ทั้งหมด']];

const state = { dash: null, daily: [], range: '90d', bucket: 'month', fc: 'dime', tab: 'daily', portfolio: {}, table: { query: '', sortKey: null, dir: 'desc', page: 1 }, showVoid: false };

// ───────── tiny DOM helpers ─────────
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast'); t.textContent = msg; t.className = `toast${isError ? ' is-error' : ''}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
}
function banner(msg, isError = false) { const b = $('status-banner'); b.hidden = !msg; b.textContent = msg ?? ''; b.className = `banner${isError ? ' is-error' : ''}`; }

// ───────── theme ─────────
function initTheme() {
  let saved = null; try { saved = localStorage.getItem('minvest-theme'); } catch { /* storage may be blocked */ }
  const theme = saved ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('minvest-theme', next); } catch { /* ignore */ }
  if (state.dash) renderCharts();
}

// ───────── views / auth ─────────
function showLogin(configured = true) {
  $('main-view').hidden = true; $('login-view').hidden = false; $('login-config').hidden = configured;
  $('login-password').value = ''; setTimeout(() => $('login-password').focus(), 50);
}
async function showMain() { $('login-view').hidden = true; $('main-view').hidden = false; await refresh(); }

async function boot() {
  initTheme();
  wire();
  try {
    const s = await get('/api/session');
    if (s.authenticated) await showMain(); else showLogin(s.configured);
  } catch (e) { showLogin(true); $('login-error').textContent = e.message; $('login-error').hidden = false; }
}

// ───────── data ─────────
async function refresh() {
  $('btn-refresh').disabled = true;
  try {
    const [dash, daily] = await Promise.all([get('/api/dashboard'), get('/api/daily?includeVoid=1')]);
    state.dash = dash; state.daily = daily.entries; state.portfolio = {};
    banner(null); renderAll();
  } catch (e) {
    if (e.status === 401) return;
    banner(state.dash ? `${e.message} — กำลังแสดงข้อมูลที่โหลดไว้ล่าสุด` : e.message, true);
    if (state.dash) renderAll(); else $('last-updated').textContent = 'โหลดข้อมูลไม่สำเร็จ';
  } finally { $('btn-refresh').disabled = false; }
}

const today = () => state.dash?.today ?? bangkokNow().date;
const activeDaily = () => state.dash?.daily ?? [];

function renderAll() { renderKpis(); renderAlerts(); renderCharts(); renderForecast(); renderGoals(); renderTable(); }

// ───────── KPIs ─────────
function card(...kids) { return el('div', { class: 'card kpi' }, ...kids); }
function line(label, value, cls = '') { return el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: label }), el('b', { class: cls, text: value })); }

function renderKpis() {
  const d = state.dash, box = clear($('kpis'));
  const t = today(), pf = d.portfolio, cur = d.currency;
  const lu = calc.lastUpdated(pf);
  $('last-updated').textContent = lu ? `ข้อมูลมูลค่าพอร์ตล่าสุด ${fmtDate(lu)} · โหลดเมื่อ ${bangkokNow().label} (เวลาไทย)` : 'ยังไม่มีข้อมูลมูลค่าพอร์ต — นำเข้าข้อมูลจาก Excel หรือกด “อัปเดตมูลค่าพอร์ต”';

  for (const p of PLATFORMS) {
    const s = pf[p] ?? [], l = calc.latest(s), ch = l ? calc.valueChange(s, calc.addDays(l.d, -30)) : null;
    box.append(card(
      el('div', { class: 'kpi-label' }, el('span', { class: `dot dot-${p}` }), `พอร์ต ${LABEL[p]} (${cur[p]})`),
      el('div', { class: 'kpi-value', text: l ? fmtMoney(l.v, cur[p]) : 'ยังไม่มีข้อมูล' }),
      el('div', { class: 'kpi-sub', text: l ? `ณ ${fmtDate(l.d)}` : '' }),
      ch ? el('div', { class: 'kpi-sub' }, `เปลี่ยนมูลค่า 30 วัน `, el('b', { class: signClass(ch.abs), text: `${fmtMoney(ch.abs, cur[p], { sign: true })} (${fmtPct(ch.pct)})` }), el('span', { class: 'chip chip-warn', text: 'ไม่ใช่กำไร' })) : null,
    ));
  }

  const tot = calc.totals(pf, d.settings);
  box.append(card(
    el('div', { class: 'kpi-label', text: 'มูลค่าพอร์ตรวม (แยกสกุลเงิน)' }),
    el('div', { class: 'kpi-lines' }, line('รวมบาท (Dime + StashAway)', fmtMoney(tot.thb, 'THB')), line('รวมดอลลาร์ (Webull)', fmtMoney(tot.usd, 'USD')),
      tot.combinedThb !== null ? line(`ประมาณรวมเป็นบาท (USD/THB ${fmtNum(tot.rate)}${tot.rateDate ? ` ณ ${fmtDate(tot.rateDate)}` : ''})`, fmtMoney(tot.combinedThb, 'THB')) : null),
    el('div', { class: 'kpi-sub', text: tot.combinedThb === null ? 'ไม่รวม USD เป็น THB เพราะยังไม่ได้ตั้งอัตราแลกเปลี่ยน (ตั้งค่าเอง ไม่เดา)' : 'อัตราแลกเปลี่ยนเป็นค่าที่คุณกำหนดเอง' }),
  ));

  const entries = activeDaily();
  const periods = [['day', 'วันนี้'], ['month', 'เดือนนี้'], ['year', 'ปีนี้']];
  const plBox = card(el('div', { class: 'kpi-label', text: 'กำไร/ขาดทุนที่บันทึก' }));
  const lines = el('div', { class: 'kpi-lines' });
  for (const [k, label] of periods) {
    const s = calc.sumDaily(entries, t, k);
    lines.append(el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: label }), el('span', {}, el('b', { class: signClass(s.thb), text: s.thb === null ? '—' : fmtMoney(s.thb, 'THB', { sign: true }) }), ' · ', el('b', { class: signClass(s.usd), text: s.usd === null ? '—' : fmtMoney(s.usd, 'USD', { sign: true }) }))));
  }
  plBox.append(lines, el('div', { class: 'kpi-sub', text: 'บาท · ดอลลาร์ ("—" = ยังไม่ได้บันทึก ไม่ใช่ศูนย์)' }));
  box.append(plBox);

  const cashBox = card(el('div', { class: 'kpi-label', text: 'เงินสดรับจริง (แยกจากกำไร)' }));
  const cl = el('div', { class: 'kpi-lines' });
  for (const [k, label] of periods.slice(1)) {
    const s = calc.sumDaily(entries, t, k, 'cash_received');
    cl.append(el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: label }), el('b', { text: `${s.thb === null ? '—' : fmtMoney(s.thb, 'THB')} · ${s.usd === null ? '—' : fmtMoney(s.usd, 'USD')}` })));
  }
  box.append(cashBox, ); cashBox.append(cl);

  const adj = card(el('div', { class: 'kpi-label', text: 'ผลตอบแทนปรับเงินฝาก (Modified Dietz)' }));
  const al = el('div', { class: 'kpi-lines' });
  for (const p of PLATFORMS) {
    const r = calc.adjustedReturn(pf[p] ?? [], d.cashflows, p, d.settings.cashflows_confirmed_through);
    al.append(r.ok ? line(LABEL[p], `${fmtPct(r.pct)} (${fmtMoney(r.pl, cur[p], { sign: true })})`, signClass(r.pl)) : el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: LABEL[p] }), el('span', { class: 'muted', text: 'ยังไม่พร้อม' })));
  }
  adj.append(al, el('div', { class: 'kpi-sub', text: d.settings.cashflows_confirmed_through ? `คำนวณถึง ${fmtDate(d.settings.cashflows_confirmed_through)} จากเงินฝาก/ถอนที่คุณยืนยัน` : 'ต้องบันทึกเงินฝาก/ถอนให้ครบ แล้วตั้ง “ยืนยันเงินฝากครบถึงวันที่” ในตั้งค่า — ระบบไม่เดากำไรจากมูลค่าพอร์ต' }));
  box.append(adj);
}

function renderAlerts() {
  const list = calc.buildAlerts(state.dash.portfolio, activeDaily(), today()), ul = clear($('alerts'));
  $('alerts-section').hidden = list.length === 0;
  for (const a of list) ul.append(el('li', { class: a.level, text: a.text }));
}

// ───────── charts ─────────
function renderCharts() {
  const d = state.dash, from = calc.rangeStart(today(), state.range);
  const ranged = Object.fromEntries(PLATFORMS.map((p) => [p, calc.sliceRange(d.portfolio[p] ?? [], from)]));
  valueChart('chart-value-thb', ['dime', 'stashaway'], ranged, 'THB');
  valueChart('chart-value-usd', ['webull'], ranged, 'USD');
  const rows = calc.incomeByBucket(activeDaily(), state.bucket, 'profit_loss', today());
  barChart('chart-income-thb', ['dime', 'stashaway'], rows, 'THB');
  barChart('chart-income-usd', ['webull'], rows, 'USD');
  const cum = calc.cumulative(calc.incomeByBucket(activeDaily(), 'day', 'profit_loss', today()));
  cumulativeChart('chart-cum-thb', ['dime', 'stashaway'], cum, 'THB');
  cumulativeChart('chart-cum-usd', ['webull'], cum, 'USD');
}

// ───────── forecast + goals ─────────
function renderForecast() {
  const d = state.dash, seg = clear($('forecast-platforms'));
  for (const p of PLATFORMS) seg.append(el('button', { type: 'button', class: `seg-btn${state.fc === p ? ' is-active' : ''}`, onclick: () => { state.fc = p; renderForecast(); } }, LABEL[p]));
  const box = clear($('forecast-card')), p = state.fc, ccy = d.currency[p];
  const fc = calc.forecast(d.portfolio[p] ?? [], d.cashflows, p, today(), { windowDays: Number(d.settings.forecast_window_days) || 180 });
  if (!fc.sufficient) { box.append(el('p', { text: `${LABEL[p]}: ${fc.reason}` }), el('p', { class: 'muted', text: 'ระบบจะไม่สร้างตัวเลขคาดการณ์จนกว่าจะมีข้อมูลพอ' })); return; }
  box.append(
    el('p', {}, el('b', { text: `${LABEL[p]} (${ccy})` }), el('span', { class: 'badge-forecast', text: 'ค่าประมาณ ไม่ใช่ข้อมูลจริง' })),
    el('p', { class: 'kpi-sub', text: `แนวโน้มเฉลี่ยต่อเดือน ${fmtPct(fc.monthlyChangePct)} · เทียบรายปี ≈ ${fmtPct(fc.annualizedPct)} (ประมาณจากข้อมูลย้อนหลัง ไม่ใช่ผลตอบแทนที่รับประกัน) · ฐาน ${fmtMoney(fc.base, ccy)} ณ ${fmtDate(fc.asOf)}` }),
  );
  const tbl = el('table', { class: 'fc-table' }, el('thead', {}, el('tr', {}, el('th', { text: 'ช่วง' }), el('th', { text: 'วันที่' }), el('th', { text: 'ค่ากลาง' }), el('th', { text: 'ช่วงโดยประมาณ' }))),
    el('tbody', {}, fc.horizons.map((h) => el('tr', {}, el('td', { text: h.label }), el('td', { text: fmtDate(h.date) }), el('td', { text: fmtMoney(h.mid, ccy) }), el('td', { class: 'muted', text: `${fmtMoney(h.lo, ccy)} – ${fmtMoney(h.hi, ccy)}` })))));
  const canvas = el('canvas', { id: 'chart-forecast', role: 'img', 'aria-label': 'กราฟคาดการณ์มูลค่าพอร์ต' });
  box.append(tbl, el('div', { class: 'chart-box' }, canvas), el('div', { id: 'empty-forecast', class: 'empty', hidden: true, text: 'ไม่มีข้อมูล' }),
    el('div', { class: 'fc-note' }, el('b', { text: 'สมมติฐานและวิธีคำนวณ' }), el('ul', {}, fc.assumptions.map((a) => el('li', { text: a })))));
  const hist = calc.sliceRange(d.portfolio[p], calc.addDays(fc.asOf, -fc.windowDays));
  forecastChart('chart-forecast', p, hist, calc.projectionPath(fc, 365, 7));
}

function renderGoals() {
  const box = clear($('goals'));
  for (const g of calc.goalProgress(state.dash.portfolio, state.dash.settings)) {
    const bar = el('span'); if (g.pct !== null) bar.style.width = `${Math.min(g.pct, 1) * 100}%`;
    box.append(el('div', { class: 'card' },
      el('div', { class: 'kpi-label' }, el('span', { class: `dot dot-${g.platform}` }), `${LABEL[g.platform]} (${g.ccy})`),
      g.goal === null ? el('p', { class: 'muted', text: 'ยังไม่ได้ตั้งเป้าหมาย — ตั้งค่าได้ที่ “ตั้งค่า”' }) : el('div', {}, el('div', { class: 'bar' }, bar), el('div', { class: 'kpi-sub', text: `${g.value === null ? '—' : fmtMoney(g.value, g.ccy)} จากเป้า ${fmtMoney(g.goal, g.ccy)} (${g.pct === null ? '—' : `${(g.pct * 100).toFixed(1)}%`})` }))));
  }
}

// ───────── history table ─────────
const histRows = () => {
  if (state.tab === 'daily') return state.daily.filter((e) => state.showVoid || e.status === 'active').map((e) => ({ ...e, date: e.entryDate, typeLabel: TYPE_LABEL[e.type] ?? e.type }));
  return (state.portfolio[state.tab] ?? []).map((e) => ({ ...e, kindLabel: KIND_LABEL[e.kind] ?? e.kind }));
};

async function ensurePortfolio(p) {
  if (state.portfolio[p]) return;
  try { state.portfolio[p] = (await get(`/api/portfolio?platform=${p}`)).entries; } catch (e) { toast(e.message, true); state.portfolio[p] = []; }
}

async function renderTable() {
  const t = state.table, daily = state.tab === 'daily';
  $('table-void').parentElement.hidden = !daily;
  if (!daily) await ensurePortfolio(state.tab);
  const cols = daily
    ? [['date', 'วันที่รายการ', true], ['typeLabel', 'ชนิด'], ['dime', 'Dime ฿', true, 'num'], ['stashaway', 'StashAway ฿', true, 'num'], ['webull', 'Webull $', true, 'num'], ['note', 'หมายเหตุ'], ['_', '']]
    : [['date', 'วันที่', true], ['thb', 'บาท', true, 'num'], ['usd', 'USD', true, 'num'], ['kindLabel', 'ชนิดแถว'], ['note', 'หมายเหตุ / ตรวจสอบ']];
  const view = calc.tableView(histRows(), { query: t.query, sortKey: t.sortKey ?? 'date', dir: t.dir, page: t.page, pageSize: 15, searchKeys: ['date', 'note', 'typeLabel', 'kindLabel', 'reviewFlag'] });
  const head = clear($('history-table').tHead); const hr = el('tr');
  for (const [key, label, sortable, cls] of cols) hr.append(el('th', { class: `${sortable ? 'sortable' : ''} ${cls ?? ''}`, 'aria-sort': (t.sortKey ?? 'date') === key ? (t.dir === 'asc' ? 'ascending' : 'descending') : null, onclick: sortable ? () => { t.dir = (t.sortKey ?? 'date') === key && t.dir === 'desc' ? 'asc' : 'desc'; t.sortKey = key; t.page = 1; renderTable(); } : null, text: label + ((t.sortKey ?? 'date') === key ? (t.dir === 'asc' ? ' ▲' : ' ▼') : '') }));
  head.append(hr);
  const body = clear($('history-table').tBodies[0]);
  if (!view.rows.length) body.append(el('tr', {}, el('td', { colspan: cols.length, class: 'muted', text: 'ไม่มีข้อมูลที่ตรงกับเงื่อนไข' })));
  for (const r of view.rows) {
    const cells = cols.map(([key, , , cls]) => {
      if (key === '_') return el('td', {}, r.status === 'active' ? el('div', { class: 'actions' }, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openDailyForm(r), text: 'แก้ไข' }), el('button', { class: 'btn btn-sm', type: 'button', onclick: () => voidDaily(r), text: 'ยกเลิก' })) : el('span', { class: 'muted', text: 'ยกเลิกแล้ว' }));
      if (key === 'date') return el('td', { text: fmtDate(r.date) });
      if (['dime', 'stashaway', 'thb'].includes(key)) return el('td', { class: cls, text: r[key] === null || r[key] === undefined ? '—' : fmtMoney(r[key], 'THB') });
      if (['webull', 'usd'].includes(key)) return el('td', { class: cls, text: r[key] === null || r[key] === undefined ? '—' : fmtMoney(r[key], 'USD') });
      if (key === 'note') return el('td', {}, r.note || '', r.reviewFlag ? el('div', { class: 'muted', text: `⚠ ${r.reviewFlag}` }) : null);
      return el('td', { text: r[key] ?? '' });
    });
    body.append(el('tr', { class: `${r.status === 'void' ? 'is-void' : ''} ${r.reviewFlag ? 'flag' : ''}` }, cells));
  }
  $('pg-info').textContent = `หน้า ${view.page}/${view.pages} · ${view.total} รายการ`;
  $('pg-prev').disabled = view.page <= 1; $('pg-next').disabled = view.page >= view.pages;
  t.page = view.page;
}

async function voidDaily(r) {
  if (!window.confirm(`ยกเลิกรายการวันที่ ${fmtDate(r.entryDate)}?\n(รายการจะถูกทำเครื่องหมายว่ายกเลิกและไม่นับใน KPI แต่ยังเก็บไว้ในชีต)`)) return;
  try { await post(`/api/daily/${r.entryId}/void`, { expectedRevision: r.revision }); toast('ยกเลิกรายการแล้ว'); await refresh(); } catch (e) { toast(e.message, true); if (e.code === 'CONFLICT') await refresh(); }
}

// ───────── generic two-step form dialog ─────────
const dlg = () => $('form-dialog');
let formCtx = null;

function fieldNode(f, value) {
  if (f.kind === 'radio') {
    return el('div', { class: 'field' }, el('span', { text: f.label }), el('div', { class: 'radio-group', role: 'radiogroup' }, f.options.map((o) =>
      el('label', { class: 'radio' }, el('input', { type: 'radio', name: f.id, value: o.value, checked: value === o.value }), el('span', {}, o.label, o.hint ? el('small', { text: o.hint }) : null)))));
  }
  const common = { id: `f-${f.id}`, name: f.id, autocomplete: 'off', placeholder: f.placeholder };
  let input;
  if (f.kind === 'select') input = el('select', common, f.options.map((o) => el('option', { value: o.value, selected: value === o.value, text: o.label })));
  else if (f.kind === 'textarea') input = el('textarea', { ...common, maxlength: 500, rows: 2 }); else if (f.kind === 'date') input = el('input', { ...common, type: 'date' });
  else input = el('input', { ...common, type: 'text', inputmode: f.inputmode ?? 'decimal' });
  if (f.kind !== 'select' && value !== undefined && value !== null) input.value = value;
  return el('label', { class: 'field' }, el('span', { text: f.label }), input, f.hint ? el('small', { class: 'muted', text: f.hint }) : null);
}

function readValues(fields) {
  const v = {};
  for (const f of fields) {
    if (f.kind === 'radio') v[f.id] = document.querySelector(`input[name="${f.id}"]:checked`)?.value ?? '';
    else v[f.id] = $(`f-${f.id}`).value;
  }
  return v;
}

function openForm(cfg) {
  formCtx = { cfg, step: 'edit', values: cfg.initial ?? {}, payload: null, busy: false };
  $('fd-title').textContent = cfg.title; renderFormStep(); dlg().showModal();
}
function renderFormStep() {
  const { cfg, step } = formCtx, body = clear($('fd-body'));
  $('fd-error').hidden = true;
  if (step === 'edit') {
    const row = []; // pair up number fields marked `pair`
    for (let i = 0; i < cfg.fields.length; i++) {
      const f = cfg.fields[i], nodes = fieldNode(f, formCtx.values[f.id]);
      if (f.pairWithNext) { body.append(el('div', { class: 'field-row' }, nodes, fieldNode(cfg.fields[++i], formCtx.values[cfg.fields[i].id]))); } else body.append(nodes);
    }
    if (cfg.intro) body.prepend(el('p', { class: 'notice', text: cfg.intro }));
    $('fd-back').hidden = true; $('fd-submit').textContent = cfg.noConfirm ? 'บันทึก' : 'ตรวจสอบ';
  } else {
    body.append(el('p', { class: 'muted', text: 'ตรวจสอบข้อมูลก่อนยืนยัน — บันทึกแล้วจะเขียนลง Google Sheets' }), el('div', { class: 'summary' }, cfg.summarize(formCtx.payload).map(([k, v]) => el('div', { class: 'summary-row' }, el('span', { class: 'muted', text: k }), el('b', { text: v })))));
    $('fd-back').hidden = false; $('fd-submit').textContent = cfg.submitLabel ?? 'ยืนยันบันทึก';
  }
  $('fd-submit').disabled = false;
  if (step === 'edit') setTimeout(() => body.querySelector('input:not([type=radio]),select,textarea')?.focus(), 30);
}
async function onFormSubmit(ev) {
  ev.preventDefault();
  if (!formCtx || formCtx.busy) return;
  const { cfg } = formCtx;
  const showErr = (m) => { $('fd-error').textContent = m; $('fd-error').hidden = false; };
  if (formCtx.step === 'edit') {
    formCtx.values = readValues(cfg.fields);
    const parsed = cfg.parse(formCtx.values);
    if (parsed.error) return showErr(parsed.error);
    formCtx.payload = parsed.payload;
    if (!cfg.noConfirm) { formCtx.step = 'confirm'; return renderFormStep(); }
  }
  formCtx.busy = true; $('fd-submit').disabled = true; $('fd-back').disabled = true;
  try {
    await cfg.submit(formCtx.payload);
    dlg().close(); toast(cfg.successMessage ?? 'บันทึกสำเร็จ'); formCtx = null;
    await cfg.after?.();
  } catch (e) {
    showErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'); // same requestId is reused on retry -> never double-writes
    if (formCtx) { formCtx.busy = false; $('fd-submit').disabled = false; $('fd-back').disabled = false; }
    if (e.code === 'CONFLICT') await refresh();
  }
}

// parsing helpers (client-side convenience; the server validates again)
function num(str, label, { required = false, min = null } = {}) {
  const s = String(str ?? '').replace(/,/g, '').trim();
  if (s === '') return required ? { error: `กรุณากรอก${label}` } : { value: null };
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) return { error: `${label} ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง, ใส่ − สำหรับค่าติดลบ)` };
  const n = Number(s);
  if (Math.abs(n) > 1e9) return { error: `${label} มากเกินไป` };
  if (min !== null && n < min) return { error: `${label} ต้องไม่น้อยกว่า ${min}` };
  return { value: n };
}
const newId = () => crypto.randomUUID();
const dateField = (id = 'entryDate', label = 'วันที่ของรายการ') => ({ id, label, kind: 'date', hint: 'ค่าเริ่มต้นคือวันนี้ (เวลาไทย)' });

function openDailyForm(existing = null) {
  const requestId = newId();
  openForm({
    title: existing ? 'แก้ไขรายการรายวัน' : 'บันทึกข้อมูลวันนี้',
    intro: 'เว้นว่างบัญชีที่ไม่มีข้อมูล (เว้นว่าง ≠ 0) · ใส่ − หน้าตัวเลขสำหรับขาดทุน',
    initial: existing ? { type: existing.type, entryDate: existing.entryDate, dime: existing.dime ?? '', stashaway: existing.stashaway ?? '', webull: existing.webull ?? '', note: existing.note } : { entryDate: bangkokNow().date },
    fields: [
      { id: 'type', label: 'ประเภทข้อมูลที่กรอก (จำเป็น)', kind: 'radio', options: [{ value: 'profit_loss', label: 'กำไร/ขาดทุน', hint: 'ผลได้เสียของวันนั้น (ไม่รวมเงินที่คุณฝากเพิ่ม)' }, { value: 'cash_received', label: 'เงินสดรับจริง', hint: 'เงินที่ได้รับเข้าบัญชีจริง เช่น ปันผล/ดอกเบี้ย' }] },
      dateField(),
      { id: 'dime', label: 'Dime (บาท)', kind: 'text', placeholder: 'เช่น 120.50 หรือ -45', pairWithNext: true }, { id: 'stashaway', label: 'StashAway (บาท)', kind: 'text', placeholder: 'เช่น 80' },
      { id: 'webull', label: 'Webull (USD)', kind: 'text', placeholder: 'เช่น 3.25' },
      { id: 'note', label: 'หมายเหตุเพิ่มเติม (ถ้ามี)', kind: 'textarea' },
    ],
    parse: (v) => {
      if (!v.type) return { error: 'กรุณาเลือกว่ากรอก “กำไร/ขาดทุน” หรือ “เงินสดรับจริง”' };
      const a = { dime: num(v.dime, 'Dime'), stashaway: num(v.stashaway, 'StashAway'), webull: num(v.webull, 'Webull') };
      for (const r of Object.values(a)) if (r.error) return { error: r.error };
      if (a.dime.value === null && a.stashaway.value === null && a.webull.value === null) return { error: 'กรอกอย่างน้อย 1 บัญชี' };
      if (!v.entryDate) return { error: 'กรุณาเลือกวันที่' };
      if (v.entryDate > calc.addDays(bangkokNow().date, 1)) return { error: 'วันที่เกินวันนี้ (เวลาไทย) ไม่ได้' };
      return { payload: { type: v.type, entryDate: v.entryDate, dime: a.dime.value, stashaway: a.stashaway.value, webull: a.webull.value, note: v.note.trim() } };
    },
    summarize: (p) => [['ประเภท', TYPE_LABEL[p.type]], ['วันที่รายการ', fmtDate(p.entryDate)], ['Dime', p.dime === null ? 'ไม่บันทึก (เว้นว่าง)' : fmtMoney(p.dime, 'THB', { sign: true })], ['StashAway', p.stashaway === null ? 'ไม่บันทึก (เว้นว่าง)' : fmtMoney(p.stashaway, 'THB', { sign: true })], ['Webull', p.webull === null ? 'ไม่บันทึก (เว้นว่าง)' : fmtMoney(p.webull, 'USD', { sign: true })], ['หมายเหตุ', p.note || '—']],
    submit: (p) => (existing ? put(`/api/daily/${existing.entryId}`, { ...p, expectedRevision: existing.revision }) : post('/api/daily', { ...p, requestId })),
    successMessage: existing ? 'แก้ไขรายการแล้ว' : 'บันทึกสำเร็จ — อัปเดต KPI และกราฟแล้ว', after: refresh,
  });
}

function openValueForm() {
  const requestId = newId();
  openForm({
    title: 'อัปเดตมูลค่าพอร์ตล่าสุด', intro: 'นี่คือ “มูลค่าพอร์ต” ไม่ใช่กำไร/ขาดทุน — ใช้บันทึกยอดรวมในแอปโบรกเกอร์',
    initial: { platform: 'dime', date: bangkokNow().date },
    fields: [{ id: 'platform', label: 'แพลตฟอร์ม', kind: 'select', options: PLATFORMS.map((p) => ({ value: p, label: `${LABEL[p]} (${calc.CCY[p]})` })) }, { id: 'value', label: 'มูลค่าพอร์ตทั้งหมด (ตามสกุลเงินของแพลตฟอร์ม)', kind: 'text', placeholder: 'เช่น 725040.29' }, dateField('date', 'วันที่ของมูลค่า'), { id: 'note', label: 'หมายเหตุ (ถ้ามี)', kind: 'textarea' }],
    parse: (v) => { const n = num(v.value, 'มูลค่าพอร์ต', { required: true, min: 0 }); if (n.error) return n; if (!v.date) return { error: 'กรุณาเลือกวันที่' }; return { payload: { platform: v.platform, value: n.value, date: v.date, note: v.note.trim() } }; },
    summarize: (p) => [['แพลตฟอร์ม', LABEL[p.platform]], ['มูลค่า', fmtMoney(p.value, calc.CCY[p.platform])], ['วันที่', fmtDate(p.date)], ['หมายเหตุ', p.note || '—']],
    submit: (p) => post('/api/portfolio', { ...p, requestId }), after: async () => { state.portfolio = {}; await refresh(); },
  });
}

function openCashflowForm() {
  const requestId = newId();
  openForm({
    title: 'บันทึกเงินฝาก / ถอน / ปันผล', intro: 'ใช้แยกเงินที่เติม/ถอนออกจากผลตอบแทน — ใส่จำนวนเป็นสกุลเงินเดียวกับพอร์ต (ระบบไม่แปลงสกุลเงินให้)',
    initial: { platform: 'dime', type: 'deposit', date: bangkokNow().date },
    fields: [{ id: 'platform', label: 'แพลตฟอร์ม', kind: 'select', options: PLATFORMS.map((p) => ({ value: p, label: `${LABEL[p]} (${calc.CCY[p]})` })) }, { id: 'type', label: 'ประเภท', kind: 'select', options: [{ value: 'deposit', label: 'ฝากเพิ่ม' }, { value: 'withdrawal', label: 'ถอนออก' }, { value: 'dividend', label: 'ปันผล/ดอกเบี้ยที่ได้รับ' }] }, { id: 'amount', label: 'จำนวนเงิน (สกุลเงินของพอร์ต)', kind: 'text' }, dateField('date', 'วันที่'), { id: 'note', label: 'หมายเหตุ', kind: 'textarea' }],
    parse: (v) => { const n = num(v.amount, 'จำนวนเงิน', { required: true, min: 0.01 }); if (n.error) return n; if (!v.date) return { error: 'กรุณาเลือกวันที่' }; return { payload: { platform: v.platform, type: v.type, amount: n.value, currency: calc.CCY[v.platform], date: v.date, note: v.note.trim() } }; },
    summarize: (p) => [['แพลตฟอร์ม', LABEL[p.platform]], ['ประเภท', { deposit: 'ฝากเพิ่ม', withdrawal: 'ถอนออก', dividend: 'ปันผล/ดอกเบี้ย' }[p.type]], ['จำนวน', fmtMoney(p.amount, p.currency)], ['วันที่', fmtDate(p.date)], ['หมายเหตุ', p.note || '—']],
    submit: (p) => post('/api/cashflows', { ...p, requestId }), after: refresh,
  });
}

function openSettingsForm() {
  const s = state.dash?.settings ?? {};
  openForm({
    title: 'ตั้งค่า', noConfirm: true, intro: 'เว้นว่าง = ล้างค่า · ไม่มีการเดาอัตราแลกเปลี่ยนหรือเป้าหมายแทนคุณ',
    initial: { goal_dime_thb: s.goal_dime_thb ?? '', goal_stashaway_thb: s.goal_stashaway_thb ?? '', goal_webull_usd: s.goal_webull_usd ?? '', usd_thb_rate: s.usd_thb_rate ?? '', usd_thb_rate_date: s.usd_thb_rate_date ?? '', cashflows_confirmed_through: s.cashflows_confirmed_through ?? '', forecast_window_days: s.forecast_window_days ?? '180' },
    fields: [
      { id: 'goal_dime_thb', label: 'เป้าหมายพอร์ต Dime (บาท)', kind: 'text' }, { id: 'goal_stashaway_thb', label: 'เป้าหมายพอร์ต StashAway (บาท)', kind: 'text' }, { id: 'goal_webull_usd', label: 'เป้าหมายพอร์ต Webull (USD)', kind: 'text' },
      { id: 'usd_thb_rate', label: 'อัตรา USD→THB ที่คุณกำหนด (ไม่บังคับ)', kind: 'text', pairWithNext: true }, { id: 'usd_thb_rate_date', label: 'ณ วันที่', kind: 'date' },
      { id: 'cashflows_confirmed_through', label: 'ยืนยันว่าบันทึกเงินฝาก/ถอนครบถึงวันที่', kind: 'date', hint: 'ใช้คำนวณผลตอบแทนปรับเงินฝาก — ตั้งเมื่อมั่นใจว่าไม่มีรายการตกหล่นเท่านั้น' },
      { id: 'forecast_window_days', label: 'จำนวนวันย้อนหลังที่ใช้ประมาณแนวโน้ม (30–730)', kind: 'text', inputmode: 'numeric' },
    ],
    parse: (v) => {
      const out = {};
      for (const k of ['goal_dime_thb', 'goal_stashaway_thb', 'goal_webull_usd', 'usd_thb_rate']) { const n = num(v[k], k, { min: 0 }); if (n.error) return { error: 'ค่าเป้าหมาย/อัตราแลกเปลี่ยนต้องเป็นตัวเลขไม่ติดลบ' }; out[k] = n.value; }
      out.usd_thb_rate_date = v.usd_thb_rate_date || null; out.cashflows_confirmed_through = v.cashflows_confirmed_through || null;
      const days = Number(v.forecast_window_days); if (!Number.isInteger(days) || days < 30 || days > 730) return { error: 'จำนวนวันต้องเป็น 30–730' };
      out.forecast_window_days = days;
      return { payload: out };
    },
    submit: (p) => put('/api/settings', p), successMessage: 'บันทึกการตั้งค่าแล้ว', after: refresh,
  });
}

// ───────── wiring ─────────
function wire() {
  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const err = $('login-error'); err.hidden = true; $('login-submit').disabled = true;
    try { await post('/api/login', { password: $('login-password').value }); $('login-password').value = ''; await showMain(); }
    catch (e) { err.textContent = e.message; err.hidden = false; } finally { $('login-submit').disabled = false; }
  });
  $('btn-logout').addEventListener('click', async () => { try { await post('/api/logout'); } finally { state.dash = null; state.daily = []; state.portfolio = {}; showLogin(true); } });
  window.addEventListener('minvest:unauthenticated', () => { state.dash = null; showLogin(true); toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', true); });
  window.addEventListener('offline', () => banner('ออฟไลน์ — แสดงข้อมูลที่โหลดไว้ล่าสุด การบันทึกจะทำไม่ได้จนกว่าจะกลับมาออนไลน์', true));
  window.addEventListener('online', () => { banner(null); refresh(); });
  $('btn-refresh').addEventListener('click', refresh); $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-add-daily').addEventListener('click', () => openDailyForm()); $('btn-add-value').addEventListener('click', openValueForm);
  initImportUi(refresh);
  $('btn-add-cashflow').addEventListener('click', openCashflowForm); $('btn-settings').addEventListener('click', openSettingsForm);
  const rb = $('range-buttons');
  for (const [k, label] of RANGES) rb.append(el('button', { type: 'button', class: `seg-btn${k === state.range ? ' is-active' : ''}`, 'data-range': k, onclick: () => { state.range = k; for (const b of rb.children) b.classList.toggle('is-active', b.dataset.range === k); renderCharts(); }, text: label }));
  $('income-bucket').addEventListener('click', (ev) => { const b = ev.target.closest('[data-bucket]'); if (!b) return; state.bucket = b.dataset.bucket; for (const x of $('income-bucket').children) x.classList.toggle('is-active', x === b); renderCharts(); });
  $('history-tabs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tab]'); if (!b) return; state.tab = b.dataset.tab; state.table = { query: '', sortKey: null, dir: 'desc', page: 1 }; $('table-search').value = ''; for (const x of $('history-tabs').children) x.classList.toggle('is-active', x === b); renderTable(); });
  $('table-search').addEventListener('input', (ev) => { state.table.query = ev.target.value; state.table.page = 1; renderTable(); });
  $('table-void').addEventListener('change', (ev) => { state.showVoid = ev.target.checked; renderTable(); });
  $('pg-prev').addEventListener('click', () => { state.table.page--; renderTable(); }); $('pg-next').addEventListener('click', () => { state.table.page++; renderTable(); });
  $('fd-form').addEventListener('submit', onFormSubmit);
  $('fd-close').addEventListener('click', () => { dlg().close(); formCtx = null; });
  dlg().addEventListener('cancel', () => { formCtx = null; });
  $('fd-back').addEventListener('click', () => { formCtx.step = 'edit'; renderFormStep(); });
}

boot();
