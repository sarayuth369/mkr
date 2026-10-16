// Pure analytics for the minvest dashboard (no DOM, no network) - unit tested in test/calc.test.mjs.
//
// Principles:
//  * Portfolio VALUE is not income. Profit/loss comes only from user-entered Daily_Income (type=profit_loss)
//    or, when cashflows are confirmed, from the Modified-Dietz cashflow-adjusted return below.
//  * THB and USD are never mixed unless the owner supplied an exchange rate (Settings).
//  * Forecasts are statistical, labelled as such, exclude deposit/withdrawal jumps, and say
//    "ข้อมูลยังไม่เพียงพอ" instead of inventing numbers.

export const PLATFORMS = ['dime', 'stashaway', 'webull'];
export const CCY = { dime: 'THB', stashaway: 'THB', webull: 'USD' };
export const PLATFORM_LABEL = { dime: 'Dime', stashaway: 'StashAway', webull: 'Webull' };

const DAY = 86400000;
export const toMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromMs(toMs(iso) + n * DAY);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);

const CASHFLOW_NOTE = /deposit|ฝาก|เพิ่มทุน|\bwd\b|withdraw|ถอน/i;

// ───────── series helpers ─────────
export const latest = (series) => (series && series.length ? series[series.length - 1] : null);

export function valueOnOrBefore(series, iso) {
  let found = null;
  for (const p of series) { if (p.d <= iso) found = p; else break; }
  return found;
}

export function rangeStart(today, key) {
  if (key === 'all') return '0000-01-01';
  const n = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[key];
  return n ? addDays(today, -n) : '0000-01-01';
}
export const sliceRange = (series, from) => series.filter((p) => p.d >= from);

/** Change in portfolio VALUE over a window. Includes deposits/withdrawals - this is NOT profit. */
export function valueChange(series, fromIso) {
  const end = latest(series);
  const start = valueOnOrBefore(series, fromIso) ?? series[0];
  if (!end || !start || start.d === end.d) return null;
  return { from: start.d, to: end.d, abs: end.v - start.v, pct: start.v > 0 ? (end.v - start.v) / start.v : null };
}

// ───────── recorded income (Daily_Income) ─────────
export const isPeriod = (date, today, period) =>
  period === 'day' ? date === today : period === 'month' ? date.slice(0, 7) === today.slice(0, 7) : period === 'year' ? date.slice(0, 4) === today.slice(0, 4) : true;

