import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BuildingsApiError } from "./api";
import { clearBuildingCache, getCachedBuildingsEntry, setCachedBuildings } from "./cache";
import {
  API_FALLBACK_TIMEOUT_MS,
  BuildingsUnavailableError,
  NETWORK_BUDGET_MS,
  loadBuildings,
} from "./loader";
import { OVERPASS_ENDPOINTS, OverpassError, isAbortError, parseOverpassResponse } from "./overpass";
import { tileWithBuildings } from "./testing";
import { fetchAreaFor } from "./tiles";
import {
  BuildingTilesError,
  OPENFREEMAP_TILEJSON_URL,
  resetTileTemplate,
  tilesForCircle,
} from "./vectorTiles";

const FIXTURES = new URL("../../../tests/fixtures/", import.meta.url);
const TILEJSON = readFileSync(new URL("openfreemap/planet.json", FIXTURES), "utf8");

const PIN = { lat: 37.7912, lng: -122.4301 };
const AREA = fetchAreaFor(PIN);

/** What Overpass (and so the API route) would return: `count` tagged buildings near the pin. */
function overpassBody(count: number): string {
  return JSON.stringify({
    version: 0.6,
    elements: Array.from({ length: count }, (_, i) => ({
      type: "way",
      id: i + 1,
      geometry: [
        { lat: 37.791, lon: -122.43 },
        { lat: 37.791, lon: -122.4299 },
        { lat: 37.7911, lon: -122.4299 },
        { lat: 37.791, lon: -122.43 },
      ],
      tags: { building: "yes", height: "10" },
    })),
  });
}
const apiBody = (count: number) =>
  JSON.stringify(parseOverpassResponse(JSON.parse(overpassBody(count))));

type Reply = (url: string, init?: RequestInit) => Response | Promise<Response>;
const respond =
  (body: BodyInit | null, status = 200): Reply =>
  () =>
    new Response(body, { status });
