/**
 * The skyline seen from the observer.
 *
 * Instead of ray-casting against every building for every sun sample, we
 * compute ONCE, for each compass direction, how high the tallest obstruction
 * reaches above the horizontal. After that "is the sun hidden?" is a single
 * array lookup: `sunAltitude < profile.elevationDeg[bin]`.
 *
 * Model: every building is a solid prism standing on flat ground, from 0 up to
 * `heightM`; the observer is a point `observerHeightM` above that same ground.
 * Each bin stores the skyline along the ray through its CENTRE azimuth.
 */
import { metersPerDegree, normalizeDeg, pointInFlatRing, wrapLngDelta } from "@/lib/geo/local";
import {
  HORIZON_BINS,
  type BuildingCollection,
  type HorizonProfile,
  type LatLng,
} from "@/lib/types";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Obstructions closer than this are treated as being this far away. */
const MIN_DISTANCE_M = 0.5;
/** Edges shorter than this (squared, m²) are ignored: repeated closing vertices etc. */
const MIN_EDGE_LENGTH_SQ = 1e-12;

export interface HorizonOptions {
  /** Number of azimuth bins. Default {@link HORIZON_BINS}. */
  binCount?: number;
  /** Building edges entirely farther away than this are ignored. Default 1000 m. */
  maxDistanceM?: number;
}

/**
 * All building geometry projected into local metres around the observer, in
 * flat typed arrays. Hierarchy: building → parts (polygons) → rings → vertices.
 * The first ring of a part is its outer boundary, the rest are holes.
 */
interface ProjectedBuildings {
  /** `[x0, y0, x1, y1, …]`, metres east / north of the observer. */
  xy: Float64Array;
  /** Ring `r` covers vertices `ringStart[r] … ringStart[r + 1] - 1`. */
  ringStart: Int32Array;
  /** Part `p` covers rings `partRingStart[p] … partRingStart[p + 1] - 1`. */
  partRingStart: Int32Array;
  /** Building `b` covers parts `buildingPartStart[b] … buildingPartStart[b + 1] - 1`. */
  buildingPartStart: Int32Array;
}

function projectBuildings(place: LatLng, buildings: BuildingCollection): ProjectedBuildings {
  const features = buildings.features;

  let vertexCount = 0;
  let ringCount = 0;
  let partCount = 0;
  for (let b = 0; b < features.length; b++) {
    const geometry = features[b].geometry;
    if (geometry.type === "Polygon") {
      partCount++;
      ringCount += geometry.coordinates.length;
      for (const ring of geometry.coordinates) vertexCount += ring.length;
    } else {
      partCount += geometry.coordinates.length;
      for (const polygon of geometry.coordinates) {
        ringCount += polygon.length;
        for (const ring of polygon) vertexCount += ring.length;
      }
    }
  }

  const xy = new Float64Array(vertexCount * 2);
  const ringStart = new Int32Array(ringCount + 1);
  const partRingStart = new Int32Array(partCount + 1);
  const buildingPartStart = new Int32Array(features.length + 1);

  const scale = metersPerDegree(place.lat);
  let vertex = 0;
  let ring = 0;
  let part = 0;

  const addPolygon = (rings: number[][][]): void => {
    partRingStart[part++] = ring;
    for (let r = 0; r < rings.length; r++) {
      const positions = rings[r];
      ringStart[ring++] = vertex;
      for (let v = 0; v < positions.length; v++) {
        xy[2 * vertex] = wrapLngDelta(positions[v][0] - place.lng) * scale.lng;
        xy[2 * vertex + 1] = (positions[v][1] - place.lat) * scale.lat;
        vertex++;
      }
    }
  };

  for (let b = 0; b < features.length; b++) {
    buildingPartStart[b] = part;
    const geometry = features[b].geometry;
    if (geometry.type === "Polygon") {
      addPolygon(geometry.coordinates);
    } else {
      for (const polygon of geometry.coordinates) addPolygon(polygon);
    }
  }
  buildingPartStart[features.length] = part;
  partRingStart[part] = ring;
  ringStart[ring] = vertex;

  return { xy, ringStart, partRingStart, buildingPartStart };
}

