/**
 * The skyline formed by the ground itself: slopes, hills and mountains.
 *
 * For every compass direction a ray is marched outward from the observer over
 * the elevation grids, and the steepest line of sight to the ground is kept.
 */
import type { Terrain } from "@/lib/types";

import { elevationAt, gridContains } from "./elevation";

const DEG_TO_RAD = Math.PI / 180;

/** Mean Earth radius, metres. */
const EARTH_RADIUS_M = 6_371_000;
/**
 * Standard terrestrial refraction coefficient: light bends along about 13% of
 * the Earth's curvature, so distant ground appears to drop by only
 * (1 − 0.13)·d²/2R below the observer's horizontal plane.
 */
const REFRACTION_COEFFICIENT = 0.13;
/** Apparent drop of the ground per metre² of distance (curvature less refraction). */
export const CURVATURE_DROP_PER_M2 = (1 - REFRACTION_COEFFICIENT) / (2 * EARTH_RADIUS_M);

/**
 * Ground closer than this is ignored (never less than one cell of the fine
 * grid): the elevation model cannot resolve the observer's immediate
 * surroundings, and a bump two metres away is not a hill.
 */
const MIN_DISTANCE_M = 5;
/** Sample spacing grows with distance: never finer than one cell, nor than 1% of the range. */
const STEP_GROWTH = 0.01;

export interface TerrainSkyline {
  /**
   * Per azimuth bin, the steepest slope (rise / distance = tan of the
   * elevation angle) of a line of sight that touches the ground, or 0 where
   * the ground never rises above the observer's horizontal.
   */
  slope: Float64Array;
  /** Horizontal distance of that ground point, metres (0 where slope is 0). */
  distanceM: Float64Array;
}

/**
 * March the bin-centre rays (bin `i` looks along azimuth `(i + 0.5)·360/binCount`)
 * over the terrain, from an observer standing at local (observerX, observerY)
 * of the terrain's frame, `observerHeightM` above the ground there.
 *
 * Rises are measured relative to the ground under the observer, lowered by the
 * Earth's curvature (with standard refraction) — negligible within a
 * kilometre, 7 m at 10 km.
 */
export function computeTerrainSkyline(
  terrain: Terrain,
  observerX: number,
  observerY: number,
  observerHeightM: number,
  binCount: number,
): TerrainSkyline {
  const { near, far } = terrain;
  const slope = new Float64Array(binCount);
  const distanceM = new Float64Array(binCount);

  const observerGround =
    gridContains(near, observerX, observerY) || far === undefined
      ? elevationAt(near, observerX, observerY)
      : elevationAt(far, observerX, observerY);
  const startM = Math.max(MIN_DISTANCE_M, near.cellSizeM);
  const binWidthRad = (360 / binCount) * DEG_TO_RAD;

  for (let bin = 0; bin < binCount; bin++) {
    const azimuth = (bin + 0.5) * binWidthRad;
    const ux = Math.sin(azimuth);
    const uy = Math.cos(azimuth);
    let best = 0;
    let bestDistance = 0;

    for (let d = startM; ;) {
      const x = observerX + d * ux;
      const y = observerY + d * uy;
      let ground: number;
      let cell: number;
      if (gridContains(near, x, y)) {
        ground = elevationAt(near, x, y);
        cell = near.cellSizeM;
      } else if (far !== undefined && gridContains(far, x, y)) {
        ground = elevationAt(far, x, y);
        cell = far.cellSizeM;
      } else {
        break; // beyond all terrain data
      }
      const rise = ground - observerGround - CURVATURE_DROP_PER_M2 * d * d - observerHeightM;
      if (rise > best * d) {
        best = rise / d;
        bestDistance = d;
      }
      const growth = d * STEP_GROWTH;
      d += growth > cell ? growth : cell;
    }

    slope[bin] = best;
    distanceM[bin] = bestDistance;
  }

  return { slope, distanceM };
}
