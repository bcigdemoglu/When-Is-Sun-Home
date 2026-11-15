import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildingsApiUrl, parseBuildingCollection } from "@/lib/buildings/api";
import {
  OVERPASS_ENDPOINTS,
  buildOverpassQuery,
  parseOverpassResponse,
} from "@/lib/buildings/overpass";
import { handleBuildingsRequest, resetUpstreamFailures } from "@/lib/buildings/server";
import { fetchAreaFor } from "@/lib/buildings/tiles";
import * as route from "./route";

const { GET } = route;

const AREA = fetchAreaFor({ lat: 37.7906, lng: -122.4294 });
const ORIGIN = "https://when-is-sun-home.vercel.app";
const CACHE_OK = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000";

const RAW_FIXTURE = readFileSync(
  new URL("../../../../tests/fixtures/pacific-heights.overpass.json", import.meta.url),
  "utf8",
);

function overpassBody(count: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 0.6,
    ...extra,
    elements: Array.from({ length: count }, (_, i) => ({
      type: "way",
      id: i + 1,
      geometry: [
        { lat: 37.79, lon: -122.43 },
        { lat: 37.79, lon: -122.429 },
        { lat: 37.791, lon: -122.429 },
        { lat: 37.79, lon: -122.43 },
      ],
      tags: { building: "yes", height: "10" },
    })),
  });
}

type Upstream = (input: string, init?: RequestInit) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

/** Script the Overpass servers: one answer per request, in order. The last one repeats. */
function upstream(...answers: Upstream[]) {
  let call = 0;
  fetchMock.mockImplementation(async (input, init) =>
    answers[Math.min(call++, answers.length - 1)](String(input), init),
  );
}

const answer =
  (body: string, status = 200, headers: Record<string, string> = {}): Upstream =>
  () =>
    new Response(body, { status, headers });
