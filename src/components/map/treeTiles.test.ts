import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { box, encodeBuildingTile } from "@/lib/buildings/testing";
import { resetTileTemplate } from "@/lib/buildings/vectorTiles";
import { decodeTileInBrowser } from "@/lib/terrain/loadTerrain";
import { encodePng } from "@/lib/terrain/testing";
import { runTreeTileJob } from "./treeTileJob";
import { loadTreeTile, parseHexColour, readTreePalette } from "./treeTiles";
import { TREE_RETRY_WAITS_MS, treeHeightsUrl, treeTileTemplate } from "./trees";

// The browser's own image decoder (a canvas read-back): stood in for here.
vi.mock("@/lib/terrain/loadTerrain", () => ({ decodeTileInBrowser: vi.fn() }));

/** The design tokens of the Trees layer, as a stylesheet would give them. */
const TOKENS: Record<string, string> = {
  "--tree-1": " #010000",
  "--tree-2": "#020000",
  "--tree-3": "#030000",
  "--tree-4": "#040000",
  "--tree-5": "#050000",
  "--tree-6": "#060000",
  "--tree-alpha": " 0.9",
  "--tree-photo-1": "#0a0000",
  "--tree-photo-2": "#0b0000",
  "--tree-photo-3": "#0c0000",
  "--tree-photo-4": "#0d0000",
  "--tree-photo-5": "#0e0000",
  "--tree-photo-6": "#0f0000",
  "--tree-photo-alpha": "0.5",
  "--tree-photo-edge": "#fff",
};
const styleOf = (tokens: Record<string, string>) => ({
  getPropertyValue: (name: string) => tokens[name] ?? "",
});

describe("parseHexColour", () => {
  it("reads the two ways a token is written", () => {
    expect(parseHexColour("#58ac6d")).toEqual([0x58, 0xac, 0x6d]);
    expect(parseHexColour("  #FFF ")).toEqual([255, 255, 255]);
    expect(parseHexColour("#0a0")).toEqual([0, 170, 0]);
  });

  it("is null for anything else", () => {
    for (const value of ["", "green", "rgb(1 2 3)", "#12345", "#gggggg", "58ac6d"]) {
      expect(parseHexColour(value), value).toBeNull();
    }
  });
});

describe("readTreePalette", () => {
  it("reads the map's six colours and their opacity, with no outline", () => {
    const palette = readTreePalette("map-light", styleOf(TOKENS));
    expect(palette.fills).toEqual([1, 2, 3, 4, 5, 6].map((red) => [red, 0, 0, 230]));
    expect(palette.edge).toBeNull();
    // The dark scheme redefines the same tokens: the look only names the family.
    expect(readTreePalette("map-dark", styleOf(TOKENS))).toEqual(palette);
  });

  it("reads the photo's colours, more see-through and with a crown outline", () => {
    const palette = readTreePalette("photo", styleOf(TOKENS));
    expect(palette.fills).toEqual([10, 11, 12, 13, 14, 15].map((red) => [red, 0, 0, 128]));
    expect(palette.edge).toEqual([255, 255, 255, 235]);
  });

  it("never fails for a missing or odd token: grey, and a sensible opacity", () => {
    const palette = readTreePalette("photo", styleOf({ "--tree-photo-alpha": "lots" }));
    expect(palette.fills).toHaveLength(6);
    for (const fill of palette.fills) expect(fill).toEqual([128, 128, 128, 204]);
    expect(palette.edge).toBeNull();
  });
});

// ─── One tile, end to end (no worker here: the page's own fallback) ─────────

const TILE = { z: 16, x: 10444, y: 23435 };
const SIZE = 8;
const TEMPLATE = "https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf";
const BUILDING_TILE = "https://tiles.openfreemap.org/planet/20261101_080013_pt/14/2611/5858.pbf";

