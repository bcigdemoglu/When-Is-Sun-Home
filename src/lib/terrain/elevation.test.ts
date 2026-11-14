import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { real } from "@/lib/geo/testing";
import type { ElevationGrid } from "@/lib/types";

import { elevationAt, elevationGridFrom, gridContains, terrainElevationAt } from "./elevation";

const ORIGIN = { lat: 37.79, lng: -122.43 };

/** 3 × 2 nodes, 10 m apart, lower-left node at (100, 200):
 *    row 1 (y = 210):  40  50  60
 *    row 0 (y = 200):  10  20  30
 */
const small: ElevationGrid = {
  origin: ORIGIN,
  cellSizeM: 10,
  width: 3,
  height: 2,
  minX: 100,
  minY: 200,
  data: Float32Array.from([10, 20, 30, 40, 50, 60]),
};

describe("elevationAt", () => {
  test("returns the node values at the nodes (row 0 is the SOUTH row)", () => {
    expect(elevationAt(small, 100, 200)).toBe(10);
    expect(elevationAt(small, 110, 200)).toBe(20);
    expect(elevationAt(small, 120, 200)).toBe(30);
    expect(elevationAt(small, 100, 210)).toBe(40);
    expect(elevationAt(small, 110, 210)).toBe(50);
    expect(elevationAt(small, 120, 210)).toBe(60);
  });

  test("interpolates bilinearly inside a cell", () => {
    expect(elevationAt(small, 105, 200)).toBeCloseTo(15, 10); // along the south edge
    expect(elevationAt(small, 100, 205)).toBeCloseTo(25, 10); // along the west edge
    expect(elevationAt(small, 105, 205)).toBeCloseTo(30, 10); // cell centre: mean of 10,20,40,50
    expect(elevationAt(small, 117.5, 202.5)).toBeCloseTo(35, 10);
    // A twisted cell: (0,0)=0, (1,0)=0, (0,1)=0, (1,1)=8 → f(x,y) = 8·x·y.
    const twisted: ElevationGrid = {
      ...small,
      width: 2,
      minX: 0,
      minY: 0,
      cellSizeM: 1,
      data: Float32Array.from([0, 0, 0, 8]),
    };
    expect(elevationAt(twisted, 0.5, 0.5)).toBeCloseTo(2, 10);
    expect(elevationAt(twisted, 0.25, 0.75)).toBeCloseTo(1.5, 10);
  });

  test("clamps to the nearest edge outside the grid", () => {
    expect(elevationAt(small, -1000, 200)).toBe(10);
    expect(elevationAt(small, 1000, 200)).toBe(30);
    expect(elevationAt(small, 110, -1000)).toBe(20);
    expect(elevationAt(small, 110, 1000)).toBe(50);
    expect(elevationAt(small, 1000, 1000)).toBe(60);
    expect(elevationAt(small, -1000, -1000)).toBe(10);
    expect(elevationAt(small, 105, 1000)).toBeCloseTo(45, 10); // still interpolates along the edge
  });

  test("degenerate grids: a single node, a single row, a single column", () => {
    const one: ElevationGrid = { ...small, width: 1, height: 1, data: Float32Array.from([7]) };
    expect(elevationAt(one, 0, 0)).toBe(7);
    expect(elevationAt(one, 100, 200)).toBe(7);
    const row: ElevationGrid = { ...small, height: 1, data: Float32Array.from([10, 20, 30]) };
    expect(elevationAt(row, 115, 999)).toBeCloseTo(25, 10);
    const column: ElevationGrid = { ...small, width: 1, data: Float32Array.from([10, 40]) };
    expect(elevationAt(column, 999, 205)).toBeCloseTo(25, 10);
  });

  test("a flat grid returns its elevation EXACTLY, everywhere", () => {
    fc.assert(
      fc.property(real(-500, 4000), real(-2000, 2000), real(-2000, 2000), (level, x, y) => {
        const flat = elevationGridFrom(
          ORIGIN,
          { minX: -500, minY: -300, cellSizeM: 7.56, width: 40, height: 30 },
          () => level,
        );
        // (=== rather than Object.is: a level of -0 may come back as +0.)
        expect(elevationAt(flat, x, y) === Math.fround(level)).toBe(true);
      }),
    );
  });

  test("reproduces any plane exactly (bilinear interpolation is exact for planes)", () => {
    fc.assert(
      fc.property(
        real(-0.5, 0.5),
        real(-0.5, 0.5),
        real(0, 500),
        real(-150, 150),
        real(-100, 100),
        (gx, gy, c, x, y) => {
          const plane = (px: number, py: number) => c + gx * px + gy * py;
          const grid = elevationGridFrom(
            ORIGIN,
            { minX: -150, minY: -100, cellSizeM: 10, width: 31, height: 21 },
            plane,
          );
          // float32 storage of the nodes: ~1e-4 m at these magnitudes.
          expect(Math.abs(elevationAt(grid, x, y) - plane(x, y))).toBeLessThan(1e-3);
        },
      ),
    );
  });

  test("stays within the range of the surrounding nodes", () => {
    const bumpy = elevationGridFrom(
      ORIGIN,
      { minX: 0, minY: 0, cellSizeM: 5, width: 20, height: 20 },
      (x, y) => 50 + 20 * Math.sin(x / 7) * Math.cos(y / 11),
    );
    fc.assert(
      fc.property(real(0, 95), real(0, 95), (x, y) => {
        const col = Math.min(18, Math.floor(x / 5));
        const row = Math.min(18, Math.floor(y / 5));
        const corners = [0, 1].flatMap((dr) =>
          [0, 1].map((dc) => bumpy.data[(row + dr) * 20 + col + dc]),
        );
        const value = elevationAt(bumpy, x, y);
        expect(value).toBeGreaterThanOrEqual(Math.min(...corners) - 1e-9);
        expect(value).toBeLessThanOrEqual(Math.max(...corners) + 1e-9);
      }),
    );
  });
});

