import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Polygon, Position } from "geojson";
import { describe, expect, it } from "vitest";
import { footprintAreaM2, neighbourhoodHeightM } from "@/lib/buildings/overpass";
import { TILE_COVER_RADIUS_M, TILE_KEEP_RADIUS_M, fetchAreaFor } from "@/lib/buildings/tiles";
import {
  boundsOfCircle,
  decodeBuildingTiles,
  latToTileY,
  lngToTileX,
  tilesForCircle,
} from "@/lib/buildings/vectorTiles";
import type { BuildingCollection, BuildingFeature } from "@/lib/types";
import {
  ANALYSED_REACH_M,
  CITY_BUILDING_FILTER,
  HIGHLIGHT_OUTSET_M,
  HIGHLIGHT_RAISE_M,
  NO_HIGHLIGHTS,
  buildingsNear,
  cityColorExpression,
  cityHeightExpression,
  highlightFeatures,
  highlightHeightM,
  labelAnchorId,
  outsetRing,
  untaggedHeightM,
  type AnalysedArea,
} from "./mapData";

/**
 * MapLibre's own expression engine, to run the layer expressions on tile
 * features exactly as the map will. (It is a dependency of maplibre-gl, not
 * of this project, so it is looked up from there.)
 */
interface TileFeature {
  /** 3 = polygon. */
  type: number;
  properties: object;
  /** Rings in the units of the tile (8192 across), as MapLibre hands them to expressions. */
  geometry?: { x: number; y: number }[][];
}
interface TileId {
  z: number;
  x: number;
  y: number;
}
interface StyleSpec {
  latest: Record<string, Record<string, unknown>>;
  expression: {
    createPropertyExpression(
      expression: unknown,
      spec: unknown,
    ): {
      result: "success" | "error";
      value: {
        evaluate(
          globals: { zoom: number },
          feature: TileFeature,
          featureState?: object,
          canonical?: TileId,
        ): unknown;
      };
    };
  };
  featureFilter(filter: unknown): {
    filter(globals: { zoom: number }, feature: TileFeature): boolean;
  };
}
const styleSpec = createRequire(createRequire(import.meta.url).resolve("maplibre-gl"))(
  "@maplibre/maplibre-gl-style-spec",
) as StyleSpec;

/** The z14 tile a tile feature is said to come from. (Its polygons may lie outside it: the maths is the same.) */
const TILE: TileId = { z: 14, x: 2620, y: 6331 };
const TILE_EXTENT = 8192;

/** Rings given as positions, as the polygons of one feature of `TILE`. */
function tileFeature(rings: Position[][], properties: object): TileFeature {
  return {
    type: 3,
    properties,
    geometry: rings.map((ring) =>
      ring.map(([lng, lat]) => ({
        x: Math.round((lngToTileX(lng, TILE.z) - TILE.x) * TILE_EXTENT),
        y: Math.round((latToTileY(lat, TILE.z) - TILE.y) * TILE_EXTENT),
      })),
    ),
  };
}

/** What a paint expression gives for a feature of the tiles. */
function evaluate(expression: unknown, property: string, feature: TileFeature | object): unknown {
  const [group, name] = property.split("/");
  const parsed = styleSpec.expression.createPropertyExpression(
    expression,
    styleSpec.latest[group][name],
  );
  expect(parsed.result).toBe("success");
  const tileFeatureOrProperties =
    "type" in feature && "properties" in feature ? feature : { type: 3, properties: feature };
  return parsed.value.evaluate({ zoom: 16 }, tileFeatureOrProperties, {}, TILE);
}

const CENTER = { lat: 37.79, lng: -122.43 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180));

