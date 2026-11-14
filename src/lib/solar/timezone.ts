/**
 * Wall-clock time handling in the time zone of the PLACE.
 *
 * Nothing in here ever looks at the machine's own time zone: calendar dates
 * are ISO strings, times of day are minutes since local midnight, and the only
 * bridge to real instants is the IANA zone's UTC offset (from `Intl`, via
 * `@date-fns/tz`).
 *
 * A wall-clock time is represented internally as a "local millisecond": the
 * epoch milliseconds of the same Y-M-D h:m:s read as if it were UTC. Then
 * `utc = local − offset`, and the only hard part is knowing which offset
 * applies — see {@link zoneOffsetTable}.
 */
import { tzOffset } from "@date-fns/tz";
import tzlookup from "tz-lookup";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// ─── Time zone of a place ──────────────────────────────────────────────────

const zoneSupport = new Map<string, boolean>();

function isSupportedZone(timeZone: string): boolean {
  let ok = zoneSupport.get(timeZone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      ok = true;
    } catch {
      ok = false;
    }
    zoneSupport.set(timeZone, ok);
  }
  return ok;
}

/** Nautical fixed-offset zone for a longitude (note the inverted POSIX sign). */
function fixedOffsetZone(lng: number): string {
  if (!Number.isFinite(lng)) return "Etc/GMT";
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  const hoursEast = Math.round(wrapped / 15);
  if (hoursEast === 0) return "Etc/GMT";
  // "Etc/GMT-3" is UTC+3: the sign in these names is the opposite of ISO 8601.
  return hoursEast > 0 ? `Etc/GMT-${hoursEast}` : `Etc/GMT+${-hoursEast}`;
}

/**
 * IANA time zone at a coordinate. Falls back to a fixed-offset `Etc/GMT±N`
 * zone derived from the longitude if the lookup fails or names a zone this
 * runtime does not know.
 */
export function timeZoneAt(lat: number, lng: number): string {
  try {
    const zone = tzlookup(lat, lng);
    if (isSupportedZone(zone)) return zone;
  } catch {
    // fall through to the longitude estimate
  }
  return fixedOffsetZone(lng);
}

