import { describe, expect, test, vi } from "vitest";

import { fromLocalMeters, toLocalMeters } from "@/lib/geo/local";
import type { LatLng } from "@/lib/types";

import { elevationAt, terrainElevationAt } from "./elevation";
import { loadTerrain, loadTerrainForCoverage, TerrainError, type DecodeTile } from "./loadTerrain";
import { metersToTerrarium, type DecodedTile } from "./terrarium";
import { terrainCoverageFor, tileXToLng, tileYToLat } from "./tiles";

const SF: LatLng = { lat: 37.7906, lng: -122.4294 };
const coverage = terrainCoverageFor(SF)!;

/** The "real world" of these tests: a slope rising to the north-east. */
const world = (lat: number, lng: number) =>
  120 + 5000 * (lng - coverage.origin.lng) + 8000 * (lat - coverage.origin.lat);

/**
 * A fake tile server + PNG decoder. The "PNG" is just the tile's z/x/y as
 * text; the decoder turns it into genuine Terrarium-encoded RGBA pixels of
 * `world`, so everything downstream of the network runs for real.
 */
function fakeTiles(options: { failOn?: string; status?: number; tileSize?: number } = {}) {
  const requested: string[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    signals.push(init?.signal);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const id = /(\d+\/\d+\/\d+)\.png$/.exec(url)![1];
    if (options.failOn === id) return new Response("nope", { status: options.status ?? 404 });
    return new Response(id, { status: 200 });
  }) as unknown as typeof fetch;

  const decodeTile: DecodeTile = async (blob): Promise<DecodedTile> => {
    const [z, x, y] = (await blob.text()).split("/").map(Number);
    const size = options.tileSize ?? 256;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let j = 0; j < size; j++) {
      const lat = tileYToLat(y + (j + 0.5) / size, z);
      for (let i = 0; i < size; i++) {
        const lng = tileXToLng(x + (i + 0.5) / size, z);
        const [r, g, b] = metersToTerrarium(world(lat, lng));
        data.set([r, g, b, 255], 4 * (j * size + i));
      }
    }
    return { width: size, height: size, data };
  };
  return { fetchImpl, decodeTile, requested, signals };
}

describe("loadTerrain", () => {
  test("fetches the 13 tiles of the place's coverage and builds both grids", async () => {
    const tiles = fakeTiles();
    const terrain = await loadTerrain(SF, tiles);

    expect(tiles.requested).toHaveLength(13);
    expect(new Set(tiles.requested).size).toBe(13);
    expect(tiles.requested).toContain(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/2620/6332.png",
    );
    expect(tiles.requested.filter((url) => url.includes("/terrarium/14/"))).toHaveLength(4);
    expect(tiles.requested.filter((url) => url.includes("/terrarium/11/"))).toHaveLength(9);

    const { near, far } = terrain;
    expect(far).toBeDefined();
    expect(near.origin).toEqual(coverage.origin);
    expect(far!.origin).toEqual(coverage.origin);
    expect(near.cellSizeM).toBeGreaterThan(7);
    expect(near.cellSizeM).toBeLessThan(8);
    expect(far!.cellSizeM).toBeGreaterThan(55);
    expect(far!.cellSizeM).toBeLessThan(65);

    // The decoded ground is the world's, through PNG encoding (1/256 m),
    // stitching and resampling — at the pin and all around it.
    const pin = toLocalMeters(coverage.origin, SF);
    expect(elevationAt(near, pin.x, pin.y)).toBeCloseTo(world(SF.lat, SF.lng), 1);
    for (const [dx, dy] of [
      [0, 0],
      [550, -300],
      [-600, 600],
      [3000, 4000],
      [-6500, -2000],
    ]) {
      const p = fromLocalMeters(coverage.origin, pin.x + dx, pin.y + dy);
      expect(terrainElevationAt(terrain, pin.x + dx, pin.y + dy)).toBeCloseTo(
        world(p.lat, p.lng),
        1,
      );
    }
  });

  test("pins that share a coverage get identical terrain", async () => {
    const a = await loadTerrain(SF, fakeTiles());
    const b = await loadTerrain({ lat: SF.lat + 0.001, lng: SF.lng - 0.001 }, fakeTiles());
    const c = await loadTerrainForCoverage(coverage, fakeTiles());
    expect(b.near.data).toEqual(a.near.data);
    expect(b.far!.data).toEqual(a.far!.data);
    expect(c.near).toEqual(a.near);
  });

  test("a custom URL template and the abort signal are passed through", async () => {
    const tiles = fakeTiles();
    const controller = new AbortController();
    await loadTerrain(SF, {
      ...tiles,
      urlTemplate: "https://tiles.test/{z}/{x}/{y}.png",
      signal: controller.signal,
    });
    expect(tiles.requested.every((url) => url.startsWith("https://tiles.test/"))).toBe(true);
    expect(tiles.signals.every((signal) => signal === controller.signal)).toBe(true);
  });

  test("a failing tile rejects with a TerrainError naming it", async () => {
    const tiles = fakeTiles({ failOn: "11/327/791", status: 503 });
    const error = await loadTerrain(SF, tiles).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TerrainError);
    expect((error as Error).message).toMatch(/11\/327\/791.*503/);
  });

  test("network errors are wrapped; aborts are passed through untouched", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const error = await loadTerrain(SF, { ...fakeTiles(), fetchImpl: offline }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TerrainError);
    expect((error as Error).message).toMatch(/Failed to fetch/);
    expect((error as Error).cause).toBeInstanceOf(TypeError);

    const controller = new AbortController();
    controller.abort();
    const aborted = await loadTerrain(SF, { ...fakeTiles(), signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect((aborted as Error).name).toBe("AbortError");
    expect(aborted).not.toBeInstanceOf(TerrainError);
  });

  test("tiles of the wrong size or with corrupted pixels are rejected", async () => {
    await expect(loadTerrain(SF, fakeTiles({ tileSize: 128 }))).rejects.toThrow(/128×128/);

    const tiles = fakeTiles();
    const transparent: DecodeTile = async (blob) => {
      const decoded = await tiles.decodeTile(blob);
      decoded.data[3] = 0;
      return decoded;
    };
    await expect(loadTerrain(SF, { ...tiles, decodeTile: transparent })).rejects.toThrow(
      TerrainError,
    );
    const garbage: DecodeTile = async () => ({
      width: 256,
      height: 256,
      data: new Uint8ClampedArray(256 * 256 * 4).fill(255),
    });
    await expect(loadTerrain(SF, { ...tiles, decodeTile: garbage })).rejects.toThrow(/implausible/);
  });

  test("places without coverage reject without touching the network", async () => {
    const tiles = fakeTiles();
    await expect(loadTerrain({ lat: 89, lng: 0 }, tiles)).rejects.toThrow(TerrainError);
    expect(tiles.requested).toHaveLength(0);
  });

  test("without a browser image decoder the default decode step fails cleanly", async () => {
    // Node has no createImageBitmap: the default decodeTile must reject, not crash.
    const { fetchImpl } = fakeTiles();
    await expect(loadTerrain(SF, { fetchImpl })).rejects.toThrow(TerrainError);
  });
});