/** Sums entries of one type for a period, per platform, with THB and USD kept apart. null = nothing recorded (not zero). */
export function sumDaily(entries, today, period, type = 'profit_loss') {
  const out = { dime: null, stashaway: null, webull: null, thb: null, usd: null, count: 0 };
  for (const e of entries) {
    if (e.type !== type || !isPeriod(e.date, today, period) || e.date > today) continue;
    out.count++;
    for (const p of PLATFORMS) if (e[p] !== null && e[p] !== undefined) out[p] = (out[p] ?? 0) + e[p];
  }
  const sum = (a, b) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  out.thb = sum(out.dime, out.stashaway);
  out.usd = out.webull;
  for (const k of ['dime', 'stashaway', 'webull', 'thb', 'usd']) if (out[k] !== null) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

export function incomeByBucket(entries, bucket /* 'day'|'month' */, type = 'profit_loss', today = '9999-12-31') {
  const m = new Map();
  for (const e of entries) {
    if (e.type !== type || e.date > today) continue;
    const key = bucket === 'month' ? e.date.slice(0, 7) : e.date;
    const row = m.get(key) ?? { k: key, dime: 0, stashaway: 0, webull: 0 };
    for (const p of PLATFORMS) if (e[p] !== null && e[p] !== undefined) row[p] += e[p];
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
}

export function cumulative(rows) {
  const acc = { dime: 0, stashaway: 0, webull: 0 };
  return rows.map((r) => { for (const p of PLATFORMS) acc[p] += r[p]; return { k: r.k, dime: round2(acc.dime), stashaway: round2(acc.stashaway), webull: round2(acc.webull) }; });
}
const round2 = (n) => Math.round(n * 100) / 100;

// ───────── cashflow-adjusted return (Modified Dietz) ─────────
/**
 * Only computed when the owner confirmed cashflows through a date (Settings.cashflows_confirmed_through)
 * and every cashflow used is in the platform's own currency. Otherwise returns {ok:false, reason}.
 */
export function adjustedReturn(series, cashflows, platform, confirmedThrough) {
  if (!confirmedThrough) return { ok: false, reason: 'ยังไม่ได้ยืนยันเงินฝาก/ถอนครบ (ตั้งค่าที่ “ตั้งค่า”)' };
  const pts = series.filter((p) => p.d <= confirmedThrough);
  if (pts.length < 2) return { ok: false, reason: 'ข้อมูลยังไม่เพียงพอ' };
  const start = pts[0], end = pts[pts.length - 1];
  const T = daysBetween(start.d, end.d);
  if (T < 1) return { ok: false, reason: 'ข้อมูลยังไม่เพียงพอ' };
  const flows = cashflows.filter((c) => c.platform === platform && (c.type === 'deposit' || c.type === 'withdrawal') && c.date > start.d && c.date <= end.d);
  if (flows.some((c) => c.currency !== CCY[platform])) return { ok: false, reason: `มีเงินฝาก/ถอนคนละสกุลเงินกับพอร์ต (${CCY[platform]}) - ระบบไม่แปลงสกุลเงินเอง` };
  let net = 0, weighted = 0;
  for (const c of flows) {
    const f = c.type === 'deposit' ? c.amount : -c.amount;
    net += f; weighted += f * ((T - daysBetween(start.d, c.date)) / T);
  }
  const denom = start.v + weighted;
  const pl = end.v - start.v - net;
  return { ok: true, pl: round2(pl), pct: denom > 0 ? pl / denom : null, from: start.d, to: end.d, netFlow: round2(net), flows: flows.length };
}

// ───────── forecast ─────────
/** Steps used for the trend estimate: gaps with a likely deposit/withdrawal (note keyword, confirmed cashflow, or big jump) are removed. */
export function usableSteps(series, cashflows = [], platform, { jumpThreshold = 0.08, maxGapDays = 10 } = {}) {
  const flowDates = new Set(cashflows.filter((c) => c.platform === platform && c.type !== 'dividend').map((c) => c.date));
  const steps = []; let excluded = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    const gap = daysBetween(a.d, b.d);
    if (gap < 1 || gap > maxGapDays || a.v <= 0 || b.v <= 0) continue;
    const r = Math.log(b.v / a.v);
    const flagged = CASHFLOW_NOTE.test(a.n ?? '') || CASHFLOW_NOTE.test(b.n ?? '') || flowDates.has(b.d) || flowDates.has(a.d) || Math.abs(r) > jumpThreshold;
    if (flagged) { excluded++; continue; }
    steps.push({ r, gap });
  }
  return { steps, excluded };
}

export function forecast(series, cashflows, platform, today, { windowDays = 180, minSteps = 30, minSpanDays = 60 } = {}) {
  const last = latest(series);
  if (!last) return { sufficient: false, reason: 'ข้อมูลยังไม่เพียงพอ' };
  const win = series.filter((p) => p.d >= addDays(last.d, -windowDays));
  const { steps, excluded } = usableSteps(win, cashflows, platform);
  const span = win.length ? daysBetween(win[0].d, last.d) : 0;
  if (steps.length < minSteps || span < minSpanDays) return { sufficient: false, reason: 'ข้อมูลยังไม่เพียงพอ (ต้องมีข้อมูลต่อเนื่องอย่างน้อย 60 วันและ 30 ช่วงที่ไม่มีเงินฝาก/ถอน)', steps: steps.length, span };
  const sumG = steps.reduce((s, x) => s + x.gap, 0);
  const m = steps.reduce((s, x) => s + x.r, 0) / sumG; // drift per day (log)
  const varDay = steps.reduce((s, x) => s + (x.r - m * x.gap) ** 2, 0) / sumG;
  const sigma = Math.sqrt(varDay);
  const at = (days) => {
    const mid = last.v * Math.exp(m * days), band = sigma * Math.sqrt(days);
    return { days, mid: round2(mid), lo: round2(last.v * Math.exp(m * days - band)), hi: round2(last.v * Math.exp(m * days + band)) };
  };
  const eom = (() => { const [y, mo] = last.d.split('-').map(Number); return fromMs(Date.UTC(y, mo, 0)); })();
  const eoy = `${last.d.slice(0, 4)}-12-31`;
  const horizons = [
    { key: 'eom', label: 'สิ้นเดือนนี้', date: eom }, { key: 'eoy', label: 'สิ้นปีนี้', date: eoy },
    { key: '1y', label: '+1 ปี', date: addDays(last.d, 365) }, { key: '2y', label: '+2 ปี', date: addDays(last.d, 730) }, { key: '3y', label: '+3 ปี', date: addDays(last.d, 1095) },
  ].map((h) => ({ ...h, ...at(Math.max(daysBetween(last.d, h.date), 0)) }));
  return {
    sufficient: true, asOf: last.d, base: last.v, ccy: CCY[platform], steps: steps.length, excluded, span, windowDays,
    dailyDrift: m, dailySigma: sigma, monthlyChangePct: Math.exp(m * 30.4375) - 1, annualizedPct: Math.exp(m * 365) - 1, horizons,
    assumptions: [
      `ประมาณจากการเปลี่ยนแปลงรายวันของมูลค่าพอร์ต ${windowDays} วันล่าสุด (${steps.length} ช่วง)`,
      `ตัดออก ${excluded} ช่วงที่น่าจะเป็นเงินฝาก/ถอน (หมายเหตุมีคำว่าฝาก/ถอน, รายการที่ยืนยันแล้ว, หรือเปลี่ยนเกิน 8% ในช่วงเดียว)`,
      'สมมติว่าไม่มีเงินฝากหรือถอนเพิ่มในอนาคต และแนวโน้มเดิมคงอยู่ - ผลจริงอาจต่างได้มาก',
      'ช่วงแสดงความไม่แน่นอนประมาณ ±1 ส่วนเบี่ยงเบนมาตรฐาน (ราว 68%) ไม่ใช่ขอบเขตที่รับประกัน',
    ],
  };
}

/** Path for charting: [{d, mid, lo, hi}] spaced every `stepDays`. */
export function projectionPath(fc, days, stepDays = 7) {
  if (!fc.sufficient) return [];
  const out = [];
  for (let t = 0; t <= days; t += stepDays) {
    const mid = fc.base * Math.exp(fc.dailyDrift * t), band = fc.dailySigma * Math.sqrt(t);
    out.push({ d: addDays(fc.asOf, t), mid: round2(mid), lo: round2(fc.base * Math.exp(fc.dailyDrift * t - band)), hi: round2(fc.base * Math.exp(fc.dailyDrift * t + band)) });
  }
  return out;
}

// ───────── alerts / goals / totals ─────────
export function buildAlerts(portfolio, daily, today) {
  const out = [];
  for (const p of PLATFORMS) {
    const s = portfolio[p] ?? [];
    const l = latest(s);
    if (!l) { out.push({ level: 'info', text: `${PLATFORM_LABEL[p]}: ยังไม่มีข้อมูลมูลค่าพอร์ต` }); continue; }
    const age = daysBetween(l.d, today);
    if (age > 4) out.push({ level: 'warn', text: `${PLATFORM_LABEL[p]}: ข้อมูลมูลค่าล่าสุดเมื่อ ${age} วันก่อน (${l.d}) - ควรอัปเดต` });
    const ch = valueChange(s, addDays(l.d, -7));
    if (ch && ch.pct !== null && ch.pct < -0.05) {
      const maybeWithdraw = CASHFLOW_NOTE.test((s.slice(-8).map((x) => x.n ?? '')).join(' '));
      out.push({ level: 'warn', text: `${PLATFORM_LABEL[p]}: มูลค่าลดลง ${(Math.abs(ch.pct) * 100).toFixed(1)}% ใน 7 วัน${maybeWithdraw ? ' (อาจมีการถอนเงินรวมอยู่)' : ' (เป็นการเปลี่ยนมูลค่า ไม่ใช่ขาดทุนที่ยืนยัน)'}` });
    }
  }
  const lastEntry = daily.filter((e) => e.type === 'profit_loss').map((e) => e.date).sort().pop();
  if (!lastEntry) out.push({ level: 'info', text: 'ยังไม่มีการบันทึกกำไร/ขาดทุนรายวัน' });
  else if (daysBetween(lastEntry, today) >= 7) out.push({ level: 'info', text: `ไม่ได้บันทึกกำไร/ขาดทุนมา ${daysBetween(lastEntry, today)} วัน (ล่าสุด ${lastEntry})` });
  return out;
}

export function goalProgress(portfolio, settings) {
  const goals = { dime: settings?.goal_dime_thb, stashaway: settings?.goal_stashaway_thb, webull: settings?.goal_webull_usd };
  return PLATFORMS.map((p) => {
    const g = goals[p] ? Number(goals[p]) : null, l = latest(portfolio[p] ?? []);
    return { platform: p, ccy: CCY[p], goal: g && g > 0 ? g : null, value: l ? l.v : null, pct: g && g > 0 && l ? Math.min(l.v / g, 9.99) : null };
  });
}

/** Totals PER CURRENCY only. USD is never added to THB here - see totalThbNow() for the converted view. */
export function totals(portfolio) {
  const v = (p) => latest(portfolio[p] ?? [])?.v ?? null;
  const thb = [v('dime'), v('stashaway')].filter((x) => x !== null);
  return { thb: thb.length ? round2(thb.reduce((a, b) => a + b, 0)) : null, usd: v('webull') };
}

// ───────── FX: Webull USD -> THB (rate comes from the Worker's /api/fx*, never hardcoded) ─────────
// Rules (disclosed in the UI): ECB publishes one reference rate per business day. A date without a published rate
// (weekend/holiday) carries the previous published rate forward and is marked `carried`. A date before the first rate
// in the loaded range is NOT converted (no invented rate). Amounts in THB derived this way are "converted value", never profit.

/** Index {dates:[sorted], rates} from the /api/fx/history payload ({rates, priorDate?, priorRate?}). */
export function fxIndex(hist) {
  if (!hist || hist.status === 'unavailable' || !hist.rates) return null;
  const rates = { ...hist.rates };
  if (hist.priorDate && hist.priorRate > 0) rates[hist.priorDate] = hist.priorRate;
  const dates = Object.keys(rates).sort();
  return dates.length ? { dates, rates } : null;
}

/** Rate in force on `iso`: the published rate for that date, else the latest earlier one (carried). null if none. */
export function fxRateFor(idx, iso) {
  if (!idx) return null;
  let lo = 0, hi = idx.dates.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (idx.dates[mid] <= iso) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found < 0) return null;
  const rateDate = idx.dates[found];
  return { rate: idx.rates[rateDate], rateDate, carried: rateDate !== iso };
}

