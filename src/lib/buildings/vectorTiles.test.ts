import { readFileSync } from "node:fs";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BuildingCollection, BuildingFeature } from "@/lib/types";
import { isAbortError, signedRingArea } from "./overpass";
import { box, encodeBuildingTile as encodeTile, type XY } from "./testing";
import { fetchAreaFor } from "./tiles";
import {
  BuildingTilesError,
  OPENFREEMAP_LATEST_TEMPLATE,
  OPENFREEMAP_TILEJSON_URL,
  boundsOfCircle,
  decodeBuildingTiles,
  fetchBuildingsFromTiles,
  heightFromRenderHeight,
  latToTileY,
  lngToTileX,
  loadTileTemplate,
  resetTileTemplate,
  templateFromTileJson,
  tileUrl,
  tileXToLng,
  tileYToLat,
  tilesForCircle,
  type TileRef,
} from "./vectorTiles";

// ─── Real fixtures ─────────────────────────────────────────────────────────

const FIXTURES = new URL("../../../tests/fixtures/", import.meta.url);
const REAL_TEMPLATE = "https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf";

function fixtureTile(tile: { z: number; x: number; y: number }): Uint8Array {
  return readFileSync(new URL(`openfreemap/${tile.z}/${tile.x}/${tile.y}.pbf`, FIXTURES));
}

const TILEJSON = readFileSync(new URL("openfreemap/planet.json", FIXTURES), "utf8");

/** The pin of the browser tests, and the fetch area the app derives from it. */
const PIN = { lat: 37.7912, lng: -122.4301 };
const AREA = fetchAreaFor(PIN);
const AREA_TILES = tilesForCircle(AREA.center, AREA.radiusM);

function decodeArea(): BuildingCollection {
  return decodeBuildingTiles(
    AREA_TILES.map((tile) => ({ tile, data: fixtureTile(tile) })),
    { bounds: boundsOfCircle(AREA.center, AREA.radiusM) },
  );
}

// ─── Hand-made tiles ───────────────────────────────────────────────────────

/** A building given in WORLD units, as tile (col, row) would hold it: shifted and clipped to the tile plus its 64-unit buffer. */
function seenFrom(col: number, row: number, rect: [number, number, number, number]): XY[] | null {
  const x1 = Math.max(rect[0] - col * 4096, -64);
  const y1 = Math.max(rect[1] - row * 4096, -64);
  const x2 = Math.min(rect[2] - col * 4096, 4160);
  const y2 = Math.min(rect[3] - row * 4096, 4160);
  return x1 < x2 && y1 < y2 ? box(x1, y1, x2, y2) : null;
}

const Z = 14;
const tileAt = (col: number, row: number): TileRef => ({
  z: Z,
  x: ((col % 2 ** Z) + 2 ** Z) % 2 ** Z,
  y: row,
  col,
});
const A = tileAt(2620, 6331);
const B = tileAt(2621, 6331);

/** Tiles for buildings given as world rectangles: every tile gets what it would really contain. */
function tilesFor(
  tiles: TileRef[],
  buildings: { rect: [number, number, number, number]; height?: number }[],
) {
  return tiles.map((tile) => ({
    tile,
    data: encodeTile(
      buildings.flatMap(({ rect, height }) => {
        const ring = seenFrom(tile.col, tile.y, rect);
        return ring ? [{ polygons: [[ring]], height }] : [];
      }),
    ),
  }));
}

/** World units of a point `dx` right of and `dy` below the top-left corner of tile A. */
const world = (dx: number, dy: number): XY => [A.col * 4096 + dx, A.y * 4096 + dy];
const rectAt = (
  dx1: number,
  dy1: number,
  dx2: number,
  dy2: number,
): [number, number, number, number] => [...world(dx1, dy1), ...world(dx2, dy2)];

/** World units → [lng, lat], unrounded. */
function toLngLat([x, y]: XY): Position {
  return [tileXToLng(x / 4096, Z), tileYToLat(y / 4096, Z)];
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointInRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(feature: BuildingFeature, point: Position): boolean {
  return polygonsOf(feature.geometry).some(
    ([outer, ...holes]) =>
      pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)),
  );
}

function bboxOf(feature: BuildingFeature): [number, number, number, number] {
  const points = polygonsOf(feature.geometry).flatMap((rings) => rings[0]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}

function expectValidGeometry(geometry: Polygon | MultiPolygon) {
  for (const rings of polygonsOf(geometry)) {
    expect(rings.length).toBeGreaterThan(0);
    rings.forEach((ring, index) => {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[ring.length - 1]).toEqual(ring[0]);
      const area = signedRingArea(ring);
      if (index === 0) expect(area).toBeGreaterThan(0);
      else expect(area).toBeLessThan(0);
    });
  }
}

