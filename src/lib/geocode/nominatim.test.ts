import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  NOMINATIM_MIN_INTERVAL_MS,
  NOMINATIM_TIMEOUT_MS,
  createRateLimiter,
  resetNominatimLimiter,
  reverseGeocodeNominatim,
  searchPlacesNominatim,
} from "./nominatim";

/** Responses captured from nominatim.openstreetmap.org (one request per endpoint). */
function captured(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function fetchReturning(body: string, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status: 200, ...init }));
}

function item(address: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    place_id: 1,
    osm_type: "node",
    osm_id: 42,
    lat: "52.5",
    lon: "13.4",
    name: "",
    address,
    ...extra,
  };
}

const listOf = (...items: unknown[]) => JSON.stringify(items);
const urlOf = (mock: ReturnType<typeof fetchReturning>, call = 0) =>
  new URL(mock.mock.calls[call][0] as string);

beforeEach(() => {
  resetNominatimLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("searchPlacesNominatim", () => {
  test("requests the search endpoint with jsonv2, address details, a limit and English labels", async () => {
    const fetchImpl = fetchReturning("[]");
    expect(await searchPlacesNominatim("  2550 pacific ave  ", { fetchImpl })).toEqual([]);
    const url = urlOf(fetchImpl);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2",
      addressdetails: "1",
      limit: "6",
      q: "2550 pacific ave",
      "accept-language": "en",
    });
    // No custom headers: the browser's Referer identifies the app, as the policy asks.
    expect(Object.keys(fetchImpl.mock.calls[0][1] ?? {})).toEqual(["signal"]);
  });

  test("an empty query resolves to nothing without a request", async () => {
    const fetchImpl = fetchReturning("[]");
    expect(await searchPlacesNominatim("   ", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a bias becomes a preferred box, never a filter", async () => {
    const fetchImpl = fetchReturning("[]");
    await searchPlacesNominatim("pacific", {
      fetchImpl,
      limit: 3,
      bias: { lat: 37.8, lng: -122.4 },
    });
    const params = urlOf(fetchImpl).searchParams;
    expect(params.get("limit")).toBe("3");
    // left,top,right,bottom
    expect(params.get("viewbox")).toBe("-122.90,38.30,-121.90,37.30");
    expect(params.has("bounded")).toBe(false);
  });

  test("the box stays on the globe, and a broken bias is ignored", async () => {
    const fetchImpl = fetchReturning("[]");
    await searchPlacesNominatim("x y z", { fetchImpl, bias: { lat: 89.9, lng: 179.9 } });
    expect(urlOf(fetchImpl).searchParams.get("viewbox")).toBe("179.40,90.00,180.00,89.40");
    resetNominatimLimiter();
    await searchPlacesNominatim("x y z", { fetchImpl, bias: { lat: Number.NaN, lng: 1 } });
    expect(urlOf(fetchImpl, 1).searchParams.has("viewbox")).toBe(false);
  });

  test("parses a captured address search into the same shape as Photon's", async () => {
    const suggestions = await searchPlacesNominatim("2550 Pacific Avenue San Francisco", {
      fetchImpl: fetchReturning(captured("nominatim-search.json")),
    });
    expect(suggestions).toEqual([
      {
        id: "nominatim:W468450103",
        lat: 37.7931118,
        lng: -122.4372316,
        name: "2550 Pacific Avenue, San Francisco, California, United States",
        label: "2550 Pacific Avenue",
        detail: "San Francisco, California, United States",
      },
    ]);
  });

  test.each([
    [
      "a named place",
      item(
        {
          road: "Telegraph Hill Boulevard",
          city: "San Francisco",
          state: "California",
          country: "United States",
          country_code: "us",
        },
        { name: "Coit Tower" },
      ),
      "Coit Tower",
      "Telegraph Hill Boulevard, San Francisco, California, United States",
    ],
    [
      "a street (its name is not repeated)",
      item(
        {
          road: "Lombard Street",
          city: "San Francisco",
          state: "California",
          country: "United States",
        },
        { name: "Lombard Street" },
      ),
      "Lombard Street",
      "San Francisco, California, United States",
    ],
    [
      "a German address (number after the street)",
      item({
        house_number: "5",
        road: "Unter den Linden",
        suburb: "Mitte",
        city: "Berlin",
        country: "Germany",
        country_code: "de",
      }),
      "Unter den Linden 5",
      "Berlin, Germany",
    ],
    [
      "a town instead of a city",
      item({
        house_number: "12",
        road: "High Street",
        town: "Lewes",
        state: "England",
        country: "United Kingdom",
        country_code: "gb",
      }),
      "12 High Street",
      "Lewes, England, United Kingdom",
    ],
    [
      "a village with no state",
      item({ village: "Hallstatt", country: "Austria", country_code: "at" }, { name: "Hallstatt" }),
      "Hallstatt",
      "Austria",
    ],
    [
      "a footpath in a suburb",
      item({ pedestrian: "Rambla de Catalunya", suburb: "Eixample", country: "Spain" }),
      "Rambla de Catalunya",
      "Eixample, Spain",
    ],
    [
      "a country",
      item({ country: "Iceland", country_code: "is" }, { name: "Iceland" }),
      "Iceland",
      "",
    ],
  ])("labels %s like Photon would", async (_, raw, label, detail) => {
    const [suggestion] = await searchPlacesNominatim("anything", {
      fetchImpl: fetchReturning(listOf(raw)),
    });
    expect(suggestion).toMatchObject({ label, detail });
    expect(suggestion.name).toBe(detail ? `${label}, ${detail}` : label);
  });

  test("ids name the service and the OSM object, with fallbacks", async () => {
    const suggestions = await searchPlacesNominatim("anything", {
      fetchImpl: fetchReturning(
        listOf(
          item({ city: "A" }, { osm_type: "relation", osm_id: 7 }),
          item({ city: "B" }, { osm_type: undefined, osm_id: undefined, place_id: 99 }),
          item({ city: "C" }, { osm_type: undefined, osm_id: undefined, place_id: undefined }),
        ),
      ),
    });
    expect(suggestions.map((s) => s.id)).toEqual([
      "nominatim:R7",
      "nominatim:P99",
      "nominatim:52.5,13.4",
    ]);
  });

  test("skips entries it cannot use and repeats of the same object", async () => {
    const good = item({ road: "Second Street", city: "Town" });
    const suggestions = await searchPlacesNominatim("anything", {
      fetchImpl: fetchReturning(
        listOf(
          null,
          "junk",
          { lat: "1", lon: "2" }, // nothing to call it
          item({ city: "Nowhere" }, { lat: "95", lon: "0" }),
          item({ city: "Nowhere" }, { lat: "abc", lon: "0" }),
          item({ city: "Nowhere" }, { lat: undefined }),
          good,
          good,
          item(
            { city: 7, road: ["x"], country: "Testland" },
            { osm_id: 43, name: null, lat: 10, lon: 20 },
          ),
        ),
      ),
    });
    expect(suggestions.map((s) => [s.label, s.lat, s.lng])).toEqual([
      ["Second Street", 52.5, 13.4],
      ["Testland", 10, 20],
    ]);
  });

  test.each([
    ["HTTP 429", fetchReturning("slow down", { status: 429 }), /HTTP 429/],
    ["HTTP 503", fetchReturning("down", { status: 503 }), /HTTP 503/],
    [
      "an error object instead of a list",
      fetchReturning('{"error":"blocked"}'),
      /unexpected response/,
    ],
    ["a body that is not JSON", fetchReturning("<html>"), /./],
  ])("rejects on %s", async (_, fetchImpl, message) => {
    await expect(searchPlacesNominatim("pacific", { fetchImpl })).rejects.toThrow(message);
  });

  test("rejects on a network failure and when aborted", async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(searchPlacesNominatim("pacific", { fetchImpl: offline })).rejects.toThrow(
      "Failed to fetch",
    );
    resetNominatimLimiter();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = fetchReturning("[]");
    await expect(
      searchPlacesNominatim("pacific", { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const outcome = expect(searchPlacesNominatim("pacific", { fetchImpl })).rejects.toThrow(
      /timed out/,
    );
    await vi.advanceTimersByTimeAsync(NOMINATIM_TIMEOUT_MS);
    await outcome;
  });
});

describe("reverseGeocodeNominatim", () => {
  test("requests the reverse endpoint at building level, with the position rounded to 4 decimals", async () => {
    const fetchImpl = fetchReturning(captured("nominatim-reverse.json"));
    const label = await reverseGeocodeNominatim(
      { lat: 37.793012345678, lng: -122.439387654321 },
      { fetchImpl },
    );
    expect(label).toBe("2698 Pacific Avenue, San Francisco");
    const url = urlOf(fetchImpl);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2",
      lat: "37.7930",
      lon: "-122.4394",
      zoom: "18",
      addressdetails: "1",
      "accept-language": "en",
    });
    expect(String(fetchImpl.mock.calls[0][0])).not.toMatch(/\d\.\d{5,}/);
  });

  test.each([
    [item({ road: "Lombard Street", city: "San Francisco" }), "Lombard Street, San Francisco"],
    [
      item({ house_number: "5", road: "Unter den Linden", city: "Berlin", country_code: "de" }),
      "Unter den Linden 5, Berlin",
    ],
    [
      item({ city: "San Francisco", state: "California" }, { name: "Golden Gate Park" }),
      "Golden Gate Park, San Francisco",
    ],
    [item({ state: "Nevada", country: "United States" }), "Nevada, United States"],
  ])("labels %j as %j", async (raw, expected) => {
    const fetchImpl = fetchReturning(JSON.stringify(raw));
    expect(await reverseGeocodeNominatim({ lat: 1, lng: 2 }, { fetchImpl })).toBe(expected);
  });

  test("null where there is nothing (open sea), and for payloads it cannot read", async () => {
    for (const body of [
      '{"error":"Unable to geocode"}',
      "[]",
      "null",
      '{"lat":"x","lon":"y"}',
      "{}",
    ]) {
      resetNominatimLimiter();
      const fetchImpl = fetchReturning(body);
      expect(await reverseGeocodeNominatim({ lat: 0, lng: 0 }, { fetchImpl })).toBeNull();
    }
  });

  test("null for a non-finite position, without a request", async () => {
    const fetchImpl = fetchReturning("{}");
    expect(await reverseGeocodeNominatim({ lat: Number.NaN, lng: 2 }, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects when the service cannot be asked", async () => {
    await expect(
      reverseGeocodeNominatim(
        { lat: 1, lng: 2 },
        { fetchImpl: fetchReturning("no", { status: 500 }) },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("the one-request-per-second rule", () => {
  test("every request from this client is at least 1.1 s after the one before", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return new Response("[]");
    });
    const t0 = Date.now();
    // Three searches and a reverse lookup asked for in the same instant.
    const all = Promise.all([
      searchPlacesNominatim("one two", { fetchImpl }),
      searchPlacesNominatim("three four", { fetchImpl }),
      reverseGeocodeNominatim({ lat: 1, lng: 2 }, { fetchImpl }),
      searchPlacesNominatim("five six", { fetchImpl }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(NOMINATIM_MIN_INTERVAL_MS - 1);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await all;
    expect(starts.map((t) => t - t0)).toEqual([0, 1100, 2200, 3300]);
    expect(NOMINATIM_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1100);
  });

  test("a request long after the last one is not delayed", async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchReturning("[]");
    await searchPlacesNominatim("one two", { fetchImpl });
    await vi.advanceTimersByTimeAsync(5000);
    const before = Date.now();
    await searchPlacesNominatim("three four", { fetchImpl });
    expect(Date.now() - before).toBe(0);
  });

  test("the spacing counts from when a request was SENT, however long it took", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return new Response("[]");
    });
    const first = searchPlacesNominatim("one two", { fetchImpl });
    await vi.advanceTimersByTimeAsync(3000);
    await first;
    await searchPlacesNominatim("three four", { fetchImpl: fetchReturning("[]") });
    const second = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return new Response("[]");
    });
    const pending = searchPlacesNominatim("five six", { fetchImpl: second });
    await vi.advanceTimersByTimeAsync(NOMINATIM_MIN_INTERVAL_MS);
    await pending;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(3000 + NOMINATIM_MIN_INTERVAL_MS);
  });

  test("an aborted caller gives its turn up without holding the queue", async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1100);
    const order: string[] = [];
    const t0 = Date.now();
    const stamp = (name: string) => () => order.push(`${name}@${Date.now() - t0}`);
    const controller = new AbortController();
    const a = limiter.acquire().then(stamp("a"));
    const b = limiter.acquire(controller.signal).then(stamp("b"), () => order.push("b aborted"));
    const c = limiter.acquire().then(stamp("c"));
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([a, b, c]);
    // c takes the slot b gave up: 1.1 s after a, not 2.2 s.
    expect(order).toEqual(["a@0", "b aborted", "c@1100"]);
  });

  test("a caller that is already aborted is turned away and costs no time", async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1100);
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const before = Date.now();
    await limiter.acquire();
    expect(Date.now() - before).toBe(0);
  });

  test("reset lets the next request through at once", async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1100);
    await limiter.acquire();
    limiter.reset();
    const before = Date.now();
    await limiter.acquire();
    expect(Date.now() - before).toBe(0);
  });
});
