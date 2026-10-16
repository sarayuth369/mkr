// Chart.js wrappers (loaded as a global from /vendor/chart.umd.js). Linear time axis -> no date adapter needed.
import { CCY, PLATFORM_LABEL, toMs } from './calc.js';
import { fmtDate, fmtMoney } from './format.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const color = (p) => css(`--${p}`);
const instances = new Map();

function base(ccy) {
  const text = css('--muted'), grid = css('--line');
  return {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { labels: { color: text, usePointStyle: true, boxWidth: 8 } },
      tooltip: { callbacks: { title: (items) => fmtDate(new Date(items[0].parsed.x).toISOString().slice(0, 10)), label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y, ccy, { sign: c.dataset.signed })}` } },
    },
    scales: {
      x: { type: 'linear', bounds: 'data', ticks: { color: text, maxTicksLimit: 6, callback: (v) => fmtDate(new Date(v).toISOString().slice(0, 10)).slice(0, 5) + '/' + String(new Date(v).getUTCFullYear()).slice(2) }, grid: { color: grid } },
      y: { ticks: { color: text, callback: (v) => new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 }).format(v) }, grid: { color: grid } },
    },
  };
}

function draw(id, config) {
  const prev = instances.get(id);
  if (prev) prev.destroy();
  const canvas = document.getElementById(id);
  const empty = document.getElementById(id.replace('chart-', 'empty-'));
  const has = config.data.datasets.some((d) => d.data.length > 0);
  canvas.parentElement.hidden = !has;
  if (empty) empty.hidden = has;
  if (!has) { instances.delete(id); return; }
  instances.set(id, new window.Chart(canvas, config));
}

/** series: {platform: [{d, v}]} for the platforms listed; dashed datasets can be appended via `extra`. */
export function valueChart(id, platforms, series, ccy, extra = []) {
  const ds = platforms.map((p) => ({ label: PLATFORM_LABEL[p], borderColor: color(p), backgroundColor: color(p), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15, data: (series[p] ?? []).map((pt) => ({ x: toMs(pt.d), y: pt.v })) }));
  draw(id, { type: 'line', data: { datasets: [...ds, ...extra] }, options: base(ccy) });
}

/** Total THB line. Each point keeps its parts + the rate used so the tooltip can show exactly how the number was built. */
export function totalChart(id, points) {
  const o = base('THB');
  o.plugins.tooltip.callbacks.afterBody = (items) => {
    const p = points[items[0].dataIndex]; if (!p) return [];
    return [`Dime ${fmtMoney(p.dime, 'THB')}`, `StashAway ${fmtMoney(p.stashaway, 'THB')}`, `Webull ${fmtMoney(p.webullUsd, 'USD')} × ${p.rate} = ${fmtMoney(p.webullThb, 'THB')}`, p.carried ? `อัตราจากวันทำการก่อนหน้า (${fmtDate(p.rateDate)})` : `อัตราวันที่ ${fmtDate(p.rateDate)}`];
  };
  const c = css('--accent');
  draw(id, { type: 'line', data: { datasets: [{ label: 'รวม (THB)', borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.1, data: points.map((p) => ({ x: toMs(p.d), y: p.total })) }] }, options: o });
}

export function barChart(id, platforms, rows, ccy) {
  const ds = platforms.map((p) => {
    const any = rows.some((r) => r[p] !== 0);
    return { label: PLATFORM_LABEL[p], backgroundColor: color(p), borderRadius: 3, signed: true, data: any ? rows.map((r) => ({ x: toMs(r.k.length === 7 ? `${r.k}-01` : r.k), y: Math.round(r[p] * 100) / 100 })) : [] };
  });
  const o = base(ccy);
  o.interaction = { mode: 'index', intersect: false };
  o.scales.x.offset = true;
  draw(id, { type: 'bar', data: { datasets: ds }, options: o });
}

export function cumulativeChart(id, platforms, rows, ccy) {
  const ds = platforms.map((p) => ({ label: PLATFORM_LABEL[p], borderColor: color(p), backgroundColor: color(p), borderWidth: 2, pointRadius: rows.length < 40 ? 3 : 0, stepped: 'before', signed: true, data: rows.map((r) => ({ x: toMs(r.k.length === 7 ? `${r.k}-01` : r.k), y: r[p] })) }));
  const hasAny = rows.length > 0;
  draw(id, { type: 'line', data: { datasets: hasAny ? ds : ds.map((d) => ({ ...d, data: [] })) }, options: base(ccy) });
}

export function forecastChart(id, platform, history, path) {
  const c = color(platform), ccy = CCY[platform];
  const sets = [
    { label: 'ข้อมูลจริง', borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, data: history.map((p) => ({ x: toMs(p.d), y: p.v })) },
    { label: 'คาดการณ์ (ค่ากลาง)', borderColor: c, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, data: path.map((p) => ({ x: toMs(p.d), y: p.mid })) },
    { label: 'ช่วงต่ำ (~68%)', borderColor: c, borderDash: [2, 4], borderWidth: 1, pointRadius: 0, data: path.map((p) => ({ x: toMs(p.d), y: p.lo })) },
    { label: 'ช่วงสูง (~68%)', borderColor: c, borderDash: [2, 4], borderWidth: 1, pointRadius: 0, data: path.map((p) => ({ x: toMs(p.d), y: p.hi })) },
  ];
  draw(id, { type: 'line', data: { datasets: sets }, options: base(ccy) });
}

export function destroyAll() { for (const c of instances.values()) c.destroy(); instances.clear(); }
