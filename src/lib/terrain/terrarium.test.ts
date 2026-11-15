import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { real } from "@/lib/geo/testing";

import { decodeTerrarium, metersToTerrarium, terrariumToMeters } from "./terrarium";

describe("Terrarium encoding", () => {
  test("documented values: elevation = (R·256 + G + B/256) − 32768", () => {
    expect(terrariumToMeters(128, 0, 0)).toBe(0); // sea level
    expect(terrariumToMeters(128, 1, 0)).toBe(1);
    expect(terrariumToMeters(128, 0, 128)).toBe(0.5);
    expect(terrariumToMeters(127, 255, 0)).toBe(-1);
    expect(terrariumToMeters(162, 144, 0)).toBe(8848); // Everest
    expect(terrariumToMeters(85, 59, 0)).toBe(-10949); // Challenger Deep-ish
    expect(terrariumToMeters(0, 0, 0)).toBe(-32768);
    expect(metersToTerrarium(0)).toEqual([128, 0, 0]);
    expect(metersToTerrarium(94.5)).toEqual([128, 94, 128]);
    expect(metersToTerrarium(-1)).toEqual([127, 255, 0]);
  });

  test("encode → decode round-trips to 1/256 m", () => {
    fc.assert(
      fc.property(real(-11000, 8900), (elevation) => {
        const [r, g, b] = metersToTerrarium(elevation);
        for (const channel of [r, g, b]) {
          expect(Number.isInteger(channel) && channel >= 0 && channel <= 255).toBe(true);
        }
        expect(Math.abs(terrariumToMeters(r, g, b) - elevation)).toBeLessThanOrEqual(
          1 / 512 + 1e-9,
        );
      }),
    );
  });
});

describe("decodeTerrarium", () => {
  const rgba = (elevations: number[]) =>
    Uint8ClampedArray.from(elevations.flatMap((e) => [...metersToTerrarium(e), 255]));

  test("decodes every pixel, row by row", () => {
    const elevations = decodeTerrarium({
      width: 3,
      height: 2,
      data: rgba([0, 1, 94.5, -1, 8848, 123.25]),
    });
    expect(elevations).toBeInstanceOf(Float32Array);
    expect(Array.from(elevations)).toEqual([0, 1, 94.5, -1, 8848, 123.25]);
  });

  test("accepts a plain Uint8Array too", () => {
    const data = Uint8Array.from(rgba([10, 20]));
    expect(Array.from(decodeTerrarium({ width: 2, height: 1, data }))).toEqual([10, 20]);
  });

  test("rejects a buffer of the wrong size", () => {
    expect(() => decodeTerrarium({ width: 2, height: 2, data: rgba([1, 2, 3]) })).toThrow(
      RangeError,
    );
    expect(() => decodeTerrarium({ width: 0, height: 2, data: new Uint8ClampedArray(0) })).toThrow(
      RangeError,
    );
    expect(() =>
      decodeTerrarium({ width: 1.5, height: 2, data: new Uint8ClampedArray(12) }),
    ).toThrow(RangeError);
  });

  test("rejects transparent pixels (premultiplied alpha would corrupt the colours)", () => {
    const data = rgba([10, 20]);
    data[7] = 254;
    expect(() => decodeTerrarium({ width: 2, height: 1, data })).toThrow(/transparent/);
  });

  test("rejects pixels that cannot be elevations (e.g. an all-black or all-white image)", () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    expect(() => decodeTerrarium({ width: 1, height: 1, data: black })).toThrow(/implausible/);
    expect(() => decodeTerrarium({ width: 1, height: 1, data: white })).toThrow(/implausible/);
  });
});
