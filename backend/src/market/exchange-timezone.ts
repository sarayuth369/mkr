/**
 * Pure IANA-timezone conversion utilities, built on `Intl.DateTimeFormat`
 * (available in the Workers runtime's V8/ICU build, same as Node - no new
 * dependency). DST transitions are handled correctly because they come
 * from the real ICU timezone database, not hand-rolled offset math - this
 * was deliberately NOT hand-rolled (offset-by-formula is exactly the kind
 * of thing that's subtly wrong right around a transition date).
 */

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0=Sunday .. 6=Saturday, in the target timezone. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date/time this UTC instant reads as in `timeZone`. */
export function localParts(utcMs: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Intl formats midnight as "24" under hour12:false for some locales/ICU builds - normalize to 0.
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday ?? 'Sun'] ?? 0,
  };
}

/** Minutes since local midnight (0-1439) for this UTC instant in `timeZone`. */
export function minutesOfDay(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The UTC offset (in minutes, `local = utc + offset`) in effect AT the
 * given UTC instant, for `timeZone`. Standard "round-trip through the
 * formatter" technique: format the instant as if its wall-clock reading
 * were UTC, then diff against the real UTC instant.
 */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - utcMs) / 60_000;
}

/**
 * The UTC epoch (ms) for local midnight of the calendar date that
 * `utcMs` falls on in `timeZone`. Two-step: get the local Y/M/D, build a
 * first-guess UTC instant for "that Y/M/D at 00:00 UTC", then correct by
 * the REAL offset in effect at that corrected instant (not the offset at
 * the original `utcMs`) - this matters right on a DST transition day,
 * where the offset can differ between the original instant and local
 * midnight of the same calendar date.
 */
export function localMidnightUtc(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const offset = offsetMinutesAt(guess, timeZone);
  return guess - offset * 60_000;
}

/** Same calendar date's UTC-midnight-equivalent, shifted by `days` local calendar days (DST-safe - re-derives from the target date's own local parts, never assumes a fixed 86,400,000ms step). */
export function addLocalDays(localMidnightUtcMs: number, days: number, timeZone: string): number {
  // Stepping by a naive +/-86_400_000ms per day and re-deriving local
  // midnight from THAT instant is safe even across a DST boundary: a
  // +/-24h jump from one local midnight always lands within the target
  // calendar day (worst case a few hours off local midnight, which
  // localMidnightUtc then corrects back to the true local midnight).
  const approx = localMidnightUtcMs + days * 86_400_000;
  return localMidnightUtc(approx, timeZone);
}

export function weekdayAt(utcMs: number, timeZone: string): number {
  return localParts(utcMs, timeZone).weekday;
}

/** The UTC epoch (ms) for local midnight on the 1st of the calendar month that `utcMs` falls in, in `timeZone`. Same offset-correction technique as [localMidnightUtc]. */
export function localMonthStartUtc(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, 1, 0, 0, 0);
  const offset = offsetMinutesAt(guess, timeZone);
  return guess - offset * 60_000;
}

/** The UTC epoch (ms) for local midnight on the 1st of the NEXT calendar month, in `timeZone`. */
export function localNextMonthStartUtc(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const guess = Date.UTC(p.year, p.month, 1, 0, 0, 0); // month is already "next" (0-indexed p.month IS next when p.month is 1-indexed current)
  const offset = offsetMinutesAt(guess, timeZone);
  return guess - offset * 60_000;
}