// ─── Calendar dates ────────────────────────────────────────────────────────

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Epoch ms of 00:00 UTC on a proleptic Gregorian date (safe for years < 100). */
function utcMidnightMs(year: number, monthIndex: number, day: number): number {
  return new Date(0).setUTCFullYear(year, monthIndex, day);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatDateMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/**
 * Local-millisecond value of midnight on an ISO date (see the file comment).
 * Throws a RangeError for anything that is not a real "YYYY-MM-DD" date.
 */
export function localMidnightMs(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    const ms = utcMidnightMs(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    // Rejects overflow such as 2026-02-30, which Date would roll into March.
    if (formatDateMs(ms) === date) return ms;
  }
  throw new RangeError(`Invalid calendar date: "${date}" (expected YYYY-MM-DD)`);
}

/** Date of the 0-based `dayIndex` of `year` (0 = 1 January). */
export function dateFromDayIndex(year: number, dayIndex: number): string {
  return formatDateMs(utcMidnightMs(year, 0, 1) + dayIndex * MS_PER_DAY);
}

/** 0-based day of the year of an ISO date (0 = 1 January). */
export function dayIndexFromDate(date: string): number {
  const ms = localMidnightMs(date);
  return Math.round((ms - utcMidnightMs(yearOfDate(date), 0, 1)) / MS_PER_DAY);
}

export function yearOfDate(date: string): number {
  localMidnightMs(date); // validate
  return Number(date.slice(0, 4));
}

/** Calendar arithmetic: the date `n` days after (or before, if negative) `date`. */
export function addDays(date: string, n: number): string {
  return formatDateMs(localMidnightMs(date) + n * MS_PER_DAY);
}

// ─── UTC offsets ───────────────────────────────────────────────────────────

/** UTC offset in minutes (east positive) of `timeZone` at a UTC instant. */
export function utcOffsetMinutes(timeZone: string, utcMs: number): number {
  const offset = tzOffset(timeZone, new Date(utcMs));
  if (!Number.isFinite(offset)) throw new RangeError(`Unknown time zone: "${timeZone}"`);
  return offset;
}

/**
 * Every UTC offset a zone uses during one calendar year, as chronological
 * segments: `offsetsMin[i]` applies to instants in `[startsMs[i], startsMs[i + 1])`
 * (the first segment starts at -∞, the last ends at +∞).
 */
export interface ZoneOffsetTable {
  timeZone: string;
  year: number;
  startsMs: number[];
  offsetsMin: number[];
}

/** How densely the year is probed for offset changes. */
const PROBE_STEP_MS = 12 * MS_PER_HOUR;
/** Real zones range from UTC−12 to UTC+14; pad a little beyond that. */
const WINDOW_BEFORE_MS = 15 * MS_PER_HOUR;
const WINDOW_AFTER_MS = 13 * MS_PER_HOUR;

const tableCache = new Map<string, ZoneOffsetTable>();
const TABLE_CACHE_LIMIT = 64;

/**
 * Offset table covering every wall-clock time of `year` in `timeZone`.
 *
 * Built by probing the offset every 12 hours and bisecting (to the second)
 * wherever two neighbouring probes disagree, so a whole year costs a few
 * hundred `Intl` calls instead of one per sample. Cached per (zone, year).
 */
export function zoneOffsetTable(timeZone: string, year: number): ZoneOffsetTable {
  const key = `${timeZone}|${year}`;
  const cached = tableCache.get(key);
  if (cached) return cached;

  const windowStart = utcMidnightMs(year, 0, 1) - WINDOW_BEFORE_MS;
  const windowEnd = utcMidnightMs(year + 1, 0, 1) + WINDOW_AFTER_MS;

  let lo = windowStart;
  let offsetLo = utcOffsetMinutes(timeZone, lo);
  const startsMs = [-Infinity];
  const offsetsMin = [offsetLo];

  while (lo < windowEnd) {
    const hi = Math.min(lo + PROBE_STEP_MS, windowEnd);
    const offsetHi = utcOffsetMinutes(timeZone, hi);
    // Usually zero iterations; more than one only if several changes share a probe step.
    while (offsetLo !== offsetHi) {
      // Find the first whole second in (lo, hi] whose offset differs from offsetLo.
      let a = lo;
      let b = hi;
      let offsetB = offsetHi;
      while (b - a > MS_PER_SECOND) {
        const mid = a + Math.floor((b - a) / (2 * MS_PER_SECOND)) * MS_PER_SECOND;
        const offsetMid = utcOffsetMinutes(timeZone, mid);
        if (offsetMid === offsetLo) {
          a = mid;
        } else {
          b = mid;
          offsetB = offsetMid;
        }
      }
      startsMs.push(b);
      offsetsMin.push(offsetB);
      lo = b;
      offsetLo = offsetB;
    }
    lo = hi;
  }

  const table: ZoneOffsetTable = { timeZone, year, startsMs, offsetsMin };
  if (tableCache.size >= TABLE_CACHE_LIMIT) tableCache.clear();
  tableCache.set(key, table);
  return table;
}

/**
 * UTC epoch ms of a wall-clock time given as a local millisecond (see the file
 * comment), which must fall within the table's year.
 *
 * Returns NaN if that wall-clock time does not exist (spring-forward gap) and
 * the FIRST occurrence if it happens twice (fall-back overlap).
 */
export function localMsToUtcMs(table: ZoneOffsetTable, localMs: number): number {
  const { startsMs, offsetsMin } = table;
  const last = offsetsMin.length - 1;
  // Segments are chronological, so the first one that accepts the time is the
  // earliest matching instant.
  for (let i = 0; i <= last; i++) {
    const utcMs = localMs - offsetsMin[i] * MS_PER_MINUTE;
    if (utcMs >= startsMs[i] && (i === last || utcMs < startsMs[i + 1])) return utcMs;
  }
  return NaN;
}

// ─── Wall clock ⇄ instant ──────────────────────────────────────────────────

function assertMinuteOfDay(minuteOfDay: number): void {
  if (!(minuteOfDay >= 0 && minuteOfDay < 1440)) {
    throw new RangeError(`minuteOfDay must be in [0, 1440), got ${minuteOfDay}`);
  }
}

/**
 * Like {@link zonedToUtc} but returns epoch milliseconds, or NaN when the
 * wall-clock time does not exist. Allocation-free once the zone table is cached.
 */
export function zonedToUtcMs(date: string, minuteOfDay: number, timeZone: string): number {
  assertMinuteOfDay(minuteOfDay);
  const table = zoneOffsetTable(timeZone, yearOfDate(date));
  return localMsToUtcMs(table, localMidnightMs(date) + minuteOfDay * MS_PER_MINUTE);
}

/**
 * The UTC instant at which clocks in `timeZone` read `minuteOfDay` (may be
 * fractional) on `date`.
 *
 * Returns `null` if that wall-clock time does not exist (DST spring-forward
 * gap). If it happens twice (fall-back), the FIRST occurrence is returned.
 */
export function zonedToUtc(date: string, minuteOfDay: number, timeZone: string): Date | null {
  const ms = zonedToUtcMs(date, minuteOfDay, timeZone);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Wall-clock date and time in `timeZone` at a UTC instant. `minuteOfDay` is
 * exact (fractional when the instant is not on a whole minute), in [0, 1440).
 */
export function utcToZoned(
  instant: Date,
  timeZone: string,
): { date: string; minuteOfDay: number } {
  const utcMs = instant.getTime();
  if (Number.isNaN(utcMs)) throw new RangeError("Invalid instant");
  const localMs = utcMs + utcOffsetMinutes(timeZone, utcMs) * MS_PER_MINUTE;
  const midnightMs = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  return { date: formatDateMs(midnightMs), minuteOfDay: (localMs - midnightMs) / MS_PER_MINUTE };
}

/**
 * The current wall-clock date and WHOLE minute (0..1439) in `timeZone`.
 * Pass `now` to make it deterministic.
 */
export function nowInZone(
  timeZone: string,
  now: Date = new Date(),
): { date: string; minuteOfDay: number } {
  const zoned = utcToZoned(now, timeZone);
  return { date: zoned.date, minuteOfDay: Math.floor(zoned.minuteOfDay) };
}