const offline: Upstream = () => {
  throw new TypeError("fetch failed");
};
const hang: Upstream = (_input, init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

function get(query: string, init?: RequestInit): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/buildings${query}`, init));
}

const forArea = (key = AREA.key) => `?area=${key}`;
const CACHE_FAILED = "public, max-age=0, s-maxage=30";

beforeEach(() => {
  resetUpstreamFailures();
  fetchMock = vi.fn<typeof fetch>();
  upstream(answer(overpassBody(3)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("route module", () => {
  test("exports only what a Next.js route file may export", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "maxDuration", "runtime"]);
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(30);
  });
});

describe("GET /api/buildings: success", () => {
  test("returns the parsed collection for the area, cacheable at the CDN for a week", async () => {
    upstream(answer(RAW_FIXTURE));
    const response = await get(forArea());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe(CACHE_OK);
    expect(response.headers.get("x-buildings-source")).toBe("overpass-api.de");
    expect(response.headers.get("x-buildings-count")).toBe("384");

    const text = await response.text();
    const expected = parseOverpassResponse(JSON.parse(RAW_FIXTURE));
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(expected)));
    // Exactly what the client validates and uses.
    expect(parseBuildingCollection(JSON.parse(text))).toEqual(expected);
    // Parsed, not raw: smaller, and no floating-point noise in the coordinates.
    expect(text.length).toBeLessThan(RAW_FIXTURE.length * 0.8);
    expect(text).not.toMatch(/\.\d{8,}/);
    expect(text).not.toContain('"elements"');
  });

  test("asks Overpass for exactly that area, identifying itself", async () => {
    await get(forArea());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OVERPASS_ENDPOINTS[0]);
    expect(init?.method).toBe("POST");
    expect((init?.body as URLSearchParams).get("data")).toBe(buildOverpassQuery(AREA.center, 500));

    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe(
      "WhenIsSunHome/2 (+https://when-is-sun-home.vercel.app)",
    );
    // Compression is left to the runtime.
    expect(headers.has("accept-encoding")).toBe(false);
    expect([...headers.keys()]).toEqual(["user-agent"]);
  });

  test("accepts the URL the client sends", async () => {
    expect(buildingsApiUrl(AREA.key)).toBe(`/api/buildings?area=${AREA.key}`);
    const response = await GET(new Request(`${ORIGIN}${buildingsApiUrl(AREA.key)}`));
    expect(response.status).toBe(200);
  });

  test("accepts the same URL as Next.js hands it to a route handler", async () => {
    // Next re-serialises the query string before the handler runs (observed
    // on the dev server): whatever was sent, `request.url` holds the
    // URLSearchParams spelling. So that spelling must be accepted, and the
    // handler cannot tell which bytes the client really sent.
    const asNextPassesIt = `?${new URLSearchParams({ area: AREA.key })}`;
    expect(asNextPassesIt).toBe(`?area=${AREA.key.replaceAll(":", "%3A")}`);
    expect((await get(asNextPassesIt)).status).toBe(200);
  });

  test("the centre queried is the cell's exact centre, not the rounded one in the key", async () => {
    const pin = { lat: 51.50735, lng: -0.12776 };
    const area = fetchAreaFor(pin);
    await get(forArea(area.key));
    const query = (fetchMock.mock.calls[0][1]?.body as URLSearchParams).get("data");
    expect(query).toBe(buildOverpassQuery(area.center, area.radiusM));
  });

  test("reports the age of the OSM data when Overpass states it", async () => {
    upstream(answer(overpassBody(2, { osm3s: { timestamp_osm_base: "2026-11-14T21:58:12Z" } })));
    expect((await get(forArea())).headers.get("x-buildings-osm-base")).toBe("2026-11-14T21:58:12Z");

    upstream(answer(overpassBody(2, { osm3s: { timestamp_osm_base: "<script>\r\nx: y" } })));
    const odd = await get(forArea());
    expect(odd.status).toBe(200);
    expect(odd.headers.has("x-buildings-osm-base")).toBe(false);
  });

  test("an area without buildings is a success, but is cached only briefly", async () => {
    upstream(answer(overpassBody(0)));
    const response = await get(forArea());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: "FeatureCollection", features: [] });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    expect(response.headers.get("x-buildings-count")).toBe("0");
  });

  test("falls back through the Overpass endpoints and names the one that answered", async () => {
    upstream(answer("slow down", 429), answer(overpassBody(2)));
    const response = await get(forArea());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE_OK);
    expect(response.headers.get("x-buildings-source")).toBe("overpass.private.coffee");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([...OVERPASS_ENDPOINTS]);
    // Every attempt is identified.
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("user-agent")).toContain("WhenIsSunHome");
    }
  });

  test("a truncated result (remark) from one server is not used", async () => {
    upstream(
      answer(overpassBody(2, { remark: 'runtime error: Query timed out in "query" at line 3' })),
      answer(overpassBody(5)),
    );
    const response = await get(forArea());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-buildings-source")).toBe("overpass.private.coffee");
    expect(response.headers.get("x-buildings-count")).toBe("5");
  });
});

describe("GET /api/buildings: invalid requests", () => {
  const moved = fetchAreaFor({ lat: AREA.center.lat, lng: AREA.center.lng + 0.003 });

  test.each([
    ["no parameters", ""],
    ["one colon percent-encoded", `?area=${AREA.key.replace(":", "%3A")}`],
    ["a lower-case escape", `?area=${AREA.key.replace(":", "%3a")}`],
    ["a letter percent-encoded", `?area=${AREA.key.replace("v", "%76")}`],
    ["a digit percent-encoded", `?area=${AREA.key.replace("4", "%34")}`],
    ["the parameter name percent-encoded", `?%61rea=${AREA.key}`],
    ["a trailing ampersand", `?area=${AREA.key}&`],
    ["a leading ampersand", `?&area=${AREA.key}`],
    ["a second question mark", `??area=${AREA.key}`],
    ["a trailing equals sign parameter", `?area=${AREA.key}&=`],
    ["a trailing semicolon", `?area=${AREA.key};`],
    ["a trailing space", `?area=${AREA.key}%20`],
    ["a trailing plus", `?area=${AREA.key}+`],
    ["a trailing null byte", `?area=${AREA.key}%00`],
    ["a minus sign percent-encoded", `?area=${AREA.key.replace("-", "%2D")}`],
    ["an upper-case version letter", `?area=${AREA.key.replace("v", "V")}`],
    ["an empty key", "?area="],
    ["another parameter name", `?key=${AREA.key}`],
    ["a differently cased name", `?Area=${AREA.key}`],
    ["an older schema version", `?area=${AREA.key.replace(/^v\d+/, "v1")}`],
    ["a newer schema version", `?area=${AREA.key.replace(/^v\d+/, "v99")}`],
    ["raw coordinates", "?area=37.7906,-122.4294"],
    ["coordinates that are not a cell centre", "?area=v4:37.7906:-122.4294"],
    ["a centre with extra digits", `?area=${AREA.key}0`],
    ["a latitude between rows", `?area=${AREA.key.replace("37.791", "37.792")}`],
    ["the key twice", `?area=${AREA.key}&area=${AREA.key}`],
    ["a valid key plus a cache-busting parameter", `?area=${AREA.key}&_=${Date.now()}`],
    ["a valid key plus an empty parameter", `?area=${AREA.key}&x`],
    ["lat/lng/radius parameters", "?lat=37.79&lng=-122.43&radius=5000"],
    ["an Overpass query", `?data=${encodeURIComponent("[out:json];node(1);out;")}`],
    ["a key with a query smuggled in", `?area=${encodeURIComponent(`${AREA.key});node(1);out;(`)}`],
    ["a very long key", `?area=v4:${"9".repeat(5000)}:1`],
    ["out-of-range coordinates", "?area=v4:95.001:200.0010"],
    // (These are told apart only where the handler sees the URL as sent;
    // under Next.js the escaped forms all arrive in one normalised spelling.)
  ])("%s → 400, uncached, and Overpass is never contacted", async (_, query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = await response.json();
    expect(body).toEqual({ error: "bad-area", message: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the neighbouring cell's key is a different, equally valid request", async () => {
    expect(moved.key).not.toBe(AREA.key);
    expect((await get(forArea(moved.key))).status).toBe(200);
  });
});

describe("GET /api/buildings: Overpass failures", () => {
  async function expectError(response: Response, status: number, kind: string) {
    expect(response.status).toBe(status);
    // Never cached by browsers, and by shared caches for half a minute only.
    expect(response.headers.get("cache-control")).toBe(CACHE_FAILED);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = (await response.json()) as { error: string; message: string };
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(body.error).toBe(kind);
    expect(body.message.length).toBeGreaterThan(5);
    expect(body.message).not.toContain("<");
    return body;
  }

  test.each([
    ["HTTP 429 everywhere", answer("<html>slow down</html>", 429), 429, "rate-limited"],
    ["HTTP 504 everywhere", answer("<html>Gateway Time-out</html>", 504), 504, "timeout"],
    ["HTTP 500 everywhere", answer("oops", 500), 502, "http"],
    ["HTTP 403 everywhere", answer("blocked", 403), 502, "http"],
    ["unreachable", offline, 502, "network"],
    ["an HTML page with status 200", answer("<!doctype html><title>hi</title>"), 502, "malformed"],
    ["JSON of the wrong shape", answer('{"nope":1}'), 502, "malformed"],
    [
      "a timed-out query (remark)",
      answer(overpassBody(0, { remark: "runtime error: Query timed out" })),
      504,
      "timeout",
    ],
    [
      "a rate-limit page with status 200",
      answer("<html>Dispatcher_Client::request_read_and_idx::rate_limited</html>"),
      429,
      "rate-limited",
    ],
  ] as const)("%s → %d %s", async (_, reply, status, kind) => {
    upstream(reply);
    const response = await get(forArea());
    await expectError(response, status, kind);
    expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([...OVERPASS_ENDPOINTS]);
    expect(response.headers.get("x-buildings-source")).toBe("overpass.private.coffee");
    // One entry per server asked: host=kind[/status]/duration.
    const attempts = response.headers.get("x-buildings-attempts")!.split(", ");
    expect(attempts).toHaveLength(OVERPASS_ENDPOINTS.length);
    expect(attempts[0]).toMatch(/^overpass-api\.de=[a-z-]+(\/\d+)?\/\d+ms$/);
    expect(attempts[1]).toMatch(/^overpass\.private\.coffee=[a-z-]+(\/\d+)?\/\d+ms$/);
  });

  test("the last endpoint's failure decides the status", async () => {
    upstream(answer("busy", 429), answer("oops", 500));
    await expectError(await get(forArea()), 502, "http");

    resetUpstreamFailures();
    upstream(offline, answer("busy", 429));
    await expectError(await get(forArea()), 429, "rate-limited");
  });

  test("429 passes on Retry-After when Overpass gave one, and only then", async () => {
    upstream(answer("busy", 429, { "Retry-After": "42" }));
    const known = await get(forArea());
    await expectError(known, 429, "rate-limited");
    expect(known.headers.get("retry-after")).toBe("42");

    resetUpstreamFailures();
    upstream(answer("busy", 429));
    const unknown = await get(forArea());
    await expectError(unknown, 429, "rate-limited");
    expect(unknown.headers.has("retry-after")).toBe(false);

    // Retry-After on some other failure is not ours to pass on.
    resetUpstreamFailures();
    upstream(answer("oops", 503, { "Retry-After": "42" }));
    expect((await get(forArea())).headers.has("retry-after")).toBe(false);
  });

  test("hanging servers: 10 s each, then 504", async () => {
    vi.useFakeTimers();
    upstream(hang);
    let response: Response | undefined;
    void get(forArea()).then((r) => (response = r));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(response).toBeDefined();
    await expectError(response!, 504, "timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.signal as AbortSignal).aborted).toBe(true);
    }
    expect(response!.headers.get("x-buildings-attempts")).toBe(
      "overpass-api.de=timeout/10000ms, overpass.private.coffee=timeout/10000ms",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test("the whole route stays within its 25 s budget however many servers there are", async () => {
    vi.useFakeTimers();
    let response: Response | undefined;
    const request = new Request(`${ORIGIN}/api/buildings${forArea()}`);
    void handleBuildingsRequest(request, {
      fetchImpl: vi.fn<typeof fetch>(
        (input, init) => hang(String(input), init) as Promise<Response>,
      ),
      endpoints: ["https://a.test/i", "https://b.test/i", "https://c.test/i", "https://d.test/i"],
    }).then((r) => (response = r));
    await vi.advanceTimersByTimeAsync(24_999);
    expect(response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(response?.status).toBe(504);
    // 10 s, 10 s, then the 5 s that are left; the fourth server is not asked.
    expect(response!.headers.get("x-buildings-attempts")).toBe(
      "a.test=timeout/10000ms, b.test=timeout/10000ms, c.test=timeout/5000ms",
    );
  });

  test("a slow first server does not starve the others", async () => {
    vi.useFakeTimers();
    upstream(hang, answer(overpassBody(4)));
    const pending = get(forArea());
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-buildings-source")).toBe("overpass.private.coffee");
  });

  test("a client that disconnects stops the work; nothing is thrown or cached", async () => {
    upstream(hang);
    const controller = new AbortController();
    const pending = get(forArea(), { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // And it is not held against the next visitor.
    upstream(answer(overpassBody(1)));
    expect((await get(forArea())).status).toBe(200);
  });
});

describe("GET /api/buildings: a burst of requests while Overpass is down", () => {
  test("the failure is replayed for half a minute without asking Overpass again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    upstream(answer("blocked", 406));
    const first = await get(forArea());
    expect(first.status).toBe(502);
    expect(first.headers.get("cache-control")).toBe(CACHE_FAILED);
    expect(first.headers.has("x-buildings-replayed")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = await first.json();

    vi.setSystemTime(Date.now() + 29_000);
    for (let i = 0; i < 5; i++) {
      const again = await get(forArea());
      expect(again.status).toBe(502);
      expect(again.headers.get("cache-control")).toBe(CACHE_FAILED);
      expect(again.headers.get("x-buildings-replayed")).toBe("1");
      expect(again.headers.get("x-buildings-attempts")).toBe(
        first.headers.get("x-buildings-attempts"),
      );
      expect(again.headers.get("x-buildings-source")).toBe("overpass.private.coffee");
      expect(await again.json()).toEqual(firstBody);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // After that, Overpass is asked again; a success clears the slate.
    vi.setSystemTime(Date.now() + 2_000);
    upstream(answer(overpassBody(3)));
    const later = await get(forArea());
    expect(later.status).toBe(200);
    expect(later.headers.get("cache-control")).toBe(CACHE_OK);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await get(forArea())).status).toBe(200);
  });

  test("Retry-After is replayed with a 429", async () => {
    upstream(answer("busy", 429, { "Retry-After": "42" }));
    await get(forArea());
    const again = await get(forArea());
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe("42");
    expect(again.headers.get("x-buildings-replayed")).toBe("1");
  });

  test("other areas are not affected, and invalid requests are never remembered", async () => {
    upstream(answer("oops", 500));
    expect((await get(forArea())).status).toBe(502);
    expect((await get("?area=nonsense")).status).toBe(400);
    expect((await get("?area=nonsense")).headers.get("cache-control")).toBe("no-store");

    const other = fetchAreaFor({ lat: 52.3731, lng: 4.8922 });
    upstream(answer(overpassBody(2)));
    const response = await get(forArea(other.key));
    expect(response.status).toBe(200);
    // The first area's failure is still being replayed.
    expect((await get(forArea())).headers.get("x-buildings-replayed")).toBe("1");
  });
});
