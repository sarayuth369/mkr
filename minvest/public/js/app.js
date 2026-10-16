// minvest dashboard controller. All dynamic text goes through textContent (no innerHTML) -> no XSS surface.
import { api, get, post, put, ApiError } from './api.js';
import * as calc from './calc.js';
import { barChart, cumulativeChart, forecastChart, totalChart, valueChart } from './charts.js';
import { initImportUi } from './import-ui.js';
import { initSecurityUi, openSecurity } from './security-ui.js';
import { bangkokNow, fmtDate, fmtMoney, fmtPct, fmtRate, signClass } from './format.js';

const $ = (id) => document.getElementById(id);
const PLATFORMS = calc.PLATFORMS;
const LABEL = calc.PLATFORM_LABEL;
const TYPE_LABEL = { profit_loss: 'กำไร/ขาดทุน', cash_received: 'เงินสดรับจริง' };
const KIND_LABEL = { value: 'มูลค่า', superseded: 'ถูกแทนที่ (วันเดียวกัน)', event_amount: 'จำนวนธุรกรรม', usd_event: 'ธุรกรรม USD', note_only: 'หมายเหตุ', value_unparsed: 'ตัวเลขผิดรูปแบบ - ตรวจสอบ' };
const RANGES = [['7d', '7 วัน'], ['30d', '30 วัน'], ['90d', '90 วัน'], ['1y', '1 ปี'], ['all', 'ทั้งหมด']];

const HIST_EDIT_KINDS = [['value', 'มูลค่าพอร์ต'], ['event_amount', 'จำนวนธุรกรรม'], ['usd_event', 'ธุรกรรม USD'], ['note_only', 'หมายเหตุ'], ['superseded', 'ถูกแทนที่ (วันเดียวกัน)']];
const newTable = () => ({ query: '', sortKey: null, dir: 'desc', page: 1, kind: '', from: '', to: '' });
const state = { dash: null, daily: [], range: '90d', bucket: 'month', fc: 'dime', tab: 'daily', portfolio: {}, table: newTable(), showVoid: false, session: null, fx: null, fxHist: null };

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
async function showMain() {
  $('login-view').hidden = true; $('main-view').hidden = false;
  try { state.session = await get('/api/session'); } catch { /* keep the previous value */ }
  await refresh();
}

async function boot() {
  initTheme();
  wire();
  try {
    const s = await get('/api/session');
    state.session = s;
    if (s.authenticated) await showMain(); else showLogin(s.configured);
  } catch (e) { showLogin(true); $('login-error').textContent = e.message; $('login-error').hidden = false; }
}

// ───────── data ─────────
async function refresh() {
  $('btn-refresh').disabled = true;
  try {
    const [dash, daily] = await Promise.all([get('/api/dashboard'), get('/api/daily?includeVoid=1')]);
    state.dash = dash; state.daily = daily.entries; state.portfolio = {};
    await loadFx(false);
    banner(null); renderAll();
  } catch (e) {
    if (e.status === 401) return;
    banner(state.dash ? `${e.message} — กำลังแสดงข้อมูลที่โหลดไว้ล่าสุด` : e.message, true);
    if (state.dash) renderAll(); else $('last-updated').textContent = 'โหลดข้อมูลไม่สำเร็จ';
  } finally { $('btn-refresh').disabled = false; }
}

const today = () => state.dash?.today ?? bangkokNow().date;
const activeDaily = () => state.dash?.daily ?? [];

/** USD->THB reference rate from the Worker (server-side fetch + cache). A failure is shown, never papered over with an old/guessed rate. */
async function loadFx(force) {
  try { state.fx = force ? await post('/api/fx/refresh') : await get('/api/fx'); }
  catch (e) { if (e.status === 401) throw e; state.fx = { status: 'unavailable', error: e.message }; }
  state.fxHist = null;
  const starts = PLATFORMS.map((p) => state.dash?.portfolio?.[p]?.[0]?.d).filter(Boolean).sort();
  if (!starts.length || state.fx.status === 'unavailable') return;
  try { state.fxHist = await get(`/api/fx/history?from=${calc.addDays(starts[0], -7)}&to=${today()}`); } catch { state.fxHist = null; }
}
const fetchedLabel = (iso) => (iso ? bangkokNow(new Date(iso)).label : '—');

function renderAll() { renderFxBar(); renderKpis(); renderAlerts(); renderCharts(); renderTotals(); renderForecast(); renderGoals(); renderTable(); }

