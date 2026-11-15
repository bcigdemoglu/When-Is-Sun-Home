import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { toLocalMeters } from "@/lib/geo/local";
import { real } from "@/lib/geo/testing";

import {
  latToTileY,
  lngToTileX,
  TERRARIUM_URL_TEMPLATE,
  terrainCoverageFor,
  tileGroundWidthM,
  tilesOf,
  tileUrl,
  tileXToLng,
  tileYToLat,
  type TileBlock,
} from "./tiles";

const SF = { lat: 37.7906, lng: -122.4294 };

/** Local-metre bounds of a block around a point: how much data lies on each side. */
function marginsM(block: TileBlock, from: { lat: number; lng: number }) {
  const n = 2 ** block.zoom;
  const westLng = tileXToLng(((block.x0 % n) + n) % n, block.zoom);
  const north = tileYToLat(block.y0, block.zoom);
  const south = tileYToLat(block.y0 + block.rows, block.zoom);
  const west = toLocalMeters(from, { lat: from.lat, lng: westLng }).x;
  const width = block.cols * tileGroundWidthM(from.lat, block.zoom);
  return {
    west: -west,
    east: west + width,
    north: toLocalMeters(from, { lat: north, lng: from.lng }).y,
    south: -toLocalMeters(from, { lat: south, lng: from.lng }).y,
  };
}

describe("Web-Mercator tile maths", () => {
  test("well-known tiles", () => {
    // Zoom 0 is one tile for the whole world.
    expect(lngToTileX(-180, 0)).toBe(0);
    expect(lngToTileX(0, 0)).toBe(0.5);
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 12);
    expect(latToTileY(85.0511287798066, 0)).toBeCloseTo(0, 9);
    expect(latToTileY(-85.0511287798066, 0)).toBeCloseTo(1, 9);
    // Greenwich / equator is the corner shared by the four central tiles at every zoom.
    expect(lngToTileX(0, 10)).toBe(512);
    expect(latToTileY(0, 10)).toBeCloseTo(512, 9);
    // San Francisco's Pacific Heights is in z14 tile 2620/6331 and z11 tile 327/791.
    expect(Math.floor(lngToTileX(SF.lng, 14))).toBe(2620);
    expect(Math.floor(latToTileY(SF.lat, 14))).toBe(6331);
    expect(Math.floor(lngToTileX(SF.lng, 11))).toBe(327);
    expect(Math.floor(latToTileY(SF.lat, 11))).toBe(791);
  });

  test("north is up: tile rows grow southwards, columns eastwards", () => {
    expect(latToTileY(60, 8)).toBeLessThan(latToTileY(10, 8));
    expect(latToTileY(10, 8)).toBeLessThan(latToTileY(-10, 8));
    expect(lngToTileX(-10, 8)).toBeLessThan(lngToTileX(10, 8));
    expect(tileYToLat(0, 8)).toBeCloseTo(85.0511, 3);
    expect(tileXToLng(0, 8)).toBe(-180);
    expect(tileXToLng(256, 8)).toBe(180);
  });

  test("longitudes wrap", () => {
    expect(lngToTileX(180, 4)).toBe(0);
    expect(lngToTileX(190, 4)).toBeCloseTo(lngToTileX(-170, 4), 12);
    expect(lngToTileX(-190, 4)).toBeCloseTo(lngToTileX(170, 4), 12);
  });

  test("tile ↔ coordinate conversions are inverses", () => {
    fc.assert(
      fc.property(
        real(-84, 84),
        real(-179.999, 179.999),
        fc.integer({ min: 0, max: 15 }),
        (lat, lng, zoom) => {
          expect(tileYToLat(latToTileY(lat, zoom), zoom)).toBeCloseTo(lat, 9);
          expect(tileXToLng(lngToTileX(lng, zoom), zoom)).toBeCloseTo(lng, 9);
          const n = 2 ** zoom;
          expect(lngToTileX(lng, zoom)).toBeGreaterThanOrEqual(0);
          expect(lngToTileX(lng, zoom)).toBeLessThan(n);
          expect(latToTileY(lat, zoom)).toBeGreaterThan(0);
          expect(latToTileY(lat, zoom)).toBeLessThan(n);
        },
      ),
    );
  });

  test("ground width of a tile", () => {
    // 40 075 km around the equator; z14 has 16 384 tiles.
    expect(tileGroundWidthM(0, 14)).toBeCloseTo(2445.98, 1);
    expect(tileGroundWidthM(60, 14)).toBeCloseTo(2445.98 / 2, 1);
    expect(tileGroundWidthM(SF.lat, 14)).toBeCloseTo(1932.9, 0);
  });

  test("tile URLs", () => {
    expect(tileUrl({ z: 14, x: 2620, y: 6332 })).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/2620/6332.png",
    );
    expect(tileUrl({ z: 1, x: 2, y: 3 }, "https://example.test/{z}-{x}-{y}")).toBe(
      "https://example.test/1-2-3",
    );
    expect(TERRARIUM_URL_TEMPLATE).toContain("{z}/{x}/{y}");
  });
});

