// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BuildingCollection, LatLng } from "@/lib/types";
import { BuildingsApiError } from "./api";
import { clearBuildingCache, getCachedBuildings, setCachedBuildings } from "./cache";
import { OVERPASS_ENDPOINTS, OverpassError, parseOverpassResponse } from "./overpass";
import { AREA_LAT_STEP_DEG, fetchAreaFor } from "./tiles";
import { buildingStats, buildingsQueryOptions, useBuildings } from "./useBuildings";

const PIN: LatLng = { lat: 37.7906, lng: -122.4294 };
const AREA = fetchAreaFor(PIN);
/** A pin in the cell directly north of PIN's. */
const NEIGHBOUR: LatLng = { lat: AREA.center.lat + AREA_LAT_STEP_DEG, lng: AREA.center.lng };
const BERLIN: LatLng = { lat: 52.52, lng: 13.405 };

function overpassBody(...ids: number[]): string {
  return JSON.stringify({
    version: 0.6,
    elements: ids.map((id, index) => ({
      type: "way",
      id,
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.001 },
        { lat: 0.001, lon: 0.001 },
        { lat: 0, lon: 0 },
      ],
      tags: [
        { building: "yes", height: "10" },
        { building: "yes", "building:levels": "2" },
        { building: "house" },
      ][index % 3],
    })),
  });
}

/** What the API route would send for the same buildings: the parsed collection. */
function apiBody(...ids: number[]): string {
  return JSON.stringify(parseOverpassResponse(JSON.parse(overpassBody(...ids))));
}

type Reply = (init?: RequestInit) => Response | Promise<Response>;

/** Answers of the two network routes; each test adjusts them as needed. */
let api: Reply;
let overpass: Reply;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let queryClient: QueryClient;

const isApiCall = ([input]: Parameters<typeof fetch>) => String(input).startsWith("/api/buildings");
const apiCalls = () => fetchMock.mock.calls.filter(isApiCall);
const overpassCalls = () => fetchMock.mock.calls.filter((call) => !isApiCall(call));

const respond =
  (body: string, status = 200) =>
  () =>
    new Response(body, { status });
