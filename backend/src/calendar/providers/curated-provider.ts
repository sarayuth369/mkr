import { classifyEvent } from '../classification';
import type { EconomicEvent } from '../types';
import { eventTimeLocal, utcFromLocalWallClock } from '../timezone';
import type { CalendarFetchRange, EconomicCalendarProvider } from './types';

/**
 * Official-source curated schedule - the PRIMARY provider for this task
 * (target architecture: "official sources are primary"). None of the six
 * priority sources (Federal Reserve, BLS, BEA, ECB, Bank of England, Bank
 * of Japan) publish a stable, machine-readable API for their release
 * SCHEDULE (as opposed to the economic data itself, which some do expose
 * via API) - each source's calendar is an HTML page intended for human
 * reading. Per this task's explicit instruction ("If automation is
 * unavailable or legally unclear, use curated/static schedule data.
 * Static/curated data is a first-class source. Do not force scraping."),
 * this is a hand-curated, versioned snapshot compiled directly from each
 * source's own official page - not scraped, not fabricated, not copied
 * from any commercial calendar site.
 *
 * ── Collection method ────────────────────────────────────────────────
 * Manually compiled 2026-09-15 by reading each source's own official
 * calendar/schedule page directly:
 *   - Federal Reserve: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   - BLS:              https://www.bls.gov/schedule/news_release/current_year.asp
 *   - BEA:               https://www.bea.gov/news/schedule
 *   - ECB:               https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
 *   - Bank of England:   https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates
 *   - Bank of Japan:     https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm
 *
 * ── Data provided ────────────────────────────────────────────────────
 * SCHEDULE only (event title, country, date/time) - never consensus/
 * actual values, which these sources' calendar pages don't publish either
 * (see types.ts's "Schedule vs values" - previous/consensus/actual stay
 * null for every curated event; that is correct, not a bug).
 *
 * ── Refresh strategy (documented limitation, not automated) ─────────
 * This file is NOT re-fetched over the network - it is a versioned code
 * snapshot. It must be manually re-verified and updated periodically
 * (recommended: quarterly, or whenever a source announces its next
 * year's schedule) by re-reading the six pages above. `ingestion.ts`
 * still re-runs on a cron (idempotent upsert of this same array into D1)
 * so a code update between deploys reaches D1 without a manual DB step -
 * but the SOURCE DATA itself only changes when this file is edited and
 * redeployed.
 *
 * ── Limitations (explicit, not hidden) ──────────────────────────────
 * - FOMC/ECB/Bank of England announcement times are each source's own
 *   long-established, publicly documented convention (2:00pm ET / 2:15pm
 *   CET / 12:00 noon UK time respectively) - stable, well-known facts,
 *   not fabricated, but not literally re-confirmed per meeting since none
 *   of these pages states a per-meeting time either.
 * - Bank of Japan does NOT publish a fixed announcement time (it varies
 *   meeting to meeting and is not pre-announced) - rather than fabricate
 *   one, BOJ events use local midnight (00:00 JST) of the decision day as
 *   a DATE-ONLY placeholder. Do not treat a BOJ event's `eventTimeUtc` as
 *   an actual announcement time.
 * - ECB's page only surfaces the still-upcoming meetings as of the
 *   collection date - earlier-2026 ECB meetings are not included here
 *   (already past, and re-deriving their historical dates confidently
 *   from that page was not possible without risking an inaccurate date -
 *   omitted rather than guessed).
 * - GDP (BEA) similarly only includes the releases visible as upcoming
 *   from the collection date - Q1/Q2 2026 advance/second estimates are
 *   not included (already past by the collection date).
 * - "high/medium/low" importance and relatedAssets are MKR's OWN
 *   classification (classification.ts), independent of any source.
 *
 * ── Commercial/republication notes ──────────────────────────────────
 * All six sources are agencies of national/supranational governments or
 * central banks; their published meeting/release SCHEDULES (dates and
 * times, not the underlying statistical microdata) are official public
 * information intended for public and market consumption, not paywalled
 * or access-restricted. No terms-of-service was bypassed and no
 * commercial calendar aggregator (FXStreet/Investing.com/TradingView/
 * ForexFactory) was read or scraped to produce this list.
 */

