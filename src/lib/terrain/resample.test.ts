import { describe, expect, test } from "vitest";

import { fromLocalMeters, toLocalMeters } from "@/lib/geo/local";
import type { ElevationGrid, LatLng } from "@/lib/types";

import { elevationAt } from "./elevation";
import { buildMosaic, resampleMosaic } from "./resample";
import { syntheticTiles } from "./testing";
import {
  terrainCoverageFor,
  tileGroundWidthM,
  tilesOf,
  tileXToLng,
  tileYToLat,
  type TileBlock,
} from "./tiles";

const TILE = 256;

/** Largest difference between a grid and the function it was sampled from. */
function worstError(
  grid: ElevationGrid,
  elevation: (lat: number, lng: number) => number,
  insetNodes = 2,
): number {
  let worst = 0;
  for (let row = insetNodes; row < grid.height - insetNodes; row += 7) {
    for (let col = insetNodes; col < grid.width - insetNodes; col += 7) {
      const x = grid.minX + col * grid.cellSizeM;
      const y = grid.minY + row * grid.cellSizeM;
      const p = fromLocalMeters(grid.origin, x, y);
      worst = Math.max(
        worst,
        Math.abs(grid.data[row * grid.width + col] - elevation(p.lat, p.lng)),
      );
    }
  }
  return worst;
}

describe("buildMosaic", () => {
  test("stitches tiles row by row from the north-west", () => {
    const block: TileBlock = { zoom: 3, x0: 2, y0: 5, cols: 2, rows: 2 };
    // 2 × 2-pixel tiles: tile t holds t·10 + pixel index.
    const tiles = [0, 1, 2, 3].map((t) => [t * 10, t * 10 + 1, t * 10 + 2, t * 10 + 3]);
    const mosaic = buildMosaic(block, tiles, 2);
    expect(mosaic.width).toBe(4);
    expect(mosaic.height).toBe(4);
    expect(Array.from(mosaic.elevations)).toEqual([
      ...[0, 1, 10, 11],
      ...[2, 3, 12, 13],
      ...[20, 21, 30, 31],
      ...[22, 23, 32, 33],
    ]);
  });

  test("rejects a wrong number of tiles or a wrong tile size", () => {
    const block: TileBlock = { zoom: 3, x0: 2, y0: 5, cols: 2, rows: 2 };
    expect(() => buildMosaic(block, [[1], [2], [3]], 1)).toThrow(RangeError);
    expect(() => buildMosaic(block, [[1], [2], [3], [4, 5]], 1)).toThrow(RangeError);
  });
});

