// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useTileTemplate } from "./useTileTemplate";
import {
  OPENFREEMAP_LATEST_TEMPLATE,
  OPENFREEMAP_TILEJSON_URL,
  loadTileTemplate,
  resetTileTemplate,
} from "./vectorTiles";

// (jsdom replaces the global URL class, so fixtures are resolved from the project root.)
const TILEJSON = readFileSync(
  path.resolve(process.cwd(), "tests/fixtures/openfreemap/planet.json"),
  "utf8",
);
const REAL_TEMPLATE = "https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf";

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetTileTemplate();
  queryClient = new QueryClient();
  fetchMock = vi.fn<typeof fetch>(async () => new Response(TILEJSON));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Not automatic here: vitest globals are off.
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("useTileTemplate", () => {
  test("is null at first, then the address the tile index names", async () => {
    const { result } = renderHook(() => useTileTemplate(), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(REAL_TEMPLATE));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(OPENFREEMAP_TILEJSON_URL);
  });

  test("is the very address the sun computation loads its tiles from", async () => {
    const { result } = renderHook(() => useTileTemplate(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toBe(await loadTileTemplate());
    // …and that took no second look at the tile index.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("never fails: without a tile index it is the 'latest' alias", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useTileTemplate(), { wrapper });
    await waitFor(() => expect(result.current).toBe(OPENFREEMAP_LATEST_TEMPLATE));
  });

  test("a tile index that answers nonsense changes nothing either", async () => {
    fetchMock.mockResolvedValue(new Response("<html>busy</html>", { status: 503 }));
    const { result } = renderHook(() => useTileTemplate(), { wrapper });
    await waitFor(() => expect(result.current).toBe(OPENFREEMAP_LATEST_TEMPLATE));
  });

  test("is shared: a second map does not ask again", async () => {
    const first = renderHook(() => useTileTemplate(), { wrapper });
    await waitFor(() => expect(first.result.current).toBe(REAL_TEMPLATE));
    const second = renderHook(() => useTileTemplate(), { wrapper });
    expect(second.result.current).toBe(REAL_TEMPLATE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