const offline: Reply = () => {
  throw new TypeError("Failed to fetch");
};
/** Never answers, but honours the abort signal like the real fetch. */
const hang: Reply = (init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderBuildings(initial: LatLng | null) {
  return renderHook(({ place }: { place: LatLng | null }) => useBuildings(place), {
    wrapper,
    initialProps: { place: initial },
  });
}

const ids = (result: { current: { buildings: BuildingCollection | null } }) =>
  result.current.buildings?.features.map((f) => f.properties.id);

/** The cache write is fire-and-forget; wait for it to land. */
async function waitForCached(key: string) {
  await waitFor(async () => expect(await getCachedBuildings(key)).not.toBeNull());
}

beforeEach(async () => {
  await clearBuildingCache();
  queryClient = new QueryClient();
  api = respond(apiBody(1, 2, 3));
  overpass = respond(overpassBody(1, 2, 3));
  fetchMock = vi.fn<typeof fetch>(async (input, init) =>
    isApiCall([input, init]) ? api(init) : overpass(init),
  );
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

  test("retries once with backoff, but not after an abort, a timeout or a refused request", () => {
    const { retry, retryDelay } = buildingsQueryOptions(PIN);
    if (typeof retry !== "function" || typeof retryDelay !== "function") {
      throw new Error("expected retry functions");
    }
    const down = new OverpassError("network", "down");
    expect(retry(0, down)).toBe(true);
    expect(retry(1, down)).toBe(false);
    expect(retry(0, new OverpassError("rate-limited", "busy"))).toBe(true);
    expect(retry(0, new BuildingsApiError("http", "bad gateway", { status: 502 }))).toBe(true);
    expect(retry(0, new OverpassError("timeout", "slow"))).toBe(false);
    expect(retry(0, new BuildingsApiError("bad-request", "no", { status: 400 }))).toBe(false);
    expect(retry(0, new DOMException("Aborted", "AbortError"))).toBe(false);
    expect(retryDelay(0, down)).toBe(1000);
    expect(retryDelay(1, down)).toBe(2000);
  });

  test("no place, or a nonsensical one: a disabled query", () => {
    expect(buildingsQueryOptions(null).queryKey).toEqual(["buildings", "none"]);
    expect(buildingsQueryOptions({ lat: Number.NaN, lng: 0 }).queryKey).toEqual([
      "buildings",
      "none",
    ]);
  });

  test("works with queryClient.fetchQuery", async () => {
    const buildings = await queryClient.fetchQuery(buildingsQueryOptions(PIN));
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
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    // Harmless.
    act(() => result.current.refetch());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("loads the area from the API route, reports stats, and fills the cache", async () => {
    const { result } = renderBuildings(PIN);
    expect(result.current).toMatchObject({ buildings: null, status: "loading", isFetching: true });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(ids(result)).toEqual(["way/1", "way/2", "way/3"]);
    expect(result.current.stats).toEqual({ total: 3, tagged: 1, levels: 1, default: 1 });
    expect(result.current).toMatchObject({ error: null, isFetching: false, isPlaceholder: false });

    // One same-origin request; Overpass is not contacted from the browser.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/buildings?area=${encodeURIComponent(AREA.key)}`);
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
    expect(overpassCalls()).toHaveLength(0);

    await waitForCached(AREA.key);
    expect(await getCachedBuildings(AREA.key)).toEqual(result.current.buildings);
  });

  test("moving the pin inside its cell does not refetch", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.buildings;

    for (const offset of [0.0001, 0.0003, -0.0002]) {
      rerender({ place: { lat: AREA.center.lat + offset, lng: AREA.center.lng - offset } });
      expect(result.current.status).toBe("ready");
      expect(result.current.buildings).toBe(first);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a second component on the same area shares the request", async () => {
    const a = renderBuildings(PIN);
    const b = renderBuildings({ lat: AREA.center.lat + 0.0001, lng: AREA.center.lng });
    await waitFor(() => expect(a.result.current.status).toBe("ready"));
    await waitFor(() => expect(b.result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b.result.current.buildings).toBe(a.result.current.buildings);
  });

  test("serves a cached area without touching the network", async () => {
    const cached = parseOverpassResponse(JSON.parse(overpassBody(77)));
    await setCachedBuildings(AREA.key, cached);

    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.buildings).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("moving to the next cell keeps the old buildings as a placeholder while loading", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.buildings;

    api = respond(apiBody(10, 11));
    rerender({ place: NEIGHBOUR });

    // Not "ready": these are the neighbouring area's buildings.
    expect(result.current).toMatchObject({
      status: "loading",
      isPlaceholder: true,
      isFetching: true,
    });
    expect(result.current.buildings).toBe(first);
    expect(result.current.stats?.total).toBe(3);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.isPlaceholder).toBe(false);
    expect(ids(result)).toEqual(["way/10", "way/11"]);
    expect(result.current.stats?.total).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Going back is instant: still in memory.
    rerender({ place: PIN });
    expect(result.current.status).toBe("ready");
    expect(result.current.buildings).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("jumping far away does not show the old city's buildings", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ place: BERLIN });
    expect(result.current).toMatchObject({
      status: "loading",
      buildings: null,
      stats: null,
      isPlaceholder: false,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("removing the place goes back to idle with no buildings", async () => {
    const { result, rerender } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ place: null });
    expect(result.current).toMatchObject({ status: "idle", buildings: null, stats: null });
  });

  test("end to end with the Pacific Heights fixture", async () => {
    // (jsdom replaces the global URL class, so resolve from the project root instead.)
    const raw = readFileSync(
      path.resolve(process.cwd(), "tests/fixtures/pacific-heights.overpass.json"),
      "utf8",
    );
    api = respond(JSON.stringify(parseOverpassResponse(JSON.parse(raw))));
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stats).toEqual({ total: 384, tagged: 321, levels: 8, default: 55 });
    expect(overpassCalls()).toHaveLength(0);
    await waitForCached(AREA.key);
    expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(384);
  });
});

describe("useBuildings: falling back from the API route to Overpass", () => {
  beforeEach(() => {
    overpass = respond(overpassBody(40, 41));
  });

  async function expectDirectResult(result: ReturnType<typeof renderBuildings>["result"]) {
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(ids(result)).toEqual(["way/40", "way/41"]);
    expect(result.current.error).toBeNull();
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(1);
    // The direct path is the unchanged browser → Overpass request.
    const [url, init] = overpassCalls()[0];
    expect(url).toBe(OVERPASS_ENDPOINTS[0]);
    expect((init?.body as URLSearchParams).get("data")).toContain(
      `(around:500,${AREA.center.lat.toFixed(6)},${AREA.center.lng.toFixed(6)})`,
    );
    await waitForCached(AREA.key);
    expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(2);
  }

  test.each([429, 500, 502, 503, 504, 401, 404])("API answers HTTP %d", async (status) => {
    api = respond(JSON.stringify({ error: "x", message: "no" }), status);
    const { result } = renderBuildings(PIN);
    await expectDirectResult(result);
  });

  test("API unreachable", async () => {
    api = offline;
    const { result } = renderBuildings(PIN);
    await expectDirectResult(result);
  });

  test.each([
    ["an HTML page", "<!doctype html><title>Sign in</title>"],
    ["JSON of the wrong shape", '{"ok":true}'],
    ["a raw Overpass document", overpassBody(1, 2)],
    ["a collection of unusable features", '{"type":"FeatureCollection","features":[{},{}]}'],
    ["truncated JSON", '{"type":"FeatureCollection","features":['],
  ])("API sends %s", async (_, body) => {
    api = respond(body);
    const { result } = renderBuildings(PIN);
    await expectDirectResult(result);
  });

  test("an invalid feature in an otherwise good API payload is dropped, with no fallback", async () => {
    const payload = JSON.parse(apiBody(1, 2));
    payload.features.push({ type: "Feature", properties: {}, geometry: null });
    api = respond(JSON.stringify(payload));
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(ids(result)).toEqual(["way/1", "way/2"]);
    expect(overpassCalls()).toHaveLength(0);
  });

  test("API answers 400: no fallback, no retry", async () => {
    api = respond(JSON.stringify({ error: "bad-area", message: "not a key" }), 400);
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(BuildingsApiError);
    expect(result.current.error).toMatchObject({ kind: "bad-request", status: 400 });
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(0);
  });

  test("an abort during the API request does not fall back", async () => {
    api = hang;
    const { result, unmount } = renderBuildings(PIN);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("loading");
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(0);
    expect(await getCachedBuildings(AREA.key)).toBeNull();
  });

  test("an abort during the fallback stops there too", async () => {
    api = offline;
    overpass = hang;
    const { unmount } = renderBuildings(PIN);
    await waitFor(() => expect(overpassCalls()).toHaveLength(1));
    const signal = overpassCalls()[0][1]?.signal as AbortSignal;

    unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Neither the other Overpass endpoints nor a retry.
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(1);
  });

  test("both routes fail: the Overpass error is reported, after one retry", async () => {
    api = respond(JSON.stringify({ error: "network", message: "upstream" }), 502);
    overpass = respond("busy", 429);
    const { result } = renderBuildings(PIN);

    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 4000 });
    expect(result.current.error).toBeInstanceOf(OverpassError);
    expect((result.current.error as OverpassError).kind).toBe("rate-limited");
    expect(result.current).toMatchObject({ buildings: null, stats: null, isFetching: false });
    // Two rounds, each: the API route once, then all three Overpass endpoints.
    expect(apiCalls()).toHaveLength(2);
    expect(overpassCalls()).toHaveLength(6);
    expect(await getCachedBuildings(AREA.key)).toBeNull();
  });

  test("both routes fail on timeouts: reported at once, without a second round", async () => {
    api = respond(JSON.stringify({ error: "timeout", message: "slow" }), 504);
    overpass = respond("gateway timeout", 504);
    const { result } = renderBuildings(PIN);

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect((result.current.error as OverpassError).kind).toBe("timeout");
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(3);
  });

  test("refetch() after an error tries again", async () => {
    api = respond("down", 504);
    overpass = respond("busy", 504);
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("error"));

    overpass = respond(overpassBody(5));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
    expect(ids(result)).toEqual(["way/5"]);
  });
});