function renderFxBar() {
  const fx = state.fx, bar = clear($('fx-bar'));
  if (!fx) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.className = `fx-bar is-${fx.status}`;
  const refresh = el('button', { class: 'btn btn-sm', type: 'button', id: 'btn-fx-refresh', onclick: refreshFx, text: 'รีเฟรชอัตรา' });
  if (fx.status === 'unavailable') {
    bar.append(el('div', {}, el('span', { class: 'chip chip-neg', text: 'ไม่มีอัตราแลกเปลี่ยน' }), ' ยังคำนวณมูลค่า Webull เป็นบาทไม่ได้ — ', el('span', { class: 'muted', text: fx.error ?? '' })), refresh);
    return;
  }
  const stale = fx.status === 'stale';
  bar.append(el('div', {},
    el('span', { class: `chip ${stale ? 'chip-warn' : 'chip-ok'}`, text: stale ? 'อัตราอาจไม่เป็นปัจจุบัน' : 'อัตราล่าสุด' }),
    ` USD/THB ${fmtRate(fx.rate)} · อัตราอ้างอิงวันที่ ${fmtDate(fx.rateDate)} · ดึงเมื่อ ${fetchedLabel(fx.fetchedAt)} (เวลาไทย)`,
    el('div', { class: 'muted small', text: `แหล่งที่มา: ${fx.source} — เป็นอัตราอ้างอิงรายวันทำการ ไม่ใช่อัตราซื้อขายจริงของโบรกเกอร์${fx.error ? ` · ${fx.error}` : ''}${fx.note ? ` · ${fx.note}` : ''}` })), refresh);
}
async function refreshFx() {
  const b = $('btn-fx-refresh'); if (b) b.disabled = true;
  try { await loadFx(true); renderAll(); toast(state.fx.status === 'unavailable' ? 'ดึงอัตราแลกเปลี่ยนไม่สำเร็จ' : 'อัปเดตอัตราแลกเปลี่ยนแล้ว', state.fx.status === 'unavailable'); }
  catch (e) { if (e.status !== 401) toast(e.message, true); }
}

// ───────── KPIs ─────────
function card(...kids) { return el('div', { class: 'card kpi' }, ...kids); }
function line(label, value, cls = '') { return el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: label }), el('b', { class: cls, text: value })); }

