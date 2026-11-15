/**
 * The ONE way the app describes a viewpoint (the "observer") in words — on the
 * viewpoint pill, in saved places and their comparison, in the share sheet
 * and on the link-preview card. Pure and server-safe.
 */
import type { Observer } from "@/lib/types";
import { heightMToFloor } from "@/state/selectors";
import { compassPoint, ordinal } from "./format";

/** At or below this height a yard viewpoint is "on the ground" (standing eye level), metres. */
const GROUND_LEVEL_MAX_M = 1.5;

/** "1 m", "4.5 m". */
export function formatMeters(heightM: number): string {
  return `${Number.isInteger(heightM) ? heightM : heightM.toFixed(1)} m`;
}

/** Floor 1 is the ground floor; above it floors are counted the way a lift does: 2nd, 3rd … */
export function floorName(floor: number): string {
  return floor <= 1 ? "Ground floor" : `${ordinal(floor)} floor`;
}

/**
 * The viewpoint in a few words:
 *
 *   "Yard · ground"                  standing in the open
 *   "Yard · 3 m up"                  a deck, a roof terrace — by its height,
 *                                    which is what the control sets
 *   "Window · 2nd floor · facing S"  a window, by floor and direction
 */
export function viewpointLabel(observer: Observer): string {
  if (observer.mode === "window") {
    const floor = floorName(heightMToFloor(observer.heightM)).toLowerCase();
    return `Window · ${floor} · facing ${compassPoint(observer.facingDeg)}`;
  }
  return observer.heightM <= GROUND_LEVEL_MAX_M
    ? "Yard · ground"
    : `Yard · ${formatMeters(observer.heightM)} up`;
}