interface CuratedRawEvent {
  source: string;
  sourceEventId: string;
  country: string;
  currency: string | null;
  title: string;
  sourceUrl: string;
  /** Local wall-clock components, converted to UTC via the source's own timezone at read time (DST-correct). */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}

const FED_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const BLS_URL = 'https://www.bls.gov/schedule/news_release/current_year.asp';
const BEA_URL = 'https://www.bea.gov/news/schedule';
const ECB_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';
const BOE_URL = 'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates';
const BOJ_URL = 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm';

function fomc(day2: [number, number, number], withSep: boolean): CuratedRawEvent {
  const [y, m, d] = day2;
  return {
    source: 'curated_official',
    sourceEventId: `fomc-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    country: 'US',
    currency: 'USD',
    title: withSep ? 'FOMC Interest Rate Decision (with Summary of Economic Projections)' : 'FOMC Interest Rate Decision',
    sourceUrl: FED_URL,
    year: y,
    month: m,
    day: d,
    hour: 14,
    minute: 0,
    timeZone: 'America/New_York',
  };
}

function bls(kind: 'cpi' | 'nfp', ym: [number, number, number], title: string): CuratedRawEvent {
  const [y, m, d] = ym;
  return {
    source: 'curated_official',
    sourceEventId: `${kind}-${y}-${String(m).padStart(2, '0')}`,
    country: 'US',
    currency: 'USD',
    title,
    sourceUrl: BLS_URL,
    year: y,
    month: m,
    day: d,
    hour: 8,
    minute: 30,
    timeZone: 'America/New_York',
  };
}

function bea(id: string, ymd: [number, number, number], title: string): CuratedRawEvent {
  const [y, m, d] = ymd;
  return {
    source: 'curated_official',
    sourceEventId: `gdp-${id}`,
    country: 'US',
    currency: 'USD',
    title,
    sourceUrl: BEA_URL,
    year: y,
    month: m,
    day: d,
    hour: 8,
    minute: 30,
    timeZone: 'America/New_York',
  };
}

function ecb(ymd: [number, number, number]): CuratedRawEvent {
  const [y, m, d] = ymd;
  return {
    source: 'curated_official',
    sourceEventId: `ecb-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    country: 'EU',
    currency: 'EUR',
    title: 'ECB Governing Council Interest Rate Decision',
    sourceUrl: ECB_URL,
    year: y,
    month: m,
    day: d,
    hour: 14,
    minute: 15,
    timeZone: 'Europe/Berlin',
  };
}

function boe(ymd: [number, number, number]): CuratedRawEvent {
  const [y, m, d] = ymd;
  return {
    source: 'curated_official',
    sourceEventId: `boe-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    country: 'UK',
    currency: 'GBP',
    title: 'Bank of England MPC Interest Rate Decision',
    sourceUrl: BOE_URL,
    year: y,
    month: m,
    day: d,
    hour: 12,
    minute: 0,
    timeZone: 'Europe/London',
  };
}

function boj(ymd: [number, number, number]): CuratedRawEvent {
  const [y, m, d] = ymd;
  return {
    source: 'curated_official',
    sourceEventId: `boj-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    country: 'JP',
    currency: 'JPY',
    // Date-only placeholder time (00:00 JST) - see class doc's BOJ limitation note.
    title: 'Bank of Japan Monetary Policy Meeting Decision',
    sourceUrl: BOJ_URL,
    year: y,
    month: m,
    day: d,
    hour: 0,
    minute: 0,
    timeZone: 'Asia/Tokyo',
  };
}