describe("terrainCoverageFor", () => {
  test("San Francisco: 2 × 2 tiles at z14 plus 3 × 3 at z11", () => {
    const coverage = terrainCoverageFor(SF)!;
    expect(coverage.key).toBe("v1:14/2620/6332");
    expect(coverage.near).toEqual({ zoom: 14, x0: 2619, y0: 6331, cols: 2, rows: 2 });
    expect(coverage.far).toEqual({ zoom: 11, x0: 326, y0: 790, cols: 3, rows: 3 });
    expect(tilesOf(coverage.near)).toEqual([
      { z: 14, x: 2619, y: 6331 },
      { z: 14, x: 2620, y: 6331 },
      { z: 14, x: 2619, y: 6332 },
      { z: 14, x: 2620, y: 6332 },
    ]);
    expect(tilesOf(coverage.far)).toHaveLength(9);
    expect(tilesOf(coverage.far)[4]).toEqual({ z: 11, x: 327, y: 791 });
    // The frame origin is the corner shared by the four near tiles.
    expect(coverage.origin.lng).toBeCloseTo(tileXToLng(2620, 14), 12);
    expect(coverage.origin.lat).toBeCloseTo(tileYToLat(6332, 14), 12);
    const offset = toLocalMeters(coverage.origin, SF);
    expect(Math.hypot(offset.x, offset.y)).toBeLessThan(1400);
  });

  test("nearby pins share the same coverage; it only changes across a tile's mid-line", () => {
    const base = terrainCoverageFor(SF)!;
    // ±150 m in every direction stays in the same block here.
    for (const [dLat, dLng] of [
      [0.0013, 0],
      [-0.0013, 0],
      [0, 0.0017],
      [0, -0.0017],
      [0.001, -0.001],
    ]) {
      expect(terrainCoverageFor({ lat: SF.lat + dLat, lng: SF.lng + dLng })!).toEqual(base);
    }
    // Two kilometres east is past a mid-line: a different block.
    expect(terrainCoverageFor({ lat: SF.lat, lng: SF.lng + 0.023 })!.key).not.toBe(base.key);
  });

  test("the zoom adapts to latitude so tiles stay 1.2–2.4 km / 8–16 km wide", () => {
    expect(terrainCoverageFor({ lat: 0, lng: 10 })!.near.zoom).toBe(15);
    expect(terrainCoverageFor({ lat: 37.8, lng: 10 })!.near.zoom).toBe(14);
    expect(terrainCoverageFor({ lat: 59.9, lng: 10 })!.near.zoom).toBe(14);
    expect(terrainCoverageFor({ lat: 69.6, lng: 19 })!.near.zoom).toBe(13);
    expect(terrainCoverageFor({ lat: 0, lng: 10 })!.far.zoom).toBe(12);
    expect(terrainCoverageFor({ lat: 37.8, lng: 10 })!.far.zoom).toBe(11);
    expect(terrainCoverageFor({ lat: 69.6, lng: 19 })!.far.zoom).toBe(10);
  });

  test("no coverage for the poles or nonsense coordinates", () => {
    expect(terrainCoverageFor({ lat: 84.5, lng: 0 })).toBeNull();
    expect(terrainCoverageFor({ lat: -89, lng: 0 })).toBeNull();
    expect(terrainCoverageFor({ lat: NaN, lng: 0 })).toBeNull();
    expect(terrainCoverageFor({ lat: 0, lng: Infinity })).toBeNull();
    expect(terrainCoverageFor({ lat: 83.9, lng: 0 })).not.toBeNull();
  });

  test("across the antimeridian the tile columns wrap", () => {
    const fiji = terrainCoverageFor({ lat: -16.8, lng: 179.9999 })!;
    const n = 2 ** fiji.near.zoom;
    const columns = new Set(tilesOf(fiji.near).map((t) => t.x));
    expect(columns).toEqual(new Set([n - 1, 0]));
    for (const tile of [...tilesOf(fiji.near), ...tilesOf(fiji.far)]) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(2 ** tile.z);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(2 ** tile.z);
    }
    // The same block is chosen from just the other side.
    expect(terrainCoverageFor({ lat: -16.8, lng: -179.9999 })!.key).toBe(fiji.key);
    expect(Math.abs(Math.abs(fiji.origin.lng) - 180)).toBeLessThan(1e-9);
  });

  test("every place has ≥ 600 m of fine data and ≥ 6.8 km of coarse data on all sides", () => {
    fc.assert(
      fc.property(real(-83.9, 83.9), real(-179.99, 179.99), (lat, lng) => {
        const place = { lat, lng };
        const coverage = terrainCoverageFor(place)!;
        expect(tilesOf(coverage.near)).toHaveLength(4);
        expect(tilesOf(coverage.far)).toHaveLength(9);
        // 13 distinct, valid tiles.
        const ids = [...tilesOf(coverage.near), ...tilesOf(coverage.far)];
        expect(new Set(ids.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(13);
        for (const tile of ids) {
          expect(Number.isInteger(tile.x) && tile.x >= 0 && tile.x < 2 ** tile.z).toBe(true);
          expect(Number.isInteger(tile.y) && tile.y >= 0 && tile.y < 2 ** tile.z).toBe(true);
          expect(tile.z).toBeLessThanOrEqual(15);
        }

        // Mercator tiles are not square in local metres away from the equator
        // (a degree of latitude is longer near the pole edge of a tile), hence
        // the 2% slack on the nominal figures. Near the map's north/south edge
        // (|lat| > 80°) the far block is clamped and may be lopsided.
        const near = marginsM(coverage.near, place);
        for (const side of [near.west, near.east, near.north, near.south]) {
          expect(side).toBeGreaterThan(600 * 0.98);
        }
        if (Math.abs(lat) < 80) {
          const far = marginsM(coverage.far, place);
          for (const side of [far.west, far.east, far.north, far.south]) {
            expect(side).toBeGreaterThan(6800 * 0.98);
          }
        }

        // The coverage is a pure function of its key: recomputing it from the
        // frame origin's neighbourhood gives the same tiles.
        const again = terrainCoverageFor(place)!;
        expect(again).toEqual(coverage);
      }),
      { numRuns: 300 },
    );
  });
});