describe("gridContains / terrainElevationAt", () => {
  test("gridContains covers the nodes' extent, edges included", () => {
    expect(gridContains(small, 100, 200)).toBe(true);
    expect(gridContains(small, 120, 210)).toBe(true);
    expect(gridContains(small, 110, 205)).toBe(true);
    expect(gridContains(small, 99.99, 205)).toBe(false);
    expect(gridContains(small, 120.01, 205)).toBe(false);
    expect(gridContains(small, 110, 199.99)).toBe(false);
    expect(gridContains(small, 110, 210.01)).toBe(false);
  });

  test("uses the fine grid where it has data and the coarse grid beyond it", () => {
    const near = elevationGridFrom(
      ORIGIN,
      { minX: -50, minY: -50, cellSizeM: 10, width: 11, height: 11 },
      () => 100,
    );
    const far = elevationGridFrom(
      ORIGIN,
      { minX: -1000, minY: -1000, cellSizeM: 100, width: 21, height: 21 },
      () => 300,
    );
    expect(terrainElevationAt({ near, far }, 0, 0)).toBe(100);
    expect(terrainElevationAt({ near, far }, 50, -50)).toBe(100);
    expect(terrainElevationAt({ near, far }, 51, 0)).toBe(300);
    expect(terrainElevationAt({ near, far }, 0, 900)).toBe(300);
    expect(terrainElevationAt({ near, far }, 5000, 5000)).toBe(300); // clamped far edge
    // Without a far grid the near grid is clamped instead.
    expect(terrainElevationAt({ near }, 5000, 5000)).toBe(100);
  });
});

describe("elevationGridFrom", () => {
  test("lays nodes out from the south-west, row-major", () => {
    const grid = elevationGridFrom(
      ORIGIN,
      { minX: 100, minY: 200, cellSizeM: 10, width: 3, height: 2 },
      (x, y) => x + 1000 * y,
    );
    expect(Array.from(grid.data)).toEqual([200100, 200110, 200120, 210100, 210110, 210120]);
    expect(grid.origin).toEqual(ORIGIN);
    expect(() =>
      elevationGridFrom(ORIGIN, { minX: 0, minY: 0, cellSizeM: 0, width: 3, height: 2 }, () => 0),
    ).toThrow(RangeError);
    expect(() =>
      elevationGridFrom(ORIGIN, { minX: 0, minY: 0, cellSizeM: 1, width: 0, height: 2 }, () => 0),
    ).toThrow(RangeError);
  });
});
