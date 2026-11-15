// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LatLng } from "@/lib/types";
import { resetNominatimLimiter } from "./nominatim";
import { PHOTON_COOL_DOWN_MS, getPhotonHealth, resetPhotonHealth } from "./photonHealth";
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
  resetPhotonHealth();
  resetNominatimLimiter();
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
    expect(result.current).toMatchObject({
      suggestions: [],
      status: "idle",
      error: null,
      isFetching: false,
      isStale: false,
      mode: "live",
      awaitingSubmit: false,
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

// ─── When Photon cannot be reached ─────────────────────────────────────────

function nominatimBody(...names: string[]): string {
  return JSON.stringify(
    names.map((name, i) => ({
      place_id: 100 + i,
      osm_type: "way",
      osm_id: 100 + i,
      lat: String(40 + i),
      lon: String(-70 - i),
      name,
      address: { country: "Fallbackland" },
    })),
  );
}

type Handler = (url: URL) => Promise<Response>;

/** Answers per host; `calls.photon` / `calls.nominatim` list the queries each was asked. */
function services(photon: Handler, nominatim: Handler) {
  const calls = { photon: [] as string[], nominatim: [] as string[] };
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(input as string);
    const q = url.searchParams.get("q") ?? "";
    if (url.hostname === "photon.komoot.io") {
      calls.photon.push(q);
      return photon(url);
    }
    if (url.hostname === "nominatim.openstreetmap.org") {
      calls.nominatim.push(q);
      return nominatim(url);
    }
    throw new Error(`unexpected request to ${url.hostname}`);
  });
  return calls;
}

const photonDown: Handler = async () => {
  throw new TypeError("Failed to fetch");
};
const photonUp: Handler = async (url) =>
  new Response(photonBody(`${url.searchParams.get("q")} live`));
const nominatimUp: Handler = async (url) =>
  new Response(nominatimBody(`${url.searchParams.get("q")} found`));
const nominatimDown: Handler = async () => new Response("down", { status: 503 });

