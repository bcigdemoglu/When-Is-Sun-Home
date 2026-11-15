import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  AREA_LAT_STEP_DEG,
  AREA_MIN_MARGIN_M,
  AREA_RADIUS_M,
  areAreasAdjacent,
  fetchAreaFor,
  parseAreaKey,
} from "./tiles";

/** Great-circle distance in metres (haversine, mean Earth radius). */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const anyPlace = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("fetchAreaFor", () => {
  test("Pacific Heights", () => {
    const area = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
    expect(area.radiusM).toBe(500);
    expect(area.key).toBe("v1:37.791:-122.4297");
    expect(area.center.lat).toBeCloseTo(37.791, 9);
    expect(distanceM(area.center, { lat: 37.7906, lng: -122.4294 })).toBeLessThan(160);
  });

  test("nearby pins share an area", () => {
    const a = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
    const b = fetchAreaFor({ lat: 37.79065, lng: -122.42945 });
    const c = fetchAreaFor({ lat: 37.7909, lng: -122.4291 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("a pin more than a cell away is in another area", () => {
    const a = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
    // 300 m north is more than one cell height.
    expect(fetchAreaFor({ lat: 37.7906 + 300 / 111_320, lng: -122.4294 }).key).not.toBe(a.key);
  });

  test("every point of a cell maps to that cell", () => {
    fc.assert(
      fc.property(
        anyPlace,
        fc.double({ min: -0.49, max: 0.49, noNaN: true }),
        fc.double({ min: -0.49, max: 0.49, noNaN: true }),
        (place, fy, fx) => {
          const area = fetchAreaFor(place);
          fc.pre(Math.abs(area.center.lat) < 89.9 && Math.abs(area.center.lng) < 179.9);
          const lngStep = AREA_LAT_STEP_DEG / Math.cos((area.center.lat * Math.PI) / 180);
          const other = fetchAreaFor({
            lat: area.center.lat + fy * AREA_LAT_STEP_DEG,
            lng: area.center.lng + fx * lngStep,
          });
          expect(other.key).toBe(area.key);
        },
      ),
    );
  });

  test("the pin always has the guaranteed margin of buildings around it", () => {
    fc.assert(
      fc.property(anyPlace, (place) => {
        const area = fetchAreaFor(place);
        const margin = area.radiusM - distanceM(area.center, place);
        expect(margin).toBeGreaterThanOrEqual(AREA_MIN_MARGIN_M);
      }),
      { numRuns: 2000 },
    );
  });

  test("cells are about 220 m on a side at any inhabited latitude", () => {
    for (const lat of [0, 37.79, -33.9, 51.5, 64.1, -54.8, 78.2]) {
      const area = fetchAreaFor({ lat, lng: 10 });
      const lngStep = AREA_LAT_STEP_DEG / Math.cos((area.center.lat * Math.PI) / 180);
      const width = distanceM(area.center, {
        lat: area.center.lat,
        lng: area.center.lng + lngStep,
      });
      const height = distanceM(area.center, {
        lat: area.center.lat + AREA_LAT_STEP_DEG,
        lng: area.center.lng,
      });
      expect(width).toBeGreaterThan(215);
      expect(width).toBeLessThan(230);
      expect(height).toBeGreaterThan(215);
      expect(height).toBeLessThan(230);
    }
  });

  test("keys are stable, short and valid for any place", () => {
    fc.assert(
      fc.property(anyPlace, (place) => {
        const area = fetchAreaFor(place);
        expect(fetchAreaFor(place)).toEqual(area);
        expect(fetchAreaFor(area.center).key).toBe(area.key);
        expect(area.key).toMatch(/^v1:-?\d{1,2}\.\d{3}:-?\d{1,3}\.\d{4}$/);
        expect(area.radiusM).toBe(AREA_RADIUS_M);
        expect(Math.abs(area.center.lat)).toBeLessThanOrEqual(90);
        expect(area.center.lng).toBeGreaterThanOrEqual(-180);
        expect(area.center.lng).toBeLessThan(180);
      }),
      { numRuns: 2000 },
    );
  });

  test("distinct cells get distinct keys", () => {
    fc.assert(
      fc.property(anyPlace, anyPlace, (a, b) => {
        const areaA = fetchAreaFor(a);
        const areaB = fetchAreaFor(b);
        const sameCentre =
          Math.abs(areaA.center.lat - areaB.center.lat) < 1e-9 &&
          Math.abs(areaA.center.lng - areaB.center.lng) < 1e-9;
        expect(areaA.key === areaB.key).toBe(sameCentre);
      }),
    );
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 50; j++) {
        keys.add(fetchAreaFor({ lat: 37.7 + i * 0.002 + 0.001, lng: -122.5 + j * 0.0026 }).key);
      }
    }
    // 50 rows; a column step here is ~0.00253°, so 0.0026° steps hit ~50 columns per row.
    expect(keys.size).toBeGreaterThan(50 * 49);
  });

  test("equator and prime meridian: the four quadrants are four cells", () => {
    const e = 1e-5;
    const keys = [
      fetchAreaFor({ lat: e, lng: e }),
      fetchAreaFor({ lat: e, lng: -e }),
      fetchAreaFor({ lat: -e, lng: e }),
      fetchAreaFor({ lat: -e, lng: -e }),
    ].map((area) => area.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain("v1:0.001:0.0010");
    expect(keys).toContain("v1:-0.001:-0.0010");
  });

  test("negative coordinates", () => {
    const sydney = { lat: -33.8568, lng: 151.2153 };
    const area = fetchAreaFor(sydney);
    expect(area.center.lat).toBeLessThan(0);
    expect(distanceM(area.center, sydney)).toBeLessThan(160);
    const rio = { lat: -22.9519, lng: -43.2105 };
    expect(distanceM(fetchAreaFor(rio).center, rio)).toBeLessThan(160);
  });

  test("antimeridian: both sides are covered and longitudes wrap", () => {
    for (const lat of [-16.5, 0.0005, 51.9, 66.01]) {
      const east = fetchAreaFor({ lat, lng: 179.99995 });
      const west = fetchAreaFor({ lat, lng: -179.99995 });
      expect(east.key).not.toBe(west.key);
      for (const area of [east, west]) {
        expect(area.center.lng).toBeGreaterThanOrEqual(-180);
        expect(area.center.lng).toBeLessThan(180);
      }
      expect(distanceM(east.center, { lat, lng: 179.99995 })).toBeLessThan(160);
      expect(distanceM(west.center, { lat, lng: -179.99995 })).toBeLessThan(160);
      // 180 and -180 are the same meridian; so are 190 and -170.
      expect(fetchAreaFor({ lat, lng: 180 })).toEqual(fetchAreaFor({ lat, lng: -180 }));
      expect(fetchAreaFor({ lat, lng: 190 })).toEqual(fetchAreaFor({ lat, lng: -170 }));
    }
  });

  test("poles: finite, clamped and still within the margin", () => {
    for (const place of [
      { lat: 90, lng: 0 },
      { lat: -90, lng: 0 },
      { lat: 89.9999, lng: 123.4 },
      { lat: -89.9999, lng: -123.4 },
      { lat: 95, lng: 10 },
    ]) {
      const area = fetchAreaFor(place);
      expect(Number.isFinite(area.center.lat)).toBe(true);
      expect(Number.isFinite(area.center.lng)).toBe(true);
      expect(Math.abs(area.center.lat)).toBeLessThan(90);
      const clamped = { lat: Math.max(-90, Math.min(90, place.lat)), lng: place.lng };
      expect(distanceM(area.center, clamped)).toBeLessThan(AREA_RADIUS_M - AREA_MIN_MARGIN_M);
    }
  });

  test("rejects non-finite input", () => {
    expect(() => fetchAreaFor({ lat: Number.NaN, lng: 0 })).toThrow(RangeError);
    expect(() => fetchAreaFor({ lat: 0, lng: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("area keys", () => {
  test("parseAreaKey returns the cell centre", () => {
    const area = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
    const centre = parseAreaKey(area.key);
    expect(centre?.lat).toBeCloseTo(area.center.lat, 3);
    expect(centre?.lng).toBeCloseTo(area.center.lng, 4);
    expect(parseAreaKey("none")).toBeNull();
    expect(parseAreaKey("v1:abc:def")).toBeNull();
  });

  test("areAreasAdjacent: same and touching cells yes, distant cells no", () => {
    const { key: here, center } = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
    const lngStep = AREA_LAT_STEP_DEG / Math.cos((center.lat * Math.PI) / 180);
    // Columns of neighbouring rows are not aligned, so step from the cell centre.
    const at = (rows: number, cols: number) =>
      fetchAreaFor({
        lat: center.lat + rows * AREA_LAT_STEP_DEG,
        lng: center.lng + cols * lngStep,
      }).key;

    expect(areAreasAdjacent(here, here)).toBe(true);
    for (const [rows, cols] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ]) {
      expect(areAreasAdjacent(here, at(rows, cols)), `${rows},${cols}`).toBe(true);
    }
    for (const [rows, cols] of [
      [3, 0],
      [0, 3],
      [-3, -3],
      [50, 50],
    ]) {
      expect(areAreasAdjacent(here, at(rows, cols)), `${rows},${cols}`).toBe(false);
    }
    expect(areAreasAdjacent(here, fetchAreaFor({ lat: 52.52, lng: 13.405 }).key)).toBe(false);
    expect(areAreasAdjacent(here, "none")).toBe(false);
  });

  test("areAreasAdjacent works across the antimeridian", () => {
    const east = fetchAreaFor({ lat: 10, lng: 179.9995 }).key;
    const west = fetchAreaFor({ lat: 10, lng: -179.9995 }).key;
    expect(areAreasAdjacent(east, west)).toBe(true);
  });
});