function renderKpis() {
  const d = state.dash, box = clear($('kpis'));
  const t = today(), pf = d.portfolio, cur = d.currency;
  const lu = calc.lastUpdated(pf);
  $('last-updated').textContent = lu ? `ข้อมูลมูลค่าพอร์ตล่าสุด ${fmtDate(lu)} · โหลดเมื่อ ${bangkokNow().label} (เวลาไทย)` : 'ยังไม่มีข้อมูลมูลค่าพอร์ต — นำเข้าข้อมูลจาก Excel หรือกด “อัปเดตมูลค่าพอร์ต”';

  const now = calc.totalThbNow(pf, state.fx);
  for (const p of PLATFORMS) {
    const s = pf[p] ?? [], l = calc.latest(s), ch = l ? calc.windowChange(s, calc.windowStart(l.d, '30d')) : null;
    const age = l ? calc.daysBetween(l.d, t) : 0;
    box.append(card(
      el('div', { class: 'kpi-label' }, el('span', { class: `dot dot-${p}` }), `พอร์ต ${LABEL[p]} (${cur[p]})`),
      el('div', { class: 'kpi-value', text: l ? fmtMoney(l.v, cur[p]) : 'ยังไม่มีข้อมูล' }),
      el('div', { class: 'kpi-sub' }, l ? `มูลค่า ณ ${fmtDate(l.d)}` : '', age > 4 ? el('span', { class: 'chip chip-warn', text: `ข้อมูลเก่า ${age} วัน` }) : null),
      p === 'webull' && l ? (now.webullThb !== null
        ? el('div', { class: 'kpi-sub' }, '≈ ', el('b', { text: fmtMoney(now.webullThb, 'THB') }), ` (× ${fmtRate(now.rate)} · อัตรา ${fmtDate(now.rateDate)})`, now.stale ? el('span', { class: 'chip chip-warn', text: 'อัตราเก่า' }) : null)
        : el('div', { class: 'kpi-sub' }, el('span', { class: 'chip chip-neg', text: 'ยังคำนวณเป็นบาทไม่ได้' }), ' ไม่มีอัตราแลกเปลี่ยนที่ตรวจสอบได้')) : null,
      l ? (ch?.ok
        ? el('div', { class: 'kpi-sub' }, 'เปลี่ยนมูลค่า 30 วัน ', el('b', { class: signClass(ch.abs), text: `${fmtMoney(ch.abs, cur[p], { sign: true })} (${fmtPct(ch.pct)})` }), el('span', { class: 'chip chip-warn', text: 'ไม่ใช่กำไร' }))
        : el('div', { class: 'kpi-sub muted', text: `ยังคำนวณการเปลี่ยนแปลง 30 วันไม่ได้ — ${ch?.reason ?? ''}` })) : null,
    ));
  }

  // Total THB = Dime + StashAway + Webull USD x rate. USD is never added to THB directly.
  const totCard = card(el('div', { class: 'kpi-label', text: 'มูลค่าพอร์ตรวมเป็นบาท (Total THB)' }));
  if (now.total === null) {
    totCard.append(el('div', { class: 'kpi-value', text: 'ยังคำนวณไม่ได้' }),
      el('div', { class: 'kpi-sub', text: now.blocked ? 'ไม่มีอัตราแลกเปลี่ยน USD/THB ที่ตรวจสอบได้ จึงไม่รวม Webull เป็นบาท (ไม่เดา ไม่ใช้อัตราเก่าแบบเงียบ ๆ)' : 'ยังไม่มีข้อมูลมูลค่าพอร์ต' }),
      now.thbSubtotal !== null ? el('div', { class: 'kpi-lines' }, line('Dime + StashAway (เฉพาะบาท)', fmtMoney(now.thbSubtotal, 'THB')), line('Webull (USD ต้นฉบับ)', fmtMoney(now.webullUsd, 'USD'))) : null);
  } else {
    totCard.append(el('div', { class: 'kpi-value', text: fmtMoney(now.total, 'THB') }),
      el('div', { class: 'kpi-lines' }, line('Dime', fmtMoney(now.dime, 'THB')), line('StashAway', fmtMoney(now.stashaway, 'THB')),
        line(`Webull ${fmtMoney(now.webullUsd, 'USD')} × ${fmtRate(now.rate)}`, fmtMoney(now.webullThb, 'THB'))),
      el('div', { class: 'kpi-sub' }, `ใช้มูลค่าล่าสุดของแต่ละพอร์ต${new Set(Object.values(now.asOf).filter(Boolean)).size > 1 ? ' (วันที่ของข้อมูลต่างกัน)' : ''} · อัตรา ${fmtDate(now.rateDate)}`,
        now.stale ? el('span', { class: 'chip chip-warn', text: 'อัตราเก่า' }) : null, now.partial ? el('span', { class: 'chip chip-warn', text: `ข้อมูลยังไม่ครบ: ไม่มี ${now.missing.map((m) => LABEL[m]).join(', ')}` }) : null));
  }
  box.append(totCard);

  const entries = activeDaily();
  const periods = [['day', 'วันนี้'], ['month', 'เดือนนี้'], ['year', 'ปีนี้']];
  const plBox = card(el('div', { class: 'kpi-label', text: 'กำไร/ขาดทุนจริงที่บันทึก (Actual P/L)' }));
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
    al.append(r.ok ? line(LABEL[p], `${fmtPct(r.pct)} (${fmtMoney(r.pl, cur[p], { sign: true })})`, signClass(r.pl)) : el('div', { class: 'kpi-line' }, el('span', { class: 'muted', text: LABEL[p] }), el('span', { class: 'chip chip-warn', text: 'ข้อมูลยังไม่ครบ' })));
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

// ───────── total THB, allocation, 7/30/90/YTD value change ─────────
function renderTotals() {
  const d = state.dash, pf = d.portfolio, t = today();
  const idx = calc.fxIndex(state.fxHist), series = calc.totalThbSeries(pf, idx);
  const from = calc.rangeStart(t, state.range);
  totalChart('chart-total-thb', series.points.filter((p) => p.d >= from));

  const now = calc.totalThbNow(pf, state.fx), alloc = calc.allocation(now), ac = clear($('allocation-card'));
  ac.append(el('div', { class: 'kpi-label', text: 'สัดส่วนพอร์ตใน Total THB' }));
  if (!alloc) ac.append(el('p', { class: 'muted', text: 'ยังคำนวณไม่ได้ — ต้องมีอัตราแลกเปลี่ยนและมูลค่าพอร์ต' }));
  else for (const a of alloc) {
    const bar = el('span'); bar.style.width = `${(a.share * 100).toFixed(1)}%`; bar.className = `fill-${a.platform}`;
    ac.append(el('div', { class: 'alloc-row' }, el('div', { class: 'kpi-line' }, el('span', {}, el('span', { class: `dot dot-${a.platform}` }), ` ${LABEL[a.platform]}`), el('b', { text: `${(a.share * 100).toFixed(1)}% · ${fmtMoney(a.thb, 'THB')}` })), el('div', { class: 'bar' }, bar)));
  }

  // value change windows (NOT profit). Strict: shows "ยังคำนวณไม่ได้" instead of a shorter/unevidenced window.
  const wc = clear($('windows-card'));
  wc.append(el('div', { class: 'kpi-label', text: 'การเปลี่ยนแปลงมูลค่าพอร์ตตามช่วงเวลา (Portfolio Value Change — ไม่ใช่กำไร)' }));
  const head = el('tr', {}, el('th', { text: 'พอร์ต' }), calc.WINDOWS.map(([, label]) => el('th', { class: 'num', text: label })), el('th', { text: 'ข้อมูลล่าสุด' }));
  const cell = (r, ccy, extra) => (r.ok
    ? el('td', { class: 'num' }, el('b', { class: signClass(r.abs), text: fmtMoney(r.abs, ccy, { sign: true }) }), el('div', { class: 'muted small', text: fmtPct(r.pct) }), extra ?? null)
    : el('td', { class: 'num muted small', title: r.reason, text: 'ยังคำนวณไม่ได้' }));
  const rows = PLATFORMS.map((p) => {
    const s = pf[p] ?? [], l = calc.latest(s), age = l ? calc.daysBetween(l.d, t) : null;
    return el('tr', {}, el('td', {}, el('span', { class: `dot dot-${p}` }), ` ${LABEL[p]} (${d.currency[p]})`),
      calc.WINDOWS.map(([k]) => cell(calc.windowChange(s, calc.windowStart(t, k)), d.currency[p])),
      el('td', {}, l ? fmtDate(l.d) : '—', age !== null && age > 4 ? el('span', { class: 'chip chip-warn', text: `เก่า ${age} วัน` }) : null));
  });
  const totRow = el('tr', { class: 'row-total' }, el('td', {}, el('b', { text: 'รวม (THB)' })),
    calc.WINDOWS.map(([k]) => {
      const r = calc.totalWindowChange(series.points, calc.windowStart(t, k));
      return cell(r, 'THB', r.ok ? el('div', { class: 'muted small', text: `ผลจากอัตราแลกเปลี่ยน ${fmtMoney(r.fxEffect, 'THB', { sign: true })}` }) : null);
    }), el('td', { class: 'muted small', text: series.points.length ? fmtDate(series.points.at(-1).d) : '—' }));
  wc.append(el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, el('thead', {}, head), el('tbody', {}, rows, totRow))));

  const notes = [];
  if (!series.points.length) notes.push(state.fx?.status === 'unavailable' ? 'ยังคำนวณมูลค่ารวมย้อนหลังเป็นบาทไม่ได้เพราะไม่มีอัตราแลกเปลี่ยน' : 'ยังคำนวณมูลค่ารวมย้อนหลังไม่ได้ — ต้องมีข้อมูลทั้ง 3 พอร์ตและอัตราแลกเปลี่ยน');
  else {
    notes.push(`มูลค่ารวมย้อนหลังเริ่มวันที่ ${fmtDate(series.start)} (วันแรกที่มีข้อมูลครบทั้ง 3 พอร์ต) · แต่ละพอร์ตใช้มูลค่าล่าสุดถึงวันนั้น · Webull แปลงด้วยอัตรา “ของวันนั้น” (ECB รายวันทำการ)`);
    if (series.carried) notes.push(`${series.carried} วันเป็นวันหยุด/ไม่มีอัตราประกาศ จึงใช้อัตราของวันทำการก่อนหน้า`);
    if (series.missing) notes.push(`${series.missing} วันไม่มีอัตราก่อนหน้าให้ใช้ จึงไม่แสดงเป็นบาท (ไม่ใช้อัตราปัจจุบันแทน)`);
    notes.push('ข้อมูล USD ต้นฉบับของ Webull ไม่ถูกแก้ไข การแปลงเป็นบาทเป็นการคำนวณเพื่อแสดงผลเท่านั้น');
  }
  $('total-notes').textContent = notes.join(' · ');
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
/** All rows of the active tab, normalised. Deleted rows are filtered later (default hidden, toggle shows them). */
const histRows = () => {
  if (state.tab === 'daily') return state.daily.map((e) => ({ ...e, date: e.entryDate, kind: e.type, typeLabel: TYPE_LABEL[e.type] ?? e.type }));
  const ccy = calc.CCY[state.tab];
  return (state.portfolio[state.tab] ?? []).map((e) => {
    const own = ccy === 'THB' ? e.thb : e.usd, other = ccy === 'THB' ? e.usd : e.thb;
    return { ...e, ccy, amount: own, otherAmount: other, otherCcy: ccy === 'THB' ? 'USD' : 'THB', kindLabel: KIND_LABEL[e.kind] ?? e.kind };
  });
};
const tabFilters = () => ({ kind: state.table.kind, from: state.table.from, to: state.table.to, showVoid: state.showVoid });
const searchKeys = () => ['date', 'note', 'typeLabel', 'kindLabel', 'reviewFlag', 'ccy'];