describe("resampleMosaic", () => {
  const SF: LatLng = { lat: 37.7906, lng: -122.4294 };
  const coverage = terrainCoverageFor(SF)!;
  // A sloping plane in geographic coordinates: +50 m per 0.01° east, +80 m per
  // 0.01° north (0.057 m/m and 0.072 m/m: steep enough that an offset of half
  // a pixel, 3.8 m, would show up as a 0.2 m error).
  const plane = (lat: number, lng: number) =>
    300 + 5000 * (lng - coverage.origin.lng) + 8000 * (lat - coverage.origin.lat);

  test("near grid: covers the 2 × 2 block around the origin at native resolution", () => {
    const grid = resampleMosaic(
      buildMosaic(coverage.near, syntheticTiles(coverage.near, plane), TILE),
      coverage.origin,
    );
    const tileWidth = tileGroundWidthM(coverage.origin.lat, 14);
    expect(grid.origin).toEqual(coverage.origin);
    expect(grid.cellSizeM).toBeCloseTo(tileWidth / 256, 1);
    expect(grid.cellSizeM).toBeGreaterThan(7);
    expect(grid.cellSizeM).toBeLessThan(8);
    expect(grid.width).toBeGreaterThanOrEqual(511);
    expect(grid.width).toBeLessThanOrEqual(513);
    expect(grid.data.length).toBe(grid.width * grid.height);
    // Symmetric about the origin (the shared tile corner), one tile each way.
    expect(grid.minX).toBeCloseTo(-tileWidth, -1);
    expect(grid.minX + (grid.width - 1) * grid.cellSizeM).toBeCloseTo(tileWidth, -1);
    expect(Math.abs(grid.minY + ((grid.height - 1) * grid.cellSizeM) / 2)).toBeLessThan(15);
    // The pin itself is well inside.
    const pin = toLocalMeters(coverage.origin, SF);
    expect(pin.x - grid.minX).toBeGreaterThan(600);
    expect(pin.y - grid.minY).toBeGreaterThan(600);
  });

  test("every node holds the elevation of ITS OWN latitude / longitude", () => {
    for (const block of [coverage.near, coverage.far]) {
      const grid = resampleMosaic(
        buildMosaic(block, syntheticTiles(block, plane), TILE),
        coverage.origin,
      );
      // Float32 + bilinear interpolation of a plane: centimetres at most.
      expect(worstError(grid, plane)).toBeLessThan(0.02);
      // Spot check with the sampler: 500 m north-east of the origin.
      const p = fromLocalMeters(coverage.origin, 500, 500);
      expect(elevationAt(grid, 500, 500)).toBeCloseTo(plane(p.lat, p.lng), 1);
    }
  });

  test("orientation: north is +y (higher rows), east is +x (higher columns)", () => {
    const northHigh = resampleMosaic(
      buildMosaic(
        coverage.near,
        syntheticTiles(coverage.near, (lat) => (lat - coverage.origin.lat) * 1e4),
        TILE,
      ),
      coverage.origin,
    );
    expect(elevationAt(northHigh, 0, 1000)).toBeGreaterThan(elevationAt(northHigh, 0, -1000) + 100);
    expect(elevationAt(northHigh, 1000, 0)).toBeCloseTo(elevationAt(northHigh, -1000, 0), 3);
    const eastHigh = resampleMosaic(
      buildMosaic(
        coverage.near,
        syntheticTiles(coverage.near, (_lat, lng) => (lng - coverage.origin.lng) * 1e4),
        TILE,
      ),
      coverage.origin,
    );
    expect(elevationAt(eastHigh, 1000, 0)).toBeGreaterThan(elevationAt(eastHigh, -1000, 0) + 100);
  });

  test("a curved surface is reproduced to within a fraction of a metre", () => {
    // A 150 m hill 400 m across, north-east of the origin.
    const hill = (lat: number, lng: number) => {
      const p = toLocalMeters(coverage.origin, { lat, lng });
      return 150 * Math.exp(-((p.x - 300) ** 2 + (p.y - 200) ** 2) / (2 * 200 ** 2));
    };
    const grid = resampleMosaic(
      buildMosaic(coverage.near, syntheticTiles(coverage.near, hill), TILE),
      coverage.origin,
    );
    expect(worstError(grid, hill)).toBeLessThan(0.1);
    expect(elevationAt(grid, 300, 200)).toBeCloseTo(150, 0);
  });

  test("a custom cell size", () => {
    const grid = resampleMosaic(
      buildMosaic(coverage.near, syntheticTiles(coverage.near, plane), TILE),
      coverage.origin,
      25,
    );
    expect(grid.cellSizeM).toBe(25);
    expect(grid.width).toBe(Math.floor((2 * tileGroundWidthM(coverage.origin.lat, 14)) / 25) + 1);
    expect(worstError(grid, plane)).toBeLessThan(0.02);
    expect(() =>
      resampleMosaic(
        buildMosaic(coverage.near, syntheticTiles(coverage.near, plane), TILE),
        coverage.origin,
        0,
      ),
    ).toThrow(RangeError);
  });

  test("works at other latitudes, in the southern hemisphere and across the antimeridian", () => {
    for (const place of [
      { lat: 0.01, lng: 0.01 },
      { lat: -33.8688, lng: 151.2093 },
      { lat: 69.6492, lng: 18.9553 },
      { lat: -16.8, lng: 179.9999 },
      { lat: 64.5, lng: -179.9999 },
    ]) {
      const c = terrainCoverageFor(place)!;
      const slope = (lat: number, lng: number) => {
        // Continuous across ±180°: measure longitude from the origin.
        const dLng = ((lng - c.origin.lng + 540) % 360) - 180;
        return 500 + 4000 * dLng + 9000 * (lat - c.origin.lat);
      };
      for (const block of [c.near, c.far]) {
        const grid = resampleMosaic(
          buildMosaic(block, syntheticTiles(block, slope), TILE),
          c.origin,
        );
        expect(worstError(grid, slope), `${place.lat},${place.lng} z${block.zoom}`).toBeLessThan(
          0.05,
        );
        const pin = toLocalMeters(c.origin, place);
        expect(pin.x).toBeGreaterThan(grid.minX);
        expect(pin.x).toBeLessThan(grid.minX + (grid.width - 1) * grid.cellSizeM);
        expect(pin.y).toBeGreaterThan(grid.minY);
        expect(pin.y).toBeLessThan(grid.minY + (grid.height - 1) * grid.cellSizeM);
      }
    }
  });
});
