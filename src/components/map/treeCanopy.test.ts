import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTileTemplate } from "@/lib/buildings/vectorTiles";
import { parseTaxlots } from "@/lib/trees/portland";
import { encodePng } from "@/lib/terrain/testing";
import { canopyCover, circleMask, heightNear, lotCanopy } from "./canopySummary";
import { buildingTilesOfWindow, canopyWindowUrl, nearWindow, windowAround } from "./canopyWindow";
import { loadCanopyGrid } from "./treeCanopy";
import { GROUND_BUILDING, GROUND_NO_DATA, GROUND_TREE, runCanopyJob } from "./treeTileJob";

/**
 * The real thing, cut small: the laser heights of the window around
 * 2124 NE 36th Ave, Portland (2014 survey) and the buildings of the two
 * building tiles it overlaps, cropped to the houses around it — the same
 * fixtures the browser tests serve.
 */
const FIXTURES = path.join(__dirname, "..", "..", "..", "tests", "e2e", "fixtures", "trees");
const read = (name: string) => {
  const data = fs.readFileSync(path.join(FIXTURES, name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const HOUSE = { lat: 45.5382208, lng: -122.6257477 };
const TEMPLATE = "https://tiles.openfreemap.org/planet/20260101_001001_pt/{z}/{x}/{y}.pbf";

vi.mock("@/lib/terrain/loadTerrain", () => ({ decodeTileInBrowser: vi.fn() }));

function network() {
  const window = nearWindow(HOUSE);
  const routes: Record<string, () => Response> = {
    "https://tiles.openfreemap.org/planet": () =>
      new Response(JSON.stringify({ tiles: [TEMPLATE], maxzoom: 14 })),
    [canopyWindowUrl(window)]: () => new Response(read("heights-near.png")),
  };
  for (const { tile } of buildingTilesOfWindow(window)) {
    routes[TEMPLATE.replace("{z}/{x}/{y}", `${tile.z}/${tile.x}/${tile.y}`)] = () =>
      new Response(read(`buildings-14-${tile.x}-${tile.y}.pbf`));
  }
  const asked: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route();
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe("loadCanopyGrid", () => {
  beforeEach(() => resetTileTemplate());

  it("measures the window around a real house: its lot, its backyard, its street trees", async () => {
    const { fetchImpl, asked } = network();
    const started = performance.now();
    const grid = await loadCanopyGrid(nearWindow(HOUSE), { labels: true, fetchImpl });
    const took = performance.now() - started;
    // The heights, the TileJSON and the two building tiles: nothing else.
    expect(asked).toHaveLength(4);
    expect(grid.labels).not.toBeNull();
    expect(grid.ground.some((kind) => kind === GROUND_BUILDING)).toBe(true);
    expect(grid.ground.some((kind) => kind === GROUND_TREE)).toBe(true);
    // A building's pixels are never a tree.
    for (let i = 0; i < grid.ground.length; i++) {
      if (grid.labels![i] > 0) expect(grid.ground[i]).toBe(GROUND_BUILDING);
    }

    const [lot] = parseTaxlots(
      JSON.parse(fs.readFileSync(path.join(FIXTURES, "taxlot.json"), "utf8")),
    );
    // The street trees recorded at the address stand west of the lot, on NE 36th Ave.
    const street = { lat: 45.5382, lng: -122.62595 };
    const result = lotCanopy(grid, lot, street);
    expect(result.backyard.kind).toBe("ok");
    if (result.backyard.kind === "ok") {
      expect(result.backyard.cover.cover).toBeGreaterThan(0.7);
      expect(result.backyard.cover.tallestFt).toBeGreaterThan(60);
      expect(result.backyard.yardSqFt).toBeGreaterThan(800);
      expect(result.backyard.yardSqFt).toBeLessThan(2500);
    }
    // The Norway maple in front: a tall street tree.
    expect(heightNear(grid, { lat: 45.538234666, lng: -122.625952187 }, 3)).toBeGreaterThan(40);
    // A generous budget for a slow CI machine; it takes a few tens of ms on a laptop.
    expect(took).toBeLessThan(2_000);
  });

  it("rejects when the heights cannot be had", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("down", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      loadCanopyGrid(windowAround(HOUSE, 16, 8), { fetchImpl, pause: async () => {} }),
    ).rejects.toThrow();
  });
});

describe("runCanopyJob", () => {
  it("cuts buildings out, marks the gaps in the survey and keeps heights", async () => {
    const size = 8;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      rgba[4 * i] = 40; // 40 ft everywhere…
      rgba[4 * i + 3] = i < size ? 0 : 255; // …but no data in the first row.
    }
    const window = windowAround(HOUSE, 16, size);
    const grid = await runCanopyJob({
      kind: "canopy",
      id: 1,
      window,
      heights: new ArrayBuffer(0),
      decoded: { width: size, height: size, data: rgba },
      buildings: [],
      labels: false,
      area: { kind: "circle", center: HOUSE, radiusM: 100 },
    });
    // The cover over the job's own area is measured in the worker.
    expect(grid.cover?.cover).toBe(1);
    expect(grid.cover?.tallestFt).toBe(40);
    expect(grid.ground.slice(0, size).every((kind) => kind === GROUND_NO_DATA)).toBe(true);
    expect(grid.ground.slice(size).every((kind) => kind === GROUND_TREE)).toBe(true);
    expect(grid.feet[size * 3]).toBe(40);
    const cover = canopyCover(grid, circleMask(window, HOUSE, 100));
    expect(cover.cover).toBe(1);
    expect(cover.surveyed).toBeCloseTo(7 / 8);
  });

  it("refuses a picture of the wrong size", async () => {
    const png = await encodePng(4, 4, new Uint8Array(64), { alpha: true });
    await expect(
      runCanopyJob({
        kind: "canopy",
        id: 2,
        window: windowAround(HOUSE, 16, 8),
        heights: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
        buildings: [],
        labels: false,
      }),
    ).rejects.toThrow(/8×8/);
  });
});