beforeEach(() => {
  resetTileTemplate();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tile maths ────────────────────────────────────────────────────────────

describe("tile maths", () => {
  test("longitude/latitude ↔ tile coordinates round-trip", () => {
    for (const [lat, lng] of [
      [37.7912, -122.4301],
      [52.3731, 4.8922],
      [-33.8568, 151.2153],
      [0, 0],
      [69.65, 18.96],
    ]) {
      expect(tileXToLng(lngToTileX(lng, 14), 14)).toBeCloseTo(lng, 10);
      expect(tileYToLat(latToTileY(lat, 14), 14)).toBeCloseTo(lat, 10);
    }
    expect(lngToTileX(-180, 14)).toBe(0);
    expect(latToTileY(0, 14)).toBeCloseTo(8192, 9);
    expect(Math.floor(lngToTileX(-122.4301, 14))).toBe(2620);
    expect(Math.floor(latToTileY(37.7912, 14))).toBe(6331);
    expect(Math.floor(lngToTileX(4.8922, 14))).toBe(8414);
    expect(Math.floor(latToTileY(52.3731, 14))).toBe(5384);
  });

  test("the browser-test pin's area needs four tiles", () => {
    expect(AREA_TILES).toEqual([
      { z: 14, x: 2619, y: 6331, col: 2619 },
      { z: 14, x: 2620, y: 6331, col: 2620 },
      { z: 14, x: 2619, y: 6332, col: 2619 },
      { z: 14, x: 2620, y: 6332, col: 2620 },
    ]);
  });

  test("a circle inside one tile needs one tile", () => {
    const centre = { lat: tileYToLat(5384.5, 14), lng: tileXToLng(8414.5, 14) };
    expect(tilesForCircle(centre, 500)).toEqual([{ z: 14, x: 8414, y: 5384, col: 8414 }]);
  });

  test("every tile touched by the circle's bounding box is included, nothing else", () => {
    for (const centre of [PIN, { lat: 52.3731, lng: 4.8922 }, { lat: -33.86, lng: 151.21 }]) {
      const tiles = tilesForCircle(centre, 500);
      expect(tiles.length).toBeGreaterThanOrEqual(1);
      expect(tiles.length).toBeLessThanOrEqual(4);
      const bounds = boundsOfCircle(centre, 500);
      for (const [lng, lat] of [
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.west, bounds.south],
        [bounds.east, bounds.south],
        [centre.lng, centre.lat],
      ]) {
        const col = Math.floor(lngToTileX(lng, 14));
        const row = Math.floor(latToTileY(lat, 14));
        expect(tiles.some((t) => t.col === col && t.y === row)).toBe(true);
      }
    }
  });

  test("boundsOfCircle is the circle's box in degrees", () => {
    const bounds = boundsOfCircle({ lat: 60, lng: 10 }, 500);
    expect((bounds.north - bounds.south) * 110_574).toBeCloseTo(1000, 6);
    expect((bounds.east - bounds.west) * 111_320 * 0.5).toBeCloseTo(1000, 6);
  });

  test("across the antimeridian columns continue, tile x wraps", () => {
    const tiles = tilesForCircle({ lat: -16.8, lng: 179.9999 }, 500);
    expect(tiles.map((t) => [t.col, t.x])).toEqual([
      [16383, 16383],
      [16384, 0],
    ]);
    const west = tilesForCircle({ lat: -16.8, lng: -179.9999 }, 500);
    expect(west.map((t) => [t.col, t.x])).toEqual([
      [-1, 16383],
      [0, 0],
    ]);
  });

  test("far north the tiles are small, so there are more of them; rows stay on the map", () => {
    const tiles = tilesForCircle({ lat: 78.22, lng: 15.65 }, 500);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.length).toBeLessThanOrEqual(12);
    for (const pole of [89.99, -89.99]) {
      for (const tile of tilesForCircle({ lat: pole, lng: 0 }, 500, 3)) {
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(8);
      }
    }
  });

  test("rejects nonsense", () => {
    expect(() => tilesForCircle({ lat: Number.NaN, lng: 0 }, 500)).toThrow(RangeError);
    expect(() => tilesForCircle({ lat: 0, lng: 0 }, 0)).toThrow(RangeError);
  });

  test("tileUrl fills the template", () => {
    expect(tileUrl(REAL_TEMPLATE, { z: 14, x: 2620, y: 6331 })).toBe(
      "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2620/6331.pbf",
    );
  });
});

// ─── Heights ───────────────────────────────────────────────────────────────

describe("heightFromRenderHeight", () => {
  test("a real value is used as it is and reported as tagged", () => {
    expect(heightFromRenderHeight(12)).toEqual({ heightM: 12, heightSource: "tagged" });
    expect(heightFromRenderHeight(1)).toEqual({ heightM: 1, heightSource: "tagged" });
    expect(heightFromRenderHeight(4)).toEqual({ heightM: 4, heightSource: "tagged" });
    expect(heightFromRenderHeight(6)).toEqual({ heightM: 6, heightSource: "tagged" });
    expect(heightFromRenderHeight(63.5)).toEqual({ heightM: 63.5, heightSource: "tagged" });
  });

  test("the schema's default of 5 m means nobody tagged a height", () => {
    expect(heightFromRenderHeight(5)).toEqual({ heightM: 7, heightSource: "default" });
  });

  test.each([[0], [-3], [Number.NaN], [undefined], ["12"], [null], [Number.POSITIVE_INFINITY]])(
    "an unusable value (%j) is a default too",
    (value) => {
      expect(heightFromRenderHeight(value)).toEqual({ heightM: 7, heightSource: "default" });
    },
  );

  test("absurd values are capped", () => {
    expect(heightFromRenderHeight(5000).heightM).toBe(1000);
  });
});

// ─── Decoding hand-made tiles ──────────────────────────────────────────────

