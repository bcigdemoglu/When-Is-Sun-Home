// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LatLng } from "@/lib/types";
import { useDebouncedValue } from "./useDebouncedValue";
import { usePlaceSearch } from "./usePlaceSearch";

function photonBody(...names: string[]): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: names.map((name, i) => ({
      type: "Feature",
      properties: { osm_type: "N", osm_id: i + 1, name, country: "Testland" },
      geometry: { type: "Point", coordinates: [10 + i, 50 + i] },
    })),
  });
}

/** The `q` parameter of every request made so far. */
function queries(mock: ReturnType<typeof vi.fn<typeof fetch>>): (string | null)[] {
  return mock.mock.calls.map(([input]) => new URL(input as string).searchParams.get("q"));
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

type SearchProps = { query: string; bias?: LatLng | null };

function renderSearch(initialQuery: string, initialBias?: LatLng | null) {
  const initialProps: SearchProps = { query: initialQuery, bias: initialBias };
  return renderHook(({ query, bias }: SearchProps) => usePlaceSearch(query, bias), {
    wrapper,
    initialProps,
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const q = new URL(input as string).searchParams.get("q") ?? "";
    return new Response(photonBody(`${q} one`, `${q} two`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Not automatic here: vitest globals are off.
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  test("returns the first value at once and later values after the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" },
    });
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    act(() => void vi.advanceTimersByTime(249));
    expect(result.current).toBe("a");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("ab");
  });

  test("each change restarts the delay; only the last value comes through", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" },
    });
    for (const value of ["ab", "abc", "abcd"]) {
      rerender({ value });
      act(() => void vi.advanceTimersByTime(200));
      expect(result.current).toBe("a");
    }
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toBe("abcd");
  });

  test("no timer is left behind after unmount", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("usePlaceSearch", () => {
  test("a query shorter than three characters is idle and makes no request", async () => {
    const { result, rerender } = renderSearch("");
    expect(result.current).toEqual({
      suggestions: [],
      status: "idle",
      error: null,
      isFetching: false,
      isStale: false,
    });
    rerender({ query: "pa" });
    rerender({ query: "  pa  " });
    await pause(350);
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("searches once typing pauses, not on every keystroke", async () => {
    const { result, rerender } = renderSearch("");
    for (const query of ["p", "pa", "pac", "paci", "pacif", "pacific"]) {
      rerender({ query });
      await pause(30);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
    expect(result.current.isStale).toBe(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(queries(fetchMock)).toEqual(["pacific"]);
    expect(result.current.suggestions.map((s) => s.label)).toEqual(["pacific one", "pacific two"]);
    expect(result.current).toMatchObject({ isStale: false, isFetching: false, error: null });
  });

  test("the request carries no custom headers and can be aborted", async () => {
    const { result } = renderSearch("berlin");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?q=berlin&limit=6&lang=en$/);
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("keeps the previous suggestions, marked stale, while the next query loads", async () => {
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.suggestions;

    rerender({ query: "pacific ave" });
    expect(result.current.suggestions).toBe(first);
    expect(result.current.isStale).toBe(true);

    await waitFor(() => expect(result.current.isStale).toBe(false));
    expect(result.current.status).toBe("ready");
    expect(result.current.suggestions.map((s) => s.label)).toEqual([
      "pacific ave one",
      "pacific ave two",
    ]);
    expect(queries(fetchMock)).toEqual(["pacific", "pacific ave"]);
  });

  test("clearing the input clears the suggestions immediately", async () => {
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ query: "" });
    expect(result.current).toMatchObject({ suggestions: [], status: "idle", isStale: false });
    await pause(300);
    expect(result.current.suggestions).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("the same query again within five minutes is served from memory", async () => {
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ query: "pacific heights" });
    await waitFor(() => expect(result.current.suggestions[0]?.label).toBe("pacific heights one"));
    rerender({ query: "pacific" });
    await waitFor(() => expect(result.current.suggestions[0]?.label).toBe("pacific one"));
    await pause(50);
    expect(queries(fetchMock)).toEqual(["pacific", "pacific heights"]);
  });

  test("surrounding whitespace does not trigger a new search", async () => {
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ query: "pacific " });
    rerender({ query: "  pacific  " });
    await pause(300);
    expect(result.current).toMatchObject({ status: "ready", isStale: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("coordinates resolve to a suggestion without a request", async () => {
    const { result } = renderSearch("37.79, -122.43");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.suggestions).toEqual([
      expect.objectContaining({ lat: 37.79, lng: -122.43, detail: "Coordinates" }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("biases towards a coarse position; small pin moves do not refetch", async () => {
    const { result, rerender } = renderSearch("pacific", { lat: 37.7906, lng: -122.4294 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.get("lat")).toBe("37.8");
    expect(params.get("lon")).toBe("-122.4");

    rerender({ query: "pacific", bias: { lat: 37.7912, lng: -122.4301 } });
    await pause(50);
    expect(result.current.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("no bias: no lat/lon parameters", async () => {
    const { result } = renderSearch("pacific", null);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.has("lat")).toBe(false);
    expect(params.has("lon")).toBe(false);
  });

  test("reports failures", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    const { result } = renderSearch("pacific");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toContain("HTTP 503");
    expect(result.current.suggestions).toEqual([]);
  });

  test("typing on aborts the request that is no longer wanted", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(
      (input, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init!.signal!;
          signals.push(signal);
          const q = new URL(input as string).searchParams.get("q") ?? "";
          // Slower than the debounce, so the first request is still in flight when the query changes.
          const timer = setTimeout(() => resolve(new Response(photonBody(q))), 400);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ query: "pacific heights" });
    await waitFor(() => expect(result.current.suggestions[0]?.label).toBe("pacific heights"), {
      timeout: 3000,
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(result.current.status).toBe("ready");
  });
});