function fillKindFilter() {
  const sel = clear($('tf-kind'));
  const opts = state.tab === 'daily' ? Object.entries(TYPE_LABEL) : Object.entries(KIND_LABEL);
  sel.append(el('option', { value: '', text: 'ทุกชนิด' }), opts.map(([v, l]) => el('option', { value: v, text: l })));
  sel.value = state.table.kind;
}

async function ensurePortfolio(p) {
  if (state.portfolio[p]) return;
  try { state.portfolio[p] = (await get(`/api/portfolio?platform=${p}`)).entries; } catch (e) { toast(e.message, true); state.portfolio[p] = []; }
}

async function renderTable() {
  const t = state.table, daily = state.tab === 'daily';
  if (!daily) await ensurePortfolio(state.tab);
  $('tf-kind-wrap').hidden = false;
  const cols = daily
    ? [['date', 'วันที่รายการ', true], ['typeLabel', 'ชนิด'], ['dime', 'Dime ฿', true, 'num'], ['stashaway', 'StashAway ฿', true, 'num'], ['webull', 'Webull $', true, 'num'], ['note', 'หมายเหตุ'], ['_', '']]
    : [['date', 'วันที่', true], ['amount', 'จำนวนเงิน', true, 'num'], ['ccy', 'สกุล'], ['kindLabel', 'ชนิดแถว'], ['note', 'หมายเหตุ / ตรวจสอบ'], ['_', '']];
  const view = calc.tableView(calc.filterHistory(histRows(), tabFilters()), { query: t.query, sortKey: t.sortKey ?? 'date', dir: t.dir, page: t.page, pageSize: 15, searchKeys: searchKeys() });
  const head = clear($('history-table').tHead); const hr = el('tr');
  for (const [key, label, sortable, cls] of cols) hr.append(el('th', { class: `${sortable ? 'sortable' : ''} ${cls ?? ''}`, 'aria-sort': (t.sortKey ?? 'date') === key ? (t.dir === 'asc' ? 'ascending' : 'descending') : null, onclick: sortable ? () => { t.dir = (t.sortKey ?? 'date') === key && t.dir === 'desc' ? 'asc' : 'desc'; t.sortKey = key; t.page = 1; renderTable(); } : null, text: label + ((t.sortKey ?? 'date') === key ? (t.dir === 'asc' ? ' ▲' : ' ▼') : '') }));
  head.append(hr);
  const body = clear($('history-table').tBodies[0]);
  if (!view.rows.length) body.append(el('tr', {}, el('td', { colspan: cols.length, class: 'muted', text: 'ไม่มีข้อมูลที่ตรงกับเงื่อนไข' })));
  for (const r of view.rows) {
    const cells = cols.map(([key, , , cls]) => {
      if (key === '_' && daily) return el('td', {}, r.status === 'active' ? el('div', { class: 'actions' }, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openDailyForm(r), text: 'แก้ไข' }), el('button', { class: 'btn btn-sm', type: 'button', onclick: () => voidDaily(r), text: 'ยกเลิก' })) : el('span', { class: 'muted', text: 'ยกเลิกแล้ว' }));
      if (key === '_') return el('td', {}, r.status === 'void'
        ? el('div', { class: 'actions' }, el('span', { class: 'chip chip-neg', text: 'ลบแล้ว' }), el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRestoreForm(r), 'aria-label': `กู้คืนรายการวันที่ ${fmtDate(r.date)}`, text: 'กู้คืน' }))
        : el('div', { class: 'actions' }, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRecordEditForm(r), 'aria-label': `แก้ไขรายการวันที่ ${fmtDate(r.date)}`, text: 'แก้ไข' }), el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => openRecordDeleteForm(r), 'aria-label': `ลบรายการวันที่ ${fmtDate(r.date)}`, text: 'ลบ' })));
      if (key === 'amount') return el('td', { class: cls }, r.amount === null || r.amount === undefined ? '—' : fmtMoney(r.amount, r.ccy), r.otherAmount !== null && r.otherAmount !== undefined ? el('div', { class: 'muted small', text: `(อีกสกุล: ${fmtMoney(r.otherAmount, r.otherCcy)})` }) : null);
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

