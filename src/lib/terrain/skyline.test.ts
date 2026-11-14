import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { real } from "@/lib/geo/testing";
import type { ElevationGrid, Terrain } from "@/lib/types";

import { elevationGridFrom } from "./elevation";
import { computeTerrainSkyline, CURVATURE_DROP_PER_M2 } from "./skyline";

const ORIGIN = { lat: 37.79, lng: -122.43 };
const DEG = Math.PI / 180;
const BINS = 720;

const angleDeg = (slope: number) => Math.atan(slope) / DEG;
const binOf = (azimuthDeg: number) => Math.floor((((azimuthDeg % 360) + 360) % 360) / (360 / BINS));

/** A square grid of half-width `half` centred on the origin. */
function squareGrid(
  half: number,
  cell: number,
  f: (x: number, y: number) => number,
): ElevationGrid {
  const n = Math.round((2 * half) / cell) + 1;
  return elevationGridFrom(
    ORIGIN,
    { minX: -half, minY: -half, cellSizeM: cell, width: n, height: n },
    f,
  );
}

// ─── Independent brute-force reference ─────────────────────────────────────
//
// Its own bilinear lookup (textbook weighted sum of the four corners), a dense
// fixed step, plain trigonometry in degrees, the curvature drop written out
// from first principles. Nothing shared with the implementation.

function refGround(grid: ElevationGrid, x: number, y: number): number | null {
  const gx = (x - grid.minX) / grid.cellSizeM;
  const gy = (y - grid.minY) / grid.cellSizeM;
  if (gx < 0 || gy < 0 || gx > grid.width - 1 || gy > grid.height - 1) return null;
  const c = Math.min(grid.width - 2, Math.floor(gx));
  const r = Math.min(grid.height - 2, Math.floor(gy));
  const fx = gx - c;
  const fy = gy - r;
  const at = (row: number, col: number) => grid.data[row * grid.width + col];
  return (
    at(r, c) * (1 - fx) * (1 - fy) +
    at(r, c + 1) * fx * (1 - fy) +
    at(r + 1, c) * (1 - fx) * fy +
    at(r + 1, c + 1) * fx * fy
  );
}

function refTerrainGround(terrain: Terrain, x: number, y: number): number | null {
  return refGround(terrain.near, x, y) ?? (terrain.far ? refGround(terrain.far, x, y) : null);
}

/** Highest elevation angle (degrees, ≥ 0) of the ground along one azimuth. */
function refSkylineDeg(
  terrain: Terrain,
  observerX: number,
  observerY: number,
  observerHeightM: number,
  azimuthDeg: number,
  startM: number,
  stepM: number,
): number {
  const eye = refTerrainGround(terrain, observerX, observerY)! + observerHeightM;
  const earthRadius = 6_371_000;
  let best = 0;
  for (let d = startM; ; d += stepM) {
    const ground = refTerrainGround(
      terrain,
      observerX + d * Math.sin(azimuthDeg * DEG),
      observerY + d * Math.cos(azimuthDeg * DEG),
    );
    if (ground === null) break;
    // Curvature lowers distant ground by d²/2R; refraction gives 13% of it back.
    const apparent = ground - ((d * d) / (2 * earthRadius)) * (1 - 0.13);
    best = Math.max(best, Math.atan2(apparent - eye, d) / DEG);
  }
  return best;
}

