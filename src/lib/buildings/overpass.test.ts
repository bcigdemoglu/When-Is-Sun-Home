import { readFileSync } from "node:fs";
import fc from "fast-check";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { describe, expect, test, vi } from "vitest";
import type { BuildingCollection } from "@/lib/types";
import {
  OVERPASS_ENDPOINTS,
  OverpassError,
  assemblePolygons,
  buildOverpassQuery,
  fetchBuildings,
  footprintAreaM2,
  isAbortError,
  parseOverpassResponse,
  refineDefaultHeights,
  signedRingArea,
  stitchRings,
} from "./overpass";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8"),
  );
}

type LatLon = { lat: number; lon: number };

const SQUARE: LatLon[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.001 },
  { lat: 0.001, lon: 0.001 },
  { lat: 0.001, lon: 0 },
  { lat: 0, lon: 0 },
];

function way(id: number, geometry: LatLon[], tags?: Record<string, string>) {
  return { type: "way", id, geometry, tags };
}

function response(...elements: unknown[]) {
  return { version: 0.6, generator: "test", elements };
}

function byId(collection: BuildingCollection, id: string) {
  const feature = collection.features.find((f) => f.properties.id === id);
  if (!feature) throw new Error(`no feature ${id}`);
  return feature;
}

/** Every ring closed, big enough, and wound per RFC 7946 (outer CCW, holes CW). */
function expectValidGeometry(geometry: Polygon | MultiPolygon) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  expect(polygons.length).toBeGreaterThan(0);
  for (const rings of polygons) {
    expect(rings.length).toBeGreaterThan(0);
    rings.forEach((ring, index) => {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[ring.length - 1]).toEqual(ring[0]);
      for (const position of ring) {
        expect(position).toHaveLength(2);
        expect(Math.abs(position[0])).toBeLessThanOrEqual(180);
        expect(Math.abs(position[1])).toBeLessThanOrEqual(90);
      }
      const area = signedRingArea(ring);
      if (index === 0) expect(area).toBeGreaterThan(0);
      else expect(area).toBeLessThan(0);
    });
  }
}

describe("buildOverpassQuery", () => {
  test("asks for building ways and multipolygon relations with inline geometry", () => {
    const query = buildOverpassQuery({ lat: 37.7906, lng: -122.4294 }, 500);
    expect(query).toBe(
      [
        "[out:json][timeout:25];",
        "(",
        '  way["building"](around:500,37.790600,-122.429400);',
        '  relation["building"]["type"="multipolygon"](around:500,37.790600,-122.429400);',
        ");",
        "out body geom;",
      ].join("\n"),
    );
  });

  test("never emits exponent notation or fractional radii", () => {
    const query = buildOverpassQuery({ lat: 1e-7, lng: -0.00000004 }, 499.6);
    expect(query).toContain("(around:500,0.000000,-0.000000)");
    expect(query).not.toMatch(/\de-?\d/);
  });

  test("rejects nonsense", () => {
    expect(() => buildOverpassQuery({ lat: Number.NaN, lng: 0 }, 500)).toThrow(RangeError);
    expect(() => buildOverpassQuery({ lat: 0, lng: 0 }, 0)).toThrow(RangeError);
  });
});

describe("signedRingArea", () => {
  test("positive for counter-clockwise, negative for clockwise", () => {
    const ccw: Position[] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
      [0, 0],
    ];
    expect(signedRingArea(ccw)).toBe(2);
    expect(signedRingArea([...ccw].reverse())).toBe(-2);
  });

  test("the same whether or not the ring repeats its first position", () => {
    const open: Position[] = [
      [0, 0],
      [2, 0],
      [0, 2],
    ];
    expect(signedRingArea(open)).toBe(2);
    expect(signedRingArea([...open, open[0]])).toBe(2);
  });
});

