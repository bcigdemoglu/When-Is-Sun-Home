/**
 * Stable fetch areas.
 *
 * Fetching buildings around the exact pin position would refetch on every
 * small move. Instead the globe is cut into fixed cells of roughly
 * 220 m × 220 m; a pin maps to its cell, and buildings are fetched once for a
 * circle around the cell centre that is large enough for every point in it.
 */
import type { LatLng } from "@/lib/types";

/** Bump to invalidate every cached area (grid, query or parsing changed). */
export const AREA_SCHEMA_VERSION = 1;

/** Cell height in degrees of latitude (~222 m). */
export const AREA_LAT_STEP_DEG = 0.002;
/** Radius fetched around each cell centre, metres. */
export const AREA_RADIUS_M = 500;
/**
 * Every pin has buildings at least this far out in all directions:
 * the fetch radius minus the half-diagonal of a cell (~158 m).
 */
export const AREA_MIN_MARGIN_M = 340;

/** Keeps cells from becoming infinitely wide (in degrees) at the poles. */
const MIN_COS_LAT = 0.01;
const ROWS = Math.round(180 / AREA_LAT_STEP_DEG);

export interface FetchArea {
  /** Stable identifier, e.g. "v1:37.791:-122.4301". Also the cache key. */
  key: string;
  center: LatLng;
  radiusM: number;
}

/** Wrap a longitude into [-180, 180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Trim "-0.000" to "0.000" so both sides of zero cannot produce the same digits. */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/**
 * The fetch area for a pin: the grid cell containing it, with the circle to
 * request from Overpass. Any two pins in the same cell get the same area.
 */
export function fetchAreaFor(place: LatLng): FetchArea {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
    throw new RangeError("fetchAreaFor: latitude and longitude must be finite");
  }
  const lat = Math.min(90, Math.max(-90, place.lat));
  const lng = wrapLng(place.lng);

  // Rows are counted from the south pole so the indices are never negative.
  const row = Math.min(ROWS - 1, Math.floor((lat + 90) / AREA_LAT_STEP_DEG));
  const centerLat = (row + 0.5) * AREA_LAT_STEP_DEG - 90;

  // The longitude step depends on the row only (never on the pin), so every
  // pin in a row sees the same columns. It widens towards the poles to keep
  // cells about as wide as they are tall.
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((centerLat * Math.PI) / 180));
  const lngStep = AREA_LAT_STEP_DEG / cosLat;
  const col = Math.floor((lng + 180) / lngStep);
  // The last column of a row is cut short at the antimeridian; its centre can
  // fall just beyond +180°, so wrap it.
  const centerLng = wrapLng((col + 0.5) * lngStep - 180);

  return {
    key: `v${AREA_SCHEMA_VERSION}:${fixed(centerLat, 3)}:${fixed(centerLng, 4)}`,
    center: { lat: centerLat, lng: centerLng },
    radiusM: AREA_RADIUS_M,
  };
}

/** The cell centre encoded in an area key, or null if the key is not one of ours. */
export function parseAreaKey(key: string): LatLng | null {
  const match = /^v\d+:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(key);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

/**
 * True when two area keys are the same cell or cells next to each other
 * (including diagonally), i.e. their fetch circles overlap heavily.
 */
export function areAreasAdjacent(keyA: string, keyB: string): boolean {
  const a = parseAreaKey(keyA);
  const b = parseAreaKey(keyB);
  if (!a || !b) return false;
  const dLat = Math.abs(a.lat - b.lat);
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180));
  let dLng = Math.abs(a.lng - b.lng);
  if (dLng > 180) dLng = 360 - dLng;
  const limit = AREA_LAT_STEP_DEG * 1.6;
  return dLat <= limit && dLng * cosLat <= limit;
}