describe("computeTerrainSkyline", () => {
  test("flat ground has no skyline, at any elevation and observer height", () => {
    for (const level of [0, 94.4, 2500]) {
      for (const height of [0, 1.5, 30]) {
        const flat = squareGrid(1000, 10, () => level);
        const skyline = computeTerrainSkyline({ near: flat }, 120, -80, height, BINS);
        expect(skyline.slope.every((s) => s === 0)).toBe(true);
        expect(skyline.distanceM.every((d) => d === 0)).toBe(true);
      }
    }
  });

  test("a plane rising to the north: uphill is blocked up to the slope angle, downhill is open", () => {
    const gradient = 0.2; // 20% ≙ 11.31°
    const plane = squareGrid(1000, 10, (_x, y) => 300 + gradient * y);
    const skyline = computeTerrainSkyline({ near: plane }, 0, 0, 0, BINS);
    for (const azimuth of [0.25, 30.25, 60.25, 89.25, 300.25, 359.75]) {
      // Along azimuth θ the ground climbs at gradient·cos θ.
      const expected = gradient * Math.cos(azimuth * DEG);
      expect(skyline.slope[binOf(azimuth)]).toBeCloseTo(expected, 5);
    }
    expect(angleDeg(skyline.slope[binOf(0)])).toBeCloseTo(11.31, 1);
    for (const azimuth of [90.25, 135, 180, 225, 269.75]) {
      expect(skyline.slope[binOf(azimuth)]).toBe(0);
      expect(skyline.distanceM[binOf(azimuth)]).toBe(0);
    }
  });

  test("standing above a slope: the line of sight clears more of it the higher you are", () => {
    const gradient = 0.2;
    const plane = squareGrid(1000, 10, (_x, y) => gradient * y);
    // Looking due north from height h, the ground at distance d is at
    // gradient·d − h: steepest at the far edge of the data (d = 1000 m).
    for (const height of [2, 10, 50]) {
      const skyline = computeTerrainSkyline({ near: plane }, 0, 0, height, BINS);
      const north = binOf(0.25);
      const edge = 1000 / Math.cos(0.25 * DEG);
      const expected =
        gradient * Math.cos(0.25 * DEG) - height / edge - CURVATURE_DROP_PER_M2 * edge;
      // The march stops within one 10 m step of the edge, then refines towards it.
      expect(skyline.slope[north]).toBeLessThanOrEqual(expected + 1e-9);
      expect(skyline.slope[north]).toBeGreaterThan(expected - height / 990 + height / 1000 - 1e-6);
      expect(skyline.distanceM[north]).toBeGreaterThan(990);
    }
  });

  test("a ridge 100 m high, 500 m to the south: atan(100 / 500) = 11.3° around azimuth 180", () => {
    // A wall-like ridge 40 m thick, running 600 m east–west.
    const ridge = squareGrid(1000, 10, (x, y) =>
      y <= -500 && y >= -540 && Math.abs(x) <= 300 ? 100 : 0,
    );
    const skyline = computeTerrainSkyline({ near: ridge }, 0, 0, 0, BINS);
    const south = binOf(180);
    expect(angleDeg(skyline.slope[south])).toBeCloseTo(11.31, 1);
    expect(skyline.distanceM[south]).toBeGreaterThan(495);
    expect(skyline.distanceM[south]).toBeLessThan(515);
    // Oblique rays meet it farther away: 500 / cos(20°) = 532 m → 10.6°.
    expect(angleDeg(skyline.slope[binOf(200)])).toBeCloseTo(
      Math.atan2(100, 500 / Math.cos(20.25 * DEG)) / DEG,
      0,
    );
    // It ends at x = ±300 m → azimuth 180° ± atan(300/500) = ±31°.
    expect(skyline.slope[binOf(180 + 29)]).toBeGreaterThan(0.1);
    expect(skyline.slope[binOf(180 - 29)]).toBeGreaterThan(0.1);
    expect(skyline.slope[binOf(180 + 34)]).toBe(0);
    expect(skyline.slope[binOf(180 - 34)]).toBe(0);
    // Nothing anywhere else.
    for (const azimuth of [0, 45, 90, 270, 315]) expect(skyline.slope[binOf(azimuth)]).toBe(0);
    // An observer 30 m up sees it 30 m lower: atan(70 / 500) = 7.97°.
    const raised = computeTerrainSkyline({ near: ridge }, 0, 0, 30, BINS);
    expect(angleDeg(raised.slope[south])).toBeCloseTo(7.97, 1);
    // From above the ridge (120 m) it is below the horizontal: open sky.
    const above = computeTerrainSkyline({ near: ridge }, 0, 0, 120, BINS);
    expect(above.slope.every((s) => s === 0)).toBe(true);
  });

  test("on top of a hill everything is below you: negative angles clamp to open sky", () => {
    const hill = squareGrid(1000, 10, (x, y) => 200 * Math.exp(-(x * x + y * y) / (2 * 300 ** 2)));
    const skyline = computeTerrainSkyline({ near: hill }, 0, 0, 0, BINS);
    expect(skyline.slope.every((s) => s === 0)).toBe(true);
    expect(skyline.distanceM.every((d) => d === 0)).toBe(true);
    // From the valley beside it the same hill does block (towards it only).
    const below = computeTerrainSkyline({ near: hill }, 800, 0, 0, BINS);
    expect(below.slope[binOf(270)]).toBeGreaterThan(0.2);
    expect(below.slope[binOf(90)]).toBe(0);
  });

  test("ground within a few metres of the observer is ignored", () => {
    // A 3 m bump right next to the observer on an otherwise flat 1 m grid.
    const bump = squareGrid(60, 1, (x, y) => (Math.hypot(x - 2, y) < 1.5 ? 3 : 0));
    const skyline = computeTerrainSkyline({ near: bump }, 0, 0, 0, BINS);
    expect(skyline.slope.every((s) => s === 0)).toBe(true);
    // The same bump 20 m away is a (small) obstruction: atan(3/18.5) ≈ 9°.
    const farther = squareGrid(60, 1, (x, y) => (Math.hypot(x - 20, y) < 1.5 ? 3 : 0));
    expect(
      angleDeg(computeTerrainSkyline({ near: farther }, 0, 0, 0, BINS).slope[binOf(90)]),
    ).toBeGreaterThan(8);
  });

  test("the coarse far grid takes over beyond the fine one, with Earth curvature", () => {
    const near = squareGrid(1000, 10, () => 0);
    // A 500 m mountain wall 5 km east and another 20 km west.
    const far = squareGrid(25_000, 100, (x) =>
      x >= 5000 && x <= 5400 ? 500 : x <= -20_000 && x >= -20_400 ? 500 : 0,
    );
    const skyline = computeTerrainSkyline({ near, far }, 0, 0, 0, BINS);
    const east = binOf(90);
    const west = binOf(270);
    // 5 km: the curvature drop is 0.87·5000²/2R = 1.7 m → atan(498.3/5000) = 5.69°.
    expect(angleDeg(skyline.slope[east])).toBeCloseTo(5.69, 1);
    expect(skyline.distanceM[east]).toBeGreaterThan(4900);
    expect(skyline.distanceM[east]).toBeLessThan(5450);
    // 20 km: the drop is 27.3 m → atan(472.7/20000) = 1.354°, not the 1.432° of a flat Earth.
    expect(CURVATURE_DROP_PER_M2 * 20_000 ** 2).toBeCloseTo(27.3, 1);
    expect(angleDeg(skyline.slope[west])).toBeGreaterThan(1.3);
    expect(angleDeg(skyline.slope[west])).toBeLessThan(1.36);
    expect(skyline.slope[binOf(0)]).toBe(0);
    // Without the far grid there is nothing to see.
    expect(computeTerrainSkyline({ near }, 0, 0, 0, BINS).slope.every((s) => s === 0)).toBe(true);
  });

  test("raising the observer never raises the terrain skyline", () => {
    const hills = squareGrid(
      1500,
      15,
      (x, y) => 60 * Math.sin(x / 180) * Math.cos(y / 230) + 0.05 * y,
    );
    let previous = computeTerrainSkyline({ near: hills }, 100, -50, 0, BINS);
    for (const height of [1, 5, 20, 80]) {
      const next = computeTerrainSkyline({ near: hills }, 100, -50, height, BINS);
      for (let bin = 0; bin < BINS; bin++) {
        if (next.slope[bin] > previous.slope[bin])
          throw new Error(`bin ${bin} rose at ${height} m`);
      }
      previous = next;
    }
  });

  test("agrees with a dense brute-force march on random rolling terrain", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: real(-900, 900),
            y: real(-900, 900),
            height: real(-60, 120),
            radius: real(80, 400),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        real(-0.15, 0.15),
        real(-0.15, 0.15),
        real(-300, 300),
        real(-300, 300),
        fc.constantFrom(0, 1.5, 10),
        (hills, gx, gy, observerX, observerY, observerHeightM) => {
          const surface = (x: number, y: number) =>
            200 +
            gx * x +
            gy * y +
            hills.reduce(
              (sum, h) =>
                sum + h.height * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.radius ** 2)),
              0,
            );
          const terrain: Terrain = {
            near: squareGrid(1000, 8, surface),
            far: squareGrid(6000, 60, surface),
          };
          const skyline = computeTerrainSkyline(
            terrain,
            observerX,
            observerY,
            observerHeightM,
            BINS,
          );
          // Every 9th bin keeps the dense reference affordable.
          for (let bin = 0; bin < BINS; bin += 9) {
            const reference = refSkylineDeg(
              terrain,
              observerX,
              observerY,
              observerHeightM,
              (bin + 0.5) * 0.5,
              8,
              1,
            );
            const actual = angleDeg(skyline.slope[bin]);
            // Both look for the highest point of the same bilinear surface
            // along the same ray; the implementation marches coarsely and then
            // homes in on the best sample, the reference checks every metre.
            if (Math.abs(actual - reference) > 0.02) {
              throw new Error(`bin ${bin}: skyline ${actual}°, dense reference ${reference}°`);
            }
            if (actual === 0) {
              if (skyline.distanceM[bin] !== 0)
                throw new Error(`bin ${bin}: distance without slope`);
            } else {
              // The reported distance reproduces the reported slope.
              const d = skyline.distanceM[bin];
              const ground = refTerrainGround(
                terrain,
                observerX + d * Math.sin((bin + 0.5) * 0.5 * DEG),
                observerY + d * Math.cos((bin + 0.5) * 0.5 * DEG),
              )!;
              const eye = refTerrainGround(terrain, observerX, observerY)! + observerHeightM;
              const slope = (ground - CURVATURE_DROP_PER_M2 * d * d - eye) / d;
              if (Math.abs(slope - skyline.slope[bin]) > 1e-6) {
                throw new Error(`bin ${bin}: distance ${d} m does not reproduce the slope`);
              }
            }
          }
        },
      ),
      { numRuns: 25, endOnFailure: true },
    );
  });
});
