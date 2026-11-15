/**
 * Text formatting for the sun report. Pure functions, no DOM.
 *
 * Every clock time is formatted from the WALL-CLOCK minute it is given (the
 * place's time zone) — never through a `Date` in the browser's zone. Only the
 * 12-hour / 24-hour preference is taken from the user's locale.
 */

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const EN_DASH = "–";

// ─── Clock ─────────────────────────────────────────────────────────────────

/**
 * Does this locale write times with AM/PM? Uses the hour cycle `Intl` resolves
 * for the locale (the browser's default when `locale` is omitted).
 */
export function detectHour12(locale?: string | string[]): boolean {
  try {
    const options = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();
    if (options.hourCycle) return options.hourCycle === "h12" || options.hourCycle === "h11";
    return options.hour12 ?? true;
  } catch {
    return true;
  }
}

/** Whole wall-clock minute in [0, 1440], from a possibly fractional minute. */
function wholeMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.min(1440, Math.max(0, Math.round(minute)));
}

/**
 * A wall-clock minute as a clock time: "9:10 AM" or "09:10".
 * Minute 1440 (the end of the day) reads "midnight" / "24:00".
 */
export function formatClock(minute: number, hour12: boolean): string {
  const m = wholeMinute(minute);
  const hours = Math.floor(m / 60);
  const mins = String(m % 60).padStart(2, "0");
  if (!hour12) return `${String(hours).padStart(2, "0")}:${mins}`;
  if (m === 1440) return "midnight";
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${mins} ${suffix}`;
}

/** An axis label for a whole hour: "6 AM", "12 PM" or "06:00". */
export function formatHourTick(minute: number, hour12: boolean): string {
  const m = wholeMinute(minute);
  const hours = Math.floor(m / 60) % 24;
  if (!hour12) return `${String(m === 1440 ? 24 : hours).padStart(2, "0")}:00`;
  return `${hours % 12 === 0 ? 12 : hours % 12} ${hours < 12 ? "AM" : "PM"}`;
}

/** "9:10 AM – 12:40 PM". */
export function formatClockRange(startMinute: number, endMinute: number, hour12: boolean): string {
  return `${formatClock(startMinute, hour12)} ${EN_DASH} ${formatClock(endMinute, hour12)}`;
}

// ─── Durations & numbers ───────────────────────────────────────────────────

/** Minutes as "6 h 25 m", "3 h" or "45 m". */
export function formatDuration(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

/** Hours with one decimal, as used on chart labels: "6.4". */
export function formatHours(hours: number): string {
  const value = Number.isFinite(hours) ? hours : 0;
  // Avoid "-0.0".
  return (Math.round(value * 10) / 10 || 0).toFixed(1);
}

/** A 0..1 fraction as a whole percentage: "58%". */
export function formatPercent(fraction: number): string {
  const value = Number.isFinite(fraction) ? fraction : 0;
  return `${Math.round(value * 100)}%`;
}

/** A whole number with thousands separators: "2,336". */
export function formatCount(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ─── Dates ─────────────────────────────────────────────────────────────────

export interface DateParts {
  year: number;
  /** 0 = January. */
  month: number;
  day: number;
}

/** Split "YYYY-MM-DD"; `null` if the string is not shaped like a date. */
export function parseIsoDate(date: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function toIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  return `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

/** Day of the week of a calendar date, 0 = Sunday. Zone-free arithmetic. */
export function weekdayOf(parts: DateParts): number {
  return new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay();
}

/**
 * A calendar date in words: "Nov 14" by default; `weekday` gives
 * "Sat, Nov 14" and `year` appends ", 2026".
 */
export function formatDate(date: string, options: { weekday?: boolean; year?: boolean } = {}) {
  const parts = parseIsoDate(date);
  if (!parts) return date;
  let text = `${MONTHS_SHORT[parts.month]} ${parts.day}`;
  if (options.weekday) text = `${WEEKDAYS_SHORT[weekdayOf(parts)]}, ${text}`;
  if (options.year) text += `, ${parts.year}`;
  return text;
}

// ─── Directions, angles & distances ────────────────────────────────────────

const COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const COMPASS_16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

const COMPASS_WORDS: Record<string, string> = {
  N: "north",
  NE: "north-east",
  E: "east",
  SE: "south-east",
  S: "south",
  SW: "south-west",
  W: "west",
  NW: "north-west",
};

function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Nearest compass point of a bearing: "SW" (8 points) or "SSW" (16 points). */
export function compassPoint(azimuthDeg: number, points: 8 | 16 = 8): string {
  if (!Number.isFinite(azimuthDeg)) return "";
  const names = points === 16 ? COMPASS_16 : COMPASS_8;
  const step = 360 / names.length;
  return names[Math.round(normalize360(azimuthDeg) / step) % names.length];
}

/** Bearing in words, for prose: "south-west". */
export function compassWords(azimuthDeg: number): string {
  return COMPASS_WORDS[compassPoint(azimuthDeg, 8)] ?? "";
}

/** "SW · 225°". */
export function formatBearing(azimuthDeg: number): string {
  if (!Number.isFinite(azimuthDeg)) return "";
  const whole = Math.round(normalize360(azimuthDeg)) % 360;
  return `${compassPoint(azimuthDeg, 16)} · ${whole}°`;
}

/** An elevation angle: "12°" (one decimal below 10°: "4.5°"). */
export function formatAngle(deg: number): string {
  if (!Number.isFinite(deg)) return "";
  const abs = Math.abs(deg);
  return `${abs < 10 ? Math.round(deg * 10) / 10 || 0 : Math.round(deg)}°`;
}

/** A ground distance: "42 m", "1.2 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

// ─── Approximate clock times & lists (verdict sentences, legend rows) ──────

/**
 * A clock time rounded to the nearest `stepMinutes`, written the way people
 * say it: "9 AM", "6:30 PM", "noon" (or "09:00", "18:30", "12:00"). Midnight at
 * the end of the day reads "midnight".
 */
export function formatClockApprox(minute: number, hour12: boolean, stepMinutes = 30): string {
  const rounded = Math.round(wholeMinute(minute) / stepMinutes) * stepMinutes;
  if (hour12 && rounded === 720) return "noon";
  const text = formatClock(rounded, hour12);
  return hour12 ? text.replace(":00", "") : text;
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/**
 * Clock ranges as one line of text for a legend row:
 * "9:10 AM – 12:40 PM, 3:00 PM – 4:40 PM". At most `max` ranges are written
 * out; the rest are counted ("+2 more"). With `openEnded`, a range touching
 * the start or end of the day reads "until 6:54 AM" / "from 4:54 PM" (how one
 * talks about the night) and a range covering the whole day "all day".
 */
export function formatRangeList(
  ranges: readonly MinuteRange[],
  hour12: boolean,
  options: { max?: number; openEnded?: boolean } = {},
): string {
  const { max = 3, openEnded = false } = options;
  if (ranges.length === 0) return "";
  const one = (range: MinuteRange): string => {
    const fromStart = range.startMinute <= 0;
    const toEnd = range.endMinute >= 1440;
    if (fromStart && toEnd) return "all day";
    if (openEnded && fromStart) return `until ${formatClock(range.endMinute, hour12)}`;
    if (openEnded && toEnd) return `from ${formatClock(range.startMinute, hour12)}`;
    return formatClockRange(range.startMinute, range.endMinute, hour12);
  };
  const shown = ranges.slice(0, max).map(one);
  const rest = ranges.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
}