/** An 8 px heights picture: 60 ft everywhere (class 3), nothing known in the last column. */
function heightsPng(): Uint8Array {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const known = i % SIZE !== SIZE - 1;
    rgba.set([known ? 60 : 253, known ? 60 : 253, known ? 60 : 253, known ? 255 : 0], 4 * i);
  }
  return encodePng(SIZE, SIZE, rgba, { alpha: true });
}

/**
 * The building tile 14/2611/5858 with one building over the top-left quarter
 * of our tile (16/10444/23435 is its first column and its last row).
 */
function buildingTile(): Uint8Array {
  return encodeBuildingTile([{ polygons: [[box(0, 3072, 512, 3584)]] }]);
}

const bytes = (data: Uint8Array) =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

function answer(body: Uint8Array | string, init: ResponseInit = {}): Response {
  return new Response(typeof body === "string" ? body : bytes(body), init);
}

/** A network that knows the three addresses a tile needs. */
function network(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const asked: string[] = [];
  const routes: Record<string, () => Response | Promise<Response>> = {
    "https://tiles.openfreemap.org/planet": () =>
      answer(JSON.stringify({ tiles: [TEMPLATE], maxzoom: 14 })),
    [BUILDING_TILE]: () => answer(buildingTile()),
    [treeHeightsUrl(TILE)]: () => answer(heightsPng()),
    ...overrides,
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route();
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

const url = treeTileTemplate("map-light")
  .replace("{z}", String(TILE.z))
  .replace("{x}", String(TILE.x))
  .replace("{y}", String(TILE.y));

/** Which pixels of the finished picture are drawn, row by row. */
function drawn(image: { data: Uint8ClampedArray }): string[] {
  const out: string[] = [];
  for (let row = 0; row < SIZE; row++) {
    let line = "";
    for (let column = 0; column < SIZE; column++) {
      line += image.data[4 * (row * SIZE + column) + 3] ? "#" : ".";
    }
    out.push(line);
  }
  return out;
}

describe("loadTreeTile", () => {
  beforeEach(() => {
    resetTileTemplate();
    // Node has neither: the picture is handed over as it was made.
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal("createImageBitmap", async (image: unknown) => image);
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => styleOf(TOKENS));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the heights and the buildings around them, and draws the trees without the buildings", async () => {
    const { fetchImpl, asked } = network();
    const { data } = await loadTreeTile(url, { fetchImpl });
    expect(new Set(asked)).toEqual(
      new Set(["https://tiles.openfreemap.org/planet", BUILDING_TILE, treeHeightsUrl(TILE)]),
    );
    const image = data as unknown as { data: Uint8ClampedArray; width: number; height: number };
    expect([image.width, image.height]).toEqual([SIZE, SIZE]);
    // The building (4 px square, top left) is cut out with a margin of one
    // 8 px-picture pixel; the last column has no heights; the rest are trees.
    expect(drawn(image)).toEqual([
      ".....##.",
      ".....##.",
      ".....##.",
      ".....##.",
      ".....##.",
      "#######.",
      "#######.",
      "#######.",
    ]);
    // In the map's colour for 50–70 ft, at the map's opacity.
    expect([...image.data.slice(4 * 5, 4 * 6)]).toEqual([4, 0, 0, 230]);
  });

  it("colours by the look in the address", async () => {
    const { fetchImpl } = network();
    const { data } = await loadTreeTile(url.replace("map-light", "photo"), { fetchImpl });
    const image = data as unknown as { data: Uint8ClampedArray };
    const colours = new Set<string>();
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (image.data[4 * i + 3]) colours.add([...image.data.slice(4 * i, 4 * i + 4)].join(","));
    }
    // The photo's colour for the class, and the white outline along the cut-out and the gap.
    expect(colours).toEqual(new Set(["13,0,0,128", "255,255,255,235"]));
  });

  it("asks again for heights that failed, after the waits, and then draws them", async () => {
    let calls = 0;
    const { fetchImpl, asked } = network({
      [treeHeightsUrl(TILE)]: () =>
        ++calls < 3 ? answer("busy", { status: 502 }) : answer(heightsPng()),
    });
    const pause = vi.fn(async (ms: number) => void ms);
    const { data } = await loadTreeTile(url, { fetchImpl, pause });
    expect(asked.filter((address) => address === treeHeightsUrl(TILE))).toHaveLength(3);
    expect(pause.mock.calls.map(([ms]) => ms)).toEqual([...TREE_RETRY_WAITS_MS]);
    expect(drawn(data as never)[7]).toBe("#######.");
  });

  it("gives the tile up when the heights never come", async () => {
    const { fetchImpl, asked } = network({
      [treeHeightsUrl(TILE)]: () => answer("down", { status: 503 }),
    });
    await expect(loadTreeTile(url, { fetchImpl, pause: async () => {} })).rejects.toThrow(/503/);
    expect(asked.filter((address) => address === treeHeightsUrl(TILE))).toHaveLength(
      TREE_RETRY_WAITS_MS.length + 1,
    );
  });

  it("gives the tile up rather than draw buildings as trees when the buildings cannot be had", async () => {
    const { fetchImpl } = network({ [BUILDING_TILE]: () => answer("down", { status: 500 }) });
    await expect(loadTreeTile(url, { fetchImpl, pause: async () => {} })).rejects.toThrow(/500/);
  });

  it("draws every tree where the building tile is empty (a 204: no buildings there)", async () => {
    const { fetchImpl } = network({
      [BUILDING_TILE]: () => new Response(null, { status: 204 }),
    });
    const { data } = await loadTreeTile(url, { fetchImpl });
    expect(drawn(data as never).every((line) => line === "#######.")).toBe(true);
  });

  it("stops at once when MapLibre no longer wants the tile", async () => {
    const controller = new AbortController();
    const { fetchImpl } = network({
      [treeHeightsUrl(TILE)]: () => {
        controller.abort();
        return answer("busy", { status: 502 });
      },
    });
    const pause = vi.fn(async () => {});
    await expect(
      loadTreeTile(url, { fetchImpl, pause, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(pause).not.toHaveBeenCalled();
  });

  it("reads the heights with the browser's own decoder where it cannot inflate a PNG itself (old iOS)", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) rgba.set([60, 60, 60, 255], 4 * i);
    vi.mocked(decodeTileInBrowser).mockResolvedValueOnce({
      width: SIZE,
      height: SIZE,
      data: rgba,
    });
    const { fetchImpl } = network({ [BUILDING_TILE]: () => new Response(null, { status: 204 }) });
    const { data } = await loadTreeTile(url, { fetchImpl });
    expect(decodeTileInBrowser).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decodeTileInBrowser).mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(drawn(data as never).every((line) => line === "########")).toBe(true);
  });

  it("does not use that decoder where it can do without", async () => {
    vi.mocked(decodeTileInBrowser).mockClear();
    const { fetchImpl } = network();
    await loadTreeTile(url, { fetchImpl });
    expect(decodeTileInBrowser).not.toHaveBeenCalled();
  });

  it("refuses an address that is not a tree tile's", async () => {
    const { fetchImpl, asked } = network();
    await expect(loadTreeTile("tree-heights://heights/1/2", { fetchImpl })).rejects.toThrow();
    expect(asked).toEqual([]);
  });
});

describe("runTreeTileJob", () => {
  it("refuses a heights picture that is not square", async () => {
    const png = encodePng(4, 2, new Uint8ClampedArray(4 * 2 * 4), { alpha: true });
    await expect(
      runTreeTileJob({
        id: 1,
        tile: TILE,
        heights: bytes(png),
        buildings: new ArrayBuffer(0),
        buildingZoom: 14,
        palette: { fills: [], edge: null },
      }),
    ).rejects.toThrow(/square/);
  });

  it("refuses what is not a picture at all", async () => {
    await expect(
      runTreeTileJob({
        id: 1,
        tile: TILE,
        heights: bytes(new TextEncoder().encode("<html>Service unavailable</html>")),
        buildings: new ArrayBuffer(0),
        buildingZoom: 14,
        palette: { fills: [], edge: null },
      }),
    ).rejects.toThrow();
  });
});
