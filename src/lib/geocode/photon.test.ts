import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GeocoderTimeoutError } from "./net";
import { resetNominatimLimiter } from "./nominatim";
import {
  PHOTON_REVERSE_TIMEOUT_MS,
  PHOTON_SEARCH_TIMEOUT_MS,
  parseCoordinates,
  reverseGeocode,
  searchPlaces,
} from "./photon";
import { PHOTON_COOL_DOWN_MS, getPhotonHealth, resetPhotonHealth } from "./photonHealth";

beforeEach(() => {
  resetPhotonHealth();
  resetNominatimLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Responses captured from photon.komoot.io. */
function captured(name: string): string {
  return readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8");
}

function fetchReturning(body: string, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status: 200, ...init }));
}

function feature(properties: Record<string, unknown>, coordinates: unknown = [13.4, 52.5]) {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates } };
}

function collectionOf(...features: unknown[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

describe("parseCoordinates", () => {
  test.each([
    ["37.79, -122.43", 37.79, -122.43],
    ["37.79,-122.43", 37.79, -122.43],
    ["  37.79 ,  -122.43  ", 37.79, -122.43],
    ["37.79; -122.43", 37.79, -122.43],
    ["37.79 -122.43", 37.79, -122.43],
    ["-33.8568, 151.2153", -33.8568, 151.2153],
    ["+48.85, +2.35", 48.85, 2.35],
    ["0, 0", 0, 0],
    ["90, 180", 90, 180],
    ["-90, -180", -90, -180],
    ["52, 13", 52, 13],
  ])("%j → %d, %d", (input, lat, lng) => {
    expect(parseCoordinates(input)).toEqual({ lat, lng });
  });

  test.each([
    [""],
    ["berlin"],
    ["37.79"],
    ["37.79,"],
    ["91, 0"],
    ["-90.01, 0"],
    ["0, 180.5"],
    ["0, -181"],
    ["12 34"],
    ["2140 37.5"],
    ["1, 2, 3"],
    ["37.79, -122.43 foo"],
    ["12 Main St, 5"],
    ["1e2, 3"],
    ["NaN, NaN"],
  ])("not coordinates: %j", (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });
});

describe("searchPlaces", () => {
  test("coordinates resolve locally, without a request", async () => {
    const fetchImpl = fetchReturning("{}");
    expect(await searchPlaces(" 37.79, -122.43 ", { fetchImpl })).toEqual([
      {
        id: "coord:37.79000,-122.43000",
        lat: 37.79,
        lng: -122.43,
        name: "37.79000, -122.43000",
        label: "37.79000, -122.43000",
        detail: "Coordinates",
      },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("out-of-range numbers are searched as text", async () => {
    const fetchImpl = fetchReturning(collectionOf());
    expect(await searchPlaces("91, 200", { fetchImpl })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("an empty query resolves to nothing, without a request", async () => {
    const fetchImpl = fetchReturning("{}");
    expect(await searchPlaces("   ", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("requests Photon with the query, a limit and English labels", async () => {
    const fetchImpl = fetchReturning(collectionOf());
    await searchPlaces("  2140 Pacific Ave & Co  ", { fetchImpl });
    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(input as string);
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "2140 Pacific Ave & Co",
      limit: "6",
      lang: "en",
    });
    expect(input).toContain("q=2140+Pacific+Ave+%26+Co");
    // A plain GET with no custom headers (no forbidden User-Agent, no preflight).
    // Nothing but a signal (for the deadline): no headers, so it stays a CORS "simple request".
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
    expect(init?.signal?.aborted).toBe(false);
  });

  test("passes limit, bias and the abort signal", async () => {
    const fetchImpl = fetchReturning(collectionOf());
    const controller = new AbortController();
    await searchPlaces("pacific", {
      fetchImpl,
      limit: 3,
      bias: { lat: 37.8, lng: -122.4 },
      signal: controller.signal,
    });
    const [input, init] = fetchImpl.mock.calls[0];
    const params = new URL(input as string).searchParams;
    expect(params.get("limit")).toBe("3");
    expect(params.get("lat")).toBe("37.8");
    expect(params.get("lon")).toBe("-122.4");
    expect(init?.signal?.aborted).toBe(false);
  });

  test("gives up after the deadline with a timeout error, and aborts the request", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = searchPlaces("pacific", { fetchImpl });
    const outcome = expect(pending).rejects.toBeInstanceOf(GeocoderTimeoutError);
    await vi.advanceTimersByTimeAsync(PHOTON_SEARCH_TIMEOUT_MS);
    await outcome;
    expect(requestSignal?.aborted).toBe(true);
  });

  test("an abort by the caller is an abort, not a timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = searchPlaces("pacific", { fetchImpl, signal: controller.signal });
    const requestSignal = fetchImpl.mock.calls[0][1]?.signal;
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The request itself was cancelled, not just abandoned.
    expect(requestSignal?.aborted).toBe(true);
    // Already aborted: no request at all.
    fetchImpl.mockClear();
    await expect(
      searchPlaces("pacific", { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("parses a captured address search", async () => {
    const suggestions = await searchPlaces("2140 pacific ave", {
      fetchImpl: fetchReturning(captured("photon-search.json")),
    });
    expect(suggestions).toHaveLength(4);
    expect(suggestions[0]).toEqual({
      id: "W259269865",
      // Photon's coordinates are [lon, lat].
      lat: 37.7941524,
      lng: -122.4305674,
      label: "2140 Pacific Avenue",
      detail: "San Francisco, California, United States",
      name: "2140 Pacific Avenue, San Francisco, California, United States",
    });
    expect(suggestions.map((s) => [s.label, s.detail])).toEqual([
      ["2140 Pacific Avenue", "San Francisco, California, United States"],
      ["2140 Pacific Avenue", "Alameda, California, United States"],
      ["2140 Pacific Avenue", "Tacoma, Washington, United States"],
      ["Columbia Pacific Maritime School", "2140 Newmark Avenue, Coos Bay, Oregon, United States"],
    ]);
    for (const suggestion of suggestions) {
      expect(suggestion.name).toBe(`${suggestion.label}, ${suggestion.detail}`);
      expect(suggestion.name).not.toMatch(/undefined|, ,|^,|,\s*$/);
    }
  });

  test("the same OSM object listed twice yields one suggestion", async () => {
    const suggestions = await searchPlaces("2500 pacific", {
      fetchImpl: fetchReturning(captured("photon-search-duplicates.json")),
    });
    expect(suggestions.map((s) => s.id)).toEqual(["W847908673", "W742353543"]);
    expect(suggestions[0].label).toBe("San Francisco RV Resort");
    expect(suggestions[0].detail).toBe("700 Palmetto Ave, Pacifica, California, United States");
  });

  test("places without an address: cities", async () => {
    const suggestions = await searchPlaces("berlin", {
      fetchImpl: fetchReturning(captured("photon-city.json")),
    });
    expect(suggestions.map((s) => [s.label, s.detail, s.name])).toEqual([
      ["Berlin", "Germany", "Berlin, Germany"],
      [
        "Berlin",
        "Coos, New Hampshire, United States",
        "Berlin, Coos, New Hampshire, United States",
      ],
    ]);
    expect(suggestions[0]).toMatchObject({ id: "R62422", lat: 52.5173885, lng: 13.3951309 });
  });

  test("repeated and empty parts are dropped from the detail line", async () => {
    const suggestions = await searchPlaces("xyz", {
      fetchImpl: fetchReturning(
        collectionOf(
          feature({
            osm_type: "R",
            osm_id: 1,
            name: "Hamburg",
            city: "Hamburg",
            state: "Hamburg",
            country: "Germany",
          }),
          feature({ osm_type: "N", osm_id: 2, name: "Luxembourg", country: "Luxembourg" }),
          feature({
            osm_type: "N",
            osm_id: 3,
            name: " Café ",
            street: "",
            city: "  ",
            state: "Bavaria",
            country: "Germany",
          }),
          feature({ osm_type: "W", osm_id: 4, street: "Main Street", city: "Springfield" }),
        ),
      ),
    });
    expect(suggestions.map((s) => [s.label, s.detail, s.name])).toEqual([
      ["Hamburg", "Germany", "Hamburg, Germany"],
      ["Luxembourg", "", "Luxembourg"],
      ["Café", "Bavaria, Germany", "Café, Bavaria, Germany"],
      ["Main Street", "Springfield", "Main Street, Springfield"],
    ]);
  });

  test("house number placement follows the country's convention", async () => {
    const suggestions = await searchPlaces("xyz", {
      fetchImpl: fetchReturning(
        collectionOf(
          feature({
            osm_type: "N",
            osm_id: 1,
            housenumber: "12",
            street: "Hauptstraße",
            city: "Berlin",
            countrycode: "DE",
          }),
          feature({
            osm_type: "N",
            osm_id: 2,
            housenumber: "12",
            street: "High Street",
            city: "Leeds",
            countrycode: "GB",
          }),
          feature({ osm_type: "N", osm_id: 3, housenumber: "12", street: "Some Road" }),
        ),
      ),
    });
    expect(suggestions.map((s) => s.label)).toEqual([
      "Hauptstraße 12",
      "12 High Street",
      "12 Some Road",
    ]);
  });

  test("unusable features are skipped, the rest survive", async () => {
    const suggestions = await searchPlaces("xyz", {
      fetchImpl: fetchReturning(
        collectionOf(
          null,
          "feature",
          {},
          { type: "Feature", properties: { name: "No geometry" } },
          feature({ name: "Bad coordinates" }, ["13.4", "52.5"]),
          feature({ name: "Short coordinates" }, [13.4]),
          feature({ name: "Off the planet" }, [13.4, 123]),
          feature({}),
          feature({
            osm_type: "N",
            osm_id: "not-a-number",
            name: 42,
            city: "Springfield",
            extent: "odd",
          }),
          feature({ osm_type: "N", osm_id: 9, name: "Good", extra: { anything: 1 } }, [1, 2, 300]),
          { type: "Feature", geometry: { type: "Point", coordinates: [5, 6] } },
        ),
      ),
    });
    expect(suggestions).toEqual([
      // Wrongly typed fields count as missing rather than rejecting the feature.
      {
        id: "52.5,13.4",
        lat: 52.5,
        lng: 13.4,
        label: "Springfield",
        detail: "",
        name: "Springfield",
      },
      { id: "N9", lat: 2, lng: 1, label: "Good", detail: "", name: "Good" },
    ]);
  });

  test.each([400, 429, 500, 503])("HTTP %d rejects", async (status) => {
    const fetchImpl = fetchReturning('{"message":"nope"}', { status });
    await expect(searchPlaces("berlin", { fetchImpl })).rejects.toThrow(`HTTP ${status}`);
  });

  test("an unexpected body rejects", async () => {
    await expect(
      searchPlaces("berlin", { fetchImpl: fetchReturning('{"message":"q is required"}') }),
    ).rejects.toThrow(/unexpected response/);
    await expect(searchPlaces("berlin", { fetchImpl: fetchReturning("<html>") })).rejects.toThrow();
  });

  test("network errors and aborts propagate", async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(searchPlaces("berlin", { fetchImpl: offline })).rejects.toThrow("Failed to fetch");

    const aborting = vi.fn<typeof fetch>(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(searchPlaces("berlin", { fetchImpl: aborting })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("uses the global fetch by default", async () => {
    const globalFetch = fetchReturning(captured("photon-city.json"));
    vi.stubGlobal("fetch", globalFetch);
    try {
      expect(await searchPlaces("berlin")).toHaveLength(2);
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("reverseGeocode", () => {
  test("requests Photon's reverse endpoint with lat and lon", async () => {
    const fetchImpl = fetchReturning(captured("photon-reverse.json"));
    const controller = new AbortController();
    const label = await reverseGeocode(
      { lat: 37.7906, lng: -122.4294 },
      { fetchImpl, signal: controller.signal },
    );
    expect(label).toBe("2200 Sacramento Street, San Francisco");

    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(input as string);
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/reverse");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "37.7906",
      lon: "-122.4294",
      lang: "en",
    });
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
  });

  test("sends the position rounded to four decimals (about 11 m), never the exact fix", async () => {
    const fetchImpl = fetchReturning(captured("photon-reverse.json"));
    // A GPS fix as the browser reports it, and a pin dropped on the map.
    for (const [place, lat, lon] of [
      [{ lat: 37.790612345678901, lng: -122.42943987654321 }, "37.7906", "-122.4294"],
      [{ lat: 52.37305999999999, lng: 4.892249999999 }, "52.3731", "4.8922"],
      [{ lat: -33.85678, lng: 151.21534 }, "-33.8568", "151.2153"],
      [{ lat: 1, lng: 2 }, "1.0000", "2.0000"],
    ] as const) {
      fetchImpl.mockClear();
      await reverseGeocode(place, { fetchImpl });
      const sent = String(fetchImpl.mock.calls[0][0]);
      const params = new URL(sent).searchParams;
      expect(params.get("lat")).toBe(lat);
      expect(params.get("lon")).toBe(lon);
      // Nothing else in the request carries more digits.
      expect(sent).not.toMatch(/\d\.\d{5,}/);
    }
  });

  test.each([
    [
      { name: "Golden Gate Park", city: "San Francisco", state: "California" },
      "Golden Gate Park, San Francisco",
    ],
    [{ street: "Lombard Street", city: "San Francisco" }, "Lombard Street, San Francisco"],
    [
      { housenumber: "5", street: "Unter den Linden", city: "Berlin", countrycode: "DE" },
      "Unter den Linden 5, Berlin",
    ],
    [{ name: "Berlin", city: "Berlin", country: "Germany" }, "Berlin"],
    [{ locality: "Japantown", state: "California" }, "Japantown"],
    [{ state: "Nevada", country: "United States" }, "Nevada, United States"],
  ])("labels %j as %j", async (properties, expected) => {
    const fetchImpl = fetchReturning(collectionOf(feature(properties)));
    expect(await reverseGeocode({ lat: 1, lng: 2 }, { fetchImpl })).toBe(expected);
  });

  test("skips features it cannot label", async () => {
    const fetchImpl = fetchReturning(
      collectionOf(null, feature({}), feature({ street: "Second Street", city: "Town" })),
    );
    expect(await reverseGeocode({ lat: 1, lng: 2 }, { fetchImpl })).toBe("Second Street, Town");
  });

  test("null when nothing is found", async () => {
    expect(
      await reverseGeocode({ lat: 0, lng: 0 }, { fetchImpl: fetchReturning(collectionOf()) }),
    ).toBeNull();
  });

  test("null on any failure, never a rejection", async () => {
    const failures: (typeof fetch)[] = [
      fetchReturning("server error", { status: 500 }),
      fetchReturning("not json"),
      fetchReturning('{"unexpected":true}'),
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
      vi.fn<typeof fetch>(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    ];
    for (const fetchImpl of failures) {
      resetPhotonHealth();
      resetNominatimLimiter();
      await expect(reverseGeocode({ lat: 1, lng: 2 }, { fetchImpl })).resolves.toBeNull();
    }
  });

  test("null for a non-finite position, without a request", async () => {
    const fetchImpl = fetchReturning(collectionOf());
    expect(await reverseGeocode({ lat: Number.NaN, lng: 2 }, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reverseGeocode — the second path", () => {
  const PLACE = { lat: 37.793012, lng: -122.439387 };
  const NOMINATIM_REVERSE = readFileSync(
    new URL("./__fixtures__/nominatim-reverse.json", import.meta.url),
    "utf8",
  );

  /** A fetch that answers per host, and remembers which hosts were asked, in order. */
  function hosts(handlers: {
    photon: () => Promise<Response>;
    nominatim?: () => Promise<Response>;
  }) {
    const asked: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const host = new URL(input as string).hostname;
      asked.push(host);
      if (host === "photon.komoot.io") return handlers.photon();
      if (host === "nominatim.openstreetmap.org" && handlers.nominatim) return handlers.nominatim();
      throw new Error(`unexpected request to ${host}`);
    });
    return { fetchImpl, asked };
  }
  const ok = (body: string) => async () => new Response(body);
  const status = (code: number) => async () => new Response("no", { status: code });
  const networkError = async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  };

  test.each([
    ["a network / CORS failure", networkError],
    ["HTTP 429 (throttled)", status(429)],
    ["HTTP 503", status(503)],
    ["a response that is not JSON", ok("<html>blocked</html>")],
    ["a response of the wrong shape", ok('{"message":"rate limited"}')],
  ])("after %s from Photon, Nominatim is asked — once", async (_, photon) => {
    const { fetchImpl, asked } = hosts({ photon, nominatim: ok(NOMINATIM_REVERSE) });
    expect(await reverseGeocode(PLACE, { fetchImpl })).toBe("2698 Pacific Avenue, San Francisco");
    expect(asked).toEqual(["photon.komoot.io", "nominatim.openstreetmap.org"]);
    const params = new URL(fetchImpl.mock.calls[1][0] as string).searchParams;
    // The same rounding as for Photon: about 11 m, never the exact pin.
    expect(params.get("lat")).toBe("37.7930");
    expect(params.get("lon")).toBe("-122.4394");
    expect(getPhotonHealth()).toBe("down");
  });

  test("a Photon that does not answer in time counts as failed", async () => {
    vi.useFakeTimers();
    const { fetchImpl, asked } = hosts({
      photon: () => new Promise<Response>(() => {}),
      nominatim: ok(NOMINATIM_REVERSE),
    });
    const pending = reverseGeocode(PLACE, { fetchImpl });
    await vi.advanceTimersByTimeAsync(PHOTON_REVERSE_TIMEOUT_MS - 1);
    expect(asked).toEqual(["photon.komoot.io"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("2698 Pacific Avenue, San Francisco");
    expect(asked).toEqual(["photon.komoot.io", "nominatim.openstreetmap.org"]);
  });

  test("a clean “nothing here” from Photon is an answer: no second request", async () => {
    const { fetchImpl, asked } = hosts({ photon: ok(collectionOf()) });
    expect(await reverseGeocode(PLACE, { fetchImpl })).toBeNull();
    expect(asked).toEqual(["photon.komoot.io"]);
    expect(getPhotonHealth()).toBe("up");
  });

  test("a Photon answer is used as is: Nominatim is never asked", async () => {
    const { fetchImpl, asked } = hosts({ photon: ok(captured("photon-reverse.json")) });
    expect(await reverseGeocode(PLACE, { fetchImpl })).toBe(
      "2200 Sacramento Street, San Francisco",
    );
    expect(asked).toEqual(["photon.komoot.io"]);
  });

  test("an aborted lookup does not fall back", async () => {
    const controller = new AbortController();
    const { fetchImpl, asked } = hosts({
      photon: () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      nominatim: ok(NOMINATIM_REVERSE),
    });
    const pending = reverseGeocode(PLACE, { fetchImpl, signal: controller.signal });
    controller.abort();
    expect(await pending).toBeNull();
    expect(asked).toEqual(["photon.komoot.io"]);
    expect(getPhotonHealth()).toBe("up");

    // Aborted before it began: nobody is asked.
    asked.length = 0;
    expect(await reverseGeocode(PLACE, { fetchImpl, signal: controller.signal })).toBeNull();
    expect(asked).toEqual([]);
  });

  test("aborting while the second service is being asked ends quietly", async () => {
    const controller = new AbortController();
    const { fetchImpl, asked } = hosts({
      photon: networkError,
      nominatim: () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const pending = reverseGeocode(PLACE, { fetchImpl, signal: controller.signal });
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    controller.abort();
    expect(await pending).toBeNull();
  });

  test("both down: null, never a rejection", async () => {
    const { fetchImpl, asked } = hosts({ photon: networkError, nominatim: status(503) });
    expect(await reverseGeocode(PLACE, { fetchImpl })).toBeNull();
    expect(asked).toEqual(["photon.komoot.io", "nominatim.openstreetmap.org"]);
  });

  test("while Photon is known to be down it is left alone; after the cool-down it is tried again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = hosts({ photon: networkError, nominatim: ok(NOMINATIM_REVERSE) });
    await reverseGeocode(PLACE, { fetchImpl: first.fetchImpl });
    expect(getPhotonHealth()).toBe("down");

    vi.setSystemTime(Date.now() + 5000);
    const during = hosts({
      photon: ok(captured("photon-reverse.json")),
      nominatim: ok(NOMINATIM_REVERSE),
    });
    expect(await reverseGeocode(PLACE, { fetchImpl: during.fetchImpl })).toBe(
      "2698 Pacific Avenue, San Francisco",
    );
    expect(during.asked).toEqual(["nominatim.openstreetmap.org"]);

    vi.setSystemTime(Date.now() + PHOTON_COOL_DOWN_MS);
    const after = hosts({ photon: ok(captured("photon-reverse.json")) });
    expect(await reverseGeocode(PLACE, { fetchImpl: after.fetchImpl })).toBe(
      "2200 Sacramento Street, San Francisco",
    );
    expect(after.asked).toEqual(["photon.komoot.io"]);
    expect(getPhotonHealth()).toBe("up");
  });
});
