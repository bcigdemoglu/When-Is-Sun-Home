// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BuildingCollection, LatLng } from "@/lib/types";
import { clearBuildingCache, getCachedBuildingsEntry, setCachedBuildings } from "./cache";
import { BuildingsUnavailableError } from "./loader";
import { OVERPASS_ENDPOINTS, parseOverpassResponse } from "./overpass";
import { tileWithBuildings } from "./testing";
import { AREA_LAT_STEP_DEG, fetchAreaFor } from "./tiles";
import {
  buildingSourceLabel,
  buildingStats,
  buildingsQueryOptions,
  useBuildings,
} from "./useBuildings";
import { OPENFREEMAP_TILEJSON_URL, resetTileTemplate } from "./vectorTiles";

// (jsdom replaces the global URL class, so fixtures are resolved from the project root.)
const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");
const TILEJSON = readFileSync(path.join(FIXTURES, "openfreemap/planet.json"), "utf8");

const PIN: LatLng = { lat: 37.7912, lng: -122.4301 };
const AREA = fetchAreaFor(PIN);
/** A pin in the cell directly north of PIN's. */
const NEIGHBOUR: LatLng = { lat: AREA.center.lat + AREA_LAT_STEP_DEG, lng: AREA.center.lng };
const BERLIN: LatLng = { lat: 52.52, lng: 13.405 };

