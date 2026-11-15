/**
 * Naming the PLACE's time zone at a wall-clock moment ("PDT", "UTC−7",
 * "Los Angeles time"). Kept apart from `format.ts` because it needs the time
 * zone engine; the only `Intl` use is to name the zone at a given instant.
 */
import { zonedToUtc } from "@/lib/solar/timezone";

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