/** USD series -> THB equivalent using each point's OWN date rate. The USD original stays in `usd`. */
export function convertUsdSeries(series, idx) {
  const points = []; let missing = 0, carried = 0;
  for (const p of series ?? []) {
    const r = fxRateFor(idx, p.d);
    if (!r) { missing++; continue; }
    if (r.carried) carried++;
    points.push({ d: p.d, v: round2(p.v * r.rate), usd: p.v, rate: r.rate, rateDate: r.rateDate, carried: r.carried });
  }
  return { points, missing, carried };
}

/**
 * Current total in THB = Dime(THB) + StashAway(THB) + Webull(USD) x rate. `fx` is the /api/fx payload.
 * No usable rate (status unavailable) -> webullThb/total are null: the UI shows "ยังคำนวณไม่ได้", never a guess.
 * A `stale` rate is still used but flagged so the UI says so.
 */
export function totalThbNow(portfolio, fx) {
  const l = (p) => latest(portfolio[p] ?? []);
  const dime = l('dime'), sa = l('stashaway'), wb = l('webull');
  const usable = Boolean(fx && fx.status !== 'unavailable' && fx.rate > 0);
  const webullThb = wb && usable ? round2(wb.v * fx.rate) : null;
  const missing = PLATFORMS.filter((p) => !l(p));
  const blocked = Boolean(wb) && !usable;
  const parts = [dime?.v ?? null, sa?.v ?? null, webullThb];
  const any = parts.some((x) => x !== null);
  return {
    dime: dime?.v ?? null, stashaway: sa?.v ?? null, webullUsd: wb?.v ?? null, webullThb,
    total: any && !blocked ? round2(parts.reduce((a, b) => a + (b ?? 0), 0)) : null,
    thbSubtotal: dime || sa ? round2((dime?.v ?? 0) + (sa?.v ?? 0)) : null,
    blocked, partial: missing.length > 0, missing,
    stale: Boolean(usable && fx.status === 'stale'), rate: usable ? fx.rate : null, rateDate: usable ? fx.rateDate : null,
    asOf: { dime: dime?.d ?? null, stashaway: sa?.d ?? null, webull: wb?.d ?? null },
  };
}