/** A square building `size` metres wide whose south-west corner is at (eastM, northM). */
function square(id: string, eastM: number, northM: number, size = 10): BuildingFeature {
  const x0 = CENTER.lng + eastM * M_LNG;
  const y0 = CENTER.lat + northM * M_LAT;
  const x1 = x0 + size * M_LNG;
  const y1 = y0 + size * M_LAT;
  return {
    type: "Feature",
    properties: { id, heightM: 9, heightSource: "default", levels: null, kind: "yes" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    },
  };
}

function ids(collection: BuildingCollection): string[] {
  return collection.features.map((feature) => feature.properties.id);
}

describe("buildingsNear", () => {
  const buildings: BuildingCollection = {
    type: "FeatureCollection",
    features: [
      square("near", 20, 20),
      square("edge", 245, 0),
      square("far", 300, 0),
      square("around-pin", -500, -500, 1000),
      square("diagonal-out", 200, 200),
    ],
  };

  it("keeps buildings whose footprint reaches into the radius", () => {
    expect(ids(buildingsNear(buildings, CENTER, 250))).toEqual(["near", "edge", "around-pin"]);
  });

  it("keeps the source order and the feature objects", () => {
    const near = buildingsNear(buildings, CENTER, 250);
    expect(near.features[0]).toBe(buildings.features[0]);
  });

  it("handles multipolygons and empty input", () => {
    const multi: BuildingFeature = {
      type: "Feature",
      properties: { id: "multi", heightM: 5, heightSource: "tagged", levels: 2, kind: "house" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          square("a", 900, 900).geometry.coordinates as number[][][],
          square("b", 10, 10).geometry.coordinates as number[][][],
        ],
      },
    };
    expect(
      ids(buildingsNear({ type: "FeatureCollection", features: [multi] }, CENTER, 250)),
    ).toEqual(["multi"]);
    expect(
      buildingsNear({ type: "FeatureCollection", features: [] }, CENTER, 250).features,
    ).toEqual([]);
  });
});

describe("labelAnchorId", () => {
  const layers = (...entries: string[]) =>
    entries.map((entry) => {
      const [id, type] = entry.split(":");
      return { id, type };
    });

  it("is the first of the labels the style ends with", () => {
    expect(
      labelAnchorId(
        layers(
          "background:background",
          "roads:line",
          "building:fill",
          "places:symbol",
          "streets:symbol",
        ),
      ),
    ).toBe("places");
  });

  it("ignores a stray label layer below the roads and footprints (the light basemap)", () => {
    expect(
      labelAnchorId(
        layers(
          "water:fill",
          "waterway_label:symbol",
          "roads:line",
          "building:fill",
          "boundary:line",
          "watername:symbol",
          "places:symbol",
        ),
      ),
    ).toBe("watername");
  });

  it("looks past our own layers, wherever they are", () => {
    const base = ["roads:line", "building:fill", "places:symbol", "streets:symbol"];
    // Added before the anchor was known: they sit on top of everything.
    expect(
      labelAnchorId(layers(...base, "sun-shadows:fill-extrusion", "sun-city-3d:fill-extrusion")),
    ).toBe("places");
    // In place.
    expect(
      labelAnchorId(layers("roads:line", "building:fill", "sun-city-flat:fill", "places:symbol")),
    ).toBe("places");
  });

  it("is undefined when the style does not end with labels", () => {
    expect(labelAnchorId([])).toBeUndefined();
    expect(labelAnchorId(layers("sun-shadows:fill-extrusion"))).toBeUndefined();
    expect(labelAnchorId(layers("places:symbol", "overlay:line"))).toBeUndefined();
  });
});

