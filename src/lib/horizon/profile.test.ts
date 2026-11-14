import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { real } from "@/lib/geo/testing";

import { toLocalMeters } from "@/lib/geo/local";
import { HORIZON_BINS, type BuildingFeature, type HorizonProfile, type LatLng } from "@/lib/types";

import { computeHorizonProfile, horizonBinFor, horizonElevationAt } from "./profile";
import {
  buildingFromLocal,
  collectionOf,
  loadPacificHeights,
  PACIFIC_HEIGHTS,
  rect,
  rotatedRect,
  type LocalPolygon,
  type LocalRing,
} from "./testing";

const DEG = Math.PI / 180;
const PLACE: LatLng = { lat: 37.7906, lng: -122.4294 };
/** Multiply the property-test run counts, e.g. `FC_SCALE=50` for a deep soak. */
const SCALE = Number(process.env.FC_SCALE ?? 1);
const atanDeg = (rise: number, run: number) => Math.atan2(rise, run) / DEG;

// ─── Independent brute-force reference ─────────────────────────────────────
//
// Works directly on local-metre geometry with the plainest possible maths:
// cast one ray, intersect it with every edge of every building by solving the
// 2×2 linear system, keep the steepest hit. No binning, no azimuth intervals,
// no typed arrays, and a different point-in-polygon method (winding angle).

interface RefBuilding {
  polygons: LocalPolygon[];
  heightM: number;
}

/** Edges of a ring as [p, q] pairs, closing the ring if it is not closed. */
function edgesOf(ring: LocalRing): [[number, number], [number, number]][] {
  const edges: [[number, number], [number, number]][] = [];
  for (let i = 0; i + 1 < ring.length; i++) edges.push([ring[i], ring[i + 1]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) edges.push([last, first]);
  return edges;
}

/** Winding number of a ring around the origin (sum of subtended angles / 2π). */
function windingNumber(ring: LocalRing): number {
  let total = 0;
  for (const [p, q] of edgesOf(ring)) {
    total += Math.atan2(p[0] * q[1] - p[1] * q[0], p[0] * q[0] + p[1] * q[1]);
  }
  return Math.round(total / (2 * Math.PI));
}

function refPolygonContainsOrigin(polygon: LocalPolygon): boolean {
  if (windingNumber(polygon[0]) === 0) return false;
  return polygon.slice(1).every((hole) => windingNumber(hole) === 0);
}

function refContainsOrigin(building: RefBuilding): boolean {
  return building.polygons.some(refPolygonContainsOrigin);
}

/** Distance along the ray at `azimuthDeg` to the nearest hit on a polygon's edges, or null. */
function refRayHitDistance(polygon: LocalPolygon, azimuthDeg: number): number | null {
  const ux = Math.sin(azimuthDeg * DEG);
  const uy = Math.cos(azimuthDeg * DEG);
  let nearest: number | null = null;
  for (const ring of polygon) {
    for (const [p, q] of edgesOf(ring)) {
      // p + t (q − p) = s u   ⇔   t·ex − s·ux = −px ,  t·ey − s·uy = −py
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const det = ex * -uy - -ux * ey;
      if (Math.abs(det) < 1e-14) continue; // parallel
      const t = (-p[0] * -uy - -ux * -p[1]) / det;
      const s = (ex * -p[1] - ey * -p[0]) / det;
      if (t < 0 || t > 1 || s <= 0) continue;
      if (nearest === null || s < nearest) nearest = s;
    }
  }
  return nearest;
}

/** Nearest point of a polygon's boundary to the origin. */
function refNearestBoundaryPoint(polygon: LocalPolygon): {
  x: number;
  y: number;
  distance: number;
} {
  let best = { x: 0, y: 0, distance: Infinity };
  for (const ring of polygon) {
    for (const [p, q] of edgesOf(ring)) {
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const lengthSq = ex * ex + ey * ey;
      const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(p[0] * ex + p[1] * ey) / lengthSq));
      const x = p[0] + t * ex;
      const y = p[1] + t * ey;
      const distance = Math.hypot(x, y);
      if (distance < best.distance) best = { x, y, distance };
    }
  }
  return best;
}

interface RefHit {
  elevationDeg: number;
  buildingIndex: number;
  distanceM: number;
}

/** The skyline along one ray: the steepest obstruction over all buildings. */
function refSkyline(buildings: RefBuilding[], azimuthDeg: number, observerHeightM: number): RefHit {
  let best: RefHit = { elevationDeg: 0, buildingIndex: -1, distanceM: 0 };
  buildings.forEach((building, buildingIndex) => {
    if (building.heightM <= observerHeightM || refContainsOrigin(building)) return;
    for (const polygon of building.polygons) {
      const hit = refRayHitDistance(polygon, azimuthDeg);
      if (hit === null) continue;
      const distanceM = Math.max(hit, 0.5);
      const elevationDeg = atanDeg(building.heightM - observerHeightM, distanceM);
      if (elevationDeg > best.elevationDeg) best = { elevationDeg, buildingIndex, distanceM };
    }
  });
  return best;
}

function toFeatures(place: LatLng, buildings: RefBuilding[]): BuildingFeature[] {
  return buildings.map((b, i) => buildingFromLocal(place, b.polygons, b.heightM, `way/${i}`));
}

function binOfBearing(x: number, y: number, binCount: number): number {
  const bearing = (((Math.atan2(x, y) / DEG) % 360) + 360) % 360;
  return Math.min(binCount - 1, Math.floor(bearing / (360 / binCount)));
}