const CURATED_EVENTS: CuratedRawEvent[] = [
  // FOMC 2026 - all 8 meetings (decision announced day 2, 2:00pm ET).
  fomc([2026, 1, 28], false),
  fomc([2026, 3, 18], true),
  fomc([2026, 4, 29], false),
  fomc([2026, 6, 17], true),
  fomc([2026, 7, 29], false),
  fomc([2026, 9, 16], true),
  fomc([2026, 10, 28], false),
  fomc([2026, 12, 9], true),

  // BLS Consumer Price Index 2026 - all 12 months, 8:30am ET.
  bls('cpi', [2026, 1, 13], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 2, 13], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 3, 11], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 4, 10], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 5, 12], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 6, 10], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 7, 14], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 8, 12], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 9, 11], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 10, 14], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 11, 10], 'US Consumer Price Index (CPI)'),
  bls('cpi', [2026, 12, 10], 'US Consumer Price Index (CPI)'),

  // BLS Employment Situation (NFP) 2026 - all 12 months, 8:30am ET.
  bls('nfp', [2026, 1, 9], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 2, 11], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 3, 6], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 4, 3], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 5, 8], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 6, 5], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 7, 2], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 8, 7], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 9, 4], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 10, 2], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 11, 6], 'US Employment Situation (Non-Farm Payrolls)'),
  bls('nfp', [2026, 12, 4], 'US Employment Situation (Non-Farm Payrolls)'),

  // BEA GDP - only the releases confirmed still-upcoming as of collection date (2026-09-15).
  bea('2026-q2-third', [2026, 9, 30], 'US GDP (Third Estimate), Q2 2026'),
  bea('2026-q3-advance', [2026, 10, 29], 'US GDP (Advance Estimate), Q3 2026'),
  bea('2026-q3-second', [2026, 11, 25], 'US GDP (Second Estimate), Q3 2026'),
  bea('2026-q3-third', [2026, 12, 23], 'US GDP (Third Estimate), Q3 2026'),

  // ECB - only the meetings confirmed still-upcoming as of collection date.
  ecb([2026, 10, 29]),
  ecb([2026, 12, 17]),

  // Bank of England MPC - only the meetings confirmed still-upcoming as of collection date.
  boe([2026, 9, 17]),
  boe([2026, 11, 5]),
  boe([2026, 12, 17]),

  // Bank of Japan - only the meetings confirmed still-upcoming as of collection date. Date-only (see limitation note).
  boj([2026, 9, 18]),
  boj([2026, 10, 30]),
  boj([2026, 12, 18]),
];

function toCanonical(raw: CuratedRawEvent): EconomicEvent {
  const eventTimeUtc = utcFromLocalWallClock(raw.year, raw.month, raw.day, raw.hour, raw.minute, raw.timeZone);
  const classification = classifyEvent(raw.title);
  return {
    id: `${raw.source}:${raw.sourceEventId}`,
    source: raw.source,
    sourceEventId: raw.sourceEventId,
    country: raw.country,
    currency: raw.currency,
    title: raw.title,
    category: classification.category,
    eventTimeUtc,
    eventTimeLocal: eventTimeLocal(eventTimeUtc, raw.country),
    importance: classification.importance,
    // Schedule-only source - never a fabricated economic value (see class doc).
    previous: null,
    consensus: null,
    actual: null,
    unit: null,
    // Computed centrally by the caller (provider-manager.ts) from eventTimeUtc vs now - never hardcoded here.
    status: 'unknown',
    relatedAssets: classification.relatedAssets,
    sourceUrl: raw.sourceUrl,
    updatedAt: Date.now(),
  };
}

export class CuratedScheduleProvider implements EconomicCalendarProvider {
  readonly id = 'curated_official';
  readonly commercial = false;

  async fetchEvents(range: CalendarFetchRange): Promise<EconomicEvent[]> {
    // No network I/O - a versioned in-memory dataset, filtered by range.
    // Still `async` to satisfy the shared provider interface uniformly
    // (every caller treats every provider identically, curated or live).
    return CURATED_EVENTS.map(toCanonical).filter((e) => e.eventTimeUtc >= range.fromMs && e.eventTimeUtc <= range.toMs);
  }
}