/** Is the observer (the local origin) inside the building's footprint, holes excluded? */
function containsOrigin(geometry: ProjectedBuildings, building: number): boolean {
  const { xy, ringStart, partRingStart, buildingPartStart } = geometry;
  for (let p = buildingPartStart[building]; p < buildingPartStart[building + 1]; p++) {
    const firstRing = partRingStart[p];
    const endRing = partRingStart[p + 1];
    if (firstRing === endRing) continue;
    if (!pointInFlatRing(0, 0, xy, ringStart[firstRing], ringStart[firstRing + 1])) continue;
    let inHole = false;
    for (let r = firstRing + 1; r < endRing && !inHole; r++) {
      inHole = pointInFlatRing(0, 0, xy, ringStart[r], ringStart[r + 1]);
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Compute the skyline around `place` for an observer `observerHeightM` above
 * the ground.
 *
 * - A building whose footprint contains the observer is excluded (the observer
 *   is taken to be on its roof or facade); the first such building is reported
 *   as `containingBuildingIndex`. A point in a courtyard HOLE is not inside the
 *   building, so the surrounding walls do block.
 * - Buildings no taller than the observer contribute nothing.
 * - Each bin holds the highest elevation angle found along the ray through the
 *   bin's centre azimuth, with the index of and distance to that obstruction.
 *   Ties keep the building that comes first in the collection.
 * - A building part so narrow or distant that it slips between two neighbouring
 *   bin-centre rays (it subtends less than one bin) would otherwise vanish; it
 *   is registered on the single bin containing its nearest point instead.
 */
export function computeHorizonProfile(
  place: LatLng,
  buildings: BuildingCollection,
  observerHeightM: number,
  options: HorizonOptions = {},
): HorizonProfile {
  const binCount = options.binCount ?? HORIZON_BINS;
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new RangeError(`binCount must be a positive integer, got ${binCount}`);
  }
  const maxDistanceM = options.maxDistanceM ?? 1000;
  const maxDistanceSq = maxDistanceM * maxDistanceM;

  // Maxima are tracked in float64 so that ties are broken exactly (first
  // building wins); they are narrowed to float32 once at the end.
  const best = new Float64Array(binCount);
  const bestDistance = new Float64Array(binCount);
  const blockerIndex = new Int32Array(binCount).fill(-1);

  const features = buildings.features;
  const geometry = projectBuildings(place, buildings);
  const { xy, ringStart, partRingStart, buildingPartStart } = geometry;

  // Unit vectors of the bin-centre rays (x east, y north).
  const binWidthDeg = 360 / binCount;
  const rayX = new Float64Array(binCount);
  const rayY = new Float64Array(binCount);
  for (let bin = 0; bin < binCount; bin++) {
    const azimuth = (bin + 0.5) * binWidthDeg * DEG_TO_RAD;
    rayX[bin] = Math.sin(azimuth);
    rayY[bin] = Math.cos(azimuth);
  }

  let containingBuildingIndex = -1;

  for (let b = 0; b < features.length; b++) {
    if (containsOrigin(geometry, b)) {
      if (containingBuildingIndex === -1) containingBuildingIndex = b;
      continue;
    }

    const rise = features[b].properties.heightM - observerHeightM;
    if (!(rise > 0) || !Number.isFinite(rise)) continue;

    for (let p = buildingPartStart[b]; p < buildingPartStart[b + 1]; p++) {
      // How many bin-centre rays hit this part, and its nearest point overall
      // (used only if no ray hits it).
      let hits = 0;
      let nearestSq = Infinity;
      let nearestX = 0;
      let nearestY = 0;

      for (let r = partRingStart[p]; r < partRingStart[p + 1]; r++) {
        const start = ringStart[r];
        const count = ringStart[r + 1] - start;
        if (count < 2) continue;

        // Walk the ring as a closed loop. For a GeoJSON ring (first vertex
        // repeated at the end) the wrap-around edge is zero-length and skipped.
        let ax = xy[2 * (start + count - 1)];
        let ay = xy[2 * (start + count - 1) + 1];
        for (let v = 0; v < count; v++) {
          const bx = xy[2 * (start + v)];
          const by = xy[2 * (start + v) + 1];
          const ex = bx - ax;
          const ey = by - ay;
          const lengthSq = ex * ex + ey * ey;
          // Twice the signed area of (observer, a, b): > 0 when b is
          // counter-clockwise from a, i.e. at a SMALLER compass bearing.
          const cross = ax * by - ay * bx;

          // Skip degenerate edges and edges seen exactly end-on (they subtend
          // no angle; the neighbouring edges cover their end points).
          if (lengthSq >= MIN_EDGE_LENGTH_SQ && cross !== 0) {
            // Nearest point of the segment to the observer.
            let t = -(ax * ex + ay * ey) / lengthSq;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const nx = ax + t * ex;
            const ny = ay + t * ey;
            const distanceSq = nx * nx + ny * ny;

            if (distanceSq <= maxDistanceSq) {
              if (distanceSq < nearestSq) {
                nearestSq = distanceSq;
                nearestX = nx;
                nearestY = ny;
              }

              // Azimuth interval subtended by the edge, clockwise from `from`.
              // An edge that does not pass through the observer subtends less
              // than 180°, so the short way round is always the right one, and
              // the sign of `cross` says which end comes first.
              const azimuthA = Math.atan2(ax, ay) * RAD_TO_DEG;
              const azimuthB = Math.atan2(bx, by) * RAD_TO_DEG;
              let width = Math.abs(azimuthB - azimuthA);
              if (width > 180) width = 360 - width;
              const from = normalizeDeg(cross < 0 ? azimuthA : azimuthB);

              // Bins whose centre azimuth (k + 0.5) * binWidth lies in
              // [from, from + width]; k may run past binCount (wrap through north).
              const firstBin = Math.ceil(from / binWidthDeg - 0.5);
              const lastBin = Math.floor((from + width) / binWidthDeg - 0.5);
              const aCrossE = ax * ey - ay * ex;
              for (let k = firstBin; k <= lastBin; k++) {
                const bin = k % binCount;
                // Ray s·u meets the edge's line where s = (a × e) / (u × e).
                const distance = aCrossE / (rayX[bin] * ey - rayY[bin] * ex);
                if (!(distance > 0) || distance === Infinity) continue;
                hits++;
                const clamped = distance < MIN_DISTANCE_M ? MIN_DISTANCE_M : distance;
                const elevation = Math.atan2(rise, clamped) * RAD_TO_DEG;
                if (elevation > best[bin]) {
                  best[bin] = elevation;
                  bestDistance[bin] = clamped;
                  blockerIndex[bin] = b;
                }
              }
            }
          }

          ax = bx;
          ay = by;
        }
      }

      // Thin / distant part that fell between bin centres: keep it visible on
      // the bin its nearest point lies in.
      if (hits === 0 && nearestSq !== Infinity) {
        const azimuth = normalizeDeg(Math.atan2(nearestX, nearestY) * RAD_TO_DEG);
        const bin = Math.min(binCount - 1, Math.floor(azimuth / binWidthDeg));
        const clamped = Math.max(Math.sqrt(nearestSq), MIN_DISTANCE_M);
        const elevation = Math.atan2(rise, clamped) * RAD_TO_DEG;
        if (elevation > best[bin]) {
          best[bin] = elevation;
          bestDistance[bin] = clamped;
          blockerIndex[bin] = b;
        }
      }
    }
  }

  return {
    binCount,
    elevationDeg: Float32Array.from(best),
    blockerIndex,
    blockerDistanceM: Float32Array.from(bestDistance),
    containingBuildingIndex,
  };
}

/**
 * Index of the bin covering `azimuthDeg` (any real number of degrees; it is
 * normalised first). Returns -1 for a non-finite azimuth.
 */
export function horizonBinFor(profile: HorizonProfile, azimuthDeg: number): number {
  if (!Number.isFinite(azimuthDeg)) return -1;
  const bin = Math.floor((normalizeDeg(azimuthDeg) * profile.binCount) / 360);
  return bin >= profile.binCount ? profile.binCount - 1 : bin;
}

/** Skyline elevation angle, degrees, in the direction `azimuthDeg` (0 = open sky). */
export function horizonElevationAt(profile: HorizonProfile, azimuthDeg: number): number {
  const bin = horizonBinFor(profile, azimuthDeg);
  return bin < 0 ? 0 : profile.elevationDeg[bin];
}
