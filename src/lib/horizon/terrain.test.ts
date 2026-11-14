/**
 * The skyline with terrain: buildings standing on real ground, and the ground
 * itself as an obstruction.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { fromLocalMeters, toLocalMeters } from "@/lib/geo/local";
import { real } from "@/lib/geo/testing";
import { elevationAt, elevationGridFrom } from "@/lib/terrain/elevation";
import { computeTerrainSkyline } from "@/lib/terrain/skyline";
import { TERRAIN_BLOCKER, type ElevationGrid, type LatLng, type Terrain } from "@/lib/types";

import { computeHorizonProfile, horizonBinFor, horizonElevationAt } from "./profile";
import {
  buildingFromLocal,
  collectionOf,
  loadPacificHeights,
  PACIFIC_HEIGHTS,
  rect,
  rotatedRect,
  type LocalRing,
} from "./testing";
import { loadPacificHeightsTerrain } from "@/lib/terrain/testing";

const DEG = Math.PI / 180;
const PLACE: LatLng = { lat: 37.7906, lng: -122.4294 };
const atanDeg = (rise: number, run: number) => Math.atan2(rise, run) / DEG;

/** A square grid centred on `origin`, half-width `half`, evaluated from f(x, y). */
function grid(
  origin: LatLng,
  half: number,
  cell: number,
  f: (x: number, y: number) => number,
): ElevationGrid {
  const n = Math.round((2 * half) / cell) + 1;
  return elevationGridFrom(
    origin,
    { minX: -half, minY: -half, cellSizeM: cell, width: n, height: n },
    f,
  );
}

const building = (ring: LocalRing, heightM: number, id = "way/1", place = PLACE) =>
  buildingFromLocal(place, [[ring]], heightM, id);

describe("computeHorizonProfile: bookkeeping", () => {
  test("records the observer height it was computed for", () => {
    const empty = collectionOf([]);
    expect(computeHorizonProfile(PLACE, empty, 0).observerHeightM).toBe(0);
    expect(computeHorizonProfile(PLACE, empty, 7.5).observerHeightM).toBe(7.5);
    const terrain = { near: grid(PLACE, 500, 10, () => 100) };
    expect(computeHorizonProfile(PLACE, empty, 3, { terrain }).observerHeightM).toBe(3);
  });

  test("TERRAIN_BLOCKER is distinct from 'none' and from every building index", () => {
    expect(TERRAIN_BLOCKER).toBe(-2);
  });
});