/** Plain assertion for hot loops (vitest's `expect` is slow when called a million times). */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Compare a profile with the brute-force reference in EVERY bin.
 *
 * At each bin centre the profile must equal the reference, with one documented
 * exception: a building part that no bin-centre ray hits at all ("sub-bin": it
 * is narrower than a bin as seen from the observer) is kept visible on the bin
 * containing its nearest point. Returns how many such parts there were.
 */
function expectMatchesReference(
  profile: HorizonProfile,
  buildings: RefBuilding[],
  observerHeightM: number,
): { subBinParts: number; blockedBins: number } {
  const { binCount } = profile;
  const tolerance = 1e-4; // float32 storage + projection round trip
  const binWidth = 360 / binCount;

  // Which parts does the reference hit with at least one bin-centre ray?
  const obstructing = buildings.map((b) => b.heightM > observerHeightM && !refContainsOrigin(b));
  // expectedFallback[bin] = steepest sub-bin part registered on that bin.
  const fallback = new Map<number, { elevationDeg: number; buildingIndex: number }[]>();
  let subBinParts = 0;
  buildings.forEach((building, buildingIndex) => {
    if (!obstructing[buildingIndex]) return;
    for (const polygon of building.polygons) {
      let hit = false;
      for (let bin = 0; bin < binCount && !hit; bin++) {
        hit = refRayHitDistance(polygon, (bin + 0.5) * binWidth) !== null;
      }
      if (hit) continue;
      subBinParts++;
      const nearest = refNearestBoundaryPoint(polygon);
      const bin = binOfBearing(nearest.x, nearest.y, binCount);
      // If that nearest point sits (almost) exactly on the boundary between two
      // bins, which of them gets the part is a rounding coin-flip the reference
      // cannot predict: discard such knife-edge scenes (fast-check shrinks
      // towards them, e.g. a speck centred exactly due east). The margin allows
      // for the lat/lng round trip: ~1e-9 m of noise on the ends of a 0.1 m
      // wall seen face-on moves its nearest point by ~1e-6° of bearing.
      const bearing = (Math.atan2(nearest.x, nearest.y) / DEG + 360) % 360;
      const intoBin = (bearing / binWidth) % 1;
      fc.pre(Math.min(intoBin, 1 - intoBin) * binWidth > 1e-4);
      const elevationDeg = atanDeg(
        building.heightM - observerHeightM,
        Math.max(nearest.distance, 0.5),
      );
      fallback.set(bin, [...(fallback.get(bin) ?? []), { elevationDeg, buildingIndex }]);
    }
  });

  // Same as `refSkyline`, but with buildings that cannot obstruct (too low, or
  // containing the observer — neither depends on the azimuth) blanked out once
  // instead of being re-tested for every ray.
  const candidates = buildings.map((b, i) => (obstructing[i] ? b : { polygons: [], heightM: -1 }));

  let blockedBins = 0;
  for (let bin = 0; bin < binCount; bin++) {
    const reference = refSkyline(candidates, (bin + 0.5) * binWidth, observerHeightM);
    let expected = reference.elevationDeg;
    let expectedFromFallback = false;
    for (const candidate of fallback.get(bin) ?? []) {
      if (candidate.elevationDeg > expected) {
        expected = candidate.elevationDeg;
        expectedFromFallback = true;
      }
    }

    const actual = profile.elevationDeg[bin];
    const where = `bin ${bin} (azimuth ${(bin + 0.5) * binWidth}°)`;
    check(
      Math.abs(actual - expected) <= tolerance,
      `${where}: profile ${actual}°, reference ${expected}°`,
    );
    check(actual >= 0, `${where}: negative elevation`);

    const blocker = profile.blockerIndex[bin];
    const distance = profile.blockerDistanceM[bin];
    if (expected === 0) {
      check(blocker === -1, `${where}: open sky but blocker ${blocker}`);
      check(distance === 0, `${where}: open sky but distance ${distance}`);
      continue;
    }
    blockedBins++;
    check(blocker >= 0 && obstructing[blocker], `${where}: impossible blocker ${blocker}`);
    if (!expectedFromFallback) {
      // The named blocker really is (one of) the steepest along this ray, and
      // the stored distance is the distance to it.
      const alone = refSkyline([buildings[blocker]], (bin + 0.5) * binWidth, observerHeightM);
      check(
        Math.abs(alone.elevationDeg - reference.elevationDeg) < tolerance,
        `${where}: blocker ${blocker} only reaches ${alone.elevationDeg}°`,
      );
      // Consistent with its own elevation…
      check(
        Math.abs(atanDeg(buildings[blocker].heightM - observerHeightM, distance) - actual) < 1e-3,
        `${where}: distance ${distance} m does not give ${actual}°`,
      );
      // …and, unless two buildings tie, equal to the reference distance.
      if (blocker === reference.buildingIndex) {
        check(
          Math.abs(distance - reference.distanceM) < 1e-3 + 1e-5 * reference.distanceM,
          `${where}: distance ${distance} m, reference ${reference.distanceM} m`,
        );
      }
    }
  }
  return { subBinParts, blockedBins };
}

