/**
 * Local tangent-plane geometry.
 *
 * Everything the engine does happens within a kilometre or so of the pinned
 * place, so we work in a flat east/north frame centred on it:
 *
 *   x = metres east of the origin, y = metres north of the origin.
 *
 * The projection is equirectangular, scaled with the WGS84 radii of curvature
 * at the origin latitude (rather than a mean-sphere radius) so that the two
 * axes are not mis-scaled against each other — over 1 km the error is well
 * under a centimetre and bearings are exact to ~0.001°.
 */
import type { LatLng } from "@/lib/types";

const DEG = Math.PI / 180;
/** WGS84 semi-major axis, metres. */
const WGS84_A = 6378137;
/** WGS84 first eccentricity squared. */
const WGS84_E2 = 0.00669437999014;

/** Metres spanned by one degree of latitude / longitude at `latDeg`. */
export function metersPerDegree(latDeg: number): { lat: number; lng: number } {
  const phi = latDeg * DEG;
  const sinPhi = Math.sin(phi);
  const w2 = 1 - WGS84_E2 * sinPhi * sinPhi;
  const w = Math.sqrt(w2);
  const meridional = (WGS84_A * (1 - WGS84_E2)) / (w2 * w);
  const primeVertical = WGS84_A / w;
  return {
    lat: meridional * DEG,
    // Never exactly 0, so the inverse projection stays finite at the poles.
    lng: Math.max(primeVertical * Math.cos(phi) * DEG, 1e-9),
  };
}

/** Wrap a longitude difference into [-180, 180). */
export function wrapLngDelta(dLng: number): number {
  return ((((dLng + 180) % 360) + 360) % 360) - 180;
}

/** Position of `p` relative to `origin`, metres (x east, y north). */
export function toLocalMeters(origin: LatLng, p: LatLng): { x: number; y: number } {
  const scale = metersPerDegree(origin.lat);
  return {
    x: wrapLngDelta(p.lng - origin.lng) * scale.lng,
    y: (p.lat - origin.lat) * scale.lat,
  };
}

/** Inverse of {@link toLocalMeters}. */
export function fromLocalMeters(origin: LatLng, x: number, y: number): LatLng {
  const scale = metersPerDegree(origin.lat);
  return {
    lat: origin.lat + y / scale.lat,
    lng: origin.lng + x / scale.lng,
  };
}

/** Normalise an angle in degrees to [0, 360). */
export function normalizeDeg(d: number): number {
  const r = d % 360;
  if (r < 0) {
    // A tiny negative such as -1e-17 rounds up to exactly 360 here.
    const wrapped = r + 360;
    return wrapped >= 360 ? 0 : wrapped;
  }
  // Values already in range come back bit-for-bit unchanged (and -0 as +0).
  return r === 0 ? 0 : r;
}

/** Smallest absolute difference between two directions, degrees, in [0, 180]. */
export function angularDistanceDeg(a: number, b: number): number {
  const d = normalizeDeg(a - b);
  return d > 180 ? 360 - d : d;
}

/**
 * Compass bearing (0 = north, 90 = east, clockwise) of the local vector
 * (x east, y north), in [0, 360). The zero vector has bearing 0.
 */
export function bearingDeg(x: number, y: number): number {
  return normalizeDeg(Math.atan2(x, y) / DEG);
}

/** A ring as a list of `[x, y]` positions (extra ordinates are ignored). */
export type Ring = ArrayLike<ArrayLike<number>>;

/**
 * Even-odd (ray casting) test: is the point strictly inside the ring?
 * The ring may be open or closed (first vertex repeated at the end); its
 * winding order does not matter. Points exactly on the boundary may land on
 * either side.
 */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Same as {@link pointInRing} for a ring stored in a flat coordinate array
 * `[x0, y0, x1, y1, …]`, covering vertices `start` (inclusive) to `end`
 * (exclusive). Indices are in VERTICES, not array elements.
 */
export function pointInFlatRing(
  x: number,
  y: number,
  coords: ArrayLike<number>,
  start = 0,
  end = coords.length >> 1,
): boolean {
  let inside = false;
  for (let i = start, j = end - 1; i < end; j = i++) {
    const xi = coords[2 * i];
    const yi = coords[2 * i + 1];
    const xj = coords[2 * j];
    const yj = coords[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * GeoJSON-style polygon test: `rings[0]` is the outer boundary, any further
 * rings are holes. A point inside a hole is NOT inside the polygon.
 */
export function pointInPolygon(x: number, y: number, rings: ArrayLike<Ring>): boolean {
  if (rings.length === 0 || !pointInRing(x, y, rings[0])) return false;
  for (let r = 1; r < rings.length; r++) {
    if (pointInRing(x, y, rings[r])) return false;
  }
  return true;
}

/** GeoJSON-style MultiPolygon test: inside any of the member polygons. */
export function pointInMultiPolygon(
  x: number,
  y: number,
  polygons: ArrayLike<ArrayLike<Ring>>,
): boolean {
  for (let p = 0; p < polygons.length; p++) {
    if (pointInPolygon(x, y, polygons[p])) return true;
  }
  return false;
}
