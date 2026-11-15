/**
 * Stable fetch areas.
 *
 * Fetching buildings around the exact pin position would refetch on every
 * small move. Instead the globe is cut into fixed cells of roughly
 * 220 m × 220 m; a pin maps to its cell, and buildings are fetched once for a
 * circle around the cell centre that is large enough for every point in it.
 */
import type { LatLng } from "@/lib/types";

/**
 * Bump whenever the grid, the Overpass query or the PARSED output changes in
 * any way. The version is part of every area key, so a bump invalidates the
 * IndexedDB cache and the CDN-cached `/api/buildings` responses in one go.
 *
 *  1 → 2: columns tile each row exactly (no cut-off cell at the antimeridian);
 *         neighbourhood-aware default heights; coordinates rounded to 7 places.
 *  2 → 3: buildings come from OpenFreeMap vector tiles (other ids, heights
 *         and feature count than the Overpass-derived data).
 *  3 → 4: tile data reaches 800 m from the cell centre instead of 500 m.
 */
export const AREA_SCHEMA_VERSION = 4;

/** Cell height in degrees of latitude (~222 m). */
export const AREA_LAT_STEP_DEG = 0.002;
/** Half the diagonal of a cell, rounded up: no pin is further than this from its cell's centre. */
export const AREA_CELL_REACH_M = 160;

/**
 * Coverage from the vector tiles (the primary source). Every z14 tile that
 * the bounding box of a circle of `TILE_COVER_RADIUS_M` around the cell
 * centre touches is fetched, so:
 *
 *   every pin has ALL buildings within at least 600 m (`TILE_MIN_MARGIN_M`)
 *   in every direction: 760 m minus the 160 m a pin can be from the centre.
 *
 * Buildings further out are kept as far as the fetched tiles happen to hold
 * them, up to `TILE_KEEP_RADIUS_M` from the centre (the skyline looks out to
 * 1 km, and what was downloaded anyway should not be thrown away).
 */
export const TILE_COVER_RADIUS_M = 760;
export const TILE_KEEP_RADIUS_M = 800;
export const TILE_MIN_MARGIN_M = 600;

/**
 * Radius asked of the Overpass fallbacks around each cell centre, metres.
 * Smaller than the tile coverage: an Overpass query costs the server real
 * work, and it is only a stand-in.
 */
export const AREA_RADIUS_M = 500;
/**
 * With Overpass data, every pin has buildings at least this far out in all
 * directions: the fetch radius minus the reach of a cell.
 */
export const AREA_MIN_MARGIN_M = 340;

/** Keeps cells from becoming infinitely wide (in degrees) at the poles. */
const MIN_COS_LAT = 0.01;
const ROWS = Math.round(180 / AREA_LAT_STEP_DEG);

export interface FetchArea {
  /** Stable identifier, e.g. "v4:37.791:-122.4300". Also the cache key. */
  key: string;
  center: LatLng;
  /** Radius for the Overpass fallbacks (`AREA_RADIUS_M`). Tiles reach further. */
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
  // cells about as wide as they are tall, and is shrunk a hair so that a
  // whole number of columns goes round the globe: every cell is complete and
  // contains its own centre, also at the antimeridian.
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((centerLat * Math.PI) / 180));
  const cols = Math.ceil(360 / (AREA_LAT_STEP_DEG / cosLat));
  const lngStep = 360 / cols;
  const col = Math.min(cols - 1, Math.floor((lng + 180) / lngStep));
  const centerLng = (col + 0.5) * lngStep - 180;

  return {
    key: `v${AREA_SCHEMA_VERSION}:${fixed(centerLat, 3)}:${fixed(centerLng, 4)}`,
    center: { lat: centerLat, lng: centerLng },
    radiusM: AREA_RADIUS_M,
  };
}

/**
 * The fetch area for a key, or null unless `key` is exactly what
 * `fetchAreaFor` produces today for some cell: current schema version,
 * canonical formatting, and a centre that snaps back to the same key.
 *
 * This is the server's gatekeeper: only the finite set of real cells is
 * accepted, never arbitrary coordinates.
 */
export function areaFromKey(key: string): FetchArea | null {
  if (typeof key !== "string" || key.length > 40) return null;
  const centre = parseAreaKey(key);
  if (!centre || Math.abs(centre.lat) > 90 || Math.abs(centre.lng) > 180) return null;
  const area = fetchAreaFor(centre);
  return area.key === key ? area : null;
}

/**
 * The cell centre encoded in an area key of any schema version (rounded as in
 * the key), or null if the text is not shaped like a key. Does not check that
 * the cell exists; see `areaFromKey` for that.
 */
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
