/**
 * Words for a shared place: its short name, its viewpoint, its best and worst
 * month. Used by the share popover and by the link-preview card (`/og`), so
 * both say the same thing. Pure and server-safe.
 */
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { heightMToFloor } from "@/state/selectors";
import { MONTH_NAMES, formatSunHours } from "@/state/urlCodec";

/** `text` cut to `max` characters (code points), with an ellipsis if it was longer. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text); // by code point: never cut an emoji in half
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** "37.7912° N, 122.4301° W". */
export function coordinatesLabel(place: Place): string {
  const ns = place.lat >= 0 ? "N" : "S";
  const ew = place.lng >= 0 ? "E" : "W";
  return `${Math.abs(place.lat).toFixed(4)}° ${ns}, ${Math.abs(place.lng).toFixed(4)}° ${ew}`;
}

/**
 * The first component of the place name ("1234 Elm St" of "1234 Elm St, San
 * Francisco, CA"), or null when the place has no usable name.
 */
export function shortPlaceName(place: Place): string | null {
  const first = (place.name ?? "").split(",")[0].trim();
  return first === "" ? null : first;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Backyard · ground level" / "Terrace · 4th floor" / "Window · 2nd floor · facing S". */
export function viewpointLabel(observer: Observer): string {
  const floor = heightMToFloor(observer.heightM);
  if (observer.mode === "window") {
    const facing = COMPASS[Math.round((((observer.facingDeg % 360) + 360) % 360) / 45) % 8];
    return `Window · ${floor === 1 ? "ground floor" : `${ordinal(floor)} floor`} · facing ${facing}`;
  }
  return floor === 1 ? "Backyard · ground level" : `Terrace · ${ordinal(floor)} floor`;
}

/** "12.7 h in May · none in January", or null when every month is the same. */
export function bestWorstLine(summary: PlaceSummary, separator = " · "): string | null {
  const best = summary.monthlySunHours[summary.bestMonth];
  const worst = summary.monthlySunHours[summary.worstMonth];
  if (formatSunHours(best) === formatSunHours(worst)) return null;
  const least = formatSunHours(worst) === formatSunHours(0) ? "none" : formatSunHours(worst);
  return `${formatSunHours(best)} in ${MONTH_NAMES[summary.bestMonth]}${separator}${least} in ${MONTH_NAMES[summary.worstMonth]}`;
}