/** Smallest distance from the observer to any building edge (to skip knife-edge scenes). */
function minBoundaryDistance(buildings: RefBuilding[]): number {
  let min = Infinity;
  for (const b of buildings) {
    for (const polygon of b.polygons) {
      min = Math.min(min, refNearestBoundaryPoint(polygon).distance);
    }
  }
  return min;
}

// ─── Generators ────────────────────────────────────────────────────────────

const coordinate = (limit: number) => real(-limit, limit);
const span = (min: number, max: number) => real(min, max);

/** A rotated rectangle wide enough (≥ 3 m) to span at least one bin within ~250 m. */
const rectBuilding = (limit: number, minHalf: number, maxHalf: number) =>
  fc
    .record({
      cx: coordinate(limit),
      cy: coordinate(limit),
      halfWidth: span(minHalf, maxHalf),
      halfHeight: span(minHalf, maxHalf),
      rotation: span(0, 180),
      heightM: span(1, 80),
    })
    .map((r): RefBuilding => ({
      polygons: [[rotatedRect(r.cx, r.cy, r.halfWidth, r.halfHeight, r.rotation)]],
      heightM: r.heightM,
    }));

/** A star-shaped (possibly concave) polygon that contains a disc of radius ≥ 2.3 m. */
const starBuilding = fc
  .record({
    cx: coordinate(150),
    cy: coordinate(150),
    spokes: fc.array(fc.record({ radius: span(4, 25), jitter: span(0, 0.5) }), {
      minLength: 5,
      maxLength: 9,
    }),
    heightM: span(1, 80),
  })
  .map((s): RefBuilding => {
    const ring: LocalRing = s.spokes.map(({ radius, jitter }, i) => {
      const angle = ((i + jitter) / s.spokes.length) * 2 * Math.PI;
      return [s.cx + radius * Math.cos(angle), s.cy + radius * Math.sin(angle)];
    });
    ring.push([ring[0][0], ring[0][1]]);
    return { polygons: [[ring]], heightM: s.heightM };
  });

/** A block with a courtyard: a rotated rectangle with a rectangular hole. */
const courtyardBuilding = fc
  .record({
    cx: coordinate(150),
    cy: coordinate(150),
    halfWidth: span(6, 30),
    halfHeight: span(6, 30),
    holeFraction: span(0.3, 0.7),
    rotation: span(0, 180),
    heightM: span(1, 80),
  })
  .map((c): RefBuilding => ({
    polygons: [
      [
        rotatedRect(c.cx, c.cy, c.halfWidth, c.halfHeight, c.rotation),
        // Holes wind the other way in GeoJSON; winding must not matter.
        rotatedRect(
          c.cx,
          c.cy,
          c.halfWidth * c.holeFraction,
          c.halfHeight * c.holeFraction,
          c.rotation,
        ).reverse() as LocalRing,
      ],
    ],
    heightM: c.heightM,
  }));

/** Two separate rectangles forming one MultiPolygon building. */
const multiPartBuilding = fc
  .tuple(rectBuilding(150, 1.5, 25), rectBuilding(150, 1.5, 25))
  .map(([a, b]): RefBuilding => ({ polygons: [...a.polygons, ...b.polygons], heightM: a.heightM }));

const solidBuilding = fc.oneof(
  { weight: 4, arbitrary: rectBuilding(150, 1.5, 25) },
  { weight: 2, arbitrary: starBuilding },
  { weight: 2, arbitrary: courtyardBuilding },
  { weight: 1, arbitrary: multiPartBuilding },
);

const observerHeight = fc.oneof(fc.constant(0), span(0, 30));

// ─── Hand-computed cases ───────────────────────────────────────────────────