/** Each platform's share of the converted total (only when the total exists and is > 0). */
export function allocation(now) {
  if (now.total === null || !(now.total > 0)) return null;
  return [['dime', now.dime], ['stashaway', now.stashaway], ['webull', now.webullThb]].filter(([, v]) => v !== null)
    .map(([platform, thb]) => ({ platform, thb, share: thb / now.total }));
}

/**
 * Historical total in THB. A row exists on every date where ANY portfolio has a record, starting from the first date on which ALL three
 * have data; each portfolio uses its latest value on or before that date, and Webull uses that date's own rate (carry-forward on
 * non-business days). Dates with no usable rate are skipped (counted in `missing`), never filled with today's rate.
 */
export function totalThbSeries(portfolio, idx) {
  const s = Object.fromEntries(PLATFORMS.map((p) => [p, portfolio[p] ?? []]));
  if (!idx || PLATFORMS.some((p) => !s[p].length)) return { points: [], missing: 0, carried: 0, start: null };
  const start = PLATFORMS.map((p) => s[p][0].d).sort().pop();
  const dates = [...new Set(PLATFORMS.flatMap((p) => s[p].map((x) => x.d)))].filter((d) => d >= start).sort();
  const pos = { dime: -1, stashaway: -1, webull: -1 };
  const points = []; let missing = 0, carried = 0;
  for (const d of dates) {
    for (const p of PLATFORMS) while (pos[p] + 1 < s[p].length && s[p][pos[p] + 1].d <= d) pos[p]++;
    const r = fxRateFor(idx, d);
    if (!r) { missing++; continue; }
    if (r.carried) carried++;
    const dime = s.dime[pos.dime].v, stashaway = s.stashaway[pos.stashaway].v, usd = s.webull[pos.webull].v;
    points.push({ d, total: round2(dime + stashaway + usd * r.rate), dime, stashaway, webullUsd: usd, webullThb: round2(usd * r.rate), rate: r.rate, rateDate: r.rateDate, carried: r.carried });
  }
  return { points, missing, carried, start };
}

