// FxStore Durable Object: server-side USD->THB reference rate (European Central Bank via Frankfurter, no API key).
//
// Rules (also disclosed in the UI and docs/MINVEST_GUIDE_TH.md):
//  * The rate is a daily REFERENCE rate published on ECB business days, NOT a live trading/bank rate.
//  * Nothing is hardcoded. If the provider is unreachable we return the last cached value flagged status=stale (with its
//    original rateDate/fetchedAt) or status=unavailable when there is no cache. A stale value is never presented as current.
//  * Historical conversion uses each record's own date; weekends/holidays carry forward the previous published rate
//    (the client labels this). Dates before the first published rate in range are left unconverted.
import type { Env } from './types';

const BASE = 'https://api.frankfurter.dev/v1';
const SOURCE = 'ECB reference rate via Frankfurter (api.frankfurter.dev)';
const FRESH_MS = 60 * 60_000;          // serve cache without refetch for 1h
const MIN_REFRESH_MS = 60_000;         // manual refresh cannot hammer the provider
const STALE_RATE_DAYS = 5;             // rateDate older than this (e.g. long ECB gap) is flagged stale
const HISTORY_FRESH_MS = 6 * 60 * 60_000;

export interface Latest { rate: number; rateDate: string; fetchedAt: number }
export interface Series { from: string; to: string; fetchedAt: number; rates: Record<string, number> }
interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> }

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function describeLatest(l: Latest | undefined, now: number, error?: string) {
  if (!l) return { status: 'unavailable', source: SOURCE, error: error ?? 'ยังไม่มีอัตราแลกเปลี่ยน' };
  const today = new Date(now).toISOString().slice(0, 10);
  const ageDays = dayDiff(l.rateDate, today);
  const stale = Boolean(error) || now - l.fetchedAt > 24 * 3_600_000 || ageDays > STALE_RATE_DAYS;
  return {
    status: stale ? 'stale' : 'fresh', rate: l.rate, rateDate: l.rateDate, fetchedAt: new Date(l.fetchedAt).toISOString(), source: SOURCE,
    ageDays, ...(error ? { error } : {}),
  };
}

export class FxStore {
  constructor(private state: { storage: Storage }, _env: Env, private fetchImpl: typeof fetch = fetch, private now: () => number = Date.now) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/latest') return json(await this.latest(url.searchParams.get('force') === '1'));
    if (url.pathname === '/history') {
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
      if (!DATE.test(from) || !DATE.test(to) || from > to || dayDiff(from, to) > 3700) return json({ status: 'error', error: 'ช่วงวันที่ไม่ถูกต้อง' }, 400);
      return json(await this.history(from, to));
    }
    return new Response('not found', { status: 404 });
  }

  private async provider(path: string): Promise<unknown> {
    const doFetch = this.fetchImpl; // not called as a method: the global fetch throws "Illegal invocation" with a foreign `this`
    const res = await doFetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    return res.json();
  }

  async latest(force: boolean) {
    const now = this.now();
    const cached = await this.state.storage.get<Latest>('latest');
    if (cached) {
      const age = now - cached.fetchedAt;
      if (!force && age < FRESH_MS) return describeLatest(cached, now);
      if (force && age < MIN_REFRESH_MS) return { ...describeLatest(cached, now), note: 'รีเฟรชได้ทุก 1 นาที แสดงค่าที่เพิ่งดึงล่าสุด' };
    }
    try {
      const j = (await this.provider('/latest?base=USD&symbols=THB')) as { date?: string; rates?: { THB?: number } };
      const rate = j?.rates?.THB;
      if (typeof rate !== 'number' || !(rate > 0) || !(rate < 1000) || typeof j.date !== 'string' || !DATE.test(j.date)) throw new Error('bad provider payload');
      const fresh: Latest = { rate, rateDate: j.date, fetchedAt: now };
      await this.state.storage.put('latest', fresh);
      return describeLatest(fresh, now);
    } catch {
      return describeLatest(cached, now, 'ดึงอัตราแลกเปลี่ยนไม่สำเร็จ' + (cached ? ' ใช้ค่าล่าสุดที่เก็บไว้ (อาจไม่ใช่ปัจจุบัน)' : ''));
    }
  }

  async history(from: string, to: string) {
    const now = this.now();
    const cached = await this.state.storage.get<Series>('series');
    const covers = cached && cached.from <= from && cached.to >= to;
    // A range ending after the cached coverage (or a stale cache) is refetched; old, closed ranges are immutable.
    const needsFetch = !covers || (now - cached!.fetchedAt > HISTORY_FRESH_MS && dayDiff(cached!.to, new Date(now).toISOString().slice(0, 10)) <= 7);
    let series = cached;
    let error: string | undefined;
    if (needsFetch) {
      const f = cached && cached.from < from ? cached.from : from;
      const t = cached && cached.to > to ? cached.to : to;
      try {
        const j = (await this.provider(`/${f}..${t}?base=USD&symbols=THB`)) as { rates?: Record<string, { THB?: number }> };
        const rates: Record<string, number> = {};
        for (const [d, r] of Object.entries(j?.rates ?? {})) if (DATE.test(d) && typeof r?.THB === 'number' && r.THB > 0 && r.THB < 1000) rates[d] = r.THB;
        if (!Object.keys(rates).length) throw new Error('empty series');
        series = { from: f, to: t, fetchedAt: now, rates };
        await this.state.storage.put('series', series);
      } catch {
        error = 'ดึงอัตราแลกเปลี่ยนย้อนหลังไม่สำเร็จ';
      }
    }
    if (!series) return { status: 'unavailable', source: SOURCE, error: error ?? 'ยังไม่มีข้อมูลอัตราแลกเปลี่ยนย้อนหลัง', rates: {} };
    const rates: Record<string, number> = {};
    for (const [d, r] of Object.entries(series.rates)) if (d >= from && d <= to) rates[d] = r;
    // include the last published rate BEFORE `from` so carry-forward works for the first days of the range
    const prior = Object.keys(series.rates).filter((d) => d < from).sort().pop();
    return {
      status: error ? 'stale' : 'fresh', source: SOURCE, fetchedAt: new Date(series.fetchedAt).toISOString(), from, to, rates,
      ...(prior ? { priorDate: prior, priorRate: series.rates[prior] } : {}), ...(error ? { error } : {}),
    };
  }
}