// ───────── portfolio history records: edit / delete (soft) / restore ─────────
// The platform and its currency are fixed by the row itself (the server derives the currency column from the platform) -
// the form can only change date, amount (in that platform's own currency), kind and note.
const reloadPortfolio = async () => { state.portfolio = {}; await refresh(); };
const recordSummary = (r) => `${LABEL[r.platform ?? state.tab]} · ${fmtDate(r.date)} · ${KIND_LABEL[r.kind] ?? r.kind} · ${r.amount === null || r.amount === undefined ? 'ไม่มีจำนวนเงิน' : fmtMoney(r.amount, r.ccy)}`;
const changed = (a, b, fmt = (x) => x) => (a === b ? fmt(b) : `${fmt(a)} → ${fmt(b)}`);

function openRecordEditForm(r) {
  const platform = state.tab, ccy = calc.CCY[platform];
  const isKnownKind = HIST_EDIT_KINDS.some(([k]) => k === r.kind);
  openForm({
    title: `แก้ไขรายการ ${LABEL[platform]}`,
    intro: `สกุลเงินของพอร์ตนี้คือ ${ccy} (แก้สกุลเงินหรือย้ายพอร์ตไม่ได้) · ${r.reviewFlag ? `⚠ ${r.reviewFlag} · ` : ''}ทุกการแก้ไขถูกบันทึกใน Audit_Log ของชีต${r.kind === 'value_unparsed' ? ' · แถวนี้ตัวเลขผิดรูปแบบ: กรอกค่าที่ถูกต้อง แล้วระบบจะเปลี่ยนเป็นรายการมูลค่า' : ''}`,
    initial: { date: r.date, value: r.amount ?? '', kind: isKnownKind ? r.kind : 'value', note: r.note ?? '' },
    fields: [
      dateField('date', 'วันที่ของรายการ'),
      { id: 'value', label: `จำนวนเงิน (${ccy})`, kind: 'text', placeholder: 'เช่น 725040.29' },
      { id: 'kind', label: 'ชนิดแถว', kind: 'select', options: HIST_EDIT_KINDS.map(([value, label]) => ({ value, label })) },
      { id: 'note', label: 'หมายเหตุ', kind: 'textarea' },
    ],
    parse: (v) => {
      if (!v.date) return { error: 'กรุณาเลือกวันที่' };
      if (v.date > calc.addDays(bangkokNow().date, 1)) return { error: 'วันที่เกินวันนี้ (เวลาไทย) ไม่ได้' };
      if (v.date < '2000-01-01') return { error: 'วันที่เก่าเกินไป' };
      const n = num(v.value, 'จำนวนเงิน', { required: v.kind === 'value', min: 0 });
      if (n.error) return n;
      return { payload: { date: v.date, value: n.value, kind: v.kind, note: v.note.trim(), expectedRevision: r.revision } };
    },
    summarize: (p) => [['รายการ', recordSummary(r)], ['วันที่', changed(fmtDate(r.date), fmtDate(p.date))], ['จำนวนเงิน', changed(r.amount === null ? '—' : fmtMoney(r.amount, ccy), p.value === null ? '—' : fmtMoney(p.value, ccy))], ['ชนิดแถว', changed(KIND_LABEL[r.kind] ?? r.kind, KIND_LABEL[p.kind] ?? p.kind)], ['หมายเหตุ', changed(r.note || '—', p.note || '—')]],
    submit: (p) => put(`/api/portfolio/${platform}/${r.recordId}`, p),
    successMessage: 'แก้ไขรายการแล้ว — บันทึกลง Google Sheets และคำนวณ KPI/กราฟใหม่แล้ว', after: reloadPortfolio,
  });
}

