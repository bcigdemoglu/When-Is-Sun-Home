/**
 * Server side of `GET /api/buildings?area=<key>`.
 *
 * The route queries Overpass on behalf of the browser, which buys three
 * things: a response the CDN can cache and share between all visitors, a
 * proper `User-Agent` (browsers cannot set one, and some Overpass servers
 * insist on it), and a much smaller payload (the parsed collection).
 *
 * It is deliberately NOT a general Overpass proxy: the only input is an area
 * key, and only keys of real grid cells are accepted.
 */
import type { BuildingCollection } from "@/lib/types";
import {
  OVERPASS_ENDPOINTS,
  OverpassError,
  buildOverpassQuery,
  fetchOverpassJson,
  isAbortError,
  parseOverpassResponse,
} from "./overpass";
import { areaFromKey } from "./tiles";

export const BUILDINGS_USER_AGENT = "WhenIsSunHome/2 (+https://when-is-sun-home.vercel.app)";

/**
 * Browsers keep an area for an hour; the CDN keeps it for a week and may
 * serve it stale for another month while it refreshes in the background.
 */
export const BUILDINGS_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000";
/**
 * An area with no buildings at all is plausible (water, fields) but is also
 * what a broken or half-loaded Overpass mirror returns, so it is not pinned
 * at the CDN for a week.
 */
export const EMPTY_BUILDINGS_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

/** Total time allowed for Overpass, all endpoints together. */
export const BUILDINGS_BUDGET_MS = 25_000;
/** No single endpoint may use up the whole budget. */
export const BUILDINGS_ENDPOINT_TIMEOUT_MS = 10_000;
/** Not worth starting another endpoint with less time than this left. */
const MIN_ATTEMPT_MS = 2_000;

export type BuildingsRouteErrorKind =
  "bad-area" | "rate-limited" | "timeout" | "http" | "malformed" | "network" | "internal";

export interface BuildingsRouteOptions {
  endpoints?: readonly string[];
  fetchImpl?: typeof fetch;
  budgetMs?: number;
  endpointTimeoutMs?: number;
}

const STATUS_BY_KIND: Record<BuildingsRouteErrorKind, number> = {
  "bad-area": 400,
  "rate-limited": 429,
  timeout: 504,
  http: 502,
  malformed: 502,
  network: 502,
  internal: 500,
};

function errorResponse(
  kind: BuildingsRouteErrorKind,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: kind, message }), {
    status: STATUS_BY_KIND[kind],
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Failures must never be cached, by the browser or by the CDN.
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

/** `osm3s.timestamp_osm_base` of a raw Overpass document, if it looks like a timestamp. */
function osmBaseOf(json: unknown): string | null {
  const stamp = (json as { osm3s?: { timestamp_osm_base?: unknown } } | null)?.osm3s
    ?.timestamp_osm_base;
  return typeof stamp === "string" && /^[\dT:Z.+-]{10,40}$/.test(stamp) ? stamp : null;
}

export async function handleBuildingsRequest(
  request: Request,
  options: BuildingsRouteOptions = {},
): Promise<Response> {
  try {
    // Exactly one parameter: anything else would be a way to mint unlimited
    // distinct URLs for the same area and bypass the CDN cache.
    const params = [...new URL(request.url).searchParams];
    const area = params.length === 1 && params[0][0] === "area" ? areaFromKey(params[0][1]) : null;
    if (!area) {
      return errorResponse(
        "bad-area",
        "Expected exactly one query parameter, `area`, holding a current building area key.",
      );
    }

    const {
      endpoints = OVERPASS_ENDPOINTS,
      fetchImpl = globalThis.fetch,
      budgetMs = BUILDINGS_BUDGET_MS,
      endpointTimeoutMs = BUILDINGS_ENDPOINT_TIMEOUT_MS,
    } = options;

    const identifiedFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", BUILDINGS_USER_AGENT);
      return fetchImpl(input, { ...init, headers });
    };

    const query = buildOverpassQuery(area.center, area.radiusM);
    const deadline = Date.now() + budgetMs;
    let lastError: OverpassError | null = null;

    for (const endpoint of endpoints) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < Math.min(MIN_ATTEMPT_MS, budgetMs)) break;

      let json: unknown;
      let buildings: BuildingCollection;
      try {
        json = await fetchOverpassJson(query, {
          endpoints: [endpoint],
          fetchImpl: identifiedFetch,
          timeoutMs: Math.min(endpointTimeoutMs, remainingMs),
          // Stop working when the client has gone away.
          signal: request.signal,
        });
        buildings = parseOverpassResponse(json);
      } catch (error) {
        if (!(error instanceof OverpassError)) throw error;
        lastError = error;
        continue;
      }

      const headers: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
        "cache-control":
          buildings.features.length > 0 ? BUILDINGS_CACHE_CONTROL : EMPTY_BUILDINGS_CACHE_CONTROL,
        "x-buildings-source": hostOf(endpoint),
        "x-buildings-count": String(buildings.features.length),
      };
      const osmBase = osmBaseOf(json);
      if (osmBase) headers["x-buildings-osm-base"] = osmBase;
      return new Response(JSON.stringify(buildings), { status: 200, headers });
    }

    if (!lastError) {
      return errorResponse(
        "timeout",
        "No Overpass endpoint could be tried within the time budget.",
      );
    }
    const extra: Record<string, string> = {};
    if (lastError.endpoint) extra["x-buildings-source"] = hostOf(lastError.endpoint);
    if (lastError.kind === "rate-limited" && lastError.retryAfterS !== undefined) {
      extra["retry-after"] = String(lastError.retryAfterS);
    }
    return errorResponse(lastError.kind, lastError.message, extra);
  } catch (error) {
    if (isAbortError(error)) {
      // The client disconnected; nobody will read this.
      return errorResponse("timeout", "The request was cancelled.");
    }
    return errorResponse("internal", "Unexpected error while loading buildings.");
  }
}