describe("decodeBuildingTiles: one tile", () => {
  test("every polygon of every feature is one building", () => {
    const data = encodeTile([
      { polygons: [[box(100, 100, 200, 200)], [box(300, 100, 400, 200)]], height: 12 },
      { polygons: [[box(500, 500, 600, 600)]], height: 30 },
    ]);
    const { features } = decodeBuildingTiles([{ tile: A, data }]);
    expect(features.map((f) => f.properties)).toEqual([
      {
        id: "tile/14/2620/6331/0.0",
        heightM: 12,
        heightSource: "tagged",
        levels: null,
        kind: "yes",
      },
      {
        id: "tile/14/2620/6331/0.1",
        heightM: 12,
        heightSource: "tagged",
        levels: null,
        kind: "yes",
      },
      {
        id: "tile/14/2620/6331/1.0",
        heightM: 30,
        heightSource: "tagged",
        levels: null,
        kind: "yes",
      },
    ]);
    for (const feature of features) {
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("Polygon");
      expectValidGeometry(feature.geometry);
      expect("name" in feature.properties).toBe(false);
    }
  });

  test("tile units become longitude/latitude, rounded to 7 decimals", () => {
    const data = encodeTile([{ polygons: [[box(0, 0, 4096, 2048)]] }]);
    const [feature] = decodeBuildingTiles([{ tile: A, data }]).features;
    const [west, south, east, north] = bboxOf(feature);
    expect(west).toBeCloseTo(tileXToLng(2620, 14), 7);
    expect(east).toBeCloseTo(tileXToLng(2621, 14), 7);
    expect(north).toBeCloseTo(tileYToLat(6331, 14), 7);
    expect(south).toBeCloseTo(tileYToLat(6331.5, 14), 7);
    expect(JSON.stringify(feature.geometry)).not.toMatch(/\.\d{8,}/);
  });

  test("holes survive, wound the other way", () => {
    const data = encodeTile([
      { polygons: [[box(100, 100, 500, 500), box(200, 200, 300, 300), box(350, 350, 450, 450)]] },
    ]);
    const [feature] = decodeBuildingTiles([{ tile: A, data }]).features;
    const rings = (feature.geometry as Polygon).coordinates;
    expect(rings).toHaveLength(3);
    expectValidGeometry(feature.geometry);
    expect(contains(feature, toLngLat(world(150, 150)))).toBe(true);
    expect(contains(feature, toLngLat(world(250, 250)))).toBe(false);
  });

  test("hide_3d outlines are skipped; their parts stand in for them", () => {
    const data = encodeTile([
      { polygons: [[box(100, 100, 500, 500)]], height: 40, hide3d: true },
      { polygons: [[box(100, 100, 500, 300)]], height: 15 },
      { polygons: [[box(100, 300, 500, 500)]], height: 40, minHeight: 15 },
    ]);
    const { features } = decodeBuildingTiles([{ tile: A, data }]);
    expect(features.map((f) => f.properties.heightM)).toEqual([15, 40]);
  });

  test("a part that starts above the ground is still a solid block from the ground", () => {
    const data = encodeTile([{ polygons: [[box(100, 100, 200, 200)]], height: 60, minHeight: 45 }]);
    expect(decodeBuildingTiles([{ tile: A, data }]).features[0].properties.heightM).toBe(60);
  });

  test("lines, points and clipping debris are ignored", () => {
    const data = encodeTile([
      { polygons: [[box(100, 100, 200, 200)]], type: 2 },
      { polygons: [[box(100, 100, 200, 200)]], type: 1 },
      { polygons: [[box(300, 300, 301, 302)]] },
      {
        polygons: [
          [
            [
              [400, 400],
              [450, 400],
              [500, 400],
            ],
          ],
        ],
      },
      { polygons: [[box(600, 600, 700, 700)]], height: 9 },
    ]);
    const { features } = decodeBuildingTiles([{ tile: A, data }]);
    expect(features.map((f) => f.properties.heightM)).toEqual([9]);
  });

  test("only the building layer is read", () => {
    const roads = encodeTile([{ polygons: [[box(0, 0, 100, 100)]] }], "transportation");
    const buildings = encodeTile([{ polygons: [[box(200, 200, 300, 300)]], height: 8 }]);
    const both = new Uint8Array([...roads, ...buildings]);
    expect(decodeBuildingTiles([{ tile: A, data: roads }]).features).toEqual([]);
    expect(decodeBuildingTiles([{ tile: A, data: both }]).features).toHaveLength(1);
  });

  test("an empty tile (no bytes, e.g. open water) has no buildings", () => {
    const empty = { type: "FeatureCollection", features: [] };
    expect(decodeBuildingTiles([])).toEqual(empty);
    expect(decodeBuildingTiles([{ tile: A, data: new Uint8Array(0) }])).toEqual(empty);
    expect(decodeBuildingTiles([{ tile: A, data: new ArrayBuffer(0) }])).toEqual(empty);
    expect(decodeBuildingTiles([{ tile: A, data: encodeTile([]) }])).toEqual(empty);
  });

  test("bytes that are not a vector tile are reported, not swallowed", () => {
    for (const junk of [
      new TextEncoder().encode("<html><body>Bad gateway</body></html>"),
      encodeTile([{ polygons: [[box(100, 100, 200, 200)]] }]).subarray(0, 30),
    ]) {
      let error: unknown;
      try {
        decodeBuildingTiles([{ tile: A, data: junk }]);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BuildingTilesError);
      expect((error as BuildingTilesError).kind).toBe("malformed");
    }
  });

  test("untagged buildings (5 m in the tile) take the neighbourhood's median instead", () => {
    const tagged = Array.from({ length: 11 }, (_, i) => ({
      polygons: [[box(100 + i * 60, 100, 150 + i * 60, 150)]],
      height: 10 + i,
    }));
    const data = encodeTile([
      ...tagged,
      // 50 × 50 units ≈ 24 m × 24 m: an ordinary house.
      { polygons: [[box(100, 400, 150, 450)]], height: 5 },
      // 6 × 6 units ≈ 3 m × 3 m: a shed.
      { polygons: [[box(300, 400, 306, 406)]], height: 5 },
    ]);
    const { features } = decodeBuildingTiles([{ tile: A, data }]);
    const defaults = features.filter((f) => f.properties.heightSource === "default");
    expect(defaults.map((f) => f.properties.heightM)).toEqual([15, 3]);
    expect(features.filter((f) => f.properties.heightSource === "tagged")).toHaveLength(11);
  });

  test("without enough tagged neighbours an untagged building is 7 m, not the tile's 5 m", () => {
    const data = encodeTile([
      { polygons: [[box(100, 400, 150, 450)]], height: 5 },
      { polygons: [[box(300, 400, 350, 450)]], height: 20 },
    ]);
    const { features } = decodeBuildingTiles([{ tile: A, data }]);
    expect(features.map((f) => [f.properties.heightM, f.properties.heightSource])).toEqual([
      [7, "default"],
      [20, "tagged"],
    ]);
  });

  test("with bounds, only buildings whose box touches them are kept", () => {
    const data = encodeTile([
      { polygons: [[box(1000, 1000, 1100, 1100)]], height: 11 },
      { polygons: [[box(3000, 3000, 3100, 3100)]], height: 22 },
      { polygons: [[box(1990, 1990, 2100, 2100)]], height: 33 },
    ]);
    const corner = (dx: number, dy: number) => toLngLat(world(dx, dy));
    const [west, north] = corner(900, 900);
    const [east, south] = corner(2000, 2000);
    const { features } = decodeBuildingTiles([{ tile: A, data }], {
      bounds: { west, east, north, south },
    });
    expect(features.map((f) => f.properties.heightM)).toEqual([11, 33]);
  });

  test("tiles of different zooms cannot be mixed", () => {
    const data = encodeTile([{ polygons: [[box(100, 100, 200, 200)]] }]);
    expect(() =>
      decodeBuildingTiles([
        { tile: A, data },
        { tile: { z: 13, x: 1310, y: 3165, col: 1310 }, data },
      ]),
    ).toThrow(BuildingTilesError);
  });
});

