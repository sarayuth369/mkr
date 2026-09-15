import { localParts } from '../market/exchange-timezone';

/**
 * Country/currency-area code -> IANA timezone, for computing
 * `eventTimeLocal` (display convenience - `eventTimeUtc` is always
 * authoritative). Reuses the same `Intl`-backed, DST-correct conversion
 * `exchange-timezone.ts` already established for market session logic -
 * no new date-math implementation.
 *
 * Intentionally only the countries/areas this task's official sources
 * actually cover - never guessed for an unrecognized code.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  US: 'America/New_York',
  EU: 'Europe/Berlin', // Germany's IANA zone - CET/CEST, matches the ECB's own Frankfurt seat
  UK: 'Europe/London',
  GB: 'Europe/London',
  JP: 'Asia/Tokyo',
};

export function timezoneForCountry(country: string): string {
  return COUNTRY_TIMEZONE[country.toUpperCase()] ?? 'UTC';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO-8601-shaped local wall-clock string, no 'Z'/offset (it's a display value, not a second source of truth). */
export function eventTimeLocal(utcMs: number, country: string): string {
  const tz = timezoneForCountry(country);
  const p = localParts(utcMs, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** UTC offset (minutes, `local = utc + offset`) in effect AT `utcMs` in `timeZone` - same round-trip-through-the-formatter technique as exchange-timezone.ts's private `offsetMinutesAt` (not exported there), re-derived here since this module needs it for arbitrary wall-clock times, not just local midnight. */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - utcMs) / 60_000;
}

/**
 * The UTC epoch (ms) for a given local wall-clock date/time in `timeZone` -
 * DST-correct (re-derives the real offset at the corrected instant, same
 * two-step technique as exchange-timezone.ts's `localMidnightUtc`). Used
 * to build the curated official-source schedule (curated-provider.ts) from
 * each source's own published LOCAL announcement time, rather than a
 * hand-computed/hardcoded UTC offset that DST would silently break.
 */
export function utcFromLocalWallClock(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = offsetMinutesAt(guess, timeZone);
  return guess - offset * 60_000;
}