describe("computeHorizonProfile: hand-computed cases", () => {
  const profileOf = (
    buildings: RefBuilding[],
    observerHeightM = 0,
    options?: { binCount?: number; maxDistanceM?: number },
  ) =>
    computeHorizonProfile(
      PLACE,
      collectionOf(toFeatures(PLACE, buildings)),
      observerHeightM,
      options,
    );

  // A long 10 m wall whose near face is 10 m due south of the observer.
  const southWall: RefBuilding = { polygons: [[rect(-20, -12, 20, -10)]], heightM: 10 };

  test("empty collection: open sky everywhere", () => {
    const profile = profileOf([]);
    expect(profile.binCount).toBe(HORIZON_BINS);
    expect(profile.elevationDeg).toBeInstanceOf(Float32Array);
    expect(profile.blockerIndex).toBeInstanceOf(Int32Array);
    expect(profile.blockerDistanceM).toBeInstanceOf(Float32Array);
    expect(profile.elevationDeg.length).toBe(720);
    expect(profile.blockerIndex.length).toBe(720);
    expect(profile.blockerDistanceM.length).toBe(720);
    expect(profile.elevationDeg.every((e) => e === 0)).toBe(true);
    expect(profile.blockerIndex.every((i) => i === -1)).toBe(true);
    expect(profile.blockerDistanceM.every((d) => d === 0)).toBe(true);
    expect(profile.containingBuildingIndex).toBe(-1);
  });

  test("a 10 m wall 10 m due south of a ground observer rises to 45°", () => {
    const profile = profileOf([southWall]);
    // Bin centres are at …179.75°, 180.25°…; along those rays the wall is
    // 10 / cos(0.25°) m away, i.e. 0.0003° short of 45°.
    expect(horizonElevationAt(profile, 180)).toBeCloseTo(45, 2);
    expect(horizonElevationAt(profile, 179.9)).toBeCloseTo(45, 2);
    const bin = horizonBinFor(profile, 180);
    expect(profile.blockerIndex[bin]).toBe(0);
    expect(profile.blockerDistanceM[bin]).toBeCloseTo(10, 3);
    // Oblique rays meet the wall farther away: 45° off-axis it is 10√2 m. The
    // bin holding azimuth 135° is sampled at its centre, 135.25° (44.75° off-axis).
    expect(horizonElevationAt(profile, 135)).toBeCloseTo(
      atanDeg(10, 10 / Math.cos(44.75 * DEG)),
      3,
    );
    expect(horizonElevationAt(profile, 135)).toBeCloseTo(atanDeg(10, 10 * Math.SQRT2), 0);
    // The wall ends at x = ±20 m → it spans azimuths 180° ± atan(20/10) = ±63.43°.
    expect(horizonElevationAt(profile, 180 - 63)).toBeGreaterThan(0);
    expect(horizonElevationAt(profile, 180 + 63)).toBeGreaterThan(0);
    expect(horizonElevationAt(profile, 180 - 64)).toBe(0);
    expect(horizonElevationAt(profile, 180 + 64)).toBe(0);
    // Nothing to the north.
    expect(horizonElevationAt(profile, 0)).toBe(0);
    expect(horizonElevationAt(profile, 90)).toBe(0);
    expect(horizonElevationAt(profile, 270)).toBe(0);
    expectMatchesReference(profile, [southWall], 0);
  });

  test("raising the observer to 4 m lowers that wall to atan(6/10)", () => {
    const profile = profileOf([southWall], 4);
    expect(horizonElevationAt(profile, 180)).toBeCloseTo(atanDeg(6, 10), 2);
    expect(atanDeg(6, 10)).toBeCloseTo(30.964, 3);
    expectMatchesReference(profile, [southWall], 4);
  });

  test("buildings no taller than the observer contribute nothing", () => {
    expect(profileOf([southWall], 10).elevationDeg.every((e) => e === 0)).toBe(true);
    expect(profileOf([southWall], 10).blockerIndex.every((i) => i === -1)).toBe(true);
    expect(profileOf([southWall], 25).elevationDeg.every((e) => e === 0)).toBe(true);
    expect(horizonElevationAt(profileOf([southWall], 9.99), 180)).toBeGreaterThan(0);
  });

  test("a wall crossing due north wraps around correctly", () => {
    // 10 m wide, 20 m to the north: spans azimuths ±atan(5/20) = ±14.04°.
    const northWall: RefBuilding = { polygons: [[rect(-5, 20, 5, 22)]], heightM: 10 };
    const profile = profileOf([northWall]);
    expect(horizonElevationAt(profile, 0)).toBeCloseTo(atanDeg(10, 20), 2);
    expect(horizonElevationAt(profile, 359.9)).toBeCloseTo(atanDeg(10, 20), 2);
    expect(horizonElevationAt(profile, 0.1)).toBeCloseTo(atanDeg(10, 20), 2);
    expect(horizonElevationAt(profile, 13.9)).toBeGreaterThan(0);
    expect(horizonElevationAt(profile, 346.1)).toBeGreaterThan(0);
    expect(horizonElevationAt(profile, 14.6)).toBe(0);
    expect(horizonElevationAt(profile, 345.4)).toBe(0);
    expect(horizonElevationAt(profile, 180)).toBe(0);
    // Bin centres within ±14.036°: 0.25°, 0.75°, … 13.75° on each side → 2 × 28.
    const blocked = Array.from(profile.elevationDeg).filter((e) => e > 0).length;
    expect(blocked).toBe(56);
    expectMatchesReference(profile, [northWall], 0);
  });

  test("the profile is symmetric for a symmetric scene", () => {
    const profile = profileOf([southWall, { polygons: [[rect(-5, 20, 5, 22)]], heightM: 10 }]);
    for (let bin = 0; bin < 360; bin++) {
      // Mirror east ↔ west: bin centre a ↔ 360 − a.
      expect(profile.elevationDeg[bin]).toBeCloseTo(profile.elevationDeg[719 - bin], 4);
    }
  });

  test("observer inside a building: that building is excluded and reported", () => {
    const home: RefBuilding = { polygons: [[rect(-6, -6, 6, 6)]], heightM: 9 };
    const alone = profileOf([home]);
    expect(alone.containingBuildingIndex).toBe(0);
    expect(alone.elevationDeg.every((e) => e === 0)).toBe(true);
    expect(alone.blockerIndex.every((i) => i === -1)).toBe(true);

    // Other buildings still block, and indices still refer to the collection.
    const withNeighbour = profileOf([southWall, home]);
    expect(withNeighbour.containingBuildingIndex).toBe(1);
    expect(horizonElevationAt(withNeighbour, 180)).toBeCloseTo(45, 2);
    expect(withNeighbour.blockerIndex[horizonBinFor(withNeighbour, 180)]).toBe(0);
    expect(horizonElevationAt(withNeighbour, 0)).toBe(0);
    expectMatchesReference(withNeighbour, [southWall, home], 0);
  });

  test("several buildings containing the observer: first is reported, all are excluded", () => {
    const a: RefBuilding = { polygons: [[rect(-6, -6, 6, 6)]], heightM: 9 };
    const b: RefBuilding = { polygons: [[rect(-3, -8, 8, 3)]], heightM: 30 };
    const profile = profileOf([southWall, a, b]);
    expect(profile.containingBuildingIndex).toBe(1);
    expect(horizonElevationAt(profile, 180)).toBeCloseTo(45, 2);
    expect(Array.from(profile.blockerIndex).every((i) => i === -1 || i === 0)).toBe(true);
    expect(horizonElevationAt(profile, 45)).toBe(0);
  });

  test("observer in a courtyard: not 'inside' the building, and walled in on all sides", () => {
    const block: RefBuilding = {
      polygons: [[rect(-20, -20, 20, 20), rect(-5, -5, 5, 5)]],
      heightM: 12,
    };
    const profile = profileOf([block]);
    expect(profile.containingBuildingIndex).toBe(-1);
    expect(profile.elevationDeg.every((e) => e > 0)).toBe(true);
    expect(profile.blockerIndex.every((i) => i === 0)).toBe(true);
    // Courtyard walls are 5 m away on the axes and 5√2 m away on the diagonals.
    for (const azimuth of [0, 90, 180, 270]) {
      expect(horizonElevationAt(profile, azimuth)).toBeCloseTo(atanDeg(12, 5), 1);
      expect(profile.blockerDistanceM[horizonBinFor(profile, azimuth)]).toBeCloseTo(5, 2);
    }
    for (const azimuth of [45, 135, 225, 315]) {
      expect(horizonElevationAt(profile, azimuth)).toBeCloseTo(atanDeg(12, 5 * Math.SQRT2), 0);
    }
    expectMatchesReference(profile, [block], 0);

    // Standing in the built part of the same block IS inside it.
    const inWing = computeHorizonProfile(
      PLACE,
      collectionOf(
        toFeatures(PLACE, [
          { polygons: [[rect(-30, -20, 10, 20), rect(-15, -5, -5, 5)]], heightM: 12 },
        ]),
      ),
      0,
    );
    expect(inWing.containingBuildingIndex).toBe(0);
    expect(inWing.elevationDeg.every((e) => e === 0)).toBe(true);
  });

  test("a tall building behind a short one: the steeper one wins", () => {
    const shortNear: RefBuilding = { polygons: [[rect(-10, -12, 10, -10)]], heightM: 5 };
    const tallFar: RefBuilding = { polygons: [[rect(-10, -52, 10, -50)]], heightM: 50 };
    const profile = profileOf([shortNear, tallFar]);
    const bin = horizonBinFor(profile, 180);
    // Short: atan(5/10) = 26.6°. Tall: atan(50/50) = 45°.
    expect(profile.elevationDeg[bin]).toBeCloseTo(45, 2);
    expect(profile.blockerIndex[bin]).toBe(1);
    expect(profile.blockerDistanceM[bin]).toBeCloseTo(50, 2);
    // The far tower spans only ±11.3°; outside it the near wall (±45°) shows.
    const side = horizonBinFor(profile, 180 + 30);
    expect(profile.blockerIndex[side]).toBe(0);
    expect(profile.elevationDeg[side]).toBeCloseTo(atanDeg(5, 10 / Math.cos(30.25 * DEG)), 2);
    expectMatchesReference(profile, [shortNear, tallFar], 0);

    // And the other way round: a close low wall hides a distant tower.
    const lowClose: RefBuilding = { polygons: [[rect(-10, -7, 10, -5)]], heightM: 10 };
    const towerFar: RefBuilding = { polygons: [[rect(-10, -102, 10, -100)]], heightM: 50 };
    const other = profileOf([towerFar, lowClose]);
    const otherBin = horizonBinFor(other, 180);
    expect(other.elevationDeg[otherBin]).toBeCloseTo(atanDeg(10, 5), 2);
    expect(other.blockerIndex[otherBin]).toBe(1);
    expect(other.blockerDistanceM[otherBin]).toBeCloseTo(5, 2);
  });

  test("identical overlapping buildings: the first one is named", () => {
    const profile = profileOf([southWall, southWall]);
    expect(Array.from(profile.blockerIndex).every((i) => i === -1 || i === 0)).toBe(true);
  });

  test("a thin distant tower is never lost between bin centres", () => {
    // 1 m × 1 m, 100 m tall, 500 m away: it subtends 0.11°, a fifth of a bin.
    const towerAt = (bearingDeg: number): RefBuilding => {
      const x = 500 * Math.sin(bearingDeg * DEG);
      const y = 500 * Math.cos(bearingDeg * DEG);
      return { polygons: [[rotatedRect(x, y, 0.5, 0.5, -bearingDeg)]], heightM: 100 };
    };
    // Bin centres are at 0.25° + k·0.5°. Try bearings on a centre, exactly on a
    // bin boundary, and everywhere in between — including across north.
    const onBinBoundary = (bearing: number) => Number.isInteger(bearing * 2);
    for (const bearing of [45.25, 45, 44.9, 45.1, 45.4, 0, 359.99, 0.01, 179.75, 270.5, 123.456]) {
      const tower = towerAt(bearing);
      const profile = profileOf([tower]);
      const lit = Array.from(profile.elevationDeg)
        .map((e, bin) => ({ e, bin }))
        .filter(({ e }) => e > 0);
      expect(lit.length, `bearing ${bearing}`).toBe(1);
      // On the bin the tower actually stands in (on a boundary: either neighbour).
      const centre = (lit[0].bin + 0.5) * 0.5;
      const offset = Math.min(Math.abs(centre - bearing), 360 - Math.abs(centre - bearing));
      expect(offset, `bearing ${bearing}`).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(lit[0].e).toBeCloseTo(atanDeg(100, 499.5), 1);
      expect(profile.blockerIndex[lit[0].bin]).toBe(0);
      expect(profile.blockerDistanceM[lit[0].bin]).toBeCloseTo(499.5, 0);
      // (Exactly on a boundary, which neighbour gets it is a rounding coin-flip
      // that the reference cannot predict.)
      if (!onBinBoundary(bearing)) expectMatchesReference(profile, [tower], 0);
    }
  });

  test("a thin tower does not hide a steeper obstruction on the same bin", () => {
    // Just east of due south, between the bin centres at 179.75° and 180.25°.
    const tower: RefBuilding = {
      polygons: [[rotatedRect(1.5, -500, 0.5, 0.5, 0)]],
      heightM: 100,
    };
    const profile = profileOf([tower, southWall]);
    const bin = horizonBinFor(profile, 180);
    expect(profile.elevationDeg[bin]).toBeCloseTo(45, 2);
    expect(profile.blockerIndex[bin]).toBe(1);
    expectMatchesReference(profile, [tower, southWall], 0);
  });

  test("edges entirely beyond maxDistanceM are ignored", () => {
    const far: RefBuilding = { polygons: [[rect(-100, 1500, 100, 1520)]], heightM: 200 };
    expect(profileOf([far]).elevationDeg.every((e) => e === 0)).toBe(true);
    const included = profileOf([far], 0, { maxDistanceM: 2000 });
    expect(horizonElevationAt(included, 0)).toBeCloseTo(atanDeg(200, 1500), 1);
    // A building straddling the limit is kept for the edges that reach inside it.
    const straddling: RefBuilding = { polygons: [[rect(-100, 990, 100, 1100)]], heightM: 200 };
    expect(horizonElevationAt(profileOf([straddling]), 0)).toBeCloseTo(atanDeg(200, 990), 1);
    // Default limit is 1000 m.
    const justInside: RefBuilding = { polygons: [[rect(-100, 999, 100, 1010)]], heightM: 200 };
    const justOutside: RefBuilding = { polygons: [[rect(-100, 1001, 100, 1010)]], heightM: 200 };
    expect(horizonElevationAt(profileOf([justInside]), 0)).toBeGreaterThan(0);
    expect(horizonElevationAt(profileOf([justOutside]), 0)).toBe(0);
  });

  test("obstructions closer than 0.5 m are treated as 0.5 m away", () => {
    const touching: RefBuilding = { polygons: [[rect(-5, 0.1, 5, 3)]], heightM: 3 };
    const profile = profileOf([touching]);
    expect(horizonElevationAt(profile, 0)).toBeCloseTo(atanDeg(3, 0.5), 2);
    expect(profile.blockerDistanceM[horizonBinFor(profile, 0)]).toBe(0.5);
    expect(Math.max(...profile.elevationDeg)).toBeLessThan(90);
  });

  test("MultiPolygon buildings: every part blocks; containing one part excludes all", () => {
    const twoWings: RefBuilding = {
      polygons: [[rect(-5, 20, 5, 22)], [rect(-5, -22, 5, -20)]],
      heightM: 10,
    };
    const profile = profileOf([twoWings]);
    expect(horizonElevationAt(profile, 0)).toBeCloseTo(atanDeg(10, 20), 2);
    expect(horizonElevationAt(profile, 180)).toBeCloseTo(atanDeg(10, 20), 2);
    expect(horizonElevationAt(profile, 90)).toBe(0);
    expectMatchesReference(profile, [twoWings], 0);

    const standingInOneWing: RefBuilding = {
      polygons: [[rect(-5, -5, 5, 5)], [rect(-5, -22, 5, -20)]],
      heightM: 10,
    };
    const inside = profileOf([standingInOneWing]);
    expect(inside.containingBuildingIndex).toBe(0);
    expect(inside.elevationDeg.every((e) => e === 0)).toBe(true);
  });

  test("open (unclosed) rings and reversed winding give the same profile", () => {
    const closed = rect(-20, -12, 20, -10);
    const open = closed.slice(0, -1);
    const reversed = [...closed].reverse();
    const base = profileOf([southWall]);
    for (const ring of [open, reversed]) {
      const profile = profileOf([{ polygons: [[ring]], heightM: 10 }]);
      expect(profile.elevationDeg).toEqual(base.elevationDeg);
      expect(profile.blockerIndex).toEqual(base.blockerIndex);
    }
  });

  test("a different bin count", () => {
    const profile = profileOf([southWall], 0, { binCount: 360 });
    expect(profile.binCount).toBe(360);
    expect(profile.elevationDeg.length).toBe(360);
    expect(horizonElevationAt(profile, 180)).toBeCloseTo(45, 1);
    expectMatchesReference(profile, [southWall], 0);
    expect(() => profileOf([southWall], 0, { binCount: 0 })).toThrow(RangeError);
    expect(() => profileOf([southWall], 0, { binCount: 12.5 })).toThrow(RangeError);
  });

  test("the geographic frame is right: a building to the north-east blocks the north-east", () => {
    // Built directly from coordinates (no local-metre helper): ~22 m north and
    // ~22 m east of the place.
    const lat = PLACE.lat + 0.0002;
    const lng = PLACE.lng + 0.00025;
    const d = 0.00003;
    const feature: BuildingFeature = {
      type: "Feature",
      properties: { id: "way/9", heightM: 20, heightSource: "tagged", levels: null, kind: "yes" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lng - d, lat - d],
            [lng + d, lat - d],
            [lng + d, lat + d],
            [lng - d, lat + d],
            [lng - d, lat - d],
          ],
        ],
      },
    };
    const profile = computeHorizonProfile(PLACE, collectionOf([feature]), 0);
    const centre = toLocalMeters(PLACE, { lat, lng });
    const bearing = Math.atan2(centre.x, centre.y) / DEG;
    expect(bearing).toBeGreaterThan(40);
    expect(bearing).toBeLessThan(50);
    expect(horizonElevationAt(profile, bearing)).toBeGreaterThan(25);
    expect(horizonElevationAt(profile, bearing + 180)).toBe(0);
    expect(horizonElevationAt(profile, bearing + 90)).toBe(0);
    expect(horizonElevationAt(profile, bearing - 90)).toBe(0);
  });
});