describe("stitchRings", () => {
  const A: Position = [0, 0];
  const B: Position = [4, 0];
  const C: Position = [4, 3];
  const D: Position = [2, 5];
  const E: Position = [0, 3];

  test("joins segments given in order", () => {
    expect(
      stitchRings([
        [A, B, C],
        [C, D, E],
        [E, A],
      ]),
    ).toEqual([[A, B, C, D, E, A]]);
  });

  test("joins shuffled segments", () => {
    const rings = stitchRings([
      [E, A],
      [A, B, C],
      [C, D, E],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([E, A, B, C, D, E]);
  });

  test("joins segments drawn in opposite directions", () => {
    const rings = stitchRings([
      [A, B, C],
      [E, D, C],
      [A, E],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([A, B, C, D, E, A]);
  });

  test("passes closed ways through and keeps separate rings separate", () => {
    const closed: Position[] = [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 10],
    ];
    const rings = stitchRings([[A, B, C], closed, [C, D, E, A]]);
    expect(rings).toHaveLength(2);
    expect(rings).toContainEqual(closed);
    expect(rings).toContainEqual([A, B, C, D, E, A]);
  });

  test("drops chains that never close, and useless fragments", () => {
    expect(
      stitchRings([
        [A, B, C],
        [C, D],
      ]),
    ).toEqual([]);
    expect(stitchRings([[A], [], [A, B, A]])).toEqual([]);
  });

  test("does not mutate its input", () => {
    const segments: Position[][] = [
      [A, B, C],
      [E, D, C],
      [A, E],
    ];
    const copy = structuredClone(segments);
    stitchRings(segments);
    expect(segments).toEqual(copy);
  });

  test("any way of cutting, shuffling and reversing a ring gives the ring back", () => {
    const ring = fc.integer({ min: 4, max: 40 }).map((n) => {
      // A convex n-gon with distinct, exactly reproducible vertices.
      const points: Position[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        points.push([Math.cos(angle) * 10 + 20, Math.sin(angle) * 7 - 5]);
      }
      return points;
    });

    fc.assert(
      fc.property(
        ring,
        fc.array(fc.nat(), { minLength: 2, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.nat(),
        (points, cutSeeds, reversals, shuffleSeed) => {
          const n = points.length;
          const cuts = [...new Set(cutSeeds.map((seed) => seed % n))].sort((a, b) => a - b);
          fc.pre(cuts.length >= 2);

          // Segment i runs from cut i to cut i+1 (wrapping), sharing end vertices.
          const segments = cuts.map((from, i) => {
            const to = cuts[(i + 1) % cuts.length];
            const segment: Position[] = [points[from]];
            for (let k = (from + 1) % n; ; k = (k + 1) % n) {
              segment.push(points[k]);
              if (k === to) break;
            }
            return reversals[i] ? segment.reverse() : segment;
          });
          // Deterministic shuffle.
          const order = segments.map((_, i) => i);
          let seed = shuffleSeed;
          for (let i = order.length - 1; i > 0; i--) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            const j = seed % (i + 1);
            [order[i], order[j]] = [order[j], order[i]];
          }

          const rings = stitchRings(order.map((i) => segments[i]));
          expect(rings).toHaveLength(1);
          const [stitched] = rings;
          expect(stitched).toHaveLength(n + 1);
          expect(stitched[stitched.length - 1]).toEqual(stitched[0]);
          expect(Math.abs(signedRingArea(stitched))).toBeCloseTo(
            Math.abs(signedRingArea(points)),
            9,
          );
          expect(new Set(stitched.map(String)).size).toBe(n);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("assemblePolygons", () => {
  const box = (x: number, y: number, size: number): Position[] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];

  test("no usable outer ring → null", () => {
    expect(assemblePolygons([], [box(0, 0, 1)])).toBeNull();
    expect(
      assemblePolygons(
        [
          [
            [0, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [],
      ),
    ).toBeNull();
  });

  test("one outer with holes → Polygon, outer CCW and holes CW whatever the input winding", () => {
    for (const outer of [box(0, 0, 10), box(0, 0, 10).reverse()]) {
      for (const hole of [box(2, 2, 3), box(2, 2, 3).reverse()]) {
        const geometry = assemblePolygons([outer], [hole]);
        expect(geometry?.type).toBe("Polygon");
        expectValidGeometry(geometry!);
        expect((geometry as Polygon).coordinates).toHaveLength(2);
      }
    }
  });

  test("several outers → MultiPolygon with each hole in the outer that contains it", () => {
    const geometry = assemblePolygons(
      [box(0, 0, 10), box(20, 0, 10), box(40, 0, 10)],
      [box(22, 2, 2), box(26, 6, 2), box(41, 1, 1)],
    ) as MultiPolygon;
    expect(geometry.type).toBe("MultiPolygon");
    expectValidGeometry(geometry);
    expect(geometry.coordinates.map((rings) => rings.length)).toEqual([1, 3, 2]);
    expect(geometry.coordinates[1][0][0]).toEqual([20, 0]);
  });

  test("a hole outside every outer is dropped", () => {
    const geometry = assemblePolygons([box(0, 0, 10)], [box(50, 50, 2)]) as Polygon;
    expect(geometry.coordinates).toHaveLength(1);
  });

  test("an island in a courtyard: the hole belongs to the big outer, not the island", () => {
    const geometry = assemblePolygons(
      [box(4, 4, 2), box(0, 0, 10)],
      [box(2, 2, 6)],
    ) as MultiPolygon;
    expect(geometry.type).toBe("MultiPolygon");
    expect(geometry.coordinates.map((rings) => rings.length)).toEqual([1, 2]);
  });

  test("a hole touching the outline at a vertex still counts as inside", () => {
    const hole: Position[] = [
      [0, 5],
      [3, 3],
      [3, 7],
      [0, 5],
    ];
    const geometry = assemblePolygons([box(0, 0, 10)], [hole]) as Polygon;
    expect(geometry.coordinates).toHaveLength(2);
  });
});

describe("parseOverpassResponse: ways", () => {
  test("a closed way becomes a counter-clockwise Polygon with contract properties", () => {
    const { features } = parseOverpassResponse(
      response(way(123, SQUARE, { building: "house", name: " Casa ", "building:levels": "2" })),
    );
    expect(features).toHaveLength(1);
    expect(features[0]).toEqual({
      type: "Feature",
      properties: {
        id: "way/123",
        heightM: 7.5,
        heightSource: "levels",
        levels: 2,
        kind: "house",
        name: "Casa",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0.001, 0],
            [0.001, 0.001],
            [0, 0.001],
            [0, 0],
          ],
        ],
      },
    });
  });

  test("positions are [lon, lat]", () => {
    const { features } = parseOverpassResponse(
      response(
        way(
          1,
          [
            { lat: 37.79, lon: -122.43 },
            { lat: 37.79, lon: -122.429 },
            { lat: 37.791, lon: -122.429 },
            { lat: 37.79, lon: -122.43 },
          ],
          { building: "yes" },
        ),
      ),
    );
    expect(features[0].geometry.coordinates[0][0]).toEqual([-122.43, 37.79]);
  });

  test("no name key when the building is unnamed", () => {
    const { features } = parseOverpassResponse(response(way(1, SQUARE, { building: "yes" })));
    expect("name" in features[0].properties).toBe(false);
    expect(features[0].properties).toEqual({
      id: "way/1",
      heightM: 7,
      heightSource: "default",
      levels: null,
      kind: "yes",
    });
  });

  test("a clockwise way is rewound", () => {
    const { features } = parseOverpassResponse(
      response(way(1, [...SQUARE].reverse(), { building: "yes" })),
    );
    expectValidGeometry(features[0].geometry);
  });

  test("an unclosed way is closed", () => {
    const { features } = parseOverpassResponse(
      response(way(1, SQUARE.slice(0, 4), { building: "yes" })),
    );
    expect(features[0].geometry.coordinates[0]).toHaveLength(5);
    expectValidGeometry(features[0].geometry);
  });

  test("repeated nodes are collapsed", () => {
    const doubled = SQUARE.flatMap((point) => [point, point]);
    const { features } = parseOverpassResponse(response(way(1, doubled, { building: "yes" })));
    expect(features[0].geometry.coordinates[0]).toHaveLength(5);
  });

  test.each([
    ["empty", []],
    ["a single point", [SQUARE[0]]],
    ["two points", [SQUARE[0], SQUARE[1]]],
    ["out and back", [SQUARE[0], SQUARE[1], SQUARE[0]]],
    [
      "collinear",
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 0, lon: 2 },
        { lat: 0, lon: 0 },
      ],
    ],
    ["all the same point", [SQUARE[0], SQUARE[0], SQUARE[0], SQUARE[0]]],
  ])("degenerate ring is dropped: %s", (_, geometry) => {
    expect(parseOverpassResponse(response(way(1, geometry, { building: "yes" }))).features).toEqual(
      [],
    );
  });

  test.each([
    ["untagged", undefined],
    ["not a building", { highway: "service" }],
    ["building=no", { building: "no" }],
    ["building=NO", { building: "NO" }],
    ["empty building value", { building: " " }],
    ["building:part only", { "building:part": "yes", height: "30" }],
    ["underground", { building: "yes", location: "underground" }],
    ["tunnel below ground", { building: "yes", tunnel: "yes", layer: "-1" }],
  ])("skipped: %s", (_, tags) => {
    expect(parseOverpassResponse(response(way(1, SQUARE, tags))).features).toEqual([]);
  });

  test.each([
    ["negative layer without tunnel", { building: "yes", layer: "-1" }],
    ["tunnel=no", { building: "yes", tunnel: "no", layer: "-1" }],
    ["tunnel above ground", { building: "yes", tunnel: "building_passage", layer: "1" }],
    ["min_height present", { building: "yes", min_height: "4" }],
  ])("kept: %s", (_, tags) => {
    expect(parseOverpassResponse(response(way(1, SQUARE, tags))).features).toHaveLength(1);
  });

  test("duplicate ids are emitted once", () => {
    const { features } = parseOverpassResponse(
      response(way(7, SQUARE, { building: "yes" }), way(7, SQUARE, { building: "house" })),
    );
    expect(features.map((f) => f.properties.id)).toEqual(["way/7"]);
  });

  test("height in feet", () => {
    const { features } = parseOverpassResponse(
      response(way(1, SQUARE, { building: "yes", height: "35'" })),
    );
    expect(features[0].properties.heightM).toBeCloseTo(10.668, 3);
    expect(features[0].properties.heightSource).toBe("tagged");
  });
});

describe("coordinate rounding", () => {
  test("coordinates are rounded to 7 decimal places", () => {
    const noisy = [
      { lat: 37.79000004999, lon: -122.43000000001 },
      { lat: 37.79, lon: -122.42900000000002 },
      { lat: 37.791000049, lon: -122.4290000499 },
      { lat: 37.79000004999, lon: -122.43000000001 },
    ];
    const { features } = parseOverpassResponse(response(way(1, noisy, { building: "yes" })));
    expect(features[0].geometry.coordinates[0]).toEqual([
      [-122.43, 37.79],
      [-122.429, 37.79],
      [-122.429, 37.791],
      [-122.43, 37.79],
    ]);
  });

  test("real OSM coordinates (7 decimals) pass through unchanged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -900_000_000, max: 900_000_000 }),
        fc.integer({ min: -1_800_000_000, max: 1_800_000_000 }),
        (latE7, lonE7) => {
          const lat = Number((latE7 / 1e7).toFixed(7));
          const lon = Number((lonE7 / 1e7).toFixed(7));
          const triangle = [
            { lat, lon },
            { lat: lat > 0 ? lat - 0.001 : lat + 0.001, lon },
            { lat, lon: lon > 0 ? lon - 0.001 : lon + 0.001 },
          ];
          const { features } = parseOverpassResponse(
            response(way(1, triangle, { building: "yes" })),
          );
          expect(features[0].geometry.coordinates[0]).toContainEqual([lon, lat]);
        },
      ),
    );
  });

  test("the serialised collection carries no floating-point noise", () => {
    const text = JSON.stringify(parseOverpassResponse(fixture("pacific-heights.overpass.json")));
    expect(text).not.toMatch(/\.\d{8,}/);
  });
});

describe("refineDefaultHeights", () => {
  /** A square footprint of the given area at the equator, as an Overpass way. */
  function footprint(id: number, areaM2: number, tags: Record<string, string>) {
    const side = Math.sqrt(areaM2);
    const dLat = side / 110_574;
    const dLon = side / 111_320;
    const lon = id * 0.01;
    return way(
      id,
      [
        { lat: 0, lon },
        { lat: 0, lon: lon + dLon },
        { lat: dLat, lon: lon + dLon },
        { lat: dLat, lon },
        { lat: 0, lon },
      ],
      tags,
    );
  }

  /** `count` tagged buildings whose heights have the given median. */
  function neighbourhood(count: number, medianM: number) {
    return Array.from({ length: count }, (_, i) =>
      footprint(1000 + i, 150, {
        building: "yes",
        height: String(medianM + (i - (count - 1) / 2) * 0.1),
      }),
    );
  }

  const heightOf = (collection: BuildingCollection, id: number) =>
    byId(collection, `way/${id}`).properties.heightM;

  test("footprintAreaM2", () => {
    const { features } = parseOverpassResponse(
      response(footprint(1, 100, { building: "yes" }), footprint(2, 2500, { building: "yes" })),
    );
    expect(footprintAreaM2(features[0].geometry)).toBeCloseTo(100, 0);
    expect(footprintAreaM2(features[1].geometry)).toBeCloseTo(2500, -1);
    // Holes are subtracted; MultiPolygon parts are added.
    const relations = parseOverpassResponse(fixture("overpass-relations.json"));
    const courtyard = byId(relations, "relation/9100001");
    const [outer, hole] = (courtyard.geometry as Polygon).coordinates;
    const solid = footprintAreaM2({ type: "Polygon", coordinates: [outer] });
    const gap = footprintAreaM2({ type: "Polygon", coordinates: [hole] });
    expect(footprintAreaM2(courtyard.geometry)).toBeCloseTo(solid - gap, 1);
    expect(solid).toBeGreaterThan(7000);
    expect(solid).toBeLessThan(8000);
  });

  test("a generic building takes the median of the tagged and level-based heights", () => {
    const collection = parseOverpassResponse(
      response(
        ...neighbourhood(9, 12),
        footprint(900, 150, { building: "apartments", "building:levels": "6" }),
        footprint(1, 150, { building: "yes" }),
        footprint(2, 150, { building: "something_new" }),
      ),
    );
    // Ten references: nine around 12 m and one of 18.5 m. The median shrugs off the outlier.
    expect(heightOf(collection, 1)).toBeGreaterThanOrEqual(12);
    expect(heightOf(collection, 1)).toBeLessThanOrEqual(12.1);
    expect(heightOf(collection, 2)).toBe(heightOf(collection, 1));
    // Rounded to 0.1 m.
    expect(heightOf(collection, 1) * 10).toBeCloseTo(Math.round(heightOf(collection, 1) * 10), 9);
    expect(byId(collection, "way/1").properties).toMatchObject({
      heightSource: "default",
      levels: null,
      kind: "yes",
    });
  });

  test("needs at least ten reference buildings", () => {
    const few = parseOverpassResponse(
      response(...neighbourhood(9, 12), footprint(1, 150, { building: "yes" })),
    );
    expect(heightOf(few, 1)).toBe(7);
    const enough = parseOverpassResponse(
      response(...neighbourhood(10, 12), footprint(1, 150, { building: "yes" })),
    );
    expect(heightOf(enough, 1)).toBe(12);
  });

  test("other default buildings are not evidence", () => {
    const collection = parseOverpassResponse(
      response(
        ...neighbourhood(9, 12),
        ...Array.from({ length: 30 }, (_, i) => footprint(200 + i, 150, { building: "hotel" })),
        footprint(1, 150, { building: "yes" }),
      ),
    );
    expect(heightOf(collection, 1)).toBe(7);
  });

  test.each([
    [2, 4],
    [4.4, 4.4],
    [25, 25],
    [40, 40],
    [90, 40],
  ])("a median of %d m is used as %d m (clamped to 4–40)", (medianM, expected) => {
    const collection = parseOverpassResponse(
      response(...neighbourhood(11, medianM), footprint(1, 150, { building: "yes" })),
    );
    expect(heightOf(collection, 1)).toBe(expected);
  });

  test("buildings with a specific kind keep their table value", () => {
    const collection = parseOverpassResponse(
      response(
        ...neighbourhood(20, 15),
        footprint(1, 150, { building: "garage" }),
        footprint(2, 150, { building: "house" }),
        footprint(3, 150, { building: "church" }),
        footprint(4, 10, { building: "house" }),
      ),
    );
    expect(heightOf(collection, 1)).toBe(3);
    expect(heightOf(collection, 2)).toBe(7);
    expect(heightOf(collection, 3)).toBe(12);
    expect(heightOf(collection, 4)).toBe(7);
  });

  test("tagged and level-based heights are never touched", () => {
    const collection = parseOverpassResponse(
      response(
        ...neighbourhood(20, 15),
        footprint(1, 10, { building: "yes", height: "9" }),
        footprint(2, 10, { building: "yes", "building:levels": "2" }),
      ),
    );
    expect(heightOf(collection, 1)).toBe(9);
    expect(heightOf(collection, 2)).toBe(6.5);
  });

  test("a tiny generic footprint is an outbuilding (3 m), with or without neighbours", () => {
    const alone = parseOverpassResponse(
      response(footprint(1, 12, { building: "yes" }), footprint(2, 24, { building: "yes" })),
    );
    expect(heightOf(alone, 1)).toBe(3);
    expect(heightOf(alone, 2)).toBe(3);
    const tall = parseOverpassResponse(
      response(...neighbourhood(20, 30), footprint(1, 12, { building: "yes" })),
    );
    expect(heightOf(tall, 1)).toBe(3);
    expect(byId(tall, "way/1").properties.heightSource).toBe("default");
  });

  test("a small footprint (25–50 m²) is never raised above 7 m, but can be lowered", () => {
    const tall = parseOverpassResponse(
      response(
        ...neighbourhood(20, 18),
        footprint(1, 26, { building: "yes" }),
        footprint(2, 49, { building: "yes" }),
        footprint(3, 51, { building: "yes" }),
      ),
    );
    expect(heightOf(tall, 1)).toBe(7);
    expect(heightOf(tall, 2)).toBe(7);
    expect(heightOf(tall, 3)).toBe(18);

    const low = parseOverpassResponse(
      response(...neighbourhood(20, 5), footprint(1, 40, { building: "yes" })),
    );
    expect(heightOf(low, 1)).toBe(5);
  });

  test("does not mutate its input and is idempotent", () => {
    const parsed = parseOverpassResponse(fixture("pacific-heights.overpass.json"));
    const snapshot = structuredClone(parsed);
    const again = refineDefaultHeights(parsed);
    expect(parsed).toEqual(snapshot);
    expect(again).toEqual(parsed);
  });

  test("an empty collection stays empty", () => {
    expect(refineDefaultHeights({ type: "FeatureCollection", features: [] })).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});

describe("parseOverpassResponse: leniency and errors", () => {
  test("bad elements are skipped without throwing", () => {
    const { features } = parseOverpassResponse(
      response(
        null,
        42,
        "way",
        {},
        { type: "node", id: 1, lat: 1, lon: 2 },
        { type: "area", id: 5 },
        { type: "way", id: "abc", geometry: SQUARE, tags: { building: "yes" } },
        { type: "way", id: 2, tags: { building: "yes" } },
        { type: "way", id: 3, geometry: "nope", tags: { building: "yes" } },
        { type: "way", id: 4, geometry: [{ lat: "1", lon: 2 }, null], tags: { building: "yes" } },
        { type: "way", id: 5, geometry: SQUARE, tags: { building: 1 } },
        { type: "relation", id: 6, tags: { building: "yes", type: "multipolygon" } },
        { type: "relation", id: 7, members: [null, 3, {}], tags: { building: "yes" } },
        way(8, SQUARE, { building: "yes" }),
      ),
    );
    expect(features.map((f) => f.properties.id)).toEqual(["way/8"]);
  });

  test("unknown extra fields are tolerated", () => {
    const element = {
      ...way(1, SQUARE, { building: "yes" }),
      nodes: [1, 2, 3, 4, 1],
      bounds: { minlat: 0, minlon: 0, maxlat: 1, maxlon: 1 },
      timestamp: "2024-01-01T00:00:00Z",
      version: 3,
      future_field: { anything: true },
    };
    expect(parseOverpassResponse({ elements: [element], whatever: 1 }).features).toHaveLength(1);
  });

  test("an empty result is a valid, empty collection", () => {
    expect(parseOverpassResponse({ elements: [] })).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test.each([[null], [undefined], ["<html>"], [[]], [{}], [{ elements: "x" }], [{ features: [] }]])(
    "a malformed document throws OverpassError: %j",
    (json) => {
      let error: unknown;
      try {
        parseOverpassResponse(json);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(OverpassError);
      expect((error as OverpassError).kind).toBe("malformed");
    },
  );

  test.each([
    ['runtime error: Query timed out in "query" at line 3 after 26 seconds.', "timeout"],
    ['runtime error: Query ran out of memory in "recurse" at line 4.', "timeout"],
    ["Dispatcher_Client::request_read_and_idx::timeout. The server is too busy", "timeout"],
    [
      "runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::rate_limited",
      "rate-limited",
    ],
  ])("a remark is a failure even with elements present: %s", (remark, kind) => {
    const json = { elements: [way(1, SQUARE, { building: "yes" })], remark };
    expect(() => parseOverpassResponse(json)).toThrow(OverpassError);
    try {
      parseOverpassResponse(json);
    } catch (error) {
      expect((error as OverpassError).kind).toBe(kind);
      expect((error as OverpassError).message).toContain(remark.slice(0, 20));
    }
  });
});

describe("parseOverpassResponse: multipolygon relations", () => {
  const collection = parseOverpassResponse(fixture("overpass-relations.json"));

  test("emits relations and standalone ways, each once", () => {
    expect(collection.features.map((f) => f.properties.id).sort()).toEqual([
      "relation/9100001",
      "relation/9100002",
      "way/9200002",
      "way/9200041",
    ]);
    for (const feature of collection.features) expectValidGeometry(feature.geometry);
  });

  test("one outer and one inner → Polygon with a hole, tags from the relation", () => {
    const feature = byId(collection, "relation/9100001");
    expect(feature.properties).toEqual({
      id: "relation/9100001",
      heightM: 15.5,
      heightSource: "levels",
      levels: 5,
      kind: "apartments",
      name: "Courtyard Block",
    });
    expect(feature.geometry.type).toBe("Polygon");
    const [outer, hole, ...rest] = (feature.geometry as Polygon).coordinates;
    expect(rest).toEqual([]);
    expect(outer).toHaveLength(5);
    expect(hole).toHaveLength(5);
    expect(new Set(outer.map(String))).toEqual(
      new Set(["-122.43,37.79", "-122.43,37.7908", "-122.429,37.7908", "-122.429,37.79"]),
    );
    expect(new Set(hole.map(String))).toEqual(
      new Set(["-122.4297,37.7902", "-122.4293,37.7902", "-122.4293,37.7906", "-122.4297,37.7906"]),
    );
  });

  test("split, shuffled and reversed member ways are stitched; two outers → MultiPolygon", () => {
    const feature = byId(collection, "relation/9100002");
    expect(feature.properties.kind).toBe("university");
    expect(feature.properties.heightSource).toBe("tagged");
    expect(feature.properties.heightM).toBeCloseTo(18.288, 3);
    expect(feature.properties.name).toBe("Science Hall");

    expect(feature.geometry.type).toBe("MultiPolygon");
    const polygons = (feature.geometry as MultiPolygon).coordinates;
    expect(polygons).toHaveLength(2);

    const big = polygons.find((rings) => rings[0].length === 6)!;
    const small = polygons.find((rings) => rings[0].length === 5)!;
    // Five-sided outline assembled from three ways, with the hole from two ways.
    expect(big).toHaveLength(2);
    expect(big[1]).toHaveLength(5);
    expect(new Set(big[0].map(String))).toEqual(
      new Set([
        "-122.428,37.79",
        "-122.4268,37.79",
        "-122.4268,37.791",
        "-122.4274,37.7912",
        "-122.428,37.791",
      ]),
    );
    // The second outer (empty role) has no hole.
    expect(small).toHaveLength(1);
  });

  test("an outer member that is also tagged as a building is not emitted twice", () => {
    expect(collection.features.some((f) => f.properties.id === "way/9200001")).toBe(false);
  });

  test("a building drawn on the inner ring (in the courtyard) is kept", () => {
    expect(byId(collection, "way/9200002").properties.kind).toBe("shed");
  });

  test("untagged member ways and unclosable relations produce nothing", () => {
    const ids = collection.features.map((f) => f.properties.id);
    expect(ids).not.toContain("way/9200013");
    expect(ids).not.toContain("relation/9100003");
  });

  test("a dropped outline way passes its tags on to the relation", () => {
    const hole = [
      { lat: 0.0002, lon: 0.0002 },
      { lat: 0.0002, lon: 0.0006 },
      { lat: 0.0006, lon: 0.0006 },
      { lat: 0.0002, lon: 0.0002 },
    ];
    const relation = (tags: Record<string, string>) => ({
      type: "relation",
      id: 2,
      members: [
        { type: "way", ref: 1, role: "outer", geometry: SQUARE },
        { type: "way", ref: 3, role: "inner", geometry: hole },
      ],
      tags: { type: "multipolygon", ...tags },
    });
    const outline = way(1, SQUARE, { building: "apartments", height: "30", name: "Tower" });

    // The relation only says "building=yes": height, type and name come from the way.
    let { features } = parseOverpassResponse(response(outline, relation({ building: "yes" })));
    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({
      id: "relation/2",
      heightM: 30,
      heightSource: "tagged",
      levels: null,
      kind: "apartments",
      name: "Tower",
    });
    expect((features[0].geometry as Polygon).coordinates).toHaveLength(2);

    // Where both have a say, the relation wins.
    ({ features } = parseOverpassResponse(
      response(outline, relation({ building: "hotel", height: "45", name: "Grand" })),
    ));
    expect(features[0].properties).toMatchObject({ heightM: 45, kind: "hotel", name: "Grand" });
  });

  test("an outer member way survives when its relation is not emitted", () => {
    const outer = way(1, SQUARE, { building: "yes" });
    const relation = {
      type: "relation",
      id: 2,
      members: [{ type: "way", ref: 1, role: "outer", geometry: SQUARE }],
      tags: { building: "no", type: "multipolygon" },
    };
    const ids = parseOverpassResponse(response(relation, outer)).features.map(
      (f) => f.properties.id,
    );
    expect(ids).toEqual(["way/1"]);
  });

  test("relations of another type are ignored", () => {
    const relation = {
      type: "relation",
      id: 2,
      members: [{ type: "way", ref: 1, role: "outline", geometry: SQUARE }],
      tags: { building: "yes", type: "building" },
    };
    expect(parseOverpassResponse(response(relation)).features).toEqual([]);
  });

  test("members without geometry or with an unknown role are ignored", () => {
    const relation = {
      type: "relation",
      id: 2,
      members: [
        { type: "way", ref: 1, role: "outer", geometry: SQUARE },
        { type: "way", ref: 3, role: "inner" },
        { type: "way", ref: 4, role: "part", geometry: SQUARE },
        { type: "relation", ref: 5, role: "outer" },
      ],
      tags: { building: "yes", type: "multipolygon" },
    };
    const { features } = parseOverpassResponse(response(relation));
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe("Polygon");
    expect((features[0].geometry as Polygon).coordinates).toHaveLength(1);
  });
});

describe("parseOverpassResponse: Pacific Heights fixture", () => {
  const raw = fixture("pacific-heights.overpass.json") as { elements: { id: number }[] };
  const collection = parseOverpassResponse(raw);

  test("every element becomes exactly one building", () => {
    expect(raw.elements.length).toBeGreaterThan(300);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(raw.elements.length);
    const ids = collection.features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(raw.elements.map((element) => `way/${element.id}`));
  });

  test("all geometry is valid and in the neighbourhood", () => {
    for (const feature of collection.features) {
      expect(feature.type).toBe("Feature");
      expectValidGeometry(feature.geometry);
      for (const [lng, lat] of (feature.geometry as Polygon).coordinates[0]) {
        expect(Math.abs(lat - 37.7906)).toBeLessThan(0.01);
        expect(Math.abs(lng + 122.4294)).toBeLessThan(0.01);
      }
    }
  });

  test("heights are positive, plausible and attributed to their source", () => {
    const counts = { tagged: 0, levels: 0, default: 0 };
    for (const { properties } of collection.features) {
      counts[properties.heightSource]++;
      expect(Number.isFinite(properties.heightM)).toBe(true);
      expect(properties.heightM).toBeGreaterThan(0);
      expect(properties.heightM).toBeLessThan(150);
      expect(properties.kind).toBe("yes");
      if (properties.heightSource === "default") {
        expect([3, 7, 12]).toContain(properties.heightM);
        expect(properties.levels).toBeNull();
      }
      if (properties.heightSource === "levels") {
        expect(properties.heightM).toBe(properties.levels! * 3 + 0.5);
      }
    }
    expect(counts).toEqual({ tagged: 321, levels: 8, default: 55 });
  });

  test("untagged buildings take the neighbourhood's height, not a global 7 m", () => {
    const reference = collection.features
      .filter((f) => f.properties.heightSource !== "default")
      .map((f) => f.properties.heightM)
      .sort((a, b) => a - b);
    expect(reference).toHaveLength(329);
    // The neighbourhood: mostly three and four storeys.
    expect(reference[164]).toBe(12);

    const defaults = collection.features.filter((f) => f.properties.heightSource === "default");
    const byHeight = new Map<number, number[]>();
    for (const feature of defaults) {
      const areas = byHeight.get(feature.properties.heightM) ?? [];
      areas.push(footprintAreaM2(feature.geometry));
      byHeight.set(feature.properties.heightM, areas);
    }
    expect([...byHeight.keys()].sort((a, b) => a - b)).toEqual([3, 7, 12]);
    // 41 ordinary footprints follow the median; 9 small and 5 tiny ones do not.
    expect(byHeight.get(12)).toHaveLength(41);
    expect(byHeight.get(7)).toHaveLength(9);
    expect(byHeight.get(3)).toHaveLength(5);
    expect(Math.min(...byHeight.get(12)!)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...byHeight.get(7)!)).toBeLessThan(50);
    expect(Math.min(...byHeight.get(7)!)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...byHeight.get(3)!)).toBeLessThan(25);
  });

  test("agrees with the legacy conversion it was generated from", () => {
    const legacy = fixture("pacific-heights.legacy.geojson") as {
      features: {
        properties: { id: number; height: number; heightSource: string; name?: string };
        geometry: Polygon;
      }[];
    };
    expect(legacy.features).toHaveLength(collection.features.length);
    for (const old of legacy.features) {
      const feature = byId(collection, `way/${old.properties.id}`);
      expect(feature.properties.name).toBe(old.properties.name);
      if (old.properties.heightSource === "measured") {
        expect(feature.properties.heightM).toBe(old.properties.height);
        expect(feature.properties.heightSource).toBe("tagged");
      }
      const ring = (feature.geometry as Polygon).coordinates[0];
      expect(ring).toHaveLength(old.geometry.coordinates[0].length);
      expect(Math.abs(signedRingArea(ring))).toBeCloseTo(
        Math.abs(signedRingArea(old.geometry.coordinates[0])),
        12,
      );
    }
    expect(byId(collection, "way/26765512").properties.name).toBe("Clay Street Garage");
  });
});

// ─── Network ───────────────────────────────────────────────────────────────

const CENTER = { lat: 37.791, lng: -122.4297 };
/** Stand-in servers, for tests of the fallback mechanics whatever the real list is. */
const THREE = ["https://a.test/i", "https://b.test/i", "https://c.test/i"];
const OK_BODY = JSON.stringify(response(way(1, SQUARE, { building: "yes" })));

function ok(body: string = OK_BODY, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function mockFetch(...replies: (Response | Error | (() => Promise<Response>))[]): FetchMock {
  const mock = vi.fn<typeof fetch>();
  for (const reply of replies) {
    if (reply instanceof Response) mock.mockResolvedValueOnce(reply);
    else if (reply instanceof Error) mock.mockRejectedValueOnce(reply);
    else mock.mockImplementationOnce(reply);
  }
  return mock;
}

/** A fetch that never answers but honours its abort signal, like the real one. */
function hangingFetch(): FetchMock {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      }),
  );
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("fetchBuildings", () => {
  test("POSTs the query form-encoded to the first endpoint, with no custom headers", async () => {
    const fetchImpl = mockFetch(ok());
    const buildings = await fetchBuildings(CENTER, 500, { fetchImpl });

    expect(buildings.features.map((f) => f.properties.id)).toEqual(["way/1"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect([...body.keys()]).toEqual(["data"]);
    expect(body.get("data")).toBe(buildOverpassQuery(CENTER, 500));
    // What actually goes on the wire.
    const request = new Request(url as string, init);
    expect(request.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    expect(await request.text()).toMatch(/^data=%5Bout%3Ajson%5D/);
  });

  test("the default endpoint list", () => {
    // Two servers, as a last resort. Each one learns the user's IP address
    // and rough position, so the list is kept as short as it can be.
    expect(OVERPASS_ENDPOINTS).toEqual([
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ]);
  });

  test("falls back through the endpoints in order", async () => {
    const fetchImpl = mockFetch(
      new Response("slow down", { status: 429 }),
      new TypeError("Failed to fetch"),
      ok(),
    );
    const buildings = await fetchBuildings(CENTER, 500, { fetchImpl, endpoints: THREE });
    expect(buildings.features).toHaveLength(1);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(THREE);
  });

  test("the default list is tried in its order", async () => {
    const fetchImpl = mockFetch(new Response("slow down", { status: 429 }), ok());
    await fetchBuildings(CENTER, 500, { fetchImpl });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([...OVERPASS_ENDPOINTS]);
  });

  test("uses the endpoints it is given", async () => {
    const fetchImpl = mockFetch(new Response("", { status: 500 }), ok());
    await fetchBuildings(CENTER, 500, {
      fetchImpl,
      endpoints: ["https://a.test/i", "https://b.test/i"],
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://a.test/i",
      "https://b.test/i",
    ]);
  });

  test.each([
    [429, "rate-limited"],
    [504, "timeout"],
    [408, "timeout"],
    [400, "http"],
    [500, "http"],
    [503, "http"],
  ] as const)("HTTP %d → %s", async (status, kind) => {
    const fetchImpl = mockFetch(
      new Response("<html><body><p>The server is probably too busy.</p></body></html>", { status }),
    );
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, endpoints: ["https://a.test/i"] }),
    );
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind, status, endpoint: "https://a.test/i" });
    expect((error as Error).message).toContain(`HTTP ${status}`);
    expect((error as Error).message).not.toContain("<");
  });

  test.each([
    [
      "JSON remark: timed out",
      JSON.stringify({
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 3',
      }),
      "timeout",
    ],
    [
      "JSON remark: out of memory, with partial elements",
      JSON.stringify({
        elements: [way(1, SQUARE, { building: "yes" })],
        remark: "runtime error: Query ran out of memory",
      }),
      "timeout",
    ],
    [
      "HTML error page: rate limited",
      '<?xml version="1.0"?><html><body><p><strong>Error</strong>: runtime error: open64: 0 Success Dispatcher_Client::request_read_and_idx::rate_limited. Please check /api/status for the quota of your IP address.</p></body></html>',
      "rate-limited",
    ],
    [
      "HTML error page: too busy",
      "<html><body><p>Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.</p></body></html>",
      "timeout",
    ],
    [
      "HTML that is not an Overpass error",
      "<!doctype html><title>Wi-Fi login</title>",
      "malformed",
    ],
    ["XML output", '<?xml version="1.0"?><osm version="0.6"></osm>', "malformed"],
    ["truncated JSON", '{"version":0.6,"elements":[{"type":"way"', "malformed"],
    ["empty body", "", "malformed"],
    ["JSON of the wrong shape", '{"error":"nope"}', "malformed"],
  ])("HTTP 200 soft error: %s → %s", async (_, body, kind) => {
    const fetchImpl = mockFetch(ok(body));
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, endpoints: ["https://a.test/i"] }),
    );
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind, status: 200, endpoint: "https://a.test/i" });
  });

  test("a 429 carries the server's Retry-After, as seconds or as a date", async () => {
    const endpoints = ["https://a.test/i"];
    const withHeader = (value: string) =>
      mockFetch(new Response("slow down", { status: 429, headers: { "Retry-After": value } }));

    expect(
      await failure(fetchBuildings(CENTER, 500, { fetchImpl: withHeader("17"), endpoints })),
    ).toMatchObject({ kind: "rate-limited", retryAfterS: 17 });

    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    const dated = (await failure(
      fetchBuildings(CENTER, 500, { fetchImpl: withHeader(inAMinute), endpoints }),
    )) as OverpassError;
    expect(dated.retryAfterS).toBeGreaterThan(55);
    expect(dated.retryAfterS).toBeLessThanOrEqual(61);

    for (const junk of ["soon", "-5", "1e9", "999999999"]) {
      const error = (await failure(
        fetchBuildings(CENTER, 500, { fetchImpl: withHeader(junk), endpoints }),
      )) as OverpassError;
      expect(error.kind).toBe("rate-limited");
      expect(error.retryAfterS, junk).toBeUndefined();
    }
    const bare = mockFetch(new Response("slow down", { status: 429 }));
    expect(
      (
        (await failure(
          fetchBuildings(CENTER, 500, { fetchImpl: bare, endpoints }),
        )) as OverpassError
      ).retryAfterS,
    ).toBeUndefined();
  });

  test("a soft error falls back to the next endpoint", async () => {
    const fetchImpl = mockFetch(
      ok(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" })),
      ok(),
    );
    const buildings = await fetchBuildings(CENTER, 500, { fetchImpl });
    expect(buildings.features).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("a network failure is reported as such, with its cause", async () => {
    const cause = new TypeError("Failed to fetch");
    const fetchImpl = mockFetch(cause);
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, endpoints: ["https://a.test/i"] }),
    );
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind: "network", endpoint: "https://a.test/i", cause });
  });

  test("a connection dropped while downloading the body is a network failure", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      }),
    );
    const fetchImpl = mockFetch(broken, ok());
    const buildings = await fetchBuildings(CENTER, 500, { fetchImpl });
    expect(buildings.features).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("throws the last error when every endpoint fails", async () => {
    const fetchImpl = mockFetch(
      new Response("", { status: 429 }),
      new TypeError("Failed to fetch"),
      new Response("", { status: 504 }),
    );
    const error = await failure(fetchBuildings(CENTER, 500, { fetchImpl, endpoints: THREE }));
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind: "timeout", status: 504, endpoint: THREE[2] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("no endpoints → a network error, no request", async () => {
    const fetchImpl = mockFetch();
    const error = await failure(fetchBuildings(CENTER, 500, { fetchImpl, endpoints: [] }));
    expect(error).toMatchObject({ kind: "network" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("an endpoint that hangs times out and the next one is tried", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = hangingFetch();
      fetchImpl.mockImplementationOnce(fetchImpl.getMockImplementation()!);
      fetchImpl.mockResolvedValueOnce(ok());

      const pending = fetchBuildings(CENTER, 500, { fetchImpl });
      await vi.advanceTimersByTimeAsync(11_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
      expect((await pending).features).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the timeout covers a body that never finishes downloading", async () => {
    vi.useFakeTimers();
    try {
      const stalled = () => Promise.resolve(new Response(new ReadableStream({ start() {} })));
      const fetchImpl = mockFetch(stalled);
      const pending = failure(
        fetchBuildings(CENTER, 500, {
          fetchImpl,
          endpoints: ["https://a.test/i"],
          timeoutMs: 5000,
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
      const error = await pending;
      expect(error).toBeInstanceOf(OverpassError);
      expect(error).toMatchObject({ kind: "timeout", endpoint: "https://a.test/i" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("timing out on every endpoint reports a timeout", async () => {
    const fetchImpl = hangingFetch();
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, timeoutMs: 5, endpoints: THREE }),
    );
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind: "timeout", endpoint: THREE[2] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("an overall budget is shared out over the endpoints, then it is over", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = hangingFetch();
      const pending = failure(
        fetchBuildings(CENTER, 500, {
          fetchImpl,
          timeoutMs: 5_000,
          budgetMs: 7_500,
          endpoints: THREE,
        }),
      );
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // The second endpoint gets what is left: 2.5 s, not its usual 5 s.
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_500);
      const error = await pending;
      expect(error).toBeInstanceOf(OverpassError);
      expect(error).toMatchObject({ kind: "timeout", endpoint: THREE[1] });
      // The third endpoint is never asked: there is no time left for it.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("with a budget, fast failures still go through every endpoint", async () => {
    const fetchImpl = mockFetch(
      new Response("", { status: 500 }),
      new Response("", { status: 429 }),
      ok(),
    );
    const buildings = await fetchBuildings(CENTER, 500, {
      fetchImpl,
      budgetMs: 10_000,
      endpoints: THREE,
    });
    expect(buildings.features).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("a budget too small to ask anyone is a timeout, without a request", async () => {
    const fetchImpl = mockFetch(ok());
    const error = await failure(fetchBuildings(CENTER, 500, { fetchImpl, budgetMs: 500 }));
    expect(error).toBeInstanceOf(OverpassError);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("an abort by the caller rejects with AbortError and does not fall through", async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    const pending = failure(fetchBuildings(CENTER, 500, { fetchImpl, signal: controller.signal }));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(OverpassError);
    expect(isAbortError(error)).toBe(true);
    expect((error as Error).name).toBe("AbortError");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  test("an abort rejects immediately even if fetch ignores the signal", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const pending = failure(fetchBuildings(CENTER, 500, { fetchImpl, signal: controller.signal }));
    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("an abort with a custom reason is still an AbortError", async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    const pending = failure(fetchBuildings(CENTER, 500, { fetchImpl, signal: controller.signal }));
    controller.abort(new Error("navigated away"));
    expect(isAbortError(await pending)).toBe(true);
  });

  test("an already-aborted signal makes no request", async () => {
    const fetchImpl = mockFetch(ok());
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, signal: AbortSignal.abort() }),
    );
    expect(isAbortError(error)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("an abort between endpoints stops the fallback", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      return new Response("", { status: 500 });
    });
    const error = await failure(
      fetchBuildings(CENTER, 500, { fetchImpl, signal: controller.signal }),
    );
    expect(isAbortError(error)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("the caller's signal is left without listeners after success", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await fetchBuildings(CENTER, 500, { fetchImpl: mockFetch(ok()), signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("uses the global fetch by default", async () => {
    const globalFetch = mockFetch(ok());
    vi.stubGlobal("fetch", globalFetch);
    try {
      const buildings = await fetchBuildings(CENTER, 500);
      expect(buildings.features).toHaveLength(1);
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