function openRecordDeleteForm(r) {
  const platform = state.tab;
  openForm({
    title: 'ลบรายการนี้?', noConfirm: true, danger: true, submitText: 'ยืนยันลบ', fields: [],
    intro: `${recordSummary(r)} — รายการจะถูกทำเครื่องหมาย “ลบ” (ยังเก็บไว้ในชีตและ Audit_Log กู้คืนได้) และจะไม่ถูกนับใน KPI/กราฟ/คาดการณ์ทันที`,
    parse: () => ({ payload: {} }),
    submit: () => post(`/api/portfolio/${platform}/${r.recordId}/void`, { expectedRevision: r.revision }),
    successMessage: 'ลบรายการแล้ว (กู้คืนได้จาก “แสดงรายการที่ลบ”)', after: reloadPortfolio,
  });
}

function openRestoreForm(r) {
  const platform = state.tab;
  openForm({
    title: 'กู้คืนรายการนี้?', noConfirm: true, submitText: 'ยืนยันกู้คืน', fields: [],
    intro: `${recordSummary(r)} — รายการจะกลับมานับใน KPI/กราฟอีกครั้ง`,
    parse: () => ({ payload: {} }),
    submit: () => post(`/api/portfolio/${platform}/${r.recordId}/restore`, { expectedRevision: r.revision }),
    successMessage: 'กู้คืนรายการแล้ว', after: reloadPortfolio,
  });
}

