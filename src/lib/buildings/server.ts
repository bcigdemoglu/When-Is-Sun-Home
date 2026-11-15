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
/**
 * When Overpass could not be had (429/502/504): shared caches may repeat the
 * failure for half a minute, browsers not at all. A burst of requests for an
 * area whose upstream is down then does not cost 25 s of function time each.
 */
export const UPSTREAM_FAILURE_CACHE_CONTROL = "public, max-age=0, s-maxage=30";
export const UPSTREAM_FAILURE_TTL_MS = 30_000;

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
      // Unless said otherwise, a failure is cached by nobody.
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * Upstream failures of the last half minute, by area key, in this server
 * instance. Not every CDN caches error responses whatever their headers say,
 * so the instance also remembers them itself.
 */
interface RememberedFailure {
  until: number;
  kind: BuildingsRouteErrorKind;
  message: string;
  headers: Record<string, string>;
}
const recentFailures = new Map<string, RememberedFailure>();
const MAX_REMEMBERED_FAILURES = 500;

/** Forget remembered upstream failures (tests). */
export function resetUpstreamFailures(): void {
  recentFailures.clear();
}

function rememberFailure(key: string, failure: RememberedFailure): void {
  if (recentFailures.size >= MAX_REMEMBERED_FAILURES) {
    const now = Date.now();
    for (const [k, f] of recentFailures) if (f.until <= now) recentFailures.delete(k);
    // Still full of live entries: drop the oldest (Maps keep insertion order).
    for (const k of recentFailures.keys()) {
      if (recentFailures.size < MAX_REMEMBERED_FAILURES) break;
      recentFailures.delete(k);
    }
  }
  recentFailures.set(key, failure);
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

/**
 * Handle `GET /api/buildings?area=<key>`.
 *
 * What protects Overpass (and our function time) from repeated work:
 *  - only keys of real grid cells are accepted, in one or two spellings;
 *  - successes are cached by the CDN for a week (per URL);
 *  - upstream failures are remembered for 30 s, per area, in this instance,
 *    and marked cacheable for 30 s for CDNs that cache error responses.
 *
 * What does NOT: a caller can still reach one area through differently
 * escaped URLs (the framework normalises them before this code runs, the
 * CDN does not), or simply walk through many valid keys. Bounding that
 * needs a rate limit in front of the function.
 */
export async function handleBuildingsRequest(
  request: Request,
  options: BuildingsRouteOptions = {},
): Promise<Response> {
  try {
    // One area, one URL. The query string must be `area=<key>` and nothing
    // else: an extra or repeated parameter, a stray `&`, a differently
    // escaped key and so on would reach the same area through another URL,
    // i.e. another CDN cache entry and a fresh Overpass query each.
    //
    // Two spellings are accepted: the key as it is (what our client sends),
    // and the key as `URLSearchParams` writes it (colons as %3A). The second
    // is not a concession: Next.js re-serialises the query string before a
    // route handler sees it, so under Next EVERY spelling arrives as that
    // one, and the original bytes cannot be checked here at all. See the
    // note on `handleBuildingsRequest`.
    const url = new URL(request.url);
    const key = url.searchParams.get("area");
    const candidate = key === null ? null : areaFromKey(key);
    const area =
      candidate &&
      (url.search === `?area=${candidate.key}` ||
        url.search === `?${new URLSearchParams({ area: candidate.key })}`)
        ? candidate
        : null;
    if (!area) {
      return errorResponse(
        "bad-area",
        "The query string must be exactly `area=<key>`, with a current building area key.",
      );
    }

    const remembered = recentFailures.get(area.key);
    if (remembered) {
      if (remembered.until > Date.now()) {
        return errorResponse(remembered.kind, remembered.message, {
          ...remembered.headers,
          "x-buildings-replayed": "1",
        });
      }
      recentFailures.delete(area.key);
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
    // One entry per endpoint tried, for the `x-buildings-attempts` debug header.
    const attempts: string[] = [];

    for (const endpoint of endpoints) {
      const remainingMs = deadline - Date.now();
      const startedAt = Date.now();
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
        attempts.push(
          `${hostOf(endpoint)}=${error.kind}${error.status ? `/${error.status}` : ""}/${Date.now() - startedAt}ms`,
        );
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
    const extra: Record<string, string> = {
      "cache-control": UPSTREAM_FAILURE_CACHE_CONTROL,
      "x-buildings-attempts": attempts.join(", "),
    };
    if (lastError.endpoint) extra["x-buildings-source"] = hostOf(lastError.endpoint);
    if (lastError.kind === "rate-limited" && lastError.retryAfterS !== undefined) {
      extra["retry-after"] = String(lastError.retryAfterS);
    }
    rememberFailure(area.key, {
      until: Date.now() + UPSTREAM_FAILURE_TTL_MS,
      kind: lastError.kind,
      message: lastError.message,
      headers: extra,
    });
    return errorResponse(lastError.kind, lastError.message, extra);
  } catch (error) {
    if (isAbortError(error)) {
      // The client disconnected; nobody will read this.
      return errorResponse("timeout", "The request was cancelled.");
    }
    return errorResponse("internal", "Unexpected error while loading buildings.");
  }
}