describe("the city layers' expressions", () => {
  const AREA: AnalysedArea = { center: CENTER, untaggedM: 11.5 };
  /** A building of the tiles, `eastM` metres east of the analysed area's centre. */
  const building = (eastM: number, properties: object) =>
    tileFeature([square("b", eastM, 0).geometry.coordinates[0] as Position[]], properties);
  const height = (analysed: AnalysedArea | null, feature: ReturnType<typeof tileFeature>) =>
    evaluate(cityHeightExpression(analysed), "paint_fill-extrusion/fill-extrusion-height", feature);

  it("draws a tagged building at its height, wherever it is", () => {
    expect(height(AREA, building(100, { render_height: 12 }))).toBe(12);
    expect(height(AREA, building(5000, { render_height: 12 }))).toBe(12);
    expect(height(null, building(100, { render_height: 12 }))).toBe(12);
    // Lower than the tiles' stand-in is still tagged.
    expect(height(AREA, building(100, { render_height: 3 }))).toBe(3);
  });

  it("draws an untagged building at the analysed height, where buildings were analysed", () => {
    expect(height(AREA, building(100, { render_height: 5 }))).toBe(11.5);
    expect(height({ ...AREA, untaggedM: 7 }, building(100, { render_height: 5 }))).toBe(7);
    // Right up to the corners of the square the loader keeps…
    expect(height(AREA, building(ANALYSED_REACH_M - 15, { render_height: 5 }))).toBe(11.5);
    // …and not beyond: one neighbourhood's median says nothing about the next town.
    expect(height(AREA, building(ANALYSED_REACH_M + 5, { render_height: 5 }))).toBe(5);
    expect(height(AREA, building(5000, { render_height: 5 }))).toBe(5);
  });

  it("decides that for all untagged buildings of a tile at once (they are one feature)", () => {
    const near = square("near", 100, 0).geometry.coordinates[0] as Position[];
    const far = square("far", 1700, 0).geometry.coordinates[0] as Position[];
    expect(height(AREA, tileFeature([far, near], { render_height: 5 }))).toBe(11.5);
    expect(height(AREA, tileFeature([far], { render_height: 5 }))).toBe(5);
  });

  it("draws the tiles' own heights while nothing is analysed", () => {
    expect(height(null, building(100, { render_height: 5 }))).toBe(5);
    expect(height(null, building(100, {}))).toBe(5);
    expect(height(null, building(100, { render_height: 30 }))).toBe(30);
  });

  it("reads what the analysis reads as untagged the same way, and caps like it", () => {
    expect(height(AREA, building(100, {}))).toBe(11.5);
    expect(height(AREA, building(100, { render_height: 0 }))).toBe(11.5);
    expect(height(AREA, building(100, { render_height: -4 }))).toBe(11.5);
    expect(height(AREA, building(100, { render_height: "12" }))).toBe(11.5);
    expect(height(AREA, building(100, { render_height: 2500 }))).toBe(1000);
  });

  it("colours estimated heights softer", () => {
    const color = (properties: object) =>
      String(
        evaluate(
          cityColorExpression("rgb(10, 20, 30)", "rgb(200, 210, 220)"),
          "paint_fill-extrusion/fill-extrusion-color",
          properties,
        ),
      );
    expect(color({ render_height: 12 })).toBe(color({ render_height: 40 }));
    expect(color({ render_height: 5 })).toBe(color({}));
    expect(color({ render_height: 5 })).not.toBe(color({ render_height: 12 }));
    // The same pair as a flat fill.
    evaluate(cityColorExpression("silver", "gray"), "paint_fill/fill-color", {});
  });

  it("leaves out the outlines whose parts are drawn", () => {
    const { filter } = styleSpec.featureFilter(CITY_BUILDING_FILTER);
    const passes = (properties: object) => filter({ zoom: 16 }, { type: 3, properties });
    expect(passes({ hide_3d: true, render_height: 30 })).toBe(false);
    expect(passes({ hide_3d: false, render_height: 30 })).toBe(true);
    expect(passes({ render_height: 30 })).toBe(true);
  });
});

