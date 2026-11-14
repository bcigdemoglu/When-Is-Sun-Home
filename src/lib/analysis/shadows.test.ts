import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { real } from "@/lib/geo/testing";

import { toLocalMeters } from "@/lib/geo/local";
import { buildingFromLocal, collectionOf, rect } from "@/lib/horizon/testing";
import type { LatLng } from "@/lib/types";

import { computeShadowPolygons } from "./shadows";

const PLACE: LatLng = { lat: 37.7906, lng: -122.4294 };
const DEG = Math.PI / 180;

/** A 10 m × 10 m, 20 m tall building centred on the place. */
const cube = buildingFromLocal(PLACE, [[rect(-5, -5, 5, 5)]], 20, "way/cube");

/** All shadow vertices of a result, in local metres. */
function localVertices(
  result: ReturnType<typeof computeShadowPolygons>,
): { x: number; y: number }[] {
  return result.features.flatMap((feature) =>
    feature.geometry.coordinates[0].map(([lng, lat]) => toLocalMeters(PLACE, { lat, lng })),
  );
}

function extent(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

describe("computeShadowPolygons", () => {
  test("sun in the south at 45°: the shadow reaches north by exactly the building height", () => {
    const result = computeShadowPolygons(PLACE, collectionOf([cube]), 180, 45);
    const box = extent(localVertices(result));
    // Footprint y ∈ [-5, 5]; swept 20 m north → up to y = 25. Nothing to the south, east or west.
    expect(box.maxY).toBeCloseTo(25, 6);
    expect(box.minY).toBeCloseTo(-5, 6);
    expect(box.minX).toBeCloseTo(-5, 6);
    expect(box.maxX).toBeCloseTo(5, 6);
  });

  test("shadows point away from the sun in every direction", () => {
    const cases: [number, "maxX" | "minX" | "maxY" | "minY", number][] = [
      [180, "maxY", 25], // sun south → shadow north
      [0, "minY", -25], // sun north → shadow south
      [90, "minX", -25], // sun east → shadow west
      [270, "maxX", 25], // sun west → shadow east
    ];
    for (const [azimuth, side, expected] of cases) {
      const box = extent(
        localVertices(computeShadowPolygons(PLACE, collectionOf([cube]), azimuth, 45)),
      );
      expect(box[side], `azimuth ${azimuth}`).toBeCloseTo(expected, 6);
    }
    // South-east sun → shadow to the north-west, 20 m along the diagonal.
    const box = extent(localVertices(computeShadowPolygons(PLACE, collectionOf([cube]), 135, 45)));
    expect(box.minX).toBeCloseTo(-5 - 20 * Math.SQRT1_2, 6);
    expect(box.maxY).toBeCloseTo(5 + 20 * Math.SQRT1_2, 6);
    expect(box.maxX).toBeCloseTo(5, 6);
    expect(box.minY).toBeCloseTo(-5, 6);
  });

  test("length is height / tan(altitude)", () => {
    for (const [altitude, length] of [
      [45, 20],
      [30, 20 / Math.tan(30 * DEG)],
      [60, 20 / Math.tan(60 * DEG)],
      [10, 20 / Math.tan(10 * DEG)],
    ]) {
      const box = extent(
        localVertices(computeShadowPolygons(PLACE, collectionOf([cube]), 180, altitude)),
      );
      expect(box.maxY - 5, `altitude ${altitude}`).toBeCloseTo(length, 5);
    }
    // Sanity: 30° → 34.64 m, 10° → 113.4 m.
    expect(20 / Math.tan(30 * DEG)).toBeCloseTo(34.64, 2);
    expect(20 / Math.tan(10 * DEG)).toBeCloseTo(113.43, 2);
  });

  test("length is capped at maxLengthM (default 300 m)", () => {
    // 20 m at 2° would be 573 m.
    const capped = extent(
      localVertices(computeShadowPolygons(PLACE, collectionOf([cube]), 180, 2)),
    );
    expect(capped.maxY - 5).toBeCloseTo(300, 5);
    const custom = extent(
      localVertices(computeShadowPolygons(PLACE, collectionOf([cube]), 180, 2, { maxLengthM: 50 })),
    );
    expect(custom.maxY - 5).toBeCloseTo(50, 5);
    // The cap does not lengthen short shadows.
    const short = extent(
      localVertices(
        computeShadowPolygons(PLACE, collectionOf([cube]), 180, 45, { maxLengthM: 50 }),
      ),
    );
    expect(short.maxY - 5).toBeCloseTo(20, 5);
  });

  test("no shadows when the sun is at or below 0.5°, or the position is not a number", () => {
    for (const altitude of [0.5, 0.4, 0, -10, NaN]) {
      expect(computeShadowPolygons(PLACE, collectionOf([cube]), 180, altitude).features).toEqual(
        [],
      );
    }
    expect(computeShadowPolygons(PLACE, collectionOf([cube]), NaN, 45).features).toEqual([]);
    expect(
      computeShadowPolygons(PLACE, collectionOf([cube]), 180, 0.51).features.length,
    ).toBeGreaterThan(0);
    expect(computeShadowPolygons(PLACE, collectionOf([]), 180, 45)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("sun at the zenith: no shadow beyond the footprint", () => {
    expect(computeShadowPolygons(PLACE, collectionOf([cube]), 180, 90).features).toEqual([]);
  });

  test("emits the translated roof plus one quad per wall, all valid closed rings", () => {
    const result = computeShadowPolygons(PLACE, collectionOf([cube]), 180, 45);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1 + 4);
    for (const feature of result.features) {
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("Polygon");
      expect(feature.geometry.coordinates).toHaveLength(1);
      const ring = feature.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[ring.length - 1]).toEqual(ring[0]);
      expect(feature.properties).toEqual({ id: "way/cube", buildingIndex: 0 });
    }
    // First piece: the roof outline moved 20 m north.
    const roof = result.features[0].geometry.coordinates[0].map(([lng, lat]) =>
      toLocalMeters(PLACE, { lat, lng }),
    );
    expect(extent(roof).minY).toBeCloseTo(15, 6);
    expect(extent(roof).maxY).toBeCloseTo(25, 6);
    // Each wall quad joins an edge to its moved copy: 4 distinct corners, 20 m apart in y.
    for (const feature of result.features.slice(1)) {
      const quad = feature.geometry.coordinates[0].map(([lng, lat]) =>
        toLocalMeters(PLACE, { lat, lng }),
      );
      expect(quad).toHaveLength(5);
      expect(quad[3].y - quad[0].y).toBeCloseTo(20, 6);
      expect(quad[2].y - quad[1].y).toBeCloseTo(20, 6);
      expect(quad[3].x).toBeCloseTo(quad[0].x, 6);
      expect(quad[2].x).toBeCloseTo(quad[1].x, 6);
    }
  });

  test("taller buildings cast proportionally longer shadows; each piece names its building", () => {
    const low = buildingFromLocal(PLACE, [[rect(-5, -5, 5, 5)]], 5, "way/low");
    const high = buildingFromLocal(PLACE, [[rect(40, -5, 50, 5)]], 50, "way/high");
    const result = computeShadowPolygons(PLACE, collectionOf([low, high]), 180, 45);
    const of = (id: string) => ({
      ...result,
      features: result.features.filter((f) => f.properties.id === id),
    });
    expect(extent(localVertices(of("way/low"))).maxY).toBeCloseTo(10, 6);
    expect(extent(localVertices(of("way/high"))).maxY).toBeCloseTo(55, 6);
    expect(of("way/low").features.every((f) => f.properties.buildingIndex === 0)).toBe(true);
    expect(of("way/high").features.every((f) => f.properties.buildingIndex === 1)).toBe(true);
  });

  test("MultiPolygons cast a shadow per part; holes are ignored; open rings are closed", () => {
    const twoParts = buildingFromLocal(
      PLACE,
      [[rect(-5, -5, 5, 5)], [rect(20, -5, 30, 5), rect(23, -2, 27, 2)]],
      10,
    );
    const result = computeShadowPolygons(PLACE, collectionOf([twoParts]), 180, 45);
    // Two outer rings → 2 roofs + 2 × 4 walls; the hole adds nothing.
    expect(result.features).toHaveLength(10);
    const box = extent(localVertices(result));
    expect(box.minX).toBeCloseTo(-5, 6);
    expect(box.maxX).toBeCloseTo(30, 6);
    expect(box.maxY).toBeCloseTo(15, 6);

    const open = buildingFromLocal(PLACE, [[rect(-5, -5, 5, 5).slice(0, -1)]], 10);
    const fromOpen = computeShadowPolygons(PLACE, collectionOf([open]), 180, 45);
    expect(fromOpen.features).toHaveLength(5);
    for (const feature of fromOpen.features) {
      const ring = feature.geometry.coordinates[0];
      expect(ring[ring.length - 1]).toEqual(ring[0]);
    }
  });

  test("the input collection is not modified", () => {
    const collection = collectionOf([cube]);
    const before = JSON.stringify(collection);
    computeShadowPolygons(PLACE, collection, 200, 30);
    expect(JSON.stringify(collection)).toBe(before);
  });

  test("every vertex is a footprint vertex or one displaced by exactly the shadow vector", () => {
    fc.assert(
      fc.property(real(0, 360), real(1, 89), real(1, 100), (azimuth, altitude, heightM) => {
        const building = buildingFromLocal(PLACE, [[rect(-5, -5, 5, 5)]], heightM);
        const result = computeShadowPolygons(PLACE, collectionOf([building]), azimuth, altitude);
        const length = Math.min(heightM / Math.tan(altitude * DEG), 300);
        // Away from the sun: bearing azimuth + 180.
        const dx = -length * Math.sin(azimuth * DEG);
        const dy = -length * Math.cos(azimuth * DEG);
        for (const p of localVertices(result)) {
          const isCorner = (x: number, y: number) =>
            Math.abs(Math.abs(x) - 5) < 1e-6 && Math.abs(Math.abs(y) - 5) < 1e-6;
          expect(isCorner(p.x, p.y) || isCorner(p.x - dx, p.y - dy)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
