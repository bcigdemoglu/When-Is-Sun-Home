/**
 * Words for a shared place: its short name, its viewpoint, its best and worst
 * month. Used by the share popover and by the link-preview card (`/og`), so
 * both say the same thing. Pure and server-safe.
 */
import { formatCoordinates } from "@/components/shared/format";
import type { Place, PlaceSummary } from "@/lib/types";
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
  return formatCoordinates(place.lat, place.lng);
}

/**
 * The first component of the place name ("1234 Elm St" of "1234 Elm St, San
 * Francisco, CA"), or null when the place has no usable name.
 */
export function shortPlaceName(place: Place): string | null {
  const first = (place.name ?? "").split(",")[0].trim();
  return first === "" ? null : first;
}

// The viewpoint wording is the app-wide one ("Yard · ground", "Window · 2nd floor · facing S").
export { viewpointLabel } from "@/components/shared/viewpoint";

/** "12.7 h in May · none in January", or null when every month is the same. */
export function bestWorstLine(summary: PlaceSummary, separator = " · "): string | null {
  const best = summary.monthlySunHours[summary.bestMonth];
  const worst = summary.monthlySunHours[summary.worstMonth];
  if (formatSunHours(best) === formatSunHours(worst)) return null;
  const least = formatSunHours(worst) === formatSunHours(0) ? "none" : formatSunHours(worst);
  return `${formatSunHours(best)} in ${MONTH_NAMES[summary.bestMonth]}${separator}${least} in ${MONTH_NAMES[summary.worstMonth]}`;
}