describe("untaggedHeightM", () => {
  const tagged = (count: number, heightM: number): BuildingFeature[] =>
    Array.from({ length: count }, (_, i) => ({
      ...square(`t${i}`, i * 20, 0),
      properties: { id: `t${i}`, heightM, heightSource: "tagged", levels: null, kind: "yes" },
    }));

  it("is the neighbourhood's height where enough buildings are tagged, else 7 m", () => {
    expect(untaggedHeightM({ type: "FeatureCollection", features: tagged(10, 12) })).toBe(12);
    expect(untaggedHeightM({ type: "FeatureCollection", features: tagged(9, 12) })).toBe(7);
    expect(untaggedHeightM({ type: "FeatureCollection", features: [] })).toBe(7);
    expect(untaggedHeightM(null)).toBe(7);
  });
});

// ─── Against the real tiles of the browser tests' neighbourhood ────────────

describe("the map against the analysis (Pacific Heights fixture tiles)", () => {
  // What the loader hands the analysis for a pin at 37.7912, -122.4301.
  const area = fetchAreaFor({ lat: 37.7912, lng: -122.4301 });
  const analysed = decodeBuildingTiles(
    tilesForCircle(area.center, TILE_COVER_RADIUS_M).map((tile) => ({
      tile,
      data: readFileSync(
        new URL(
          `../../../tests/fixtures/openfreemap/${tile.z}/${tile.x}/${tile.y}.pbf`,
          import.meta.url,
        ),
      ),
    })),
    { bounds: boundsOfCircle(area.center, Math.max(TILE_COVER_RADIUS_M, TILE_KEEP_RADIUS_M)) },
  );
  const untaggedM = untaggedHeightM(analysed);
  const expression = cityHeightExpression({ center: area.center, untaggedM });
  /**
   * How tall the tile layer draws a building: from the attributes the tile
   * has for it, and where it stands (each on its own here, which is the
   * hardest case for "in reach of the analysed area").
   */
  const drawnM = ({ properties, geometry }: BuildingFeature) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return evaluate(
      expression,
      "paint_fill-extrusion/fill-extrusion-height",
      tileFeature(polygons.flat(), {
        render_height: properties.heightSource === "default" ? 5 : properties.heightM,
      }),
    );
  };

  it("draws untagged buildings at the height the analysis applied", () => {
    expect(analysed.features).toHaveLength(3632);
    expect(untaggedM).toBe(neighbourhoodHeightM(analysed));
    expect(untaggedM).toBeGreaterThan(7);

    const large = analysed.features.filter(
      ({ properties, geometry }) =>
        properties.heightSource === "default" && footprintAreaM2(geometry) >= 50,
    );
    expect(large.length).toBeGreaterThan(600);
    expect(new Set(large.map((building) => building.properties.heightM))).toEqual(
      new Set([untaggedM]),
    );
    for (const building of large) expect(drawnM(building)).toBe(building.properties.heightM);
  });

  it("differs from the analysis only for small untagged buildings: under 3% of all", () => {
    const off = analysed.features.filter(
      (building) => drawnM(building) !== building.properties.heightM,
    );
    expect(off.length).toBeGreaterThan(0);
    expect(off.length / analysed.features.length).toBeLessThan(0.03);
    for (const { properties, geometry } of off) {
      expect(properties.heightSource).toBe("default");
      expect(footprintAreaM2(geometry)).toBeLessThan(50);
      // Drawn too tall, never too low: nothing the analysis counts is missing from the picture.
      expect(properties.heightM).toBeLessThan(untaggedM);
    }
  });

  it("every highlight stands proud of the building drawn under it", () => {
    for (const building of analysed.features) {
      expect(highlightHeightM(building, untaggedM)).toBeGreaterThan(Number(drawnM(building)));
      expect(highlightHeightM(building, untaggedM)).toBeGreaterThan(building.properties.heightM);
    }
  });
});

// ─── Highlights ────────────────────────────────────────────────────────────

/** A ring given in metres east / north of CENTER, as positions. */
const ringOf = (points: [number, number][]): Position[] =>
  points.map(([x, y]) => [CENTER.lng + x * M_LNG, CENTER.lat + y * M_LAT]);