describe("decodeBuildingTiles: buildings at tile edges", () => {
  /** x = 4096 in tile A's units is the edge between A and B. */
  const EDGE = 4096;

  test("a building wholly inside one tile but within the other's buffer appears once", () => {
    // 20 units from the edge, inside A. B sees it too, in its buffer.
    const tiles = tilesFor([A, B], [{ rect: rectAt(EDGE - 60, 500, EDGE - 20, 560), height: 9 }]);
    expect(decodeBuildingTiles([tiles[0]]).features).toHaveLength(1);
    // On its own, B does not claim a building that lies outside its square.
    expect(decodeBuildingTiles([tiles[1]]).features).toHaveLength(0);
    const { features } = decodeBuildingTiles(tiles);
    expect(features.map((f) => f.properties.id)).toEqual(["tile/14/2620/6331/0.0"]);
  });

  test("a small building on the edge is complete in both tiles and is kept once", () => {
    const tiles = tilesFor([A, B], [{ rect: rectAt(EDGE - 30, 500, EDGE + 30, 560), height: 9 }]);
    expect(decodeBuildingTiles([tiles[0]]).features).toHaveLength(1);
    expect(decodeBuildingTiles([tiles[1]]).features).toHaveLength(1);
    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe("Polygon");
    expect(contains(features[0], toLngLat(world(EDGE - 20, 530)))).toBe(true);
    expect(contains(features[0], toLngLat(world(EDGE + 20, 530)))).toBe(true);
  });

  test("cut in one tile, whole in the other: the whole one is used", () => {
    // Reaches 30 units into A (so B, with its 64-unit buffer, has all of it)
    // and 300 units into B (so A's copy is cut off at its buffer's edge).
    const rect = rectAt(EDGE - 30, 500, EDGE + 300, 560);
    const tiles = tilesFor([A, B], [{ rect, height: 14 }]);
    const alone = decodeBuildingTiles([tiles[0]]).features;
    expect(alone).toHaveLength(1);
    // A's own copy stops at the buffer's edge.
    expect(bboxOf(alone[0])[2]).toBeCloseTo(toLngLat(world(EDGE + 64, 0))[0], 7);

    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(1);
    expect(features[0].properties.id).toBe("tile/14/2621/6331/0.0");
    expect(features[0].geometry.type).toBe("Polygon");
    const [west, , east] = bboxOf(features[0]);
    expect(west).toBeCloseTo(toLngLat(world(EDGE - 30, 0))[0], 7);
    expect(east).toBeCloseTo(toLngLat(world(EDGE + 300, 0))[0], 7);
  });

  test("cut in both tiles: the two halves become one MultiPolygon feature", () => {
    const rect = rectAt(EDGE - 300, 500, EDGE + 300, 700);
    const tiles = tilesFor([A, B], [{ rect, height: 37 }]);
    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(1);
    const [feature] = features;
    expect(feature.properties).toMatchObject({
      id: "tile/14/2620/6331/0.0",
      heightM: 37,
      heightSource: "tagged",
    });
    expect(feature.geometry.type).toBe("MultiPolygon");
    expect((feature.geometry as MultiPolygon).coordinates).toHaveLength(2);
    expectValidGeometry(feature.geometry);

    // One building for "which building is the pin in", wherever the pin is.
    for (const dx of [-290, -100, -1, 1, 30, 63, 65, 290]) {
      expect(contains(feature, toLngLat(world(EDGE + dx, 600))), `dx ${dx}`).toBe(true);
    }
    expect(contains(feature, toLngLat(world(EDGE + 310, 600)))).toBe(false);
    expect(contains(feature, toLngLat(world(EDGE - 310, 600)))).toBe(false);
    // Together the halves span the whole building.
    const [west, south, east, north] = bboxOf(feature);
    expect([west, north]).toEqual(toLngLat(world(EDGE - 300, 500)).map((v) => +v.toFixed(7)));
    expect([east, south]).toEqual(toLngLat(world(EDGE + 300, 700)).map((v) => +v.toFixed(7)));
  });

  test("the result does not depend on the order the tiles arrive in", () => {
    const tiles = tilesFor(
      [A, B],
      [
        { rect: rectAt(EDGE - 300, 500, EDGE + 300, 700), height: 37 },
        { rect: rectAt(EDGE - 30, 900, EDGE + 300, 960), height: 14 },
        { rect: rectAt(EDGE - 30, 1500, EDGE + 30, 1560), height: 9 },
        { rect: rectAt(100, 100, 200, 200), height: 20 },
      ],
    );
    const forwards = decodeBuildingTiles(tiles);
    expect(forwards.features).toHaveLength(4);
    expect(decodeBuildingTiles([...tiles].reverse())).toEqual(forwards);
  });

  test("halves with different heights are different buildings", () => {
    const rect = rectAt(EDGE - 300, 500, EDGE + 300, 700);
    const tiles = [
      { tile: A, data: encodeTile([{ polygons: [[seenFrom(A.col, A.y, rect)!]], height: 20 }]) },
      { tile: B, data: encodeTile([{ polygons: [[seenFrom(B.col, B.y, rect)!]], height: 25 }]) },
    ];
    expect(decodeBuildingTiles(tiles).features).toHaveLength(2);
  });

  test("two terraced houses of the same height crossing the edge stay two buildings", () => {
    const tiles = tilesFor(
      [A, B],
      [
        { rect: rectAt(EDGE - 300, 500, EDGE + 300, 600), height: 12 },
        { rect: rectAt(EDGE - 300, 600, EDGE + 300, 700), height: 12 },
      ],
    );
    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(2);
    for (const feature of features) {
      expect((feature.geometry as MultiPolygon).coordinates).toHaveLength(2);
    }
    const upper = features.find((f) => contains(f, toLngLat(world(EDGE - 200, 550))))!;
    const lower = features.find((f) => contains(f, toLngLat(world(EDGE - 200, 650))))!;
    expect(upper).not.toBe(lower);
    expect(contains(upper, toLngLat(world(EDGE + 200, 550)))).toBe(true);
    expect(contains(upper, toLngLat(world(EDGE + 200, 650)))).toBe(false);
    expect(contains(lower, toLngLat(world(EDGE + 200, 650)))).toBe(true);
  });

  test("a building over the corner of four tiles is one feature", () => {
    const C = tileAt(2620, 6332);
    const D = tileAt(2621, 6332);
    const rect = rectAt(EDGE - 300, EDGE - 300, EDGE + 300, EDGE + 300);
    const tiles = tilesFor([A, B, C, D], [{ rect, height: 50 }]);
    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(1);
    expect((features[0].geometry as MultiPolygon).coordinates).toHaveLength(4);
    for (const [dx, dy] of [
      [-200, -200],
      [200, -200],
      [-200, 200],
      [200, 200],
    ]) {
      expect(contains(features[0], toLngLat(world(EDGE + dx, EDGE + dy)))).toBe(true);
    }
  });

  test("a north-south edge works like an east-west one", () => {
    const C = tileAt(2620, 6332);
    const rect = rectAt(500, EDGE - 300, 700, EDGE + 300);
    const { features } = decodeBuildingTiles(tilesFor([A, C], [{ rect, height: 18 }]));
    expect(features).toHaveLength(1);
    expect((features[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  test("a cut building whose other tile was not fetched is kept as far as it goes", () => {
    const rect = rectAt(EDGE - 300, 500, EDGE + 300, 700);
    const [onlyA] = tilesFor([A], [{ rect, height: 37 }]);
    const { features } = decodeBuildingTiles([onlyA]);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe("Polygon");
  });

  test("a courtyard building cut by the edge keeps its courtyard", () => {
    // A square ring of a building, 800 units across with a 400-unit courtyard,
    // centred on the edge. Each tile holds a "C": the cut runs through the
    // courtyard, so the clipping leaves two separate cut edges per tile.
    const c = (x0: number, open: number): XY[] => [
      [x0, 400],
      [open, 400],
      [open, 600],
      [x0 + Math.sign(open - x0) * 200, 600],
      [x0 + Math.sign(open - x0) * 200, 1000],
      [open, 1000],
      [open, 1200],
      [x0, 1200],
    ];
    const tiles = [
      { tile: A, data: encodeTile([{ polygons: [[c(EDGE - 400, 4160)]], height: 22 }]) },
      { tile: B, data: encodeTile([{ polygons: [[c(400, -64)]], height: 22 }]) },
    ];
    const { features } = decodeBuildingTiles(tiles);
    expect(features).toHaveLength(1);
    expect((features[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
    expect(contains(features[0], toLngLat(world(EDGE - 300, 800)))).toBe(true);
    expect(contains(features[0], toLngLat(world(EDGE + 300, 800)))).toBe(true);
    expect(contains(features[0], toLngLat(world(EDGE - 150, 800)))).toBe(false);
    expect(contains(features[0], toLngLat(world(EDGE + 150, 800)))).toBe(false);
    expect(contains(features[0], toLngLat(world(EDGE + 10, 500)))).toBe(true);
  });

  test("a lone building near the edge is not mistaken for a cut one", () => {
    // Nothing in these tiles reaches the buffer's edge except the cut copy
    // in A; B's complete copy has a wall parallel to the edge, 30 units out.
    const rect = rectAt(EDGE - 30, 500, EDGE + 300, 560);
    const { features } = decodeBuildingTiles(tilesFor([A, B], [{ rect, height: 14 }]));
    expect(features.map((f) => f.geometry.type)).toEqual(["Polygon"]);
    // And a sparse tile on its own: complete buildings stay plain polygons.
    const sparse = encodeTile([{ polygons: [[box(-30, 100, 80, 200)]], height: 8 }]);
    expect(decodeBuildingTiles([{ tile: B, data: sparse }]).features).toHaveLength(1);
  });

  test("a building needed for the area brings its far half along, even from outside the bounds", () => {
    const rect = rectAt(EDGE - 300, 500, EDGE + 300, 700);
    const tiles = tilesFor([A, B], [{ rect, height: 37 }]);
    const [west, north] = toLngLat(world(EDGE - 1000, 0));
    const [east, south] = toLngLat(world(EDGE - 250, 1000));
    const { features } = decodeBuildingTiles(tiles, { bounds: { west, east, north, south } });
    expect(features).toHaveLength(1);
    expect((features[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
    expect(contains(features[0], toLngLat(world(EDGE + 200, 600)))).toBe(true);
  });

  test("across the antimeridian", () => {
    const last = tileAt(16383, 6331);
    const first = tileAt(16384, 6331);
    expect(first.x).toBe(0);
    const edge = 16384 * 4096;
    const rect: [number, number, number, number] = [
      edge - 300,
      6331 * 4096 + 500,
      edge + 300,
      6331 * 4096 + 700,
    ];
    const { features } = decodeBuildingTiles(tilesFor([last, first], [{ rect, height: 10 }]));
    expect(features).toHaveLength(1);
    const lngs = polygonsOf(features[0].geometry).flatMap((rings) => rings[0].map((p) => p[0]));
    for (const lng of lngs) {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThan(180);
    }
    expect(Math.max(...lngs)).toBeGreaterThan(179.99);
    expect(Math.min(...lngs)).toBeLessThan(-179.99);
  });
});

// ─── Real tiles ────────────────────────────────────────────────────────────

describe("decodeBuildingTiles: real OpenFreeMap tiles (Pacific Heights)", () => {
  const collection = decodeArea();
  const bounds = boundsOfCircle(AREA.center, AREA.radiusM);

  test("reproduces the parsed fixture", () => {
    // Regenerate both with `pnpm fetch-fixture` when the conversion changes.
    const expected = JSON.parse(
      readFileSync(new URL("pacific-heights.buildings.json", FIXTURES), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(collection))).toEqual(expected);
  });

  test("every building of the area, once, as valid geometry", () => {
    expect(collection.features).toHaveLength(1600);
    const ids = collection.features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^tile\/14\/26(19|20)\/633[12]\/\d+\.\d+$/);

    const shapes = new Set<string>();
    for (const feature of collection.features) {
      expectValidGeometry(feature.geometry);
      const [west, south, east, north] = bboxOf(feature);
      expect(east).toBeGreaterThanOrEqual(bounds.west);
      expect(west).toBeLessThanOrEqual(bounds.east);
      expect(north).toBeGreaterThanOrEqual(bounds.south);
      expect(south).toBeLessThanOrEqual(bounds.north);
      shapes.add(JSON.stringify(feature.geometry));
    }
    // No building twice, although every tile pair shares a strip of buildings.
    expect(shapes.size).toBe(collection.features.length);
    expect(JSON.stringify(collection)).not.toMatch(/\.\d{8,}/);
  });

  test("the tiles overlap: decoded one by one they hold more than together", () => {
    const separately = AREA_TILES.map(
      (tile) =>
        decodeBuildingTiles([{ tile, data: fixtureTile(tile) }], { bounds }).features.length,
    );
    expect(separately.every((count) => count > 100)).toBe(true);
    const sum = separately.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(collection.features.length);
    expect(sum - collection.features.length).toBeLessThan(100);
  });

  test("heights: whole metres from the tiles; untagged buildings take the local median", () => {
    const counts = { tagged: 0, levels: 0, default: 0 };
    const defaults = new Map<number, number>();
    const tagged: number[] = [];
    for (const { properties } of collection.features) {
      counts[properties.heightSource]++;
      expect(properties.heightM).toBeGreaterThan(0);
      expect(properties.heightM).toBeLessThan(150);
      expect(properties.levels).toBeNull();
      expect(properties.kind).toBe("yes");
      if (properties.heightSource === "tagged") {
        expect(Number.isInteger(properties.heightM)).toBe(true);
        expect(properties.heightM).not.toBe(5);
        tagged.push(properties.heightM);
      } else {
        defaults.set(properties.heightM, (defaults.get(properties.heightM) ?? 0) + 1);
      }
    }
    expect(counts).toEqual({ tagged: 1245, levels: 0, default: 355 });
    tagged.sort((a, b) => a - b);
    expect(tagged[Math.floor(tagged.length / 2)]).toBe(11);
    // Ordinary footprints: the median. Small ones: 7 m. Sheds: 3 m.
    expect(Object.fromEntries(defaults)).toEqual({ 11: 308, 7: 25, 3: 22 });
  });

  test("agrees with OpenStreetMap as fetched through Overpass", () => {
    // The older, Overpass-derived fixture of the same neighbourhood.
    const legacy = JSON.parse(
      readFileSync(new URL("pacific-heights.legacy.geojson", FIXTURES), "utf8"),
    ) as {
      features: {
        properties: { height: number; heightSource: string; name?: string };
        geometry: Polygon;
      }[];
    };
    let found = 0;
    let sameHeight = 0;
    let measured = 0;
    let untagged = 0;
    let untaggedAsDefault = 0;
    for (const old of legacy.features) {
      const ring = old.geometry.coordinates[0];
      const centroid: Position = [
        ring.slice(1).reduce((s, p) => s + p[0], 0) / (ring.length - 1),
        ring.slice(1).reduce((s, p) => s + p[1], 0) / (ring.length - 1),
      ];
      const matches = collection.features.filter((f) => contains(f, centroid));
      if (matches.length === 0) continue;
      found++;
      if (old.properties.heightSource === "measured") {
        measured++;
        if (matches.some((f) => f.properties.heightM === old.properties.height)) sameHeight++;
      } else if (old.properties.heightSource === "unknown") {
        untagged++;
        if (matches.some((f) => f.properties.heightSource === "default")) untaggedAsDefault++;
      }
    }
    // Every building is in the z14 tiles, with the height OSM has for it.
    expect(found / legacy.features.length).toBeGreaterThan(0.97);
    expect(sameHeight / measured).toBeGreaterThan(0.95);
    expect(untaggedAsDefault / untagged).toBeGreaterThan(0.9);

    const garage = collection.features.filter((f) => contains(f, [-122.4331, 37.7906]));
    expect(garage.map((f) => f.properties.heightM)).toEqual([12]);
  });
});

describe("decodeBuildingTiles: a real building cut by two tiles", () => {
  // 14/2620/6332 and 14/2621/6332 share two large buildings that reach
  // further than the buffer into both, so each tile holds only a part.
  const west = tileAt(2620, 6332);
  const east = tileAt(2621, 6332);
  const tiles = [west, east].map((tile) => ({ tile, data: fixtureTile(tile) }));
  const edgeLng = tileXToLng(2621, 14);

  /** Buildings with a point at `offset` degrees from the shared edge, at this height. */
  function straddling(collection: BuildingCollection, heightM: number) {
    return collection.features.filter((feature) => {
      if (feature.properties.heightM !== heightM) return false;
      const [w, , e] = bboxOf(feature);
      return w < edgeLng - 0.0004 && e > edgeLng - 0.0001;
    });
  }

  test("separately, each tile has its own partial copy", () => {
    const westOnly = straddling(decodeBuildingTiles([tiles[0]]), 37);
    expect(westOnly).toHaveLength(1);
    expect(westOnly[0].geometry.type).toBe("Polygon");
    // Cut off at the buffer's edge, 64 units past the tile edge.
    expect(bboxOf(westOnly[0])[2]).toBeCloseTo(tileXToLng(2621 + 64 / 4096, 14), 6);
  });

  test("together they are one feature, on both sides of the edge", () => {
    const both = decodeBuildingTiles(tiles);
    const merged = both.features.filter((f) => f.geometry.type === "MultiPolygon");
    expect(merged.map((f) => [f.properties.id, f.properties.heightM])).toEqual([
      ["tile/14/2620/6332/4.64", 4],
      ["tile/14/2620/6332/82.0", 37],
    ]);

    const bufferDeg = (64 / 4096) * (360 / 2 ** 14);
    for (const building of merged) {
      expectValidGeometry(building.geometry);
      const halves = (building.geometry as MultiPolygon).coordinates;
      expect(halves).toHaveLength(2);
      const [westHalf, eastHalf] = halves.map((rings) => rings[0].map((p) => p[0]));
      // The west tile's copy stops at its buffer's edge, the east tile's
      // copy starts at its own: neither is the whole building.
      expect(Math.max(...westHalf)).toBeCloseTo(edgeLng + bufferDeg, 6);
      expect(Math.min(...eastHalf)).toBeCloseTo(edgeLng - bufferDeg, 6);
      expect(Math.min(...westHalf)).toBeLessThan(edgeLng - bufferDeg - 1e-5);
      expect(Math.max(...eastHalf)).toBeGreaterThan(edgeLng + bufferDeg + 1e-5);

      // A pin in either half is in this feature, and in no other feature of
      // that height: the far half can never count as a neighbour.
      for (const rings of halves) {
        const outer = rings[0].slice(1);
        const probe: Position = [
          outer.reduce((sum, p) => sum + p[0], 0) / outer.length,
          outer.reduce((sum, p) => sum + p[1], 0) / outer.length,
        ];
        expect(contains(building, probe)).toBe(true);
        const owners = both.features.filter(
          (f) => f.properties.heightM === building.properties.heightM && contains(f, probe),
        );
        expect(owners).toEqual([building]);
      }
    }

    const separately =
      decodeBuildingTiles([tiles[0]]).features.length +
      decodeBuildingTiles([tiles[1]]).features.length;
    expect(both.features.length).toBeLessThan(separately);
  });
});

// ─── TileJSON ──────────────────────────────────────────────────────────────

describe("templateFromTileJson", () => {
  test("reads the versioned template from the real TileJSON", () => {
    expect(templateFromTileJson(JSON.parse(TILEJSON))).toBe(REAL_TEMPLATE);
  });

  test.each([
    ["not an object", "<html>"],
    ["no tiles", { maxzoom: 14 }],
    ["an empty list", { tiles: [] }],
    ["tiles that are not strings", { tiles: [42] }],
    ["plain http", { tiles: ["http://tiles.example/{z}/{x}/{y}.pbf"] }],
    ["a template without placeholders", { tiles: ["https://tiles.example/planet.pbf"] }],
    ["a missing placeholder", { tiles: ["https://tiles.example/{z}/{x}.pbf"] }],
    ["a tile set that stops before z14", { tiles: [REAL_TEMPLATE], maxzoom: 13 }],
  ])("rejects %s", (_, json) => {
    expect(templateFromTileJson(json)).toBeNull();
  });

  test("accepts a TileJSON that does not say its maxzoom", () => {
    expect(templateFromTileJson({ tiles: [REAL_TEMPLATE] })).toBe(REAL_TEMPLATE);
  });
});

describe("loadTileTemplate", () => {
  const tileJsonResponse = () =>
    new Response(TILEJSON, { headers: { "content-type": "application/json" } });
  const OTHER = REAL_TEMPLATE.replace("20261101_080013_pt", "20261108_080013_pt");

  test("asks the TileJSON endpoint, with no custom headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tileJsonResponse());
    expect(await loadTileTemplate({ fetchImpl })).toBe(REAL_TEMPLATE);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENFREEMAP_TILEJSON_URL);
    expect(url).toBe("https://tiles.openfreemap.org/planet");
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
  });

  test("is remembered for an hour, then asked for again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchImpl = vi.fn<typeof fetch>(async () => tileJsonResponse());
    await loadTileTemplate({ fetchImpl });
    vi.setSystemTime(Date.now() + 59 * 60_000);
    await loadTileTemplate({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2 * 60_000);
    fetchImpl.mockImplementation(
      async () => new Response(TILEJSON.replace("20261101_080013_pt", "20261108_080013_pt")),
    );
    expect(await loadTileTemplate({ fetchImpl })).toBe(OTHER);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("`refresh` asks again at once", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tileJsonResponse());
    await loadTileTemplate({ fetchImpl });
    await loadTileTemplate({ fetchImpl, refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["a network error", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["HTTP 503", async () => new Response("down", { status: 503 })],
    ["a body that is not JSON", async () => new Response("<html>")],
    ["an unusable TileJSON", async () => new Response('{"tiles":[]}')],
  ])("%s falls back to the last template seen", async (_, failing) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchImpl = vi.fn<typeof fetch>(async () => tileJsonResponse());
    await loadTileTemplate({ fetchImpl });

    vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
    fetchImpl.mockImplementation(failing as () => Promise<Response>);
    expect(await loadTileTemplate({ fetchImpl })).toBe(REAL_TEMPLATE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("with nothing to fall back on, the documented 'latest' alias is used", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("down", { status: 500 }));
    expect(await loadTileTemplate({ fetchImpl })).toBe(OPENFREEMAP_LATEST_TEMPLATE);
    expect(OPENFREEMAP_LATEST_TEMPLATE).toBe(
      "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf",
    );
  });

  test("after a failure the endpoint is left alone for a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("down", { status: 500 }));
    await loadTileTemplate({ fetchImpl });
    await loadTileTemplate({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    fetchImpl.mockImplementation(async () => tileJsonResponse());
    expect(await loadTileTemplate({ fetchImpl })).toBe(REAL_TEMPLATE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("a TileJSON that hangs is given up on after four seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    let template: string | undefined;
    void loadTileTemplate({ fetchImpl }).then((t) => (template = t));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(template).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(template).toBe(OPENFREEMAP_LATEST_TEMPLATE);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an abort rejects instead of falling back", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = loadTileTemplate({ fetchImpl, signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    // An abort is not a failure of the endpoint: the next call asks again.
    fetchImpl.mockImplementation(async () => tileJsonResponse());
    expect(await loadTileTemplate({ fetchImpl })).toBe(REAL_TEMPLATE);

    const already = await loadTileTemplate({ fetchImpl, signal: AbortSignal.abort() }).catch(
      (e) => e,
    );
    expect(isAbortError(already)).toBe(true);
  });
});

// ─── Fetching ──────────────────────────────────────────────────────────────

type Reply = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that serves the fixture TileJSON and tiles; `overrides` replace single URLs' answers. */
function fixtureFetch(overrides: { match: RegExp; reply: Reply }[] = []) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const override = overrides.find(({ match }) => match.test(url));
    if (override) return override.reply(url, init);
    if (url === OPENFREEMAP_TILEJSON_URL) return new Response(TILEJSON);
    const tile = /\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url);
    if (!tile) return new Response("not found", { status: 404 });
    try {
      const bytes = fixtureTile({ z: +tile[1], x: +tile[2], y: +tile[3] });
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": "application/vnd.mapbox-vector-tile" },
      });
    } catch {
      return new Response(null, { status: 204 });
    }
  });
}

const tileCalls = (mock: ReturnType<typeof fixtureFetch>) =>
  mock.mock.calls.map(([url]) => String(url)).filter((url) => url.endsWith(".pbf"));

const hang: Reply = (_url, init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("fetchBuildingsFromTiles", () => {
  test("fetches the TileJSON, then the area's four tiles, and decodes them", async () => {
    const fetchImpl = fixtureFetch();
    const buildings = await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl });
    expect(buildings).toEqual(decodeArea());
    expect(buildings.features).toHaveLength(1600);

    expect(fetchImpl.mock.calls[0][0]).toBe(OPENFREEMAP_TILEJSON_URL);
    expect(tileCalls(fetchImpl).sort()).toEqual([
      "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2619/6331.pbf",
      "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2619/6332.pbf",
      "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2620/6331.pbf",
      "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2620/6332.pbf",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    // Plain GETs: no custom headers, so no CORS preflight.
    for (const [, init] of fetchImpl.mock.calls) {
      expect(Object.keys(init ?? {})).toEqual(["signal"]);
    }
  });

  test("the tiles are requested in parallel", async () => {
    let open = 0;
    let most = 0;
    const slow: Reply = async (url) => {
      open++;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      const [, z, x, y] = /(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
      return new Response(new Uint8Array(fixtureTile({ z: +z, x: +x, y: +y })));
    };
    await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, {
      fetchImpl: fixtureFetch([{ match: /\.pbf$/, reply: slow }]),
    });
    expect(most).toBe(4);
  });

  test("the TileJSON is fetched once for many areas", async () => {
    const fetchImpl = fixtureFetch();
    await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl });
    await fetchBuildingsFromTiles({ lat: 37.8, lng: -122.42 }, 500, { fetchImpl });
    const tileJsonCalls = fetchImpl.mock.calls.filter(([url]) => url === OPENFREEMAP_TILEJSON_URL);
    expect(tileJsonCalls).toHaveLength(1);

    await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl, refresh: true });
    expect(fetchImpl.mock.calls.filter(([url]) => url === OPENFREEMAP_TILEJSON_URL)).toHaveLength(
      2,
    );
  });

  test("when the TileJSON is down, the 'latest' tiles are used", async () => {
    const fetchImpl = fixtureFetch([
      { match: /\/planet$/, reply: () => new Response("down", { status: 502 }) },
    ]);
    const buildings = await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl });
    expect(buildings.features).toHaveLength(1600);
    for (const url of tileCalls(fetchImpl)) {
      expect(url).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\/latest\/14\/\d+\/\d+\.pbf$/);
    }
  });

  test.each([204, 404])("a tile answered with %d is an empty tile", async (status) => {
    const fetchImpl = fixtureFetch([
      { match: /14\/2619\/6331\.pbf$/, reply: () => new Response(null, { status }) },
    ]);
    const buildings = await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl });
    expect(buildings.features.length).toBeGreaterThan(500);
    expect(buildings.features.length).toBeLessThan(1600);
  });

  test("an area with no buildings at all is an empty collection, not an error", async () => {
    const fetchImpl = fixtureFetch();
    // The fixture has no tiles here, so every tile is answered with 204.
    const buildings = await fetchBuildingsFromTiles({ lat: 30, lng: -140 }, 500, { fetchImpl });
    expect(buildings).toEqual({ type: "FeatureCollection", features: [] });
  });

  test("one failed tile fails the whole area and stops the other downloads", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = fixtureFetch([
      { match: /14\/2620\/6331\.pbf$/, reply: () => new Response("oops", { status: 500 }) },
      {
        match: /\.pbf$/,
        reply: (url, init) => {
          signals.push(init!.signal!);
          return hang(url, init);
        },
      },
    ]);
    const error = await failure(fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl }));
    expect(error).toBeInstanceOf(BuildingTilesError);
    expect(error).toMatchObject({
      kind: "http",
      status: 500,
      url: "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2620/6331.pbf",
    });
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  test("a network error is retried once", async () => {
    let failures = 0;
    const flaky: Reply = (url) => {
      if (failures++ === 0) throw new TypeError("Failed to fetch");
      const [, z, x, y] = /(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
      return new Response(new Uint8Array(fixtureTile({ z: +z, x: +x, y: +y })));
    };
    const fetchImpl = fixtureFetch([{ match: /14\/2620\/6332\.pbf$/, reply: flaky }]);
    const buildings = await fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl });
    expect(buildings.features).toHaveLength(1600);
    expect(tileCalls(fetchImpl).filter((url) => url.endsWith("14/2620/6332.pbf"))).toHaveLength(2);
    expect(tileCalls(fetchImpl)).toHaveLength(5);
  });

  test("a second network error is final", async () => {
    const cause = new TypeError("Failed to fetch");
    const fetchImpl = fixtureFetch([
      {
        match: /14\/2620\/6332\.pbf$/,
        reply: () => {
          throw cause;
        },
      },
    ]);
    const error = await failure(fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl }));
    expect(error).toBeInstanceOf(BuildingTilesError);
    expect(error).toMatchObject({ kind: "network", cause });
    expect(tileCalls(fetchImpl).filter((url) => url.endsWith("14/2620/6332.pbf"))).toHaveLength(2);
  });

  test("an HTTP error is not retried", async () => {
    const fetchImpl = fixtureFetch([
      { match: /14\/2620\/6332\.pbf$/, reply: () => new Response("no", { status: 503 }) },
    ]);
    const error = await failure(fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl }));
    expect(error).toMatchObject({ kind: "http", status: 503 });
    expect(tileCalls(fetchImpl).filter((url) => url.endsWith("14/2620/6332.pbf"))).toHaveLength(1);
  });

  test("garbage instead of a tile is a malformed error", async () => {
    const fetchImpl = fixtureFetch([
      { match: /14\/2620\/6332\.pbf$/, reply: () => new Response("<html>captive portal</html>") },
    ]);
    const error = await failure(fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl }));
    expect(error).toBeInstanceOf(BuildingTilesError);
    expect(error).toMatchObject({ kind: "malformed" });
  });

  test("a tile that hangs times out after twelve seconds, retry included", async () => {
    vi.useFakeTimers();
    const fetchImpl = fixtureFetch([{ match: /14\/2620\/6332\.pbf$/, reply: hang }]);
    const pending = failure(fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl }));
    await vi.advanceTimersByTimeAsync(11_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error).toBeInstanceOf(BuildingTilesError);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an abort rejects with AbortError and cancels every request", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = fixtureFetch([
      {
        match: /\.pbf$/,
        reply: (url, init) => {
          signals.push(init!.signal!);
          return hang(url, init);
        },
      },
    ]);
    const controller = new AbortController();
    const pending = failure(
      fetchBuildingsFromTiles(AREA.center, AREA.radiusM, { fetchImpl, signal: controller.signal }),
    );
    await vi.waitFor(() => expect(signals).toHaveLength(4));
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(BuildingTilesError);
    expect(isAbortError(error)).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    // No retries after an abort.
    expect(tileCalls(fetchImpl)).toHaveLength(4);
  });

  test("an already-aborted signal makes no request", async () => {
    const fetchImpl = fixtureFetch();
    const error = await failure(
      fetchBuildingsFromTiles(AREA.center, AREA.radiusM, {
        fetchImpl,
        signal: AbortSignal.abort(),
      }),
    );
    expect(isAbortError(error)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
