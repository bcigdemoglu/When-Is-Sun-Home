// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LatLng } from "@/lib/types";
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

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderBuildings(initial: LatLng | null) {
  return renderHook(({ place }: { place: LatLng | null }) => useBuildings(place), {
    wrapper,
    initialProps: { place: initial },
  });
}

/** The cache write is fire-and-forget; wait for it to land. */
async function waitForCached(key: string) {
  await waitFor(async () => expect(await getCachedBuildings(key)).not.toBeNull());
}

beforeEach(async () => {
  await clearBuildingCache();
  queryClient = new QueryClient();
  fetchMock = vi.fn<typeof fetch>(async () => new Response(overpassBody(1, 2, 3)));
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
      buildingsQueryOptions({ lat: PIN.lat + 0.0002, lng: PIN.lng + 0.0002 }).queryKey,
    ).toEqual(options.queryKey);
    expect(buildingsQueryOptions(NEIGHBOUR).queryKey).not.toEqual(options.queryKey);
  });

  test("never goes stale in memory and is collected after 30 minutes", () => {
    const options = buildingsQueryOptions(PIN);
    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(30 * 60 * 1000);
  });

  test("retries once, with backoff, but never after an abort", () => {
    const { retry, retryDelay } = buildingsQueryOptions(PIN);
    const failed = new OverpassError("network", "down");
    const aborted = new DOMException("Aborted", "AbortError");
    expect(typeof retry === "function" && retry(0, failed)).toBe(true);
    expect(typeof retry === "function" && retry(1, failed)).toBe(false);
    expect(typeof retry === "function" && retry(0, aborted)).toBe(false);
    expect(typeof retryDelay === "function" && retryDelay(0, failed)).toBe(1000);
    expect(typeof retryDelay === "function" && retryDelay(1, failed)).toBe(2000);
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

  test("loads the area around the place, reports stats, and fills the cache", async () => {
    const { result } = renderBuildings(PIN);
    expect(result.current).toMatchObject({ buildings: null, status: "loading", isFetching: true });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.buildings?.features.map((f) => f.properties.id)).toEqual([
      "way/1",
      "way/2",
      "way/3",
    ]);
    expect(result.current.stats).toEqual({ total: 3, tagged: 1, levels: 1, default: 1 });
    expect(result.current).toMatchObject({ error: null, isFetching: false, isPlaceholder: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OVERPASS_ENDPOINTS[0]);
    const query = (init?.body as URLSearchParams).get("data");
    expect(query).toContain(
      `(around:500,${AREA.center.lat.toFixed(6)},${AREA.center.lng.toFixed(6)})`,
    );

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
    const b = renderBuildings({ lat: PIN.lat + 0.0001, lng: PIN.lng });
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

    fetchMock.mockImplementation(async () => new Response(overpassBody(10, 11)));
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
    expect(result.current.buildings?.features.map((f) => f.properties.id)).toEqual([
      "way/10",
      "way/11",
    ]);
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

  test("reports an error after every endpoint failed twice", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 429 }));
    const { result } = renderBuildings(PIN);

    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 4000 });
    expect(result.current.error).toBeInstanceOf(OverpassError);
    expect((result.current.error as OverpassError).kind).toBe("rate-limited");
    expect(result.current).toMatchObject({ buildings: null, stats: null, isFetching: false });
    // Three endpoints, tried on the first attempt and on the single retry.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await getCachedBuildings(AREA.key)).toBeNull();
  });

  test("refetch() after an error tries again", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 504 }));
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 4000 });

    fetchMock.mockImplementation(async () => new Response(overpassBody(5)));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
    expect(result.current.buildings?.features).toHaveLength(1);
  });

  test("refetch() bypasses the cache and replaces it", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => new Response(overpassBody(21, 22, 23, 24)));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.buildings?.features).toHaveLength(4));
    expect(result.current.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(async () =>
      expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(4),
    );
  });

  test("a failed refetch() keeps the buildings and the cached copy", async () => {
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitForCached(AREA.key);

    fetchMock.mockImplementation(async () => new Response("down", { status: 500 }));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBeInstanceOf(OverpassError), {
      timeout: 4000,
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.buildings?.features).toHaveLength(3);
    expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(3);
  });

  test("unmounting aborts the request in flight", async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const { result, unmount } = renderBuildings(PIN);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("loading");
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // No fallback to the other endpoints, no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("end to end with the Pacific Heights fixture", async () => {
    // (jsdom replaces the global URL class, so resolve from the project root instead.)
    const raw = readFileSync(
      path.resolve(process.cwd(), "tests/fixtures/pacific-heights.overpass.json"),
      "utf8",
    );
    fetchMock.mockImplementation(async () => new Response(raw));
    const { result } = renderBuildings(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stats).toEqual({ total: 384, tagged: 321, levels: 8, default: 55 });
    await waitForCached(AREA.key);
    expect((await getCachedBuildings(AREA.key))?.features).toHaveLength(384);
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