/** …and back, to the millimetre. */
const metresOf = (ring: Position[]): [number, number][] =>
  ring.map(([lng, lat]) => [
    Math.round(((lng - CENTER.lng) / M_LNG) * 1000) / 1000,
    Math.round(((lat - CENTER.lat) / M_LAT) * 1000) / 1000,
  ]);

describe("outsetRing", () => {
  it("moves every edge of a square outwards, whichever way it is wound", () => {
    const ccw = ringOf([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    expect(metresOf(outsetRing(ccw, 0.25))).toEqual([
      [-0.25, -0.25],
      [10.25, -0.25],
      [10.25, 10.25],
      [-0.25, 10.25],
      [-0.25, -0.25],
    ]);
    const cw = [...ccw].reverse();
    expect(metresOf(outsetRing(cw, 0.25))).toEqual([
      [-0.25, -0.25],
      [-0.25, 10.25],
      [10.25, 10.25],
      [10.25, -0.25],
      [-0.25, -0.25],
    ]);
  });

  it("moves inwards for a negative distance (a courtyard shrinks)", () => {
    const hole = ringOf([
      [2, 2],
      [2, 8],
      [8, 8],
      [8, 2],
      [2, 2],
    ]);
    expect(metresOf(outsetRing(hole, -0.5))).toEqual([
      [2.5, 2.5],
      [2.5, 7.5],
      [7.5, 7.5],
      [7.5, 2.5],
      [2.5, 2.5],
    ]);
  });

  it("keeps an inside corner an inside corner", () => {
    // An L: the corner at (4, 4) points into the building.
    const l = ringOf([
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
      [0, 0],
    ]);
    expect(metresOf(outsetRing(l, 0.25))).toEqual([
      [-0.25, -0.25],
      [10.25, -0.25],
      [10.25, 4.25],
      [4.25, 4.25],
      [4.25, 10.25],
      [-0.25, 10.25],
      [-0.25, -0.25],
    ]);
  });

  it("does not shoot a needle-sharp corner far out", () => {
    const needle = ringOf([
      [0, 0],
      [20, 0.2],
      [0, 0.4],
      [0, 0],
    ]);
    const tip = metresOf(outsetRing(needle, 0.25))[1];
    expect(tip[0]).toBeGreaterThan(20);
    expect(tip[0]).toBeLessThan(21);
  });

  it("handles open rings, repeated points and degenerate input", () => {
    const open = ringOf([
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(metresOf(outsetRing(open, 1))).toEqual([
      [-1, -1],
      [11, -1],
      [11, 11],
      [-1, 11],
    ]);
    const line = ringOf([
      [0, 0],
      [10, 0],
    ]);
    expect(outsetRing(line, 1)).toEqual(line);
    expect(outsetRing([], 1)).toEqual([]);
    const square10 = square("s", 0, 0).geometry.coordinates[0] as Position[];
    expect(outsetRing(square10, 0)).toEqual(square10);
    expect(outsetRing(square10, 0)).not.toBe(square10);
  });
});

describe("highlightFeatures", () => {
  const building = (
    id: string,
    heightM: number,
    heightSource: BuildingFeature["properties"]["heightSource"],
    eastM = 0,
  ): BuildingFeature => ({
    ...square(id, eastM, 0),
    properties: { id, heightM, heightSource, levels: null, kind: "yes" },
  });
  const collection: BuildingCollection = {
    type: "FeatureCollection",
    features: [
      building("tagged", 20, "tagged"),
      building("untagged", 11.5, "default", 30),
      building("shed", 3, "default", 60),
      building("other", 9, "tagged", 90),
    ],
  };
  const UNTAGGED_M = 11.5;
  const pick = (blockerId: string | null, pinId: string | null) =>
    highlightFeatures(collection, { blockerId, pinId }, UNTAGGED_M);

  it("is empty without a blocker and a pin building, or without buildings", () => {
    expect(pick(null, null)).toBe(NO_HIGHLIGHTS);
    expect(pick("gone", "also-gone")).toBe(NO_HIGHLIGHTS);
    expect(highlightFeatures(null, { blockerId: "tagged", pinId: null }, UNTAGGED_M)).toBe(
      NO_HIGHLIGHTS,
    );
  });

  it("marks the blocker and the pin's building", () => {
    expect(pick("tagged", "untagged").features.map((feature) => feature.properties)).toEqual([
      { id: "tagged", blocker: true, pin: false, heightM: 20 + HIGHLIGHT_RAISE_M },
      { id: "untagged", blocker: false, pin: true, heightM: 11.5 + HIGHLIGHT_RAISE_M },
    ]);
    expect(pick("other", null).features.map((feature) => feature.properties)).toEqual([
      { id: "other", blocker: true, pin: false, heightM: 9 + HIGHLIGHT_RAISE_M },
    ]);
  });

  it("is one feature when one building holds both roles", () => {
    expect(pick("tagged", "tagged").features.map((feature) => feature.properties)).toEqual([
      { id: "tagged", blocker: true, pin: true, heightM: 20 + HIGHLIGHT_RAISE_M },
    ]);
  });

  it("is never lower than the building the tile layer draws there (the max rule)", () => {
    // The analysis has the shed at 3 m; the tiles cannot tell it from any
    // other untagged building and draw it at the area's default.
    expect(pick("shed", null).features[0].properties.heightM).toBe(UNTAGGED_M + HIGHLIGHT_RAISE_M);
    expect(highlightHeightM(building("shed", 3, "default"), UNTAGGED_M)).toBe(11.8);
    // A tagged building is drawn at its own height, however low.
    expect(highlightHeightM(building("low", 3, "tagged"), UNTAGGED_M)).toBe(3.3);
    // An untagged one the analysis has taller than the default (other data sources).
    expect(highlightHeightM(building("tall", 14, "default"), UNTAGGED_M)).toBe(14.3);
  });

  it("grows the footprint all round and leaves the analysed building alone", () => {
    const before = structuredClone(collection);
    const [feature] = pick("tagged", null).features;
    const ring = (feature.geometry as Polygon).coordinates[0];
    const d = HIGHLIGHT_OUTSET_M;
    expect(metresOf(ring)).toEqual([
      [-d, -d],
      [10 + d, -d],
      [10 + d, 10 + d],
      [-d, 10 + d],
      [-d, -d],
    ]);
    expect(collection).toEqual(before);
  });

  it("grows every part of a multipolygon and shrinks its courtyards", () => {
    const outer = square("o", 0, 0, 20).geometry.coordinates[0] as Position[];
    const yard = ringOf([
      [5, 5],
      [5, 15],
      [15, 15],
      [15, 5],
      [5, 5],
    ]);
    const second = square("p", 100, 0).geometry.coordinates[0] as Position[];
    const multi: BuildingFeature = {
      type: "Feature",
      properties: { id: "multi", heightM: 10, heightSource: "tagged", levels: null, kind: "yes" },
      geometry: { type: "MultiPolygon", coordinates: [[outer, yard], [second]] },
    };
    const [feature] = highlightFeatures(
      { type: "FeatureCollection", features: [multi] },
      { blockerId: "multi", pinId: null },
      UNTAGGED_M,
    ).features;
    expect(feature.geometry.type).toBe("MultiPolygon");
    const [[grownOuter, shrunkYard], [grownSecond]] = feature.geometry
      .coordinates as Position[][][];
    expect(metresOf(grownOuter)[2]).toEqual([20.25, 20.25]);
    expect(metresOf(shrunkYard)[0]).toEqual([5.25, 5.25]);
    expect(metresOf(shrunkYard)[2]).toEqual([14.75, 14.75]);
    expect(metresOf(grownSecond)[0]).toEqual([99.75, -0.25]);
  });
});