describe("useBuildings: refetch()", () => {
  test("goes straight to Overpass, past both caches, and replaces the cached copy", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);
    expect(apiCalls()).toHaveLength(1);

    overpass = respond(overpassBody(21, 22, 23, 24));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.buildings?.features).toHaveLength(4));
    expect(result.current.status).toBe("ready");
    // The CDN-cached route is not asked again.
    expect(apiCalls()).toHaveLength(1);
    expect(overpassCalls()).toHaveLength(1);
    await waitFor(async () =>
      expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(4),
    );
  });

  test("falls back to the API route (skipping the HTTP cache) when Overpass is down", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);

    overpass = respond("down", 500);
    api = respond(apiBody(31, 32));
    act(() => result.current.refetch());
    await waitFor(() => expect(ids(result)).toEqual(["way/31", "way/32"]));
    expect(result.current).toMatchObject({ status: "ready", error: null });
    expect(overpassCalls()).toHaveLength(3);
    expect(apiCalls()).toHaveLength(2);
    expect(apiCalls()[1][1]?.cache).toBe("reload");
  });

  test("a failed refetch() keeps the buildings and the cached copy", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);

    overpass = respond("down", 500);
    api = respond("down", 500);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBeInstanceOf(OverpassError), {
      timeout: 4000,
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.buildings?.features).toHaveLength(3);
    expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(3);

    // The next refetch still bypasses the cache, and now succeeds.
    overpass = respond(overpassBody(50));
    act(() => result.current.refetch());
    await waitFor(() => expect(ids(result)).toEqual(["way/50"]));
    expect(result.current.error).toBeNull();
  });
});

test("buildingStats counts by height source", () => {
  const buildings = parseOverpassResponse(JSON.parse(overpassBody(1, 2, 3, 4)));
  expect(buildingStats(buildings)).toEqual({ total: 4, tagged: 2, levels: 1, default: 1 });
  expect(buildingStats({ type: "FeatureCollection", features: [] })).toEqual({
    total: 0,
    tagged: 0,
    levels: 0,
    default: 0,
  });
});
