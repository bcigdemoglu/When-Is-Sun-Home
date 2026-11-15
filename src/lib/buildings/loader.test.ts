import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BuildingsApiError } from "./api";
import { clearBuildingCache, getCachedBuildingsEntry, setCachedBuildings } from "./cache";
import {
  API_FALLBACK_TIMEOUT_MS,
  BuildingsUnavailableError,
  NETWORK_BUDGET_MS,
  RESUME_DELAY_MS,
  loadBuildings,
} from "./loader";
import { OVERPASS_ENDPOINTS, OverpassError, isAbortError, parseOverpassResponse } from "./overpass";
import { tileWithBuildings } from "./testing";
import {
  AREA_CELL_REACH_M,
  TILE_COVER_RADIUS_M,
  TILE_KEEP_RADIUS_M,
  TILE_MIN_MARGIN_M,
  fetchAreaFor,
} from "./tiles";
import {
  BuildingTilesError,
  OPENFREEMAP_TILEJSON_URL,
  boundsOfCircle,
  decodeBuildingTiles,
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
    expect(calls("tile")).toHaveLength(tilesForCircle(AREA.center, TILE_COVER_RADIUS_M).length);
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
    // Everything the four tiles hold within 800 m of the cell centre: more
    // than twice what a 500 m radius would give (1600).
    expect(loaded.buildings.features).toHaveLength(3632);
    expect(loaded.buildings).toEqual(
      decodeBuildingTiles(
        tilesForCircle(AREA.center, TILE_COVER_RADIUS_M).map((tile) => ({
          tile,
          data: readFileSync(new URL(`openfreemap/14/${tile.x}/${tile.y}.pbf`, FIXTURES)),
        })),
        { bounds: boundsOfCircle(AREA.center, TILE_KEEP_RADIUS_M) },
      ),
    );
  });

  test("every pin of the cell has all buildings within 600 m, in every direction", async () => {
    tiles = (url) => {
      const [, x, y] = /\/14\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
      return new Response(
        new Uint8Array(readFileSync(new URL(`openfreemap/14/${x}/${y}.pbf`, FIXTURES))),
      );
    };
    const { buildings } = await loadBuildings(AREA);
    // Everything the area's tiles contain, without any distance filter.
    const everything = decodeBuildingTiles(
      tilesForCircle(AREA.center, TILE_COVER_RADIUS_M).map((tile) => ({
        tile,
        data: readFileSync(new URL(`openfreemap/14/${tile.x}/${tile.y}.pbf`, FIXTURES)),
      })),
    );
    const loadedShapes = new Set(buildings.features.map((f) => JSON.stringify(f.geometry)));
    const metres = (lng: number, lat: number) =>
      Math.hypot(
        (lat - AREA.center.lat) * 110_574,
        (lng - AREA.center.lng) * 111_320 * Math.cos((AREA.center.lat * Math.PI) / 180),
      );
    // The corners of the cell are the pins furthest from its centre (< 160 m).
    const reach = TILE_MIN_MARGIN_M + AREA_CELL_REACH_M;
    let near = 0;
    for (const feature of everything.features) {
      const ring = (
        feature.geometry.type === "Polygon"
          ? feature.geometry.coordinates
          : feature.geometry.coordinates[0]
      )[0];
      if (!ring.some(([lng, lat]) => metres(lng, lat) <= reach)) continue;
      near++;
      expect(loadedShapes.has(JSON.stringify(feature.geometry)), feature.properties.id).toBe(true);
    }
    expect(near).toBeGreaterThan(2000);
    expect(reach).toBeLessThanOrEqual(TILE_COVER_RADIUS_M);
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
    expect(calls("api")[0][0]).toBe(`/api/buildings?area=${AREA.key}`);
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

/**
 * A stand-in for the page (`document`): the tests run without a DOM. Only
 * what the loader looks at: `visibilityState` and the event that announces
 * its changes.
 */
function fakePage(initial: "visible" | "hidden" = "visible") {
  const events = new EventTarget();
  const page = {
    visibilityState: initial as string,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  vi.stubGlobal("document", page);
  const listeners = { added: 0, removed: 0 };
  const add = page.addEventListener;
  const remove = page.removeEventListener;
  page.addEventListener = (...args: Parameters<typeof add>) => (listeners.added++, add(...args));
  page.removeEventListener = (...args: Parameters<typeof remove>) => (
    listeners.removed++,
    remove(...args)
  );
  return {
    listeners,
    show(state: "visible" | "hidden") {
      page.visibilityState = state;
      events.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

// iOS suspends a page that goes to the background: its requests are cut off
// ("Load failed") and nothing more happens until the user comes back.
describe("loadBuildings: a page in the background", () => {
  /** What iOS answers for a request that was under way when the page was suspended. */
  const cutOff: Reply = () => {
    throw new TypeError("Load failed");
  };
  const everythingCutOff = () => {
    tileJson = cutOff;
    tiles = cutOff;
    api = cutOff;
    overpass = cutOff;
  };
  const everythingBack = () => {
    tileJson = respond(TILEJSON);
    tiles = tilesWith([10, 20, 30]);
  };
  const settled = (promise: Promise<unknown>) => {
    let done = false;
    promise.then(
      () => (done = true),
      () => (done = true),
    );
    return () => done;
  };

  test("a load cut off in the background runs again when the page is back", async () => {
    const page = fakePage();
    everythingCutOff();
    tiles = () => {
      page.show("hidden"); // the user switches to another app mid-download
      throw new TypeError("Load failed");
    };

    const pending = loadBuildings(AREA, { resumeDelayMs: 0 });
    const isSettled = settled(pending);
    // Every source failed, yet there is no error: the load waits for the page.
    await vi.waitFor(() => expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isSettled()).toBe(false);
    const before = fetchMock.mock.calls.length;

    everythingBack();
    page.show("visible");
    const loaded = await pending;
    expect(loaded.source).toBe("tiles");
    expect(loaded.buildings.features.map((f) => f.properties.heightM)).toEqual([10, 20, 30]);
    // The second round asked the tiles only.
    expect(fetchMock.mock.calls.slice(before).map(([url]) => kindOf(String(url)))).toEqual([
      "tile",
      "tile",
      "tile",
      "tile",
    ]);
    expect(await cached()).toMatchObject({ source: "tiles" });
    expect(page.listeners.removed).toBe(page.listeners.added);
  });

  test("a link opened in a background tab is treated the same", async () => {
    const page = fakePage("hidden");
    everythingCutOff();
    const pending = loadBuildings(AREA, { resumeDelayMs: 0 });
    await vi.waitFor(() => expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length));

    everythingBack();
    page.show("visible");
    await expect(pending).resolves.toMatchObject({ source: "tiles" });
  });

  test("there is one more round, not an endless loop", async () => {
    const page = fakePage();
    everythingCutOff();
    tiles = () => {
      page.show("hidden");
      throw new TypeError("Load failed");
    };
    const pending = failure(loadBuildings(AREA, { resumeDelayMs: 0 }));
    await vi.waitFor(() => expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length));

    tiles = cutOff; // still no network after coming back
    page.show("visible");
    const error = await pending;
    expect(error).toBeInstanceOf(BuildingsUnavailableError);
    expect((error as BuildingsUnavailableError).attempts.map((a) => a.source)).toEqual([
      "tiles",
      "api",
      "overpass",
    ]);
    expect(calls("overpass")).toHaveLength(2 * OVERPASS_ENDPOINTS.length);
    expect(page.listeners.removed).toBe(page.listeners.added);
  });

  test("a failure with the page in view all along is final", async () => {
    const page = fakePage();
    everythingCutOff();
    const error = await failure(loadBuildings(AREA, { resumeDelayMs: 0 }));
    expect(error).toBeInstanceOf(BuildingsUnavailableError);
    expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length);
    expect(page.listeners.removed).toBe(page.listeners.added);
  });

  test("going to the background does not disturb a load that succeeds", async () => {
    const page = fakePage();
    const ok = tilesWith([10, 20, 30]);
    tiles = (url, init) => {
      page.show("hidden");
      return ok(url, init);
    };
    await expect(loadBuildings(AREA, { resumeDelayMs: 0 })).resolves.toMatchObject({
      source: "tiles",
    });
    expect(calls("tile")).toHaveLength(4);
  });

  test("aborting while it waits for the page: AbortError", async () => {
    const page = fakePage("hidden");
    everythingCutOff();
    const controller = new AbortController();
    const pending = failure(loadBuildings(AREA, { signal: controller.signal, resumeDelayMs: 0 }));
    await vi.waitFor(() => expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length));
    const before = fetchMock.mock.calls.length;

    controller.abort();
    const error = await pending;
    expect(isAbortError(error)).toBe(true);
    page.show("visible");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls).toHaveLength(before);
    expect(page.listeners.removed).toBe(page.listeners.added);
  });

  test("the second round starts a moment after the page is back, not in the same instant", async () => {
    expect(RESUME_DELAY_MS).toBeGreaterThanOrEqual(500);
    vi.useFakeTimers();
    const page = fakePage("hidden");
    everythingCutOff();
    // (`fresh` only to keep IndexedDB out of a fake-timer test.)
    const pending = loadBuildings(AREA, { fresh: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length);
    const before = fetchMock.mock.calls.length;

    everythingBack();
    page.show("visible");
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS - 1);
    expect(fetchMock.mock.calls).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ source: "tiles" });
  });

  test("a page that is gone again before the moment is over is waited for again", async () => {
    vi.useFakeTimers();
    const page = fakePage("hidden");
    everythingCutOff();
    const pending = loadBuildings(AREA, { fresh: true });
    await vi.advanceTimersByTimeAsync(0);
    const before = fetchMock.mock.calls.length;

    everythingBack();
    page.show("visible");
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS / 2);
    page.show("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls).toHaveLength(before);

    page.show("visible");
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS);
    await expect(pending).resolves.toMatchObject({ source: "tiles" });
    expect(page.listeners.removed).toBe(page.listeners.added);
  });

  test("aborting during that moment: AbortError, and no timer is left behind", async () => {
    vi.useFakeTimers();
    const page = fakePage("hidden");
    everythingCutOff();
    const controller = new AbortController();
    const pending = failure(loadBuildings(AREA, { fresh: true, signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    page.show("visible");
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS / 2);

    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(page.listeners.removed).toBe(page.listeners.added);
  });
});

// Safari on iOS can leave an IndexedDB request unanswered for good.
describe("loadBuildings: a cache that does not answer", () => {
  test("the load goes on without it after a moment", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("indexedDB", { open: () => ({}) }); // no event ever fires
    vi.resetModules();
    const fresh = await import("./loader");
    const { BUILDING_CACHE_READ_TIMEOUT_MS } = await import("./cache");

    const pending = fresh.loadBuildings(AREA);
    await vi.advanceTimersByTimeAsync(BUILDING_CACHE_READ_TIMEOUT_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ source: "tiles", origin: "tiles" });

    // The next load does not wait at all, and nothing is left ticking.
    fetchMock.mockClear();
    await expect(fresh.loadBuildings(AREA)).resolves.toMatchObject({ source: "tiles" });
    expect(vi.getTimerCount()).toBe(0);
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