/**
 * Change in portfolio VALUE over a window (7/30/90/YTD). Strict: the baseline must exist on or before the window start and not be
 * more than 10 days older - otherwise {ok:false}. Never labelled profit (it includes deposits/withdrawals).
 */
export function windowChange(series, fromIso) {
  const end = latest(series);
  if (!end) return { ok: false, reason: 'ยังไม่มีข้อมูล' };
  const base = valueOnOrBefore(series, fromIso);
  if (!base) return { ok: false, reason: 'ข้อมูลย้อนหลังยังไม่ถึงช่วงนี้' };
  if (daysBetween(base.d, fromIso) > 10) return { ok: false, reason: 'ข้อมูลช่วงต้นไม่ต่อเนื่อง (ห่างเกิน 10 วัน)' };
  if (base.d === end.d) return { ok: false, reason: 'ยังไม่มีข้อมูลใหม่หลังจุดเริ่ม' };
  return { ok: true, from: base.d, to: end.d, abs: round2(end.v - base.v), pct: base.v > 0 ? (end.v - base.v) / base.v : null };
}

export const WINDOWS = [['7d', '7 วัน'], ['30d', '30 วัน'], ['90d', '90 วัน'], ['ytd', 'ตั้งแต่ต้นปี']];
export const windowStart = (today, key) => (key === 'ytd' ? `${today.slice(0, 4)}-01-01` : addDays(today, -{ '7d': 7, '30d': 30, '90d': 90 }[key]));

