import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  angularDistanceDeg,
  bearingDeg,
  fromLocalMeters,
  metersPerDegree,
  normalizeDeg,
  pointInFlatRing,
  pointInMultiPolygon,
  pointInPolygon,
  pointInRing,
  toLocalMeters,
  wrapLngDelta,
} from "./local";

const DEG = Math.PI / 180;

/** Independent great-circle distance on a mean sphere. */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

describe("metersPerDegree", () => {
  test("matches the published WGS84 lengths of a degree", () => {
    // Standard geodesy table values (metres per degree).
    expect(metersPerDegree(0).lat).toBeCloseTo(110574.3, 0);
    expect(metersPerDegree(0).lng).toBeCloseTo(111319.5, 0);
    expect(metersPerDegree(45).lat).toBeCloseTo(111131.7, 0);
    expect(metersPerDegree(45).lng).toBeCloseTo(78846.8, 0);
    expect(metersPerDegree(60).lat).toBeCloseTo(111412.3, 0);
    expect(metersPerDegree(60).lng).toBeCloseTo(55800.0, 0);
  });

  test("is symmetric about the equator and stays invertible at the poles", () => {
    expect(metersPerDegree(-37.79)).toEqual(metersPerDegree(37.79));
    expect(metersPerDegree(90).lng).toBeGreaterThan(0);
    expect(metersPerDegree(90).lat).toBeCloseTo(111694, 0);
  });
});

describe("toLocalMeters / fromLocalMeters", () => {
  const origin = { lat: 37.7906, lng: -122.4294 };

  test("x points east and y points north", () => {
    expect(toLocalMeters(origin, origin)).toEqual({ x: 0, y: 0 });
    const east = toLocalMeters(origin, { lat: origin.lat, lng: origin.lng + 0.001 });
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBe(0);
    const north = toLocalMeters(origin, { lat: origin.lat + 0.001, lng: origin.lng });
    expect(north.x).toBe(0);
    expect(north.y).toBeGreaterThan(0);
    const southWest = toLocalMeters(origin, { lat: origin.lat - 0.001, lng: origin.lng - 0.001 });
    expect(southWest.x).toBeLessThan(0);
    expect(southWest.y).toBeLessThan(0);
  });

  test("0.001° at San Francisco is the expected number of metres", () => {
    const p = toLocalMeters(origin, { lat: origin.lat + 0.001, lng: origin.lng + 0.001 });
    expect(p.y).toBeCloseTo(110.99, 1);
    expect(p.x).toBeCloseTo(88.08, 1);
  });

  test("works across the antimeridian", () => {
    const fiji = { lat: -17, lng: 179.9995 };
    const p = toLocalMeters(fiji, { lat: -17, lng: -179.9995 });
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeCloseTo(0.001 * metersPerDegree(-17).lng, 6);
    const q = toLocalMeters({ lat: -17, lng: -179.9995 }, fiji);
    expect(q.x).toBeCloseTo(-p.x, 6);
  });

  test("round-trips", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        (lat, lng, x, y) => {
          const o = { lat, lng };
          const back = toLocalMeters(o, fromLocalMeters(o, x, y));
          expect(back.x).toBeCloseTo(x, 6);
          expect(back.y).toBeCloseTo(y, 6);
        },
      ),
    );
  });

  test("distances agree with the great-circle distance within 0.6% up to 2 km", () => {
    // 0.6% covers the sphere-vs-ellipsoid difference of the reference itself.
    fc.assert(
      fc.property(
        fc.double({ min: -70, max: 70, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: 50, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (lat, lng, distance, bearing) => {
          const o = { lat, lng };
          const p = fromLocalMeters(
            o,
            distance * Math.sin(bearing * DEG),
            distance * Math.cos(bearing * DEG),
          );
          expect(Math.abs(haversineM(o, p) - distance) / distance).toBeLessThan(0.006);
        },
      ),
    );
  });
});

describe("normalizeDeg", () => {
  test("known values", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(720.5)).toBe(0.5);
    expect(normalizeDeg(-720.5)).toBe(359.5);
    expect(normalizeDeg(359.999)).toBe(359.999);
  });

  test("never returns 360 or -0", () => {
    expect(normalizeDeg(-1e-17)).toBe(0);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
    expect(Object.is(normalizeDeg(-360), 0)).toBe(true);
  });

  test("leaves in-range values bit-for-bit unchanged", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 360, maxExcluded: true, noNaN: true }), (d) => {
        expect(normalizeDeg(d)).toBe(d === 0 ? 0 : d);
      }),
    );
  });

  test("is in [0, 360) and congruent to the input", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (d) => {
        const n = normalizeDeg(d);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(360);
        const turns = (d - n) / 360;
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("angularDistanceDeg", () => {
  test("known values", () => {
    expect(angularDistanceDeg(350, 10)).toBe(20);
    expect(angularDistanceDeg(10, 350)).toBe(20);
    expect(angularDistanceDeg(0, 180)).toBe(180);
    expect(angularDistanceDeg(90, 90)).toBe(0);
    expect(angularDistanceDeg(-45, 45)).toBe(90);
    expect(angularDistanceDeg(725, 5)).toBe(0);
  });

  test("is symmetric and in [0, 180]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        (a, b) => {
          const d = angularDistanceDeg(a, b);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(180);
          expect(angularDistanceDeg(b, a)).toBeCloseTo(d, 9);
        },
      ),
    );
  });
});