describe("horizonBinFor / horizonElevationAt", () => {
  const profile = computeHorizonProfile(PLACE, collectionOf([]), 0);

  test("bin i covers [i, i + 1) × 0.5°", () => {
    expect(horizonBinFor(profile, 0)).toBe(0);
    expect(horizonBinFor(profile, 0.49)).toBe(0);
    expect(horizonBinFor(profile, 0.5)).toBe(1);
    expect(horizonBinFor(profile, 180)).toBe(360);
    expect(horizonBinFor(profile, 359.5)).toBe(719);
    expect(horizonBinFor(profile, 359.999)).toBe(719);
  });

  test("normalises any azimuth", () => {
    expect(horizonBinFor(profile, 360)).toBe(0);
    expect(horizonBinFor(profile, 720.3)).toBe(0);
    expect(horizonBinFor(profile, -0.1)).toBe(719);
    expect(horizonBinFor(profile, -180)).toBe(360);
    expect(horizonBinFor(profile, -1e-17)).toBe(0);
  });

  test("non-finite azimuths have no bin and no obstruction", () => {
    expect(horizonBinFor(profile, NaN)).toBe(-1);
    expect(horizonBinFor(profile, Infinity)).toBe(-1);
    expect(horizonElevationAt(profile, NaN)).toBe(0);
  });

  test("always lands in range", () => {
    fc.assert(
      fc.property(real(-1e5, 1e5), (azimuth) => {
        const bin = horizonBinFor(profile, azimuth);
        expect(Number.isInteger(bin)).toBe(true);
        expect(bin).toBeGreaterThanOrEqual(0);
        expect(bin).toBeLessThan(720);
      }),
    );
  });
});