describe("computeHorizonProfile: flat terrain changes nothing", () => {
  const rectBuilding = fc.record({
    cx: real(-150, 150),
    cy: real(-150, 150),
    halfWidth: real(1.5, 25),
    halfHeight: real(1.5, 25),
    rotation: real(0, 180),
    heightM: real(1, 80),
  });

  test("flat ground at ANY elevation gives bit-for-bit the no-terrain profile", () => {
    fc.assert(
      fc.property(
        fc.array(rectBuilding, { minLength: 0, maxLength: 10 }),
        fc.oneof(fc.constant(0), real(0, 40)),
        real(-400, 4500),
        // The terrain's frame origin is generally not the pin.
        real(-800, 800),
        real(-800, 800),
        fc.boolean(),
        (buildings, observerHeightM, level, offsetX, offsetY, withFar) => {
          const features = collectionOf(
            buildings.map((b, i) =>
              building(
                rotatedRect(b.cx, b.cy, b.halfWidth, b.halfHeight, b.rotation),
                b.heightM,
                `way/${i}`,
              ),
            ),
          );
          const origin = fromLocalMeters(PLACE, offsetX, offsetY);
          const terrain: Terrain = {
            near: grid(origin, 1200, 20, () => level),
            ...(withFar ? { far: grid(origin, 6000, 200, () => level) } : {}),
          };
          const flat = computeHorizonProfile(PLACE, features, observerHeightM);
          const onTerrain = computeHorizonProfile(PLACE, features, observerHeightM, { terrain });
          expect(onTerrain.elevationDeg).toEqual(flat.elevationDeg);
          expect(onTerrain.blockerIndex).toEqual(flat.blockerIndex);
          expect(onTerrain.blockerDistanceM).toEqual(flat.blockerDistanceM);
          expect(onTerrain.containingBuildingIndex).toBe(flat.containingBuildingIndex);
          expect(onTerrain.observerHeightM).toBe(flat.observerHeightM);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("the real fixture on a flat plain equals the fixture without terrain", () => {
    const fixture = loadPacificHeights();
    const terrain = { near: grid(PACIFIC_HEIGHTS, 900, 10, () => 94.4) };
    for (const height of [0, 1, 12]) {
      const flat = computeHorizonProfile(PACIFIC_HEIGHTS, fixture, height);
      const onTerrain = computeHorizonProfile(PACIFIC_HEIGHTS, fixture, height, { terrain });
      expect(onTerrain).toEqual(flat);
    }
  });
});

describe("computeHorizonProfile: terrain as an obstruction", () => {
  const none = collectionOf([]);

  test("a plane tilted up towards the north blocks the north up to its slope", () => {
    const terrain = { near: grid(PLACE, 1000, 10, (_x, y) => 300 + 0.2 * y) };
    const profile = computeHorizonProfile(PLACE, none, 0, { terrain });
    expect(horizonElevationAt(profile, 0)).toBeCloseTo(atanDeg(0.2, 1), 1); // 11.31°
    expect(horizonElevationAt(profile, 60)).toBeCloseTo(atanDeg(0.2 * Math.cos(60.25 * DEG), 1), 1);
    // (The bin holding azimuth 300° is sampled at 300.25°, i.e. 59.75° west of north.)
    expect(horizonElevationAt(profile, 300)).toBeCloseTo(
      atanDeg(0.2 * Math.cos(59.75 * DEG), 1),
      1,
    );
    expect(profile.blockerIndex[horizonBinFor(profile, 0)]).toBe(TERRAIN_BLOCKER);
    expect(profile.blockerDistanceM[horizonBinFor(profile, 0)]).toBeGreaterThan(0);
    // Downhill: open sky.
    for (const azimuth of [100, 180, 260]) {
      expect(horizonElevationAt(profile, azimuth)).toBe(0);
      expect(profile.blockerIndex[horizonBinFor(profile, azimuth)]).toBe(-1);
      expect(profile.blockerDistanceM[horizonBinFor(profile, azimuth)]).toBe(0);
    }
  });

  test("a ridge 100 m high 500 m to the south: 11.3° around azimuth 180", () => {
    const ridge = (x: number, y: number) =>
      50 + (y <= -500 && y >= -540 && Math.abs(x) <= 300 ? 100 : 0);
    const terrain = { near: grid(PLACE, 1000, 10, ridge) };
    const profile = computeHorizonProfile(PLACE, none, 0, { terrain });
    const south = horizonBinFor(profile, 180);
    expect(profile.elevationDeg[south]).toBeCloseTo(atanDeg(100, 500), 1);
    expect(profile.blockerIndex[south]).toBe(TERRAIN_BLOCKER);
    expect(profile.blockerDistanceM[south]).toBeGreaterThan(495);
    expect(profile.blockerDistanceM[south]).toBeLessThan(515);
    expect(horizonElevationAt(profile, 180 + 34)).toBe(0);
    expect(horizonElevationAt(profile, 0)).toBe(0);
    // Every bin matches the terrain skyline on its own.
    const skyline = computeTerrainSkyline(terrain, 0, 0, 0, 720);
    for (let bin = 0; bin < 720; bin++) {
      expect(profile.elevationDeg[bin]).toBeCloseTo(Math.atan(skyline.slope[bin]) / DEG, 4);
    }
    // From 30 m up: atan(70/500).
    const raised = computeHorizonProfile(PLACE, none, 30, { terrain });
    expect(horizonElevationAt(raised, 180)).toBeCloseTo(atanDeg(70, 500), 1);
  });

  test("an observer on a hilltop sees no terrain: negative angles clamp to 0", () => {
    const terrain = {
      near: grid(PLACE, 1000, 10, (x, y) => 200 * Math.exp(-(x * x + y * y) / (2 * 300 ** 2))),
    };
    const profile = computeHorizonProfile(PLACE, none, 0, { terrain });
    expect(profile.elevationDeg.every((e) => e === 0)).toBe(true);
    expect(profile.blockerIndex.every((i) => i === -1)).toBe(true);
    expect(profile.blockerDistanceM.every((d) => d === 0)).toBe(true);
  });

  test("the terrain's frame origin need not be the pin", () => {
    // The same world — a ridge about 500 m south of the PIN — described in a
    // frame whose origin is 700 m east and 400 m north of the pin. (Its edges
    // are placed between grid nodes, so both grids sample the same shape: full
    // height from the nodes 510 m south onwards.)
    const origin = fromLocalMeters(PLACE, 700, 400);
    const pin = toLocalMeters(origin, PLACE);
    expect(pin.x).toBeCloseTo(-700, 0);
    expect(pin.y).toBeCloseTo(-400, 0);
    const ridgeAroundPin = (x: number, y: number) =>
      y <= -505 && y >= -545 && Math.abs(x) <= 305 ? 100 : 0;
    const centred = computeHorizonProfile(PLACE, none, 0, {
      terrain: { near: grid(PLACE, 1500, 10, ridgeAroundPin) },
    });
    const shifted = computeHorizonProfile(PLACE, none, 0, {
      terrain: {
        near: grid(origin, 1500, 10, (x, y) => ridgeAroundPin(x - pin.x, y - pin.y)),
      },
    });
    expect(horizonElevationAt(shifted, 180)).toBeCloseTo(atanDeg(100, 510), 1);
    expect(horizonElevationAt(centred, 180)).toBeCloseTo(atanDeg(100, 510), 1);
    let differing = 0;
    for (let bin = 0; bin < 720; bin++) {
      if (Math.abs(shifted.elevationDeg[bin] - centred.elevationDeg[bin]) > 0.05) differing++;
      expect(shifted.blockerIndex[bin] === TERRAIN_BLOCKER).toBe(shifted.elevationDeg[bin] > 0);
    }
    // Only the few bins grazing the ridge's two ends may differ.
    expect(differing).toBeLessThanOrEqual(6);
    expect(horizonElevationAt(shifted, 0)).toBe(0);
    expect(horizonElevationAt(shifted, 90)).toBe(0);
  });
});

describe("computeHorizonProfile: buildings on real ground", () => {
  // A 10 m building whose near face is 100 m due north of a ground observer.
  const house = collectionOf([building(rect(-10, 100, 10, 120), 10)]);
  const north = 0.1;

  test("same level: atan(10 / 100)", () => {
    const terrain = { near: grid(PLACE, 500, 5, () => 50) };
    const profile = computeHorizonProfile(PLACE, house, 0, { terrain });
    expect(horizonElevationAt(profile, north)).toBeCloseTo(atanDeg(10, 100), 2);
    expect(profile.blockerIndex[horizonBinFor(profile, north)]).toBe(0);
  });

  test("on a rise 20 m above the observer it blocks three times as much", () => {
    // A terrace 20 m higher beyond y = 95 m (the step itself reaches atan(20/95) = 11.9°).
    const terrain = { near: grid(PLACE, 500, 5, (_x, y) => (y >= 95 ? 70 : 50)) };
    const profile = computeHorizonProfile(PLACE, house, 0, { terrain });
    const bin = horizonBinFor(profile, north);
    // Roof at 70 + 10 = 80 m, eye at 50 m, 100 m away.
    expect(profile.elevationDeg[bin]).toBeCloseTo(atanDeg(30, 100), 1);
    expect(profile.blockerIndex[bin]).toBe(0);
    expect(profile.blockerDistanceM[bin]).toBeCloseTo(100, 0);
    // Beside the house the terrace edge itself is the skyline.
    const beside = horizonBinFor(profile, 30);
    expect(profile.blockerIndex[beside]).toBe(TERRAIN_BLOCKER);
    expect(profile.elevationDeg[beside]).toBeCloseTo(atanDeg(20, 95 / Math.cos(30.25 * DEG)), 0);
  });

  test("in a hollow 20 m below the observer it no longer blocks at all", () => {
    const terrain = { near: grid(PLACE, 500, 5, (_x, y) => (y >= 95 ? 30 : 50)) };
    const profile = computeHorizonProfile(PLACE, house, 0, { terrain });
    // Roof at 30 + 10 = 40 m is below the eye at 50 m.
    expect(profile.elevationDeg.every((e) => e === 0)).toBe(true);
    expect(profile.blockerIndex.every((i) => i === -1)).toBe(true);
    // …until it is tall enough to poke above the observer: 25 m → 5 m over.
    const tower = collectionOf([building(rect(-10, 100, 10, 120), 25)]);
    expect(
      horizonElevationAt(computeHorizonProfile(PLACE, tower, 0, { terrain }), north),
    ).toBeCloseTo(atanDeg(5, 100), 2);
  });

  test("the observer's own ground counts: from a 20 m mound the same house is hidden", () => {
    const terrain = {
      near: grid(PLACE, 500, 5, (x, y) => 50 + 20 * Math.exp(-(x * x + y * y) / (2 * 25 ** 2))),
    };
    const profile = computeHorizonProfile(PLACE, house, 0, { terrain });
    expect(horizonElevationAt(profile, north)).toBe(0);
    // From 15 m lower (the mound's foot would be −20): raise the house instead.
    const taller = collectionOf([building(rect(-10, 100, 10, 120), 40)]);
    const seen = computeHorizonProfile(PLACE, taller, 0, { terrain });
    // Roof at ≈ 50 + 40, eye at 70 → 20 m over 100 m.
    expect(horizonElevationAt(seen, north)).toBeCloseTo(atanDeg(20, 100), 1);
  });

  test("a building on a slope stands on the MEAN ground under its outline", () => {
    // Ground rises 10% to the north; the footprint spans y = 100…120 m, so its
    // corners are at +10, +10, +12, +12 m: base = observer ground + 11 m.
    const terrain = { near: grid(PLACE, 500, 5, (_x, y) => 50 + 0.1 * y) };
    const profile = computeHorizonProfile(PLACE, house, 0, { terrain });
    const bin = horizonBinFor(profile, north);
    expect(profile.elevationDeg[bin]).toBeCloseTo(atanDeg(11 + 10, 100), 1);
    expect(profile.blockerIndex[bin]).toBe(0);
    // Away from the house the hillside itself (5.7°) is the skyline.
    const beside = horizonBinFor(profile, 30);
    expect(profile.blockerIndex[beside]).toBe(TERRAIN_BLOCKER);
    expect(profile.elevationDeg[beside]).toBeCloseTo(atanDeg(0.1 * Math.cos(30.25 * DEG), 1), 1);
    // The observer's height comes off both.
    const raised = computeHorizonProfile(PLACE, house, 6, { terrain });
    expect(raised.elevationDeg[bin]).toBeCloseTo(atanDeg(11 + 10 - 6, 100), 1);
    expect(raised.observerHeightM).toBe(6);
  });

  test("where a hill and a building overlap, the steeper one is named", () => {
    // Ridge to the south (11.3°) with a low house in front of it (5.7°) and a
    // tower in front of it further west (atan(60/100) = 31°).
    const ridge = (_x: number, y: number) => (y <= -500 && y >= -540 ? 100 : 0);
    const terrain = { near: grid(PLACE, 1000, 10, ridge) };
    const scene = collectionOf([
      building(rect(-10, -120, 10, -100), 10, "way/low"),
      building(rect(-80, -120, -60, -100), 60, "way/tower"),
    ]);
    const profile = computeHorizonProfile(PLACE, scene, 0, { terrain });
    const behindLowHouse = horizonBinFor(profile, 180);
    expect(profile.blockerIndex[behindLowHouse]).toBe(TERRAIN_BLOCKER);
    expect(profile.elevationDeg[behindLowHouse]).toBeCloseTo(atanDeg(100, 500), 1);
    expect(profile.blockerDistanceM[behindLowHouse]).toBeGreaterThan(495);
    const atTower = horizonBinFor(profile, 180 + atanDeg(70, 100));
    expect(profile.blockerIndex[atTower]).toBe(1);
    expect(profile.elevationDeg[atTower]).toBeGreaterThan(25);
    expect(profile.blockerDistanceM[atTower]).toBeLessThan(150);
    // Without terrain the low house would have been the blocker there.
    expect(computeHorizonProfile(PLACE, scene, 0).blockerIndex[behindLowHouse]).toBe(0);
  });

  test("equals max(buildings re-based onto flat ground, terrain skyline) in every bin", () => {
    const rectBuilding = fc.record({
      cx: real(-200, 200),
      cy: real(-200, 200),
      halfWidth: real(2, 20),
      halfHeight: real(2, 20),
      rotation: real(0, 180),
      heightM: real(2, 60),
    });
    fc.assert(
      fc.property(
        fc.array(rectBuilding, { minLength: 1, maxLength: 8 }),
        real(-0.2, 0.2),
        real(-0.2, 0.2),
        fc.constantFrom(0, 1.5, 12),
        real(-300, 300),
        real(-300, 300),
        (buildings, gx, gy, observerHeightM, offsetX, offsetY) => {
          const origin = fromLocalMeters(PLACE, offsetX, offsetY);
          const pin = toLocalMeters(origin, PLACE);
          // A tilted plane (in the terrain's own frame): bilinear sampling of a
          // plane is exact, so every base elevation is known in closed form.
          const plane = (x: number, y: number) => 400 + gx * x + gy * y;
          const terrain: Terrain = { near: grid(origin, 1200, 12, plane) };
          const rings = buildings.map((b) =>
            rotatedRect(b.cx, b.cy, b.halfWidth, b.halfHeight, b.rotation),
          );
          const features = collectionOf(
            buildings.map((b, i) => building(rings[i], b.heightM, `way/${i}`)),
          );
          const profile = computeHorizonProfile(PLACE, features, observerHeightM, { terrain });

          // Independent route 1: the same buildings on FLAT ground, each made
          // taller (or shorter) by how far its base is above the observer's ground.
          const observerGround = plane(pin.x, pin.y);
          const rebased = collectionOf(
            buildings.map((b, i) => {
              const corners = rings[i].slice(0, 4);
              const meanBase =
                corners.reduce((sum, [x, y]) => sum + plane(pin.x + x, pin.y + y), 0) / 4;
              return building(rings[i], b.heightM + meanBase - observerGround, `way/${i}`);
            }),
          );
          const flat = computeHorizonProfile(PLACE, rebased, observerHeightM);
          // Independent route 2: the ground alone.
          const ground = computeTerrainSkyline(terrain, pin.x, pin.y, observerHeightM, 720);

          expect(profile.containingBuildingIndex).toBe(flat.containingBuildingIndex);
          for (let bin = 0; bin < 720; bin++) {
            const groundDeg = Math.atan(ground.slope[bin]) / DEG;
            const expected = Math.max(flat.elevationDeg[bin], groundDeg);
            if (Math.abs(profile.elevationDeg[bin] - expected) > 0.02) {
              throw new Error(`bin ${bin}: ${profile.elevationDeg[bin]}° vs ${expected}°`);
            }
            const blocker = profile.blockerIndex[bin];
            // Skip the blocker check where the two candidates are a near-tie.
            if (Math.abs(flat.elevationDeg[bin] - groundDeg) < 0.05) continue;
            if (groundDeg > flat.elevationDeg[bin]) {
              if (blocker !== TERRAIN_BLOCKER) throw new Error(`bin ${bin}: expected terrain`);
              if (Math.abs(profile.blockerDistanceM[bin] - ground.distanceM[bin]) > 0.01) {
                throw new Error(`bin ${bin}: terrain distance`);
              }
            } else if (blocker !== flat.blockerIndex[bin]) {
              throw new Error(
                `bin ${bin}: expected building ${flat.blockerIndex[bin]}, got ${blocker}`,
              );
            }
          }
        },
      ),
      { numRuns: 60, endOnFailure: true },
    );
  });
});

describe("computeHorizonProfile: real buildings on real terrain (Pacific Heights)", () => {
  const fixture = loadPacificHeights();
  const terrain = loadPacificHeightsTerrain();

  test("the fixture terrain is the hill we expect", () => {
    const pin = toLocalMeters(terrain.near.origin, PACIFIC_HEIGHTS);
    const here = elevationAt(terrain.near, pin.x, pin.y);
    // Pacific Heights ridge: ~95 m at the pin, falling steeply to the bay in the north.
    expect(here).toBeGreaterThan(80);
    expect(here).toBeLessThan(110);
    expect(elevationAt(terrain.near, pin.x, pin.y + 600)).toBeLessThan(here - 30);
    expect(elevationAt(terrain.near, pin.x, pin.y - 400)).toBeLessThan(here - 20);
    expect(terrain.far).toBeDefined();
    expect(terrain.far!.origin).toEqual(terrain.near.origin);
  });

  test("terrain changes the skyline, names hills, and never produces nonsense", () => {
    const flat = computeHorizonProfile(PACIFIC_HEIGHTS, fixture, 1);
    const real3d = computeHorizonProfile(PACIFIC_HEIGHTS, fixture, 1, { terrain });
    expect(real3d.containingBuildingIndex).toBe(flat.containingBuildingIndex);
    let changed = 0;
    let terrainBins = 0;
    for (let bin = 0; bin < 720; bin++) {
      const elevation = real3d.elevationDeg[bin];
      expect(elevation).toBeGreaterThanOrEqual(0);
      expect(elevation).toBeLessThan(90);
      if (Math.abs(elevation - flat.elevationDeg[bin]) > 0.5) changed++;
      const blocker = real3d.blockerIndex[bin];
      if (blocker === TERRAIN_BLOCKER) {
        terrainBins++;
        expect(elevation).toBeGreaterThan(0);
        expect(real3d.blockerDistanceM[bin]).toBeGreaterThanOrEqual(5);
      } else if (blocker >= 0) {
        expect(blocker).toBeLessThan(fixture.features.length);
        expect(elevation).toBeGreaterThan(0);
      } else {
        expect(blocker).toBe(-1);
        expect(elevation).toBe(0);
      }
    }
    // On a ridge with streets dropping away on both sides, most of the
    // skyline moves by more than half a degree.
    expect(changed).toBeGreaterThan(200);
    console.log(
      `Pacific Heights skyline with terrain: ${changed}/720 bins moved by > 0.5°, ` +
        `${terrainBins} bins where the ground itself is the skyline`,
    );
  });
});
