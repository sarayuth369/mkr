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

/** Totals per currency. A combined THB estimate exists ONLY if the owner supplied usd_thb_rate. */
export function totals(portfolio, settings) {
  const v = (p) => latest(portfolio[p] ?? [])?.v ?? null;
  const thb = [v('dime'), v('stashaway')].filter((x) => x !== null);
  const usd = v('webull');
  const thbTotal = thb.length ? round2(thb.reduce((a, b) => a + b, 0)) : null;
  const rate = settings?.usd_thb_rate ? Number(settings.usd_thb_rate) : null;
  return {
    thb: thbTotal, usd,
    combinedThb: rate && rate > 0 && (thbTotal !== null || usd !== null) ? round2((thbTotal ?? 0) + (usd ?? 0) * rate) : null,
    rate: rate && rate > 0 ? rate : null, rateDate: settings?.usd_thb_rate_date ?? null,
  };
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