/** Total-THB value change over a window with the Webull FX movement split out: value effect (balances) vs FX effect (rate). */
export function totalWindowChange(points, fromIso) {
  const end = latest(points);
  if (!end) return { ok: false, reason: 'ยังไม่มีข้อมูลรวมเป็นบาท' };
  const base = valueOnOrBefore(points, fromIso);
  if (!base) return { ok: false, reason: 'ข้อมูลย้อนหลังยังไม่ถึงช่วงนี้' };
  if (daysBetween(base.d, fromIso) > 10) return { ok: false, reason: 'ข้อมูลช่วงต้นไม่ต่อเนื่อง (ห่างเกิน 10 วัน)' };
  if (base.d === end.d) return { ok: false, reason: 'ยังไม่มีข้อมูลใหม่หลังจุดเริ่ม' };
  const fxEffect = base.webullUsd * (end.rate - base.rate);
  const abs = end.total - base.total;
  return { ok: true, from: base.d, to: end.d, abs: round2(abs), pct: base.total > 0 ? abs / base.total : null, fxEffect: round2(fxEffect), valueEffect: round2(abs - fxEffect) };
}

// ───────── history filters + CSV ─────────
export function filterHistory(rows, { kind = '', from = '', to = '', showVoid = false } = {}) {
  return rows.filter((r) => (showVoid || r.status !== 'void') && (!kind || r.kind === kind) && (!from || r.date >= from) && (!to || r.date <= to));
}

/** CSV cell with spreadsheet-formula neutralisation for TEXT cells (numbers are written verbatim). */
export function csvCell(v, isText = false) {
  if (v === null || v === undefined) return '';
  if (!isText && typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || isText ? `"${s.replace(/"/g, '""')}"` : s;
}
/** columns: [[header, key, isText]] -> CSV text (CRLF). Dates stay ISO yyyy-MM-dd and each row keeps its own currency column. */
export function toCsv(columns, rows) {
  return [columns.map(([h]) => csvCell(h, true)).join(','), ...rows.map((r) => columns.map(([, k, t]) => csvCell(r[k], t)).join(','))].join('\r\n') + '\r\n';
}

export function lastUpdated(portfolio) {
  return PLATFORMS.map((p) => latest(portfolio[p] ?? [])?.d).filter(Boolean).sort().pop() ?? null;
}

// ───────── table helpers ─────────
export function tableView(rows, { query = '', sortKey, dir = 'desc', page = 1, pageSize = 20, searchKeys = [] }) {
  const q = query.trim().toLowerCase();
  let r = q ? rows.filter((x) => searchKeys.some((k) => String(x[k] ?? '').toLowerCase().includes(q))) : rows.slice();
  if (sortKey) r.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x < y ? -1 : 1) * (dir === 'asc' ? 1 : -1); });
  const pages = Math.max(1, Math.ceil(r.length / pageSize));
  const p = Math.min(Math.max(page, 1), pages);
  return { rows: r.slice((p - 1) * pageSize, p * pageSize), total: r.length, page: p, pages };
}