describe("bearingDeg", () => {
  test("compass directions", () => {
    expect(bearingDeg(0, 1)).toBe(0);
    expect(bearingDeg(1, 0)).toBe(90);
    expect(bearingDeg(0, -1)).toBe(180);
    expect(bearingDeg(-1, 0)).toBe(270);
    expect(bearingDeg(1, 1)).toBeCloseTo(45, 12);
    expect(bearingDeg(-1, 1)).toBeCloseTo(315, 12);
    expect(bearingDeg(0, 0)).toBe(0);
  });

  test("inverts sin/cos", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.999, noNaN: true }),
        fc.double({ min: 0.1, max: 1000, noNaN: true }),
        (bearing, r) => {
          const got = bearingDeg(r * Math.sin(bearing * DEG), r * Math.cos(bearing * DEG));
          expect(angularDistanceDeg(got, bearing)).toBeLessThan(1e-9);
        },
      ),
    );
  });
});

describe("wrapLngDelta", () => {
  test("wraps into [-180, 180)", () => {
    expect(wrapLngDelta(0)).toBe(0);
    expect(wrapLngDelta(190)).toBe(-170);
    expect(wrapLngDelta(-190)).toBe(170);
    expect(wrapLngDelta(180)).toBe(-180);
    expect(wrapLngDelta(359)).toBe(-1);
  });
});

describe("point in polygon", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  // An "L": the square with its top-right quadrant removed.
  const lShape: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [5, 5],
    [5, 10],
    [0, 10],
    [0, 0],
  ];

  test("square", () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(0.001, 9.999, square)).toBe(true);
    expect(pointInRing(-0.001, 5, square)).toBe(false);
    expect(pointInRing(5, 10.001, square)).toBe(false);
    expect(pointInRing(15, 5, square)).toBe(false);
  });

  test("concave ring", () => {
    expect(pointInRing(2, 8, lShape)).toBe(true);
    expect(pointInRing(8, 2, lShape)).toBe(true);
    expect(pointInRing(8, 8, lShape)).toBe(false);
  });

  test("open rings, reversed winding and extra ordinates give the same answer", () => {
    const open = square.slice(0, -1);
    const reversed = [...square].reverse();
    const withAltitude = square.map(([x, y]) => [x, y, 30]);
    for (const [x, y] of [
      [5, 5],
      [11, 5],
      [-1, -1],
      [9.5, 0.5],
    ]) {
      const expected = pointInRing(x, y, square);
      expect(pointInRing(x, y, open)).toBe(expected);
      expect(pointInRing(x, y, reversed)).toBe(expected);
      expect(pointInRing(x, y, withAltitude)).toBe(expected);
    }
  });

  test("degenerate rings contain nothing", () => {
    expect(pointInRing(0, 0, [])).toBe(false);
    expect(pointInRing(0, 0, [[0, 0]])).toBe(false);
    expect(
      pointInRing(0.5, 0, [
        [0, 0],
        [1, 0],
      ]),
    ).toBe(false);
  });

  test("holes are outside the polygon", () => {
    const outer = [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
      [-20, -20],
    ];
    const hole = [
      [-5, -5],
      [-5, 5],
      [5, 5],
      [5, -5],
      [-5, -5],
    ];
    expect(pointInPolygon(0, 0, [outer, hole])).toBe(false);
    expect(pointInPolygon(10, 0, [outer, hole])).toBe(true);
    expect(pointInPolygon(30, 0, [outer, hole])).toBe(false);
    expect(pointInPolygon(0, 0, [outer])).toBe(true);
    expect(pointInPolygon(0, 0, [])).toBe(false);
  });

  test("multipolygon: inside any member", () => {
    const a = [square];
    const b = [square.map(([x, y]) => [x + 100, y])];
    expect(pointInMultiPolygon(5, 5, [a, b])).toBe(true);
    expect(pointInMultiPolygon(105, 5, [a, b])).toBe(true);
    expect(pointInMultiPolygon(50, 5, [a, b])).toBe(false);
    expect(pointInMultiPolygon(5, 5, [])).toBe(false);
  });

  test("agrees with a half-plane test on random rotated rectangles", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 1, max: 30, noNaN: true }),
        fc.double({ min: 1, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (cx, cy, halfW, halfH, rotation, px, py) => {
          const cos = Math.cos(rotation * DEG);
          const sin = Math.sin(rotation * DEG);
          const corner = (u: number, v: number): [number, number] => [
            cx + u * cos - v * sin,
            cy + u * sin + v * cos,
          ];
          const ring = [
            corner(-halfW, -halfH),
            corner(halfW, -halfH),
            corner(halfW, halfH),
            corner(-halfW, halfH),
          ];
          // The point in the rectangle's own frame.
          const u = (px - cx) * cos + (py - cy) * sin;
          const v = -(px - cx) * sin + (py - cy) * cos;
          const margin = Math.min(halfW - Math.abs(u), halfH - Math.abs(v));
          fc.pre(Math.abs(margin) > 1e-6); // skip points on the boundary
          expect(pointInRing(px, py, ring)).toBe(margin > 0);

          const flat = ring.flat();
          expect(pointInFlatRing(px, py, flat)).toBe(margin > 0);
          // …and when the ring sits in the middle of a longer flat array.
          const padded = [99, 99, ...flat, -99, -99];
          expect(pointInFlatRing(px, py, padded, 1, 5)).toBe(margin > 0);
        },
      ),
    );
  });
});
