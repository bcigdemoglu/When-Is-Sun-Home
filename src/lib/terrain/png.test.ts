import fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { fromLocalMeters } from "@/lib/geo/local";

import { canDecodePng, decodePng, UnsupportedPngError } from "./png";
import { decodeTerrarium } from "./terrarium";
import { encodePng, loadPacificHeightsTerrain, type PngFilter } from "./testing";
import { latToTileY, lngToTileX } from "./tiles";

function randomPixels(
  width: number,
  height: number,
  seed: number,
  opaque: boolean,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = opaque && i % 4 === 3 ? 255 : state >>> 24;
  }
  return data;
}

describe("decodePng", () => {
  test("this runtime can inflate PNG data (Node ≥ 18 and every current browser)", () => {
    expect(canDecodePng()).toBe(true);
  });

  test("decodes every scanline filter type bit-exactly (RGB)", async () => {
    const pixels = randomPixels(17, 11, 42, true);
    for (const filter of [0, 1, 2, 3, 4] as PngFilter[]) {
      const decoded = await decodePng(encodePng(17, 11, pixels, { filter }));
      expect(decoded.width).toBe(17);
      expect(decoded.height).toBe(11);
      expect(decoded.data, `filter ${filter}`).toEqual(pixels);
    }
  });

  test("decodes RGBA, mixed filters per row and image data split over several chunks", async () => {
    const pixels = randomPixels(32, 20, 7, false);
    const png = encodePng(32, 20, pixels, {
      alpha: true,
      filter: (row) => (row % 5) as PngFilter,
      idatChunks: 4,
    });
    const decoded = await decodePng(png);
    expect(decoded.data).toEqual(pixels);
  });

  test("round-trips arbitrary images", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.boolean(),
        fc.array(fc.constantFrom<PngFilter>(0, 1, 2, 3, 4), { minLength: 1, maxLength: 6 }),
        async (width, height, seed, alpha, filters) => {
          const pixels = randomPixels(width, height, seed, !alpha);
          const png = encodePng(width, height, pixels, {
            alpha,
            filter: (row) => filters[row % filters.length],
            idatChunks: 1 + (seed % 3),
          });
          expect((await decodePng(png)).data).toEqual(pixels);
        },
      ),
      { numRuns: 60 },
    );
  });

  test("works on a view into a larger buffer", async () => {
    const pixels = randomPixels(5, 4, 3, true);
    const png = encodePng(5, 4, pixels, { filter: 4 });
    const padded = new Uint8Array(png.length + 20);
    padded.set(png, 10);
    expect((await decodePng(padded.subarray(10, 10 + png.length))).data).toEqual(pixels);
  });

  test("rejects things that are not PNGs", async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Not a PNG/);
    await expect(decodePng(new TextEncoder().encode("<html>Access denied</html>"))).rejects.toThrow(
      /Not a PNG/,
    );
    const png = encodePng(8, 8, randomPixels(8, 8, 1, true));
    await expect(decodePng(png.subarray(0, png.length - 30))).rejects.toThrow();
    await expect(decodePng(png.subarray(0, 8))).rejects.toThrow(/no header/);
  });

  test("flags PNG flavours it does not handle so the caller can fall back", async () => {
    const png = encodePng(8, 8, randomPixels(8, 8, 1, true));
    const patched = (offsetInHeader: number, value: number) => {
      const copy = png.slice();
      copy[16 + offsetInHeader] = value; // IHDR body starts at byte 16
      return copy;
    };
    await expect(decodePng(patched(8, 16))).rejects.toThrow(UnsupportedPngError); // 16-bit
    await expect(decodePng(patched(9, 3))).rejects.toThrow(UnsupportedPngError); // palette
    await expect(decodePng(patched(9, 0))).rejects.toThrow(UnsupportedPngError); // greyscale
    await expect(decodePng(patched(12, 1))).rejects.toThrow(UnsupportedPngError); // interlaced
  });

  test("rejects image data of the wrong length", async () => {
    // Header says 9 × 8 but the data is for 8 × 8.
    const png = encodePng(8, 8, randomPixels(8, 8, 1, true));
    const copy = png.slice();
    copy[19] = 9;
    await expect(decodePng(copy)).rejects.toThrow(/expected/);
  });
});

describe("a real Terrarium tile (z14 2620/6331, Pacific Heights)", () => {
  const file = path.resolve(process.cwd(), "tests/fixtures/terrarium-14-2620-6331.png");
  const TILE = { z: 14, x: 2620, y: 6331 };

  test("decodes to plausible San Francisco ground", async () => {
    const decoded = await decodePng(new Uint8Array(readFileSync(file)));
    expect(decoded.width).toBe(256);
    expect(decoded.height).toBe(256);
    const elevations = decodeTerrarium(decoded); // also checks opacity and range
    let min = Infinity;
    let max = -Infinity;
    for (const e of elevations) {
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    // The tile runs from the Pacific Heights ridge (~115 m at Lafayette Park)
    // down to the Marina waterfront.
    expect(min).toBeGreaterThan(-5);
    expect(min).toBeLessThan(10);
    expect(max).toBeGreaterThan(100);
    expect(max).toBeLessThan(130);
  });

  test("agrees with the terrain fixture that was resampled from it", async () => {
    const elevations = decodeTerrarium(await decodePng(new Uint8Array(readFileSync(file))));
    const { near } = loadPacificHeightsTerrain();
    let compared = 0;
    let worst = 0;
    for (let row = 0; row < near.height; row += 5) {
      for (let col = 0; col < near.width; col += 5) {
        // This grid node's position in the tile, in pixels (centres at +0.5).
        const p = fromLocalMeters(
          near.origin,
          near.minX + col * near.cellSizeM,
          near.minY + row * near.cellSizeM,
        );
        const px = (lngToTileX(p.lng, TILE.z) - TILE.x) * 256 - 0.5;
        const py = (latToTileY(p.lat, TILE.z) - TILE.y) * 256 - 0.5;
        // Only nodes whose four surrounding pixels are all in THIS tile.
        if (px < 0 || py < 0 || px > 255 || py > 255) continue;
        const i = Math.min(254, Math.floor(px));
        const j = Math.min(254, Math.floor(py));
        const fx = px - i;
        const fy = py - j;
        const expected =
          elevations[j * 256 + i] * (1 - fx) * (1 - fy) +
          elevations[j * 256 + i + 1] * fx * (1 - fy) +
          elevations[(j + 1) * 256 + i] * (1 - fx) * fy +
          elevations[(j + 1) * 256 + i + 1] * fx * fy;
        worst = Math.max(worst, Math.abs(near.data[row * near.width + col] - expected));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(300);
    // The fixture stores decimetres (±0.05 m) of float32 values.
    expect(worst).toBeLessThan(0.06);
  });
});
