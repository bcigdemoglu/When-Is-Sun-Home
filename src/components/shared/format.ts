/**
 * Display formatting for wall-clock values in the PLACE's time zone.
 *
 * Dates are ISO strings and times are minutes since local midnight, so most of
 * this never touches a `Date` in the browser's zone; the only `Intl` use is to
 * name the place's zone at a given instant.
 */
import { zonedToUtc } from "@/lib/analysis";

/** "3:42 PM". Fractional minutes are floored; 1440 wraps to 12:00 AM. */
export function formatClock(minuteOfDay: number): string {
  if (!Number.isFinite(minuteOfDay)) return "–";
  const total = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** "3:42p" — for tight spots such as tick labels. */
export function formatClockCompact(minuteOfDay: number): string {
  if (!Number.isFinite(minuteOfDay)) return "–";
  const total = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${hour24 < 12 ? "a" : "p"}`;
}

/**
 * The real instant a wall-clock time stands for. A time skipped by a DST
 * spring-forward resolves to the moment the clocks show next (one hour on).
 */
function instantFor(date: string, minuteOfDay: number, timeZone: string): Date | null {
  try {
    const minute = Math.min(1439, Math.max(0, minuteOfDay));
    return (
      zonedToUtc(date, minute, timeZone) ??
      zonedToUtc(date, Math.min(1439, minute + 60), timeZone) ??
      zonedToUtc(date, 720, timeZone)
    );
  } catch {
    return null;
  }
}

const zoneNameFormats = new Map<string, Intl.DateTimeFormat | null>();

/** Building an `Intl.DateTimeFormat` is slow; keep one per zone (null = unknown zone). */
function zoneNameFormat(timeZone: string): Intl.DateTimeFormat | null {
  let format = zoneNameFormats.get(timeZone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" });
    } catch {
      format = null;
    }
    if (zoneNameFormats.size > 50) zoneNameFormats.clear();
    zoneNameFormats.set(timeZone, format);
  }
  return format;
}

/**
 * Short name of the zone at that wall-clock time: "PST" / "PDT", or "GMT+3"
 * where the zone has no English abbreviation. Empty string if unknown.
 */
export function zoneAbbreviation(timeZone: string, date: string, minuteOfDay: number): string {
  const format = zoneNameFormat(timeZone);
  const instant = format ? instantFor(date, minuteOfDay, timeZone) : null;
  if (!format || !instant) return "";
  try {
    const parts = format.formatToParts(instant);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "UTC−8", "UTC+5:30", "UTC". Empty string if unknown. */
export function utcOffsetLabel(timeZone: string, date: string, minuteOfDay: number): string {
  const instant = instantFor(date, minuteOfDay, timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!instant || !match) return "";
  const minute = Math.min(1439, Math.max(0, minuteOfDay));
  const localMs =
    new Date(0).setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3])) +
    minute * 60_000;
  let offset = Math.round((localMs - instant.getTime()) / 60_000);
  // In a DST gap `instant` is the time the clocks show next, one hour on.
  if (zonedToUtcSafe(date, minute, timeZone) === null) offset += 60;
  if (offset === 0) return "UTC";
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${offset < 0 ? "−" : "+"}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

function zonedToUtcSafe(date: string, minuteOfDay: number, timeZone: string): Date | null {
  try {
    return zonedToUtc(date, minuteOfDay, timeZone);
  } catch {
    return null;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
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

function parseIsoDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "Sat, Nov 14" (add the year with `withYear`). Zone independent. */
export function formatShortDate(date: string, withYear = false): string {
  const parts = parseIsoDate(date);
  if (!parts || parts.month < 1 || parts.month > 12) return date;
  const weekday =
    WEEKDAYS[
      new Date(new Date(0).setUTCFullYear(parts.year, parts.month - 1, parts.day)).getUTCDay()
    ];
  const base = `${weekday}, ${MONTHS[parts.month - 1].slice(0, 3)} ${parts.day}`;
  return withYear ? `${base}, ${parts.year}` : base;
}

/** "November 14". Zone independent. */
export function formatMonthDay(date: string): string {
  const parts = parseIsoDate(date);
  if (!parts || parts.month < 1 || parts.month > 12) return date;
  return `${MONTHS[parts.month - 1]} ${parts.day}`;
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const COMPASS_NAMES = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

function compassIndex(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return Math.round(normalized / 45) % 8;
}

/** Nearest of the 8 compass points: 0 → "N", 200 → "S", 337.5 → "N". */
export function compassPoint(deg: number): string {
  return Number.isFinite(deg) ? COMPASS_POINTS[compassIndex(deg)] : "–";
}

/** Spoken form: 135 → "south-east". */
export function compassName(deg: number): string {
  return Number.isFinite(deg) ? COMPASS_NAMES[compassIndex(deg)] : "unknown";
}

/** "37.7906° N, 122.4294° W". */
export function formatCoordinates(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "–";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

/**
 * One line naming the place's zone at a wall-clock time:
 * "Los Angeles time (PDT, UTC−7)".
 */
export function zoneLabel(timeZone: string, date: string, minuteOfDay: number): string {
  const details = [zoneAbbreviation(timeZone, date, minuteOfDay)];
  const offset = utcOffsetLabel(timeZone, date, minuteOfDay);
  if (!details.includes(offset)) details.push(offset);
  const shown = details.filter((detail) => detail !== "");
  return `${zoneCity(timeZone)} time${shown.length > 0 ? ` (${shown.join(", ")})` : ""}`;
}

/** "America/Los_Angeles" → "Los Angeles"; "Etc/GMT+8" stays as is. */
export function zoneCity(timeZone: string): string {
  if (timeZone.startsWith("Etc/")) return timeZone.slice(4);
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}