const offline: Reply = () => {
  throw new TypeError("Failed to fetch");
};
const hang: Reply = (_url, init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

/** The four kinds of request the loader can make; each test scripts their answers. */
let tileJson: Reply;
let tiles: Reply;
let api: Reply;
let overpass: Reply;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

type Kind = "tilejson" | "tile" | "api" | "overpass";
function kindOf(url: string): Kind {
  if (url === OPENFREEMAP_TILEJSON_URL) return "tilejson";
  if (url.startsWith("https://tiles.openfreemap.org/")) return "tile";
  if (url.startsWith("/api/buildings")) return "api";
  return "overpass";
}
const calls = (kind: Kind) => fetchMock.mock.calls.filter(([url]) => kindOf(String(url)) === kind);

/** Tiles that hold `heights.length` buildings next to the area's centre. */
function tilesWith(heights: number[]): Reply {
  const { tile, data } = tileWithBuildings(AREA.center, heights);
  return (url) =>
    url.endsWith(`/${tile.z}/${tile.x}/${tile.y}.pbf`)
      ? new Response(new Uint8Array(data))
      : new Response(null, { status: 204 });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** The cache write is not awaited by the loader. */
async function cached() {
  return vi.waitFor(async () => {
    const entry = await getCachedBuildingsEntry(AREA.key);
    expect(entry).not.toBeNull();
    return entry!;
  });
}

beforeEach(async () => {
  await clearBuildingCache();
  resetTileTemplate();
  tileJson = respond(TILEJSON);
  tiles = tilesWith([10, 20, 30]);
  api = respond(apiBody(2));
  overpass = respond(overpassBody(4));
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    return { tilejson: tileJson, tile: tiles, api, overpass }[kindOf(url)](url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadBuildings: the usual path", () => {
  test("tiles answer: nothing else is asked", async () => {
    const loaded = await loadBuildings(AREA);
    expect(loaded.source).toBe("tiles");
    expect(loaded.origin).toBe("tiles");
    expect(loaded.buildings.features.map((f) => f.properties.heightM)).toEqual([10, 20, 30]);

    expect(calls("tilejson")).toHaveLength(1);
    expect(calls("tile")).toHaveLength(tilesForCircle(AREA.center, AREA.radiusM).length);
    expect(calls("tile")).toHaveLength(4);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);
  });

  test("the result is saved, with its source, and served from the cache next time", async () => {
    const first = await loadBuildings(AREA);
    expect(await cached()).toMatchObject({ source: "tiles", data: first.buildings });
    fetchMock.mockClear();

    const second = await loadBuildings(AREA);
    expect(second).toEqual({ buildings: first.buildings, source: "cache", origin: "tiles" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an area without buildings is a result, not a failure", async () => {
    tiles = respond(null, 204);
    const loaded = await loadBuildings(AREA);
    expect(loaded).toMatchObject({ source: "tiles", buildings: { features: [] } });
    expect(calls("api")).toHaveLength(0);
  });

  test("the real fixture tiles end to end", async () => {
    tiles = (url) => {
      const [, x, y] = /\/14\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
      return new Response(
        new Uint8Array(readFileSync(new URL(`openfreemap/14/${x}/${y}.pbf`, FIXTURES))),
      );
    };
    const loaded = await loadBuildings(AREA);
    expect(loaded.source).toBe("tiles");
    expect(loaded.buildings.features).toHaveLength(1600);
  });
});

describe("loadBuildings: fallbacks", () => {
  test.each([
    ["HTTP 500", () => respond("oops", 500)],
    ["HTTP 403", () => respond("no", 403)],
    ["unreachable", () => offline],
    ["garbage instead of tiles", () => respond("<html>hello</html>")],
  ] as const)("tiles fail (%s) → the API route", async (_, reply) => {
    tiles = reply();
    const loaded = await loadBuildings(AREA);
    expect(loaded.source).toBe("api");
    expect(loaded.origin).toBe("api");
    expect(loaded.buildings.features).toHaveLength(2);
    expect(calls("api")).toHaveLength(1);
    expect(calls("api")[0][0]).toBe(`/api/buildings?area=${encodeURIComponent(AREA.key)}`);
    expect(calls("overpass")).toHaveLength(0);
    expect((await cached()).source).toBe("api");
  });

  test.each([
    ["HTTP 502", () => respond('{"error":"network","message":"x"}', 502)],
    ["HTTP 400", () => respond('{"error":"bad-area","message":"x"}', 400)],
    ["unreachable", () => offline],
    ["a payload of the wrong shape", () => respond('{"ok":true}')],
  ] as const)("tiles and the API route fail (%s) → Overpass directly", async (_, reply) => {
    tiles = respond("oops", 500);
    api = reply();
    const loaded = await loadBuildings(AREA);
    expect(loaded.source).toBe("overpass");
    expect(loaded.buildings.features).toHaveLength(4);
    expect(calls("api")).toHaveLength(1);
    expect(calls("overpass")).toHaveLength(1);
    expect(calls("overpass")[0][0]).toBe(OVERPASS_ENDPOINTS[0]);
    expect((await cached()).source).toBe("overpass");
  });

  test("a TileJSON outage alone changes nothing: the 'latest' tiles are used", async () => {
    tileJson = respond("down", 503);
    const loaded = await loadBuildings(AREA);
    expect(loaded.source).toBe("tiles");
    expect(String(calls("tile")[0][0])).toContain("/planet/latest/14/");
    expect(calls("api")).toHaveLength(0);
  });

  test("everything fails: one error that says what each source answered", async () => {
    tiles = respond("oops", 500);
    api = respond('{"error":"timeout","message":"Overpass did not answer"}', 504);
    overpass = respond("slow down", 429);

    const error = await failure(loadBuildings(AREA));
    expect(error).toBeInstanceOf(BuildingsUnavailableError);
    const { attempts, message, cause } = error as BuildingsUnavailableError;
    expect(attempts.map((attempt) => attempt.source)).toEqual(["tiles", "api", "overpass"]);
    expect(attempts[0].error).toBeInstanceOf(BuildingTilesError);
    expect(attempts[0].error).toMatchObject({ kind: "http", status: 500 });
    expect(attempts[1].error).toBeInstanceOf(BuildingsApiError);
    expect(attempts[1].error).toMatchObject({ kind: "http", status: 504 });
    expect(attempts[2].error).toBeInstanceOf(OverpassError);
    expect(attempts[2].error).toMatchObject({ kind: "rate-limited" });
    for (const attempt of attempts) expect(attempt.ms).toBeGreaterThanOrEqual(0);
    // The primary source's failure is the cause.
    expect(cause).toBe(attempts[0].error);
    expect(message).toMatch(/^Building data could not be loaded \(tiles: .*; api: .*; overpass: /);

    // Each source was asked once (Overpass: each of its endpoints once).
    expect(calls("tile")).toHaveLength(4);
    expect(calls("api")).toHaveLength(1);
    expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length);
    expect(await getCachedBuildingsEntry(AREA.key)).toBeNull();
  });
});

describe("loadBuildings: aborting", () => {
  test.each([
    ["the tiles", () => ((tiles = hang), "tile" as const), 0, 0],
    ["the API route", () => ((tiles = respond("x", 500)), (api = hang), "api" as const), 1, 0],
    [
      "Overpass",
      () => (
        (tiles = respond("x", 500)),
        (api = respond("x", 500)),
        (overpass = hang),
        "overpass" as const
      ),
      1,
      1,
    ],
  ])(
    "during %s: AbortError, and nothing further is tried",
    async (_, arrange, apis, overpasses) => {
      const waitingOn = arrange();
      const controller = new AbortController();
      const pending = failure(loadBuildings(AREA, { signal: controller.signal }));
      await vi.waitFor(() => expect(calls(waitingOn).length).toBeGreaterThan(0));
      controller.abort();

      const error = await pending;
      expect(isAbortError(error)).toBe(true);
      expect(error).not.toBeInstanceOf(BuildingsUnavailableError);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls("api")).toHaveLength(apis);
      expect(calls("overpass")).toHaveLength(overpasses);
      expect(await getCachedBuildingsEntry(AREA.key)).toBeNull();
    },
  );
});

describe("loadBuildings: refreshing", () => {
  test("`fresh` skips the saved copy, re-reads the tile index, and replaces the copy", async () => {
    await loadBuildings(AREA);
    await cached();
    expect(calls("tilejson")).toHaveLength(1);

    tiles = tilesWith([40, 50, 60, 70]);
    const loaded = await loadBuildings(AREA, { fresh: true });
    expect(loaded.source).toBe("tiles");
    expect(loaded.buildings.features).toHaveLength(4);
    expect(calls("tilejson")).toHaveLength(2);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);
    await vi.waitFor(async () =>
      expect((await getCachedBuildingsEntry(AREA.key))?.data.features).toHaveLength(4),
    );
  });

  test("a failed refresh leaves the saved copy alone", async () => {
    await loadBuildings(AREA);
    await cached();
    tiles = respond("x", 500);
    api = respond("x", 500);
    overpass = respond("x", 500);
    expect(await failure(loadBuildings(AREA, { fresh: true }))).toBeInstanceOf(
      BuildingsUnavailableError,
    );
    expect((await getCachedBuildingsEntry(AREA.key))?.data.features).toHaveLength(3);
  });

  test("a saved copy from a fallback source is used while it lasts", async () => {
    await setCachedBuildings(AREA.key, parseOverpassResponse(JSON.parse(overpassBody(5))), "api");
    const loaded = await loadBuildings(AREA);
    expect(loaded).toMatchObject({ source: "cache", origin: "api" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadBuildings: time budget", () => {
  test("with every server hanging, the error comes after 28 seconds", async () => {
    expect(NETWORK_BUDGET_MS).toBe(28_000);
    expect(API_FALLBACK_TIMEOUT_MS).toBe(8_000);
    vi.useFakeTimers();
    tileJson = hang;
    tiles = hang;
    api = hang;
    overpass = hang;

    let error: unknown;
    // (`fresh` only to keep IndexedDB out of a fake-timer test.)
    void loadBuildings(AREA, { fresh: true }).catch((e) => (error = e));

    // 0–4 s: the tile index. 4–16 s: the tiles.
    await vi.advanceTimersByTimeAsync(3_999);
    expect(calls("tile")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls("tile")).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(calls("api")).toHaveLength(0);
    // 16–24 s: the API route.
    await vi.advanceTimersByTimeAsync(1);
    expect(calls("api")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(calls("overpass")).toHaveLength(0);
    // 24–28 s: Overpass gets what is left.
    await vi.advanceTimersByTimeAsync(1);
    expect(calls("overpass")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(error).toBeInstanceOf(BuildingsUnavailableError);
    const { attempts } = error as BuildingsUnavailableError;
    expect(attempts.map(({ source, error: e }) => [source, (e as { kind: string }).kind])).toEqual([
      ["tiles", "timeout"],
      ["api", "timeout"],
      ["overpass", "timeout"],
    ]);
    expect(attempts.map((attempt) => attempt.ms)).toEqual([16_000, 8_000, 4_000]);
    expect(calls("overpass")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("tiles that fail fast leave the fallbacks most of the budget", async () => {
    vi.useFakeTimers();
    tiles = respond("x", 500);
    api = hang;
    overpass = hang;
    let error: unknown;
    void loadBuildings(AREA, { fresh: true }).catch((e) => (error = e));

    await vi.advanceTimersByTimeAsync(8_000);
    // Overpass: its first endpoint's usual 12 s, then the next one with the rest.
    expect(calls("overpass")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls("overpass")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toBeInstanceOf(BuildingsUnavailableError);
  });

  test("no fallback is started without time to spare", async () => {
    tiles = respond("x", 500);
    const error = await failure(loadBuildings(AREA, { fresh: true, budgetMs: 1_000 }));
    expect(error).toBeInstanceOf(BuildingsUnavailableError);
    expect((error as BuildingsUnavailableError).attempts.map((a) => a.source)).toEqual(["tiles"]);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);
  });
});