/** What Overpass (and so the API route) would return: `count` buildings. */
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
/** Never answers, but honours the abort signal like the real fetch. */
const hang: Reply = (_url, init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

/** Tiles holding one building per given height, next to the centre of the pin's area. */
function tilesWith(heights: number[], pin: LatLng = PIN): Reply {
  const { tile, data } = tileWithBuildings(fetchAreaFor(pin).center, heights);
  return (url) =>
    url.endsWith(`/${tile.z}/${tile.x}/${tile.y}.pbf`)
      ? new Response(new Uint8Array(data))
      : new Response(null, { status: 204 });
}

/** Answers of the network; each test adjusts them as needed. */
let tiles: Reply;
let api: Reply;
let overpass: Reply;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let queryClient: QueryClient;

type Kind = "tilejson" | "tile" | "api" | "overpass";
function kindOf(url: string): Kind {
  if (url === OPENFREEMAP_TILEJSON_URL) return "tilejson";
  if (url.startsWith("https://tiles.openfreemap.org/")) return "tile";
  if (url.startsWith("/api/buildings")) return "api";
  return "overpass";
}
const calls = (kind: Kind) => fetchMock.mock.calls.filter(([url]) => kindOf(String(url)) === kind);

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderBuildings(initial: LatLng | null) {
  return renderHook(({ place }: { place: LatLng | null }) => useBuildings(place), {
    wrapper,
    initialProps: { place: initial },
  });
}

const heights = (result: { current: { buildings: BuildingCollection | null } }) =>
  result.current.buildings?.features.map((f) => f.properties.heightM);

/** The cache write is fire-and-forget; wait for it to land. */
async function waitForCached(key: string) {
  await waitFor(async () => expect(await getCachedBuildingsEntry(key)).not.toBeNull());
}

beforeEach(async () => {
  await clearBuildingCache();
  resetTileTemplate();
  queryClient = new QueryClient();
  tiles = tilesWith([10, 20, 5]);
  api = respond(apiBody(2));
  overpass = respond(overpassBody(4));
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (kindOf(url) === "tilejson") return new Response(TILEJSON);
    return { tile: tiles, api, overpass }[kindOf(url) as Exclude<Kind, "tilejson">](url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Not automatic here: vitest globals are off.
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("buildingsQueryOptions", () => {
  test("is keyed by the fetch area, not the pin", () => {
    const options = buildingsQueryOptions(PIN);
    expect(options.queryKey).toEqual(["buildings", AREA.key]);
    expect(
      buildingsQueryOptions({ lat: AREA.center.lat + 0.0002, lng: AREA.center.lng + 0.0002 })
        .queryKey,
    ).toEqual(options.queryKey);
    expect(buildingsQueryOptions(NEIGHBOUR).queryKey).not.toEqual(options.queryKey);
  });

  test("never goes stale in memory and is collected after 30 minutes", () => {
    const options = buildingsQueryOptions(PIN);
    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(30 * 60 * 1000);
  });

  test("does not retry: one load already tries every source", () => {
    expect(buildingsQueryOptions(PIN).retry).toBe(false);
  });

  test("no place, or a nonsensical one: a disabled query", () => {
    expect(buildingsQueryOptions(null).queryKey).toEqual(["buildings", "none"]);
    expect(buildingsQueryOptions({ lat: Number.NaN, lng: 0 }).queryKey).toEqual([
      "buildings",
      "none",
    ]);
  });

  test("works with queryClient.fetchQuery; the data is a plain collection", async () => {
    const buildings = await queryClient.fetchQuery(buildingsQueryOptions(PIN));
    expect(buildings.type).toBe("FeatureCollection");
    expect(buildings.features).toHaveLength(3);
  });
});

describe("useBuildings", () => {
  test("no place → idle, nothing fetched", async () => {
    const { result } = renderBuildings(null);
    expect(result.current).toMatchObject({
      buildings: null,
      status: "idle",
      error: null,
      isFetching: false,
      isPlaceholder: false,
      stats: null,
      source: null,
      originalSource: null,
      sourceLabel: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    // Harmless.
    act(() => result.current.refetch());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("loads the area from the vector tiles, reports stats and source, fills the cache", async () => {
    const { result } = renderBuildings(PIN);
    expect(result.current).toMatchObject({
      buildings: null,
      status: "loading",
      isFetching: true,
      source: null,
      sourceLabel: null,
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    // The untagged building (5 m in the tile) is our 7 m default.
    expect(heights(result)).toEqual([10, 20, 7]);
    expect(result.current.stats).toEqual({ total: 3, tagged: 2, levels: 0, default: 1 });
    expect(result.current).toMatchObject({
      error: null,
      isFetching: false,
      isPlaceholder: false,
      source: "tiles",
      originalSource: "tiles",
      sourceLabel: "OpenFreeMap vector tiles",
    });

    // The tile index and the area's four tiles; nothing else.
    expect(calls("tilejson")).toHaveLength(1);
    expect(
      calls("tile")
        .map(([url]) => String(url).replace(/^.*\/14\//, ""))
        .sort(),
    ).toEqual(["2619/6331.pbf", "2619/6332.pbf", "2620/6331.pbf", "2620/6332.pbf"]);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);

    await waitForCached(AREA.key);
    expect(await getCachedBuildingsEntry(AREA.key)).toMatchObject({
      data: result.current.buildings,
      source: "tiles",
    });
  });

  test("the contract other code relies on is unchanged", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(Object.keys(result.current).sort()).toEqual([
      "buildings",
      "error",
      "isFetching",
      "isPlaceholder",
      "originalSource",
      "refetch",
      "source",
      "sourceLabel",
      "stats",
      "status",
    ]);
    expect(Object.keys(result.current.stats!).sort()).toEqual([
      "default",
      "levels",
      "tagged",
      "total",
    ]);
  });

  test("moving the pin inside its cell does not refetch", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.buildings;
    const requests = fetchMock.mock.calls.length;

    for (const offset of [0.0001, 0.0003, -0.0002]) {
      rerender({ place: { lat: AREA.center.lat + offset, lng: AREA.center.lng - offset } });
      expect(result.current.status).toBe("ready");
      expect(result.current.buildings).toBe(first);
      expect(result.current.source).toBe("tiles");
    }
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  test("a second component on the same area shares the request", async () => {
    const a = renderBuildings(PIN);
    const b = renderBuildings({ lat: AREA.center.lat + 0.0001, lng: AREA.center.lng });
    await waitFor(() => expect(a.result.current.status).toBe("ready"));
    await waitFor(() => expect(b.result.current.status).toBe("ready"));
    expect(calls("tile")).toHaveLength(4);
    expect(b.result.current.buildings).toBe(a.result.current.buildings);
    expect(b.result.current.source).toBe("tiles");
  });

  test("serves a saved area without touching the network, and says where it came from", async () => {
    const saved = parseOverpassResponse(JSON.parse(overpassBody(7)));
    await setCachedBuildings(AREA.key, saved, "tiles");

    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.buildings).toEqual(saved);
    expect(result.current).toMatchObject({
      source: "cache",
      originalSource: "tiles",
      sourceLabel: "OpenFreeMap vector tiles (saved copy)",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("moving to the next cell keeps the old buildings as a placeholder while loading", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.buildings;

    tiles = tilesWith([30, 40], NEIGHBOUR);
    rerender({ place: NEIGHBOUR });

    // Not "ready": these are the neighbouring area's buildings.
    expect(result.current).toMatchObject({
      status: "loading",
      isPlaceholder: true,
      isFetching: true,
      source: null,
    });
    expect(result.current.buildings).toBe(first);
    expect(result.current.stats?.total).toBe(3);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.isPlaceholder).toBe(false);
    expect(heights(result)).toEqual([30, 40]);
    expect(result.current.source).toBe("tiles");
    // The tile index is not fetched again for the second area.
    expect(calls("tilejson")).toHaveLength(1);

    // Going back is instant: still in memory.
    const requests = fetchMock.mock.calls.length;
    rerender({ place: PIN });
    expect(result.current.status).toBe("ready");
    expect(result.current.buildings).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  test("jumping far away does not show the old city's buildings", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    tiles = tilesWith([15], BERLIN);
    rerender({ place: BERLIN });
    expect(result.current).toMatchObject({
      status: "loading",
      buildings: null,
      stats: null,
      isPlaceholder: false,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(heights(result)).toEqual([15]);
  });

  test("removing the place goes back to idle with no buildings", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ place: null });
    expect(result.current).toMatchObject({
      status: "idle",
      buildings: null,
      stats: null,
      source: null,
    });
  });

  test("unmounting aborts the requests in flight; nothing else is tried", async () => {
    tiles = hang;
    const { result, unmount } = renderBuildings(PIN);
    await waitFor(() => expect(calls("tile")).toHaveLength(4));
    expect(result.current.status).toBe("loading");
    const signals = calls("tile").map(([, init]) => init?.signal as AbortSignal);
    expect(signals.some((signal) => signal.aborted)).toBe(false);

    unmount();
    await waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls("tile")).toHaveLength(4);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);
    expect(await getCachedBuildingsEntry(AREA.key)).toBeNull();
  });

  test("end to end with the real Pacific Heights tiles", async () => {
    tiles = (url) => {
      const [, x, y] = /\/14\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
      return new Response(
        new Uint8Array(readFileSync(path.join(FIXTURES, `openfreemap/14/${x}/${y}.pbf`))),
      );
    };
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stats).toEqual({ total: 3632, tagged: 2834, levels: 0, default: 798 });
    expect(result.current.source).toBe("tiles");
    await waitForCached(AREA.key);
    expect((await getCachedBuildingsEntry(AREA.key))?.data.features).toHaveLength(3632);
  });
});

describe("useBuildings: when the tiles cannot be had", () => {
  test("the API route stands in, and the result says so", async () => {
    tiles = respond("oops", 500);
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.buildings?.features).toHaveLength(2);
    expect(result.current).toMatchObject({
      error: null,
      source: "api",
      originalSource: "api",
      sourceLabel: "OpenStreetMap via Overpass (server)",
    });
    expect(calls("api")).toHaveLength(1);
    expect(calls("overpass")).toHaveLength(0);
  });

  test("then Overpass directly", async () => {
    tiles = respond("oops", 500);
    api = respond('{"error":"http","message":"blocked"}', 502);
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.buildings?.features).toHaveLength(4);
    expect(result.current).toMatchObject({
      source: "overpass",
      sourceLabel: "OpenStreetMap via Overpass",
    });
    expect(calls("overpass").map(([url]) => url)).toEqual([OVERPASS_ENDPOINTS[0]]);
    await waitForCached(AREA.key);
    expect((await getCachedBuildingsEntry(AREA.key))?.source).toBe("overpass");
  });

  test("a saved copy of fallback data is labelled as such", async () => {
    await setCachedBuildings(
      AREA.key,
      parseOverpassResponse(JSON.parse(overpassBody(2))),
      "overpass",
    );
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({
      source: "cache",
      originalSource: "overpass",
      sourceLabel: "OpenStreetMap via Overpass (saved copy)",
    });
  });

  test("everything down: one error, at once, each source asked exactly once", async () => {
    tiles = respond("oops", 500);
    api = respond('{"error":"timeout","message":"slow"}', 504);
    overpass = respond("busy", 429);
    const { result } = renderBuildings(PIN);

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(BuildingsUnavailableError);
    expect(
      (result.current.error as BuildingsUnavailableError).attempts.map((a) => a.source),
    ).toEqual(["tiles", "api", "overpass"]);
    expect(result.current).toMatchObject({
      buildings: null,
      stats: null,
      isFetching: false,
      source: null,
    });
    // No second round.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls("tile")).toHaveLength(4);
    expect(calls("api")).toHaveLength(1);
    expect(calls("overpass")).toHaveLength(OVERPASS_ENDPOINTS.length);
    expect(await getCachedBuildingsEntry(AREA.key)).toBeNull();
  });

  test("refetch() after an error tries again, tiles first", async () => {
    tiles = respond("oops", 500);
    api = respond("down", 500);
    overpass = respond("down", 500);
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("error"));

    tiles = tilesWith([12]);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
    expect(heights(result)).toEqual([12]);
    expect(result.current.source).toBe("tiles");
    expect(calls("api")).toHaveLength(1);
  });
});

describe("useBuildings: refetch()", () => {
  test("re-reads the tiles, past the saved copy, and replaces it", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);
    expect(calls("tilejson")).toHaveLength(1);

    tiles = tilesWith([21, 22, 23, 24]);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.buildings?.features).toHaveLength(4));
    expect(result.current).toMatchObject({ status: "ready", source: "tiles", error: null });
    // The tile index is asked again (a newer build may be out); Overpass is not involved.
    expect(calls("tilejson")).toHaveLength(2);
    expect(calls("tile")).toHaveLength(8);
    expect(calls("api")).toHaveLength(0);
    expect(calls("overpass")).toHaveLength(0);
    await waitFor(async () =>
      expect((await getCachedBuildingsEntry(AREA.key))?.data.features).toHaveLength(4),
    );
  });

  test("from a saved copy: the source changes from cache to tiles", async () => {
    await setCachedBuildings(AREA.key, parseOverpassResponse(JSON.parse(overpassBody(7))), "api");
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("cache");

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.source).toBe("tiles"));
    expect(heights(result)).toEqual([10, 20, 7]);
    expect(result.current.sourceLabel).toBe("OpenFreeMap vector tiles");
  });

  test("a failed refetch() keeps the buildings and the saved copy", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);

    tiles = respond("down", 500);
    api = respond("down", 500);
    overpass = respond("down", 500);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBeInstanceOf(BuildingsUnavailableError));
    expect(result.current.status).toBe("ready");
    expect(result.current.buildings?.features).toHaveLength(3);
    expect((await getCachedBuildingsEntry(AREA.key))?.data.features).toHaveLength(3);

    // The next refetch still bypasses the saved copy, and now succeeds.
    tiles = tilesWith([50]);
    act(() => result.current.refetch());
    await waitFor(() => expect(heights(result)).toEqual([50]));
    expect(result.current.error).toBeNull();
  });
});

test("buildingSourceLabel", () => {
  expect(buildingSourceLabel("tiles", "tiles")).toBe("OpenFreeMap vector tiles");
  expect(buildingSourceLabel("api", "api")).toBe("OpenStreetMap via Overpass (server)");
  expect(buildingSourceLabel("overpass", "overpass")).toBe("OpenStreetMap via Overpass");
  expect(buildingSourceLabel("cache", "tiles")).toBe("OpenFreeMap vector tiles (saved copy)");
  expect(buildingSourceLabel("cache", null)).toBe("Saved copy");
});

test("buildingStats counts by height source", () => {
  const collection: BuildingCollection = {
    type: "FeatureCollection",
    features: (["tagged", "levels", "default", "tagged"] as const).map((heightSource, i) => ({
      type: "Feature",
      properties: { id: `way/${i}`, heightM: 9, heightSource, levels: null, kind: "yes" },
      geometry: { type: "Polygon", coordinates: [] },
    })),
  };
  expect(buildingStats(collection)).toEqual({ total: 4, tagged: 2, levels: 1, default: 1 });
  expect(buildingStats({ type: "FeatureCollection", features: [] })).toEqual({
    total: 0,
    tagged: 0,
    levels: 0,
    default: 0,
  });
});