// ───────── CSV export (current tab, current filters/search/sort; original currency + ISO dates; formula-injection safe) ─────────
function exportCsv() {
  const t = state.table, daily = state.tab === 'daily';
  const view = calc.tableView(calc.filterHistory(histRows(), tabFilters()), { query: t.query, sortKey: t.sortKey ?? 'date', dir: t.dir, page: 1, pageSize: 1e9, searchKeys: searchKeys() });
  const rows = view.rows.map((r) => (daily
    ? { ...r, status: r.status }
    : { ...r, rawAmount: r.ccy === 'THB' ? r.rawThb : r.rawUsd }));
  if (!rows.length) return toast('ไม่มีข้อมูลให้ส่งออกตามตัวกรองนี้', true);
  const cols = daily
    ? [['date', 'date'], ['type', 'type', true], ['dime_thb', 'dime'], ['stashaway_thb', 'stashaway'], ['webull_usd', 'webull'], ['note', 'note', true], ['status', 'status', true], ['entry_id', 'entryId', true], ['revision', 'revision']]
    : [['date', 'date'], ['amount', 'amount'], ['currency', 'ccy', true], ['kind', 'kind', true], ['status', 'status', true], ['note', 'note', true], ['review_flag', 'reviewFlag', true], ['raw_date', 'rawDate', true], ['raw_amount', 'rawAmount', true], ['record_id', 'recordId', true], ['revision', 'revision']];
  const blob = new Blob(['﻿', calc.toCsv(cols, rows)], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `minvest-${state.tab}-${bangkokNow().date}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`ส่งออก ${rows.length} รายการแล้ว`);
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
  formCtx = { cfg, step: 'edit', values: cfg.initial ?? {}, payload: null, busy: false, dirty: false };
  $('fd-title').textContent = cfg.title; renderFormStep(); dlg().showModal();
}
/** Closing with unsaved edits asks first; a busy (saving) dialog cannot be dismissed. */
function requestCloseForm() {
  if (formCtx?.busy) return false;
  if (formCtx?.dirty && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก — ปิดและทิ้งข้อมูลนี้?')) return false;
  formCtx = null; dlg().close(); return true;
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
    if (cfg.extra) body.append(cfg.extra());
    if (cfg.intro) body.prepend(el('p', { class: 'notice', text: cfg.intro }));
    $('fd-back').hidden = true; $('fd-submit').textContent = cfg.submitText ?? (cfg.noConfirm ? 'บันทึก' : 'ตรวจสอบ');
    $('fd-submit').className = `btn ${cfg.danger ? 'btn-danger' : 'btn-primary'}`;
  } else {
    body.append(el('p', { class: 'muted', text: 'ตรวจสอบข้อมูลก่อนยืนยัน — บันทึกแล้วจะเขียนลง Google Sheets' }), el('div', { class: 'summary' }, cfg.summarize(formCtx.payload).map(([k, v]) => el('div', { class: 'summary-row' }, el('span', { class: 'muted', text: k }), el('b', { text: v })))));
    $('fd-back').hidden = false; $('fd-submit').textContent = cfg.submitLabel ?? 'ยืนยันบันทึก'; $('fd-submit').className = 'btn btn-primary';
  }
  $('fd-submit').disabled = false;
  if (step === 'edit') setTimeout(() => body.querySelector('input:not([type=radio]),select,textarea')?.focus(), 30);}
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
    title: 'ตั้งค่า', noConfirm: true, intro: 'เว้นว่าง = ล้างค่า · อัตรา USD→THB ดึงอัตโนมัติจาก ECB ผ่านเซิร์ฟเวอร์ (ไม่ต้องตั้งเอง และไม่เดา)',
    initial: { goal_dime_thb: s.goal_dime_thb ?? '', goal_stashaway_thb: s.goal_stashaway_thb ?? '', goal_webull_usd: s.goal_webull_usd ?? '', cashflows_confirmed_through: s.cashflows_confirmed_through ?? '', forecast_window_days: s.forecast_window_days ?? '180' },
    extra: () => el('section', { class: 'settings-security', 'aria-labelledby': 'h-sec' },
      el('h4', { id: 'h-sec', text: 'ความปลอดภัย' }),
      el('p', { class: 'muted small', text: 'เปลี่ยนรหัสผ่านเข้าระบบ — เก็บแบบแฮชถาวร ไม่ต้องแก้ Cloudflare secret ทุกครั้ง' }),
      el('button', { type: 'button', class: 'btn', onclick: () => { if (requestCloseForm()) openSecurity(state.session, toast); }, text: 'เปลี่ยนรหัสผ่าน…' })),
    fields: [
      { id: 'goal_dime_thb', label: 'เป้าหมายพอร์ต Dime (บาท)', kind: 'text' }, { id: 'goal_stashaway_thb', label: 'เป้าหมายพอร์ต StashAway (บาท)', kind: 'text' }, { id: 'goal_webull_usd', label: 'เป้าหมายพอร์ต Webull (USD)', kind: 'text' },
      { id: 'cashflows_confirmed_through', label: 'ยืนยันว่าบันทึกเงินฝาก/ถอนครบถึงวันที่', kind: 'date', hint: 'ใช้คำนวณผลตอบแทนปรับเงินฝาก — ตั้งเมื่อมั่นใจว่าไม่มีรายการตกหล่นเท่านั้น' },
      { id: 'forecast_window_days', label: 'จำนวนวันย้อนหลังที่ใช้ประมาณแนวโน้ม (30–730)', kind: 'text', inputmode: 'numeric' },
    ],
    parse: (v) => {
      const out = {};
      for (const k of ['goal_dime_thb', 'goal_stashaway_thb', 'goal_webull_usd']) { const n = num(v[k], k, { min: 0 }); if (n.error) return { error: 'ค่าเป้าหมายต้องเป็นตัวเลขไม่ติดลบ' }; out[k] = n.value; }
      out.cashflows_confirmed_through = v.cashflows_confirmed_through || null;
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
  $('btn-logout').addEventListener('click', async () => { try { await post('/api/logout'); } finally { state.dash = null; state.daily = []; state.portfolio = {}; state.fx = null; state.fxHist = null; showLogin(true); } });
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
  const resetFilterInputs = () => { $('table-search').value = ''; $('tf-from').value = ''; $('tf-to').value = ''; fillKindFilter(); };
  fillKindFilter();
  $('history-tabs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tab]'); if (!b) return; state.tab = b.dataset.tab; state.table = newTable(); resetFilterInputs(); for (const x of $('history-tabs').children) x.classList.toggle('is-active', x === b); renderTable(); });
  $('table-search').addEventListener('input', (ev) => { state.table.query = ev.target.value; state.table.page = 1; renderTable(); });
  $('table-void').addEventListener('change', (ev) => { state.showVoid = ev.target.checked; state.table.page = 1; renderTable(); });
  $('tf-kind').addEventListener('change', (ev) => { state.table.kind = ev.target.value; state.table.page = 1; renderTable(); });
  $('tf-from').addEventListener('change', (ev) => { state.table.from = ev.target.value; state.table.page = 1; renderTable(); });
  $('tf-to').addEventListener('change', (ev) => { state.table.to = ev.target.value; state.table.page = 1; renderTable(); });
  $('btn-reset-filters').addEventListener('click', () => { const keep = { sortKey: state.table.sortKey, dir: state.table.dir }; state.table = { ...newTable(), ...keep }; state.showVoid = false; $('table-void').checked = false; resetFilterInputs(); renderTable(); });
  $('btn-export').addEventListener('click', exportCsv);
  initSecurityUi({ onChanged: async () => { try { state.session = await get('/api/session'); } catch { /* ignore */ } } });
  $('pg-prev').addEventListener('click', () => { state.table.page--; renderTable(); }); $('pg-next').addEventListener('click', () => { state.table.page++; renderTable(); });
  $('fd-form').addEventListener('submit', onFormSubmit);
  $('fd-close').addEventListener('click', requestCloseForm);
  dlg().addEventListener('cancel', (ev) => { ev.preventDefault(); requestCloseForm(); }); // Esc: never silently drops unsaved input
  $('fd-body').addEventListener('input', () => { if (formCtx) formCtx.dirty = true; });
  $('fd-body').addEventListener('change', () => { if (formCtx) formCtx.dirty = true; });
  $('fd-back').addEventListener('click', () => { formCtx.step = 'edit'; renderFormStep(); });
}

boot();
