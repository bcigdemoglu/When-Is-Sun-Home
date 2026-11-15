import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import type { BuildingCollection } from "@/lib/types";
import {
  BUILDINGS_API_TIMEOUT_MS,
  BuildingsApiError,
  buildingsApiUrl,
  fetchBuildingsFromApi,
  parseBuildingCollection,
} from "./api";
import { isAbortError, parseOverpassResponse } from "./overpass";

const KEY = "v3:37.791:-122.4300";

function feature(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    properties: { id, heightM: 9, heightSource: "tagged", levels: null, kind: "yes" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0.001, 0],
          [0.001, 0.001],
          [0, 0],
        ],
      ],
    },
    ...overrides,
  };
}

function collection(...features: unknown[]) {
  return { type: "FeatureCollection", features };
}

function fetchReturning(body: unknown, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 200,
        ...init,
      }),
  );
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("parseBuildingCollection", () => {
  test("accepts what parseOverpassResponse produces, unchanged", () => {
    for (const name of ["pacific-heights.overpass.json", "overpass-relations.json"]) {
      const raw = JSON.parse(
        readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8"),
      );
      const parsed = parseOverpassResponse(raw);
      // Through JSON, as it travels from the route to the browser.
      const received = parseBuildingCollection(JSON.parse(JSON.stringify(parsed)));
      expect(received).toEqual(parsed);
    }
  });

  test("an empty collection is valid", () => {
    expect(parseBuildingCollection(collection())).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("keeps names, drops unknown extras", () => {
    const named = feature("way/1");
    Object.assign(named.properties, { name: "Hall", secret: 1 });
    const result = parseBuildingCollection({ ...collection(named), bbox: [0, 0, 1, 1] });
    expect(result).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: "way/1",
            heightM: 9,
            heightSource: "tagged",
            levels: null,
            kind: "yes",
            name: "Hall",
          },
          geometry: named.geometry,
        },
      ],
    });
    expect(
      "name" in parseBuildingCollection(collection(feature("way/2"))).features[0].properties,
    ).toBe(false);
  });

  test("unusable features are dropped, usable ones kept", () => {
    const good = feature("way/1");
    const multi = feature("relation/2", {
      geometry: { type: "MultiPolygon", coordinates: [good.geometry.coordinates] },
    });
    const bad = [
      null,
      "feature",
      {},
      feature("way/3", { type: "Thing" }),
      feature("", {}),
      { ...feature("way/4"), properties: { id: "way/4" } },
      { ...feature("way/5"), properties: { ...good.properties, heightM: 0 } },
      { ...feature("way/6"), properties: { ...good.properties, heightM: "9" } },
      { ...feature("way/7"), properties: { ...good.properties, heightSource: "measured" } },
      { ...feature("way/8"), properties: { ...good.properties, levels: undefined } },
      { ...feature("way/9"), properties: { ...good.properties, kind: 3 } },
      feature("way/10", { geometry: { type: "Point", coordinates: [0, 0] } }),
      feature("way/11", { geometry: { type: "Polygon", coordinates: [] } }),
      feature("way/12", {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      }),
      feature("way/13", {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, "1"],
              [1, 0],
              [0, 0],
            ],
          ],
        },
      }),
      feature("way/14", { geometry: null }),
    ];
    const result = parseBuildingCollection(collection(good, ...bad, multi));
    expect(result.features.map((f) => f.properties.id)).toEqual(["way/1", "relation/2"]);
  });

  test.each([
    ["null", null],
    ["a string", "<html>"],
    ["an array", []],
    ["an object of another shape", { elements: [] }],
    ["a raw Overpass document", { version: 0.6, elements: [{ type: "way", id: 1 }] }],
    ["another GeoJSON type", { type: "Feature", features: [] }],
    ["features that are not a list", { type: "FeatureCollection", features: {} }],
    ["only unusable features", collection({}, null, feature(""))],
  ])("rejects %s as malformed", (_, json) => {
    let error: unknown;
    try {
      parseBuildingCollection(json);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BuildingsApiError);
    expect((error as BuildingsApiError).kind).toBe("malformed");
  });
});

