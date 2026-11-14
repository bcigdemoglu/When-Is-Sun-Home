/**
 * Turning a sun position into "what is the sun doing for this observer".
 */
import { angularDistanceDeg } from "@/lib/geo/local";
import { horizonBinFor } from "@/lib/horizon/profile";
import { sunPositionAt } from "@/lib/solar/position";
import { addDays, zonedToUtcMs } from "@/lib/solar/timezone";
import {
  SunState,
  TERRAIN_BLOCKER,
  type HorizonProfile,
  type LatLng,
  type Observer,
  type SunInstant,
  type SunStateCode,
} from "@/lib/types";

/**
 * Can direct light from azimuth `azimuthDeg` reach the observer at all?
 * A "yard" sees the whole sky; a "window" only the cone `facingDeg ± fovDeg/2`
 * (edges included).
 */
export function isInViewCone(azimuthDeg: number, observer: Observer): boolean {
  if (observer.mode === "yard" || observer.fovDeg >= 360) return true;
  return angularDistanceDeg(azimuthDeg, observer.facingDeg) <= observer.fovDeg / 2;
}

/**
 * Classify one sun position. Precedence: Night → OutOfView → Blocked → Sun.
 *
 * - Night: altitude ≤ 0, or not a number (e.g. a wall-clock time lost to DST).
 * - Blocked: the sun is strictly below the skyline in its direction; a sun
 *   exactly on the skyline counts as Sun.
 * - `horizon === null` means "no building data": nothing is ever Blocked.
 *
 * The horizon must have been computed for this observer's height.
 */
export function classifySun(
  azimuthDeg: number,
  altitudeDeg: number,
  horizon: HorizonProfile | null,
  observer: Observer,
): SunStateCode {
  if (!(altitudeDeg > 0)) return SunState.Night;
  if (!isInViewCone(azimuthDeg, observer)) return SunState.OutOfView;
  if (horizon !== null) {
    const bin = horizonBinFor(horizon, azimuthDeg);
    if (bin >= 0 && altitudeDeg < horizon.elevationDeg[bin]) return SunState.Blocked;
  }
  return SunState.Sun;
}

/** Longest wall-clock gap we are prepared to step over, in hours. */
const MAX_GAP_HOURS = 48;

/**
 * Everything about the sun at one wall-clock moment in the place's time zone.
 *
 * If the wall-clock time does not exist (DST spring-forward gap) the instant
 * one hour later is used — the moment the clocks actually show next. (For the
 * rare zones whose gap is longer, further whole hours are added until a real
 * time is found.)
 */
export function sunInstantAt(
  place: LatLng,
  date: string,
  minuteOfDay: number,
  timeZone: string,
  horizon: HorizonProfile | null,
  observer: Observer,
): SunInstant {
  let utcMs = zonedToUtcMs(date, minuteOfDay, timeZone);
  for (let hours = 1; Number.isNaN(utcMs) && hours <= MAX_GAP_HOURS; hours++) {
    const shifted = minuteOfDay + hours * 60;
    const dayShift = Math.floor(shifted / 1440);
    utcMs = zonedToUtcMs(addDays(date, dayShift), shifted - dayShift * 1440, timeZone);
  }
  if (Number.isNaN(utcMs)) {
    return { azimuthDeg: NaN, altitudeDeg: NaN, state: SunState.Night };
  }

  const { azimuthDeg, altitudeDeg } = sunPositionAt(place.lat, place.lng, new Date(utcMs));
  const state = classifySun(azimuthDeg, altitudeDeg, horizon, observer);
  const instant: SunInstant = { azimuthDeg, altitudeDeg, state };
  if (state === SunState.Blocked && horizon !== null) {
    const bin = horizonBinFor(horizon, azimuthDeg);
    const buildingIndex = horizon.blockerIndex[bin];
    instant.blocker = {
      kind: buildingIndex === TERRAIN_BLOCKER ? "terrain" : "building",
      buildingIndex,
      distanceM: horizon.blockerDistanceM[bin],
      elevationDeg: horizon.elevationDeg[bin],
    };
  }
  return instant;
}