describe("computeHorizonProfile: agreement with the brute-force reference", () => {
  test("random solid buildings: equal to the reference at every bin centre", () => {
    fc.assert(
      fc.property(
        fc.array(solidBuilding, { minLength: 0, maxLength: 10 }),
        observerHeight,
        (buildings, observerHeightM) => {
          fc.pre(minBoundaryDistance(buildings) > 1e-6);
          const profile = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, buildings)),
            observerHeightM,
          );
          const { subBinParts } = expectMatchesReference(profile, buildings, observerHeightM);
          // These shapes are all wider than a bin, so the comparison above was
          // a strict equality in all 720 bins.
          expect(subBinParts).toBe(0);
          const expectedContaining = buildings.findIndex(refContainsOrigin);
          expect(profile.containingBuildingIndex).toBe(expectedContaining);
        },
      ),
      { numRuns: 300 * SCALE },
    );
  });

  test("random scenes hugging the observer (many walls within a few metres)", () => {
    fc.assert(
      fc.property(
        fc.array(rectBuilding(12, 1.5, 8), { minLength: 1, maxLength: 6 }),
        observerHeight,
        (buildings, observerHeightM) => {
          fc.pre(minBoundaryDistance(buildings) > 1e-6);
          const profile = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, buildings)),
            observerHeightM,
          );
          expectMatchesReference(profile, buildings, observerHeightM);
          expect(profile.containingBuildingIndex).toBe(buildings.findIndex(refContainsOrigin));
        },
      ),
      { numRuns: 300 * SCALE },
    );
  });

  test("random tiny / distant buildings: nothing vanishes, nothing else changes", () => {
    let sawSubBin = 0;
    fc.assert(
      fc.property(
        fc.array(fc.oneof(rectBuilding(600, 0.05, 3), rectBuilding(150, 1.5, 25)), {
          minLength: 1,
          maxLength: 10,
        }),
        observerHeight,
        (buildings, observerHeightM) => {
          fc.pre(minBoundaryDistance(buildings) > 1e-6);
          const profile = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, buildings)),
            observerHeightM,
            { maxDistanceM: 5000 },
          );
          // Exact at every bin centre, except that each part too thin to be hit
          // by any bin-centre ray is present on the bin of its nearest point.
          sawSubBin += expectMatchesReference(profile, buildings, observerHeightM).subBinParts;
        },
      ),
      { numRuns: 300 * SCALE },
    );
    expect(sawSubBin).toBeGreaterThan(20); // the generator really exercises that path
  });

  test("other bin counts agree with the reference too", () => {
    fc.assert(
      fc.property(
        fc.array(solidBuilding, { minLength: 1, maxLength: 6 }),
        fc.constantFrom(1, 2, 3, 7, 90, 360, 1440),
        (buildings, binCount) => {
          fc.pre(minBoundaryDistance(buildings) > 1e-6);
          const profile = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, buildings)),
            0,
            { binCount },
          );
          expectMatchesReference(profile, buildings, 0);
        },
      ),
      { numRuns: 100 * SCALE },
    );
  });

  test("works at other latitudes and across the antimeridian", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<LatLng>(
          { lat: 0, lng: 0 },
          { lat: -33.87, lng: 151.21 },
          { lat: 69.65, lng: 18.96 },
          { lat: -17, lng: 179.9999 },
          { lat: 64, lng: -179.9999 },
        ),
        fc.array(solidBuilding, { minLength: 1, maxLength: 6 }),
        (place, buildings) => {
          fc.pre(minBoundaryDistance(buildings) > 1e-6);
          const profile = computeHorizonProfile(
            place,
            collectionOf(toFeatures(place, buildings)),
            0,
          );
          expectMatchesReference(profile, buildings, 0);
        },
      ),
      { numRuns: 100 * SCALE },
    );
  });
});