describe("fetchBuildingsFromApi", () => {
  test("GETs the same-origin route with the encoded key and nothing else", async () => {
    const fetchImpl = fetchReturning(collection(feature("way/1")));
    const result = await fetchBuildingsFromApi(KEY, { fetchImpl });
    expect(result.features.map((f) => f.properties.id)).toEqual(["way/1"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/buildings?area=v3%3A37.791%3A-122.4300");
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("buildingsApiUrl: base URL for scripts, trailing slashes ignored", () => {
    expect(buildingsApiUrl(KEY)).toBe("/api/buildings?area=v3%3A37.791%3A-122.4300");
    expect(buildingsApiUrl(KEY, "https://preview.example.app///")).toBe(
      "https://preview.example.app/api/buildings?area=v3%3A37.791%3A-122.4300",
    );
    // The key the server sees is the key we sent.
    expect(new URL(buildingsApiUrl(KEY, "https://x.test")).searchParams.get("area")).toBe(KEY);
  });

  test("baseUrl and reload are passed on", async () => {
    const fetchImpl = fetchReturning(collection());
    await fetchBuildingsFromApi(KEY, {
      fetchImpl,
      baseUrl: "https://preview.example.app",
      reload: true,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://preview.example.app/api/buildings?area=v3%3A37.791%3A-122.4300");
    expect(init?.cache).toBe("reload");
  });

  test.each([
    [400, "bad-request"],
    [401, "http"],
    [404, "http"],
    [429, "http"],
    [500, "http"],
    [502, "http"],
    [504, "http"],
  ] as const)("HTTP %d → %s, with the route's message", async (status, kind) => {
    const fetchImpl = fetchReturning({ error: "x", message: "Overpass said no" }, { status });
    const error = await failure(fetchBuildingsFromApi(KEY, { fetchImpl }));
    expect(error).toBeInstanceOf(BuildingsApiError);
    expect(error).toMatchObject({ kind, status });
    expect((error as Error).message).toBe(
      `The buildings service answered HTTP ${status}: Overpass said no`,
    );
  });

  test("an error page that is not JSON still gives a clean message", async () => {
    const fetchImpl = fetchReturning("<html><body>Authentication required</body></html>", {
      status: 401,
    });
    const error = await failure(fetchBuildingsFromApi(KEY, { fetchImpl }));
    expect((error as Error).message).toBe("The buildings service answered HTTP 401");
  });

  test.each([
    ["HTML with status 200", "<!doctype html><title>App</title>"],
    ["an empty body", ""],
    ["truncated JSON", '{"type":"FeatureCollection","features":[{"type":"Fe'],
    ["JSON of another shape", '{"ok":true}'],
  ])("%s → malformed", async (_, body) => {
    const error = await failure(fetchBuildingsFromApi(KEY, { fetchImpl: fetchReturning(body) }));
    expect(error).toBeInstanceOf(BuildingsApiError);
    expect(error).toMatchObject({ kind: "malformed" });
  });

  test("a network failure → network, with its cause", async () => {
    const cause = new TypeError("Failed to fetch");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw cause;
    });
    const error = await failure(fetchBuildingsFromApi(KEY, { fetchImpl }));
    expect(error).toBeInstanceOf(BuildingsApiError);
    expect(error).toMatchObject({ kind: "network", cause });
  });

  /** A fetch that never answers but honours its abort signal, like the real one. */
  function hangingFetch() {
    return vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
  }

  test("gives up after 28 seconds", async () => {
    expect(BUILDINGS_API_TIMEOUT_MS).toBe(28_000);
    vi.useFakeTimers();
    try {
      const fetchImpl = hangingFetch();
      const pending = failure(fetchBuildingsFromApi(KEY, { fetchImpl }));
      await vi.advanceTimersByTimeAsync(27_999);
      expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error).toBeInstanceOf(BuildingsApiError);
      expect(error).toMatchObject({ kind: "timeout" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the timeout also covers a body that stalls", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      });
      return new Response(body);
    });
    const error = await failure(fetchBuildingsFromApi(KEY, { fetchImpl, timeoutMs: 10 }));
    expect(error).toMatchObject({ kind: "timeout" });
  });

  test("an abort by the caller rejects with AbortError, not a BuildingsApiError", async () => {
    const fetchImpl = hangingFetch();
    const controller = new AbortController();
    const pending = failure(fetchBuildingsFromApi(KEY, { fetchImpl, signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(BuildingsApiError);
    expect(isAbortError(error)).toBe(true);
    expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  test("an already-aborted signal makes no request", async () => {
    const fetchImpl = fetchReturning(collection());
    const error = await failure(
      fetchBuildingsFromApi(KEY, { fetchImpl, signal: AbortSignal.abort() }),
    );
    expect(isAbortError(error)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("leaves no timer or listener behind", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const result: BuildingCollection = await fetchBuildingsFromApi(KEY, {
        fetchImpl: fetchReturning(collection()),
        signal: controller.signal,
      });
      expect(result.features).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});