describe("usePlaceSearch — Photon down", () => {
  /** Type `query` with Photon failing, and wait until the hook has switched to submit mode. */
  async function intoSubmitMode(query: string, nominatim: Handler = nominatimUp) {
    const calls = services(photonDown, nominatim);
    const hook = renderSearch(query);
    await waitFor(() => expect(hook.result.current.mode).toBe("submit"), { timeout: 3000 });
    return { ...hook, calls };
  }

  test("a failed search is retried once, then the hook switches to submit mode — no error, no request", async () => {
    const { result, calls } = await intoSubmitMode("pacific");
    expect(calls.photon).toEqual(["pacific", "pacific"]);
    expect(getPhotonHealth()).toBe("down");
    expect(result.current).toMatchObject({
      mode: "submit",
      awaitingSubmit: true,
      status: "idle",
      suggestions: [],
      error: null,
      isFetching: false,
      isStale: false,
    });
    // The second service is not asked until the user submits.
    expect(calls.nominatim).toEqual([]);
  });

  test.each([
    ["HTTP 429", async () => new Response("slow down", { status: 429 })],
    ["HTTP 500", async () => new Response("oops", { status: 500 })],
    ["a blocked page instead of JSON", async () => new Response("<html>")],
  ] satisfies [string, Handler][])("%s from Photon also counts as down", async (_, photon) => {
    services(photon, nominatimUp);
    const { result } = renderSearch("pacific");
    await waitFor(() => expect(result.current.mode).toBe("submit"), { timeout: 3000 });
  });

  test("while down, typing sends nothing to either service", async () => {
    const { result, rerender, calls } = await intoSubmitMode("pacific");
    calls.photon.length = 0;
    for (const query of ["pacific ", "pacific h", "pacific he", "pacific heights"]) {
      rerender({ query });
      await pause(120);
    }
    await pause(400);
    expect(calls.photon).toEqual([]);
    expect(calls.nominatim).toEqual([]);
    expect(result.current).toMatchObject({ mode: "submit", awaitingSubmit: true, status: "idle" });
  });

  test("submit runs exactly one Nominatim search for the typed text", async () => {
    const { result, calls } = await intoSubmitMode("  pacific heights ");
    act(() => result.current.submit());
    expect(result.current).toMatchObject({ status: "loading", awaitingSubmit: false });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(calls.nominatim).toEqual(["pacific heights"]);
    expect(result.current.suggestions).toEqual([
      {
        id: "nominatim:W100",
        lat: 40,
        lng: -70,
        name: "pacific heights found, Fallbackland",
        label: "pacific heights found",
        detail: "Fallbackland",
      },
    ]);
    // Submitting the same text again asks nobody.
    act(() => result.current.submit());
    await pause(50);
    expect(calls.nominatim).toHaveLength(1);
  });

  test("editing the text clears the results until it is submitted again; going back uses the cache", async () => {
    const { result, rerender, calls } = await intoSubmitMode("pacific");
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ query: "pacific ave" });
    expect(result.current).toMatchObject({ status: "idle", awaitingSubmit: true, suggestions: [] });
    await pause(400);
    expect(calls.nominatim).toEqual(["pacific"]);

    rerender({ query: "pacific" });
    expect(result.current.status).toBe("ready");
    expect(result.current.suggestions[0].label).toBe("pacific found");
    expect(calls.nominatim).toEqual(["pacific"]);
  });

  test("submit does nothing below three characters and in live mode", async () => {
    const { result, rerender, calls } = await intoSubmitMode("pacific");
    rerender({ query: "pa" });
    expect(result.current).toMatchObject({ mode: "submit", awaitingSubmit: false, status: "idle" });
    act(() => result.current.submit());
    await pause(50);
    expect(calls.nominatim).toEqual([]);

    resetPhotonHealth();
    const live = services(photonUp, nominatimUp);
    const second = renderSearch("berlin");
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    act(() => second.result.current.submit());
    await pause(50);
    expect(live.nominatim).toEqual([]);
  });

  test("the bias goes along as a preferred box", async () => {
    services(photonDown, nominatimUp);
    const { result } = renderSearch("pacific", { lat: 37.7906, lng: -122.4294 });
    await waitFor(() => expect(result.current.mode).toBe("submit"), { timeout: 3000 });
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const url = new URL(fetchMock.mock.calls.at(-1)![0] as string);
    expect(url.hostname).toBe("nominatim.openstreetmap.org");
    // Around the coarse (~10 km) position, never the pin itself.
    expect(url.searchParams.get("viewbox")).toBe("-122.90,38.30,-121.90,37.30");
  });

  test("both down: an error that can be retried, with one request per try", async () => {
    const { result, calls } = await intoSubmitMode("pacific", nominatimDown);
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toContain("HTTP 503");
    expect(result.current).toMatchObject({
      mode: "submit",
      suggestions: [],
      awaitingSubmit: false,
    });
    expect(calls.nominatim).toEqual(["pacific"]);

    resetNominatimLimiter();
    act(() => result.current.retry());
    await waitFor(() => expect(calls.nominatim).toHaveLength(2));
    await waitFor(() => expect(result.current.status).toBe("error"));

    // Submitting again is another way to retry.
    resetNominatimLimiter();
    services(photonDown, nominatimUp);
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("coordinates still resolve at once, without any service", async () => {
    const { result, rerender, calls } = await intoSubmitMode("pacific");
    calls.photon.length = 0;
    rerender({ query: "37.79, -122.43" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.mode).toBe("live");
    expect(result.current.suggestions[0].id).toBe("coord:37.79000,-122.43000");
    expect(calls.photon).toEqual([]);
    expect(calls.nominatim).toEqual([]);
    expect(getPhotonHealth()).toBe("down");
  });

  test("an aborted request is not a failure", async () => {
    const calls = services(
      (url) =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(photonBody(url.searchParams.get("q") ?? ""))), 300);
        }),
      nominatimUp,
    );
    const { result, rerender } = renderSearch("pacific");
    await waitFor(() => expect(calls.photon).toHaveLength(1));
    rerender({ query: "pacific heights" });
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 3000 });
    expect(getPhotonHealth()).toBe("up");
    expect(result.current.mode).toBe("live");
  });

  describe("recovery", () => {
    test("after the cool-down the next keystroke probes Photon; a good answer brings live mode back", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { result, rerender } = await intoSubmitMode("pacific");

      // Still cooling down: a keystroke probes nothing.
      const recovered = services(photonUp, nominatimUp);
      vi.setSystemTime(Date.now() + PHOTON_COOL_DOWN_MS - 5000);
      rerender({ query: "pacific h" });
      await pause(400);
      expect(recovered.photon).toEqual([]);
      expect(result.current.mode).toBe("submit");

      vi.setSystemTime(Date.now() + 6000);
      rerender({ query: "pacific he" });
      expect(getPhotonHealth()).toBe("probing");
      // Until the probe answers the user still sees submit mode.
      expect(result.current).toMatchObject({ mode: "submit", awaitingSubmit: true });
      await waitFor(() => expect(result.current.mode).toBe("live"));
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(recovered.photon).toEqual(["pacific he"]);
      expect(recovered.nominatim).toEqual([]);
      expect(result.current.suggestions.map((s) => s.label)).toEqual(["pacific he live"]);
      expect(getPhotonHealth()).toBe("up");

      // And typing is live again.
      rerender({ query: "pacific heights" });
      await waitFor(() =>
        expect(result.current.suggestions[0]?.label).toBe("pacific heights live"),
      );
    });

    test("a probe that fails starts another cool-down, without ever showing an error", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { result, rerender, calls } = await intoSubmitMode("pacific");
      calls.photon.length = 0;
      const seen: string[] = [];
      vi.setSystemTime(Date.now() + PHOTON_COOL_DOWN_MS + 1);
      rerender({ query: "pacific h" });
      await waitFor(() => expect(getPhotonHealth()).toBe("probing"));
      await waitFor(
        () => {
          seen.push(result.current.status);
          expect(getPhotonHealth()).toBe("down");
        },
        { timeout: 3000 },
      );
      expect(seen).not.toContain("error");
      expect(result.current).toMatchObject({
        mode: "submit",
        awaitingSubmit: true,
        status: "idle",
      });
      expect(calls.photon.length).toBeGreaterThanOrEqual(1);

      // Cooling down again: more typing is silent.
      calls.photon.length = 0;
      rerender({ query: "pacific he" });
      await pause(400);
      expect(calls.photon).toEqual([]);
    });

    test("results found by submitting stay usable while the probe runs", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { result } = await intoSubmitMode("pacific");
      act(() => result.current.submit());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.suggestions[0].label).toBe("pacific found");
    });
  });
});