describe("computeHorizonProfile: monotonicity", () => {
  test("raising the observer never raises the skyline", () => {
    fc.assert(
      fc.property(
        fc.array(solidBuilding, { minLength: 1, maxLength: 8 }),
        span(0, 40),
        span(0, 40),
        (buildings, a, b) => {
          const collection = collectionOf(toFeatures(PLACE, buildings));
          const low = computeHorizonProfile(PLACE, collection, Math.min(a, b));
          const high = computeHorizonProfile(PLACE, collection, Math.max(a, b));
          for (let bin = 0; bin < low.binCount; bin++) {
            check(high.elevationDeg[bin] <= low.elevationDeg[bin], `bin ${bin} got steeper`);
          }
          expect(high.containingBuildingIndex).toBe(low.containingBuildingIndex);
        },
      ),
      { numRuns: 200 * SCALE },
    );
  });

  test("adding a building never lowers the skyline", () => {
    fc.assert(
      fc.property(
        fc.array(solidBuilding, { minLength: 0, maxLength: 8 }),
        solidBuilding,
        observerHeight,
        (buildings, extra, observerHeightM) => {
          const before = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, buildings)),
            observerHeightM,
          );
          const after = computeHorizonProfile(
            PLACE,
            collectionOf(toFeatures(PLACE, [...buildings, extra])),
            observerHeightM,
          );
          for (let bin = 0; bin < before.binCount; bin++) {
            check(after.elevationDeg[bin] >= before.elevationDeg[bin], `bin ${bin} got lower`);
          }
        },
      ),
      { numRuns: 200 * SCALE },
    );
  });

  test("the order of buildings does not change the skyline", () => {
    fc.assert(
      fc.property(fc.array(solidBuilding, { minLength: 2, maxLength: 8 }), (buildings) => {
        const forward = computeHorizonProfile(PLACE, collectionOf(toFeatures(PLACE, buildings)), 0);
        const backward = computeHorizonProfile(
          PLACE,
          collectionOf(toFeatures(PLACE, [...buildings].reverse())),
          0,
        );
        expect(backward.elevationDeg).toEqual(forward.elevationDeg);
      }),
      { numRuns: 100 * SCALE },
    );
  });
});

