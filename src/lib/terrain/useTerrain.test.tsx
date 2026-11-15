// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LatLng, Terrain } from "@/lib/types";

import { elevationGridFrom } from "./elevation";
import { loadTerrainForCoverage, TerrainError } from "./loadTerrain";
import { terrainCoverageFor, type TerrainCoverage } from "./tiles";
import { terrainQueryOptions, useTerrain } from "./useTerrain";

// The network + image decoding are replaced; everything else is real.
vi.mock("./loadTerrain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./loadTerrain")>()),
  loadTerrainForCoverage: vi.fn(),
}));
const loadMock = vi.mocked(loadTerrainForCoverage);

const PIN: LatLng = { lat: 37.7906, lng: -122.4294 };
/** 150 m away: same block of tiles. */
const NEARBY: LatLng = { lat: 37.7916, lng: -122.4284 };
const BERLIN: LatLng = { lat: 52.52, lng: 13.405 };

function terrainFor(coverage: TerrainCoverage, level: number): Terrain {
  return {
    near: elevationGridFrom(
      coverage.origin,
      { minX: -100, minY: -100, cellSizeM: 100, width: 3, height: 3 },
      () => level,
    ),
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderTerrain(initial: LatLng | null) {
  return renderHook(({ place }: { place: LatLng | null }) => useTerrain(place), {
    wrapper,
    initialProps: { place: initial },
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  loadMock.mockReset();
  loadMock.mockImplementation(async (coverage) => terrainFor(coverage, 100));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("useTerrain", () => {
  test("no place: idle, nothing fetched", () => {
    const { result } = renderTerrain(null);
    expect(result.current).toEqual({ terrain: null, status: "idle", error: null });
    expect(loadMock).not.toHaveBeenCalled();
  });

  test("loads the terrain for the place's tile coverage", async () => {
    const { result } = renderTerrain(PIN);
    expect(result.current.status).toBe("loading");
    expect(result.current.terrain).toBeNull();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
    expect(result.current.terrain!.near.origin).toEqual(terrainCoverageFor(PIN)!.origin);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock.mock.calls[0][0]).toEqual(terrainCoverageFor(PIN));
    // The query's abort signal is handed to the loader.
    expect(loadMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("moving the pin within the same coverage re-uses the terrain", async () => {
    expect(terrainCoverageFor(NEARBY)!.key).toBe(terrainCoverageFor(PIN)!.key);
    const { result, rerender } = renderTerrain(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.terrain;

    rerender({ place: NEARBY });
    expect(result.current.status).toBe("ready");
    expect(result.current.terrain).toBe(first);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  test("a different area loads its own terrain; coming back is served from cache", async () => {
    const { result, rerender } = renderTerrain(PIN);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const sanFrancisco = result.current.terrain;

    rerender({ place: BERLIN });
    // Never the previous area's hills while the new ones load.
    expect(result.current.status).toBe("loading");
    expect(result.current.terrain).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.terrain!.near.origin).toEqual(terrainCoverageFor(BERLIN)!.origin);
    expect(loadMock).toHaveBeenCalledTimes(2);

    rerender({ place: PIN });
    expect(result.current.status).toBe("ready");
    expect(result.current.terrain).toBe(sanFrancisco);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  test("failure is reported, not thrown: status 'error' and no terrain", async () => {
    loadMock.mockRejectedValue(new TerrainError("Terrain tile 14/1/2 failed: HTTP 503"));
    const { result } = renderTerrain(PIN);
    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 4000 });
    expect(result.current.terrain).toBeNull();
    expect(result.current.error).toBeInstanceOf(TerrainError);
    expect(result.current.error!.message).toMatch(/503/);
    // One retry, then give up.
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  test("places without terrain coverage (the poles) stay idle", () => {
    const { result } = renderTerrain({ lat: 89, lng: 0 });
    expect(result.current).toEqual({ terrain: null, status: "idle", error: null });
    expect(loadMock).not.toHaveBeenCalled();
  });

  test("the query is keyed by the coverage and never goes stale", () => {
    const options = terrainQueryOptions(PIN);
    expect(options.queryKey).toEqual(["terrain", "v1:14/2620/6332"]);
    expect(terrainQueryOptions(NEARBY).queryKey).toEqual(options.queryKey);
    expect(terrainQueryOptions(BERLIN).queryKey).not.toEqual(options.queryKey);
    expect(terrainQueryOptions(null).queryKey).toEqual(["terrain", "none"]);
    expect(options.staleTime).toBe(Infinity);
  });
});