describe("computeHorizonProfile: real buildings (Pacific Heights fixture)", () => {
  const fixture = loadPacificHeights();
  const asReference: RefBuilding[] = fixture.features.map((feature) => ({
    heightM: feature.properties.heightM,
    polygons: [
      (feature.geometry.coordinates as number[][][]).map((ring) =>
        ring.map(([lng, lat]): [number, number] => {
          const p = toLocalMeters(PACIFIC_HEIGHTS, { lat, lng });
          return [p.x, p.y];
        }),
      ),
    ],
  }));

  test("agrees with the brute-force reference in every bin, at several observer heights", () => {
    for (const observerHeightM of [0, 1, 6, 15]) {
      const profile = computeHorizonProfile(PACIFIC_HEIGHTS, fixture, observerHeightM);
      const { blockedBins } = expectMatchesReference(profile, asReference, observerHeightM);
      expect(blockedBins).toBeGreaterThan(observerHeightM < 10 ? 600 : 100);
      expect(profile.containingBuildingIndex).toBe(asReference.findIndex(refContainsOrigin));
    }
  });

  test("agrees with the reference from other spots in the neighbourhood", () => {
    for (const [dx, dy] of [
      [40, 25],
      [-60, 10],
      [15, -80],
      [-120, -90],
    ]) {
      const scale = { lat: 110992, lng: 88081 };
      const spot = {
        lat: PACIFIC_HEIGHTS.lat + dy / scale.lat,
        lng: PACIFIC_HEIGHTS.lng + dx / scale.lng,
      };
      const reference: RefBuilding[] = fixture.features.map((feature) => ({
        heightM: feature.properties.heightM,
        polygons: [
          (feature.geometry.coordinates as number[][][]).map((ring) =>
            ring.map(([lng, lat]): [number, number] => {
              const p = toLocalMeters(spot, { lat, lng });
              return [p.x, p.y];
            }),
          ),
        ],
      }));
      const profile = computeHorizonProfile(spot, fixture, 1.5);
      expectMatchesReference(profile, reference, 1.5);
      expect(profile.containingBuildingIndex).toBe(reference.findIndex(refContainsOrigin));
    }
  });
});
