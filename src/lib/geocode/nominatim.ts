/**
 * Nominatim (https://nominatim.openstreetmap.org), the OpenStreetMap
 * Foundation's public geocoder — the app's SECOND path, used when Photon
 * cannot be reached, and for a pasted listing link whose house Photon does
 * not know (see `./listingLookup`: Nominatim can work a US house number out
 * from the census bureau's street ranges).
 *
 * It is a donated service with a usage policy that this module and its
 * callers exist to respect:
 *
 *   https://operations.osmfoundation.org/policies/nominatim/
 *
 *  - NO autocomplete. Never call `searchPlacesNominatim` per keystroke: only
 *    for a search the user explicitly submitted (Enter / the Search row, or a
 *    listing link pasted whole — at most two requests for one link).
 *  - At most 1 request per second — for the whole application. Every request
 *    from this module passes one limiter that keeps ≥ 1.1 s between them
 *    (per browser tab; with a handful of users that is far inside the limit).
 *  - Identify the application: in a browser the Referer header does. No
 *    custom headers are sent (a browser may not set User-Agent anyway).
 *  - Show attribution wherever results are shown ("© OpenStreetMap
 *    contributors"; see the footer of the search results).
 *  - No bulk or periodic use: one search per submit, one reverse lookup per
 *    pin drop, results cached by the caller.
 *  - It must be possible to switch the service off without shipping new
 *    code to users: set `NEXT_PUBLIC_NOMINATIM_FALLBACK=off` and redeploy.
 *
 * The policy only permits use by a developer's deliberate, informed choice,
 * and access can be withdrawn at any time: this is a fallback, not a
 * foundation. Heavier use needs a commercial provider or an own instance.
 *
 * Pure TypeScript: no React, no DOM beyond `fetch`.
 */
import { z } from "zod";
import type { LatLng } from "@/lib/types";
import { describeAddress, shortAddressLabel, suggestionAddress, type AddressParts } from "./labels";
import { getJson } from "./net";
import {
  DEFAULT_SEARCH_LIMIT,
  REVERSE_GEOCODE_DECIMALS,
  type PlaceSuggestion,
  type ReverseGeocodeOptions,
  type SearchPlacesOptions,
} from "./types";

export const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
/** Least time between two requests to Nominatim from this client. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;
export const NOMINATIM_TIMEOUT_MS = 10_000;
/** Half-size, in degrees, of the box around the bias point that results are preferred in. */
const BIAS_BOX_DEG = 0.5;

/** False when the fallback has been switched off for this build. */
export const NOMINATIM_ENABLED = process.env.NEXT_PUBLIC_NOMINATIM_FALLBACK !== "off";

// ─── Rate limiter ──────────────────────────────────────────────────────────

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface RateLimiter {
  /**
   * Resolves when the caller may send its request: in turn, and no sooner
   * than `minIntervalMs` after the previous one was let through. Rejects with
   * an AbortError if `signal` aborts first — an aborted caller gives its turn
   * up and does not delay the ones behind it.
   */
  acquire(signal?: AbortSignal): Promise<void>;
  /** Forget the last request (tests). */
  reset(): void;
}

export function createRateLimiter(minIntervalMs: number): RateLimiter {
  let tail: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  return {
    acquire(signal) {
      const turn = tail.then(async () => {
        if (signal?.aborted) return;
        const wait = lastStart + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait, signal);
        if (signal?.aborted) return;
        lastStart = Date.now();
      });
      tail = turn;
      return turn.then(() => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      });
    },
    reset() {
      lastStart = Number.NEGATIVE_INFINITY;
    },
  };
}

/** The one queue every Nominatim request of this page goes through. */
const limiter = createRateLimiter(NOMINATIM_MIN_INTERVAL_MS);

/** Lets the next request through at once. For tests only. */
export function resetNominatimLimiter(): void {
  limiter.reset();
}

// ─── Response schema ───────────────────────────────────────────────────────

/** A string field that degrades to "missing" instead of failing the result. */
const text = z.string().optional().catch(undefined);
/** Nominatim sends coordinates as strings ("37.7931118"). */
const coordinate = z.union([z.number(), z.string().min(1)]).transform(Number);

const addressSchema = z
  .object({
    house_number: text,
    road: text,
    pedestrian: text,
    footway: text,
    path: text,
    neighbourhood: text,
    quarter: text,
    suburb: text,
    city_district: text,
    borough: text,
    city: text,
    town: text,
    village: text,
    hamlet: text,
    municipality: text,
    county: text,
    state: text,
    region: text,
    country: text,
    country_code: text,
    postcode: text,
  })
  .optional()
  .catch(undefined);

const resultSchema = z.object({
  osm_type: text,
  osm_id: z.number().optional().catch(undefined),
  place_id: z.number().optional().catch(undefined),
  lat: coordinate,
  lon: coordinate,
  name: text,
  /** What kind of thing was found: "building" / "yes", "place" / "house", "highway" / "residential". */
  category: text,
  type: text,
  address: addressSchema,
});

type NominatimResult = z.infer<typeof resultSchema>;

/** Nominatim's address in the vocabulary the shared label rules use. */
function addressParts(result: NominatimResult): AddressParts {
  const a = result.address ?? {};
  return {
    name: result.name,
    housenumber: a.house_number,
    street: a.road ?? a.pedestrian ?? a.footway ?? a.path,
    locality: a.neighbourhood,
    district: a.suburb ?? a.city_district ?? a.borough ?? a.quarter,
    city: a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality,
    county: a.county,
    state: a.state ?? a.region,
    country: a.country,
    countrycode: a.country_code,
    postcode: a.postcode,
  };
}

function parseResult(value: unknown): NominatimResult | null {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) return null;
  const { lat, lon } = parsed.data;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  return parsed.data;
}

function toSuggestion(value: unknown): PlaceSuggestion | null {
  const result = parseResult(value);
  if (!result) return null;
  const parts = addressParts(result);
  const description = describeAddress(parts);
  if (!description) return null;
  const { label, detail } = description;
  const { lat, lon: lng } = result;
  // "way" 468450103 → "nominatim:W468450103", like Photon's "W468450103".
  const osm =
    result.osm_type && result.osm_id !== undefined
      ? `${result.osm_type.charAt(0).toUpperCase()}${result.osm_id}`
      : result.place_id !== undefined
        ? `P${result.place_id}`
        : `${lat},${lng}`;
  const suggestion: PlaceSuggestion = {
    id: `nominatim:${osm}`,
    lat,
    lng,
    name: detail ? `${label}, ${detail}` : label,
    label,
    detail,
    address: suggestionAddress(parts),
  };
  if (isInterpolated(result)) suggestion.approximate = true;
  return suggestion;
}

/**
 * A house number that is on no map: Nominatim knows the range of numbers
 * along the street (in the United States from the census bureau's TIGER
 * data) and places this one between the ends. Such a result is a "house"
 * whose object is the line it was worked out from — a way, where a mapped
 * address is a point or a building.
 */
function isInterpolated(result: NominatimResult): boolean {
  return (
    result.category === "place" &&
    result.type === "house" &&
    (result.osm_type ?? "").toLowerCase() === "way" &&
    Boolean(result.address?.house_number)
  );
}

// ─── Requests ──────────────────────────────────────────────────────────────

async function nominatimJson(
  url: URL,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  // Results in English, like Photon's (`lang=en`), whatever the browser prefers.
  url.searchParams.set("accept-language", "en");
  await limiter.acquire(signal);
  return getJson(url, { signal, fetchImpl, timeoutMs: NOMINATIM_TIMEOUT_MS });
}

/**
 * Places matching a free-text query the user SUBMITTED — never call this as
 * the user types (see the policy notes at the top of this file).
 *
 * An empty query resolves to no suggestions without a request. Rejects on
 * network / HTTP errors, on a response that is not a result list, and when
 * aborted; odd entries in a good list are skipped.
 */
export async function searchPlacesNominatim(
  query: string,
  options: SearchPlacesOptions = {},
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q === "") return [];
  const { signal, limit = DEFAULT_SEARCH_LIMIT, bias, fetchImpl = globalThis.fetch } = options;

  const url = new URL("/search", NOMINATIM_BASE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", q);
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    // A preference, not a filter (no `bounded`): left,top,right,bottom.
    const box = [
      Math.max(-180, bias.lng - BIAS_BOX_DEG),
      Math.min(90, bias.lat + BIAS_BOX_DEG),
      Math.min(180, bias.lng + BIAS_BOX_DEG),
      Math.max(-90, bias.lat - BIAS_BOX_DEG),
    ];
    url.searchParams.set("viewbox", box.map((value) => value.toFixed(2)).join(","));
  }

  const body = await nominatimJson(url, signal, fetchImpl);
  if (!Array.isArray(body)) throw new Error("Place search returned an unexpected response");

  const suggestions: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of body) {
    const suggestion = toSuggestion(item);
    if (!suggestion || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  }
  return suggestions;
}

/**
 * A short label ("2698 Pacific Avenue, San Francisco") for a point, or null
 * when there is no address there. One lookup per pin drop — never in a loop.
 *
 * Rejects on network / HTTP errors and when aborted (the public
 * `reverseGeocode` in `./photon` turns those into null).
 */
export async function reverseGeocodeNominatim(
  place: LatLng,
  options: ReverseGeocodeOptions = {},
): Promise<string | null> {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  const { signal, fetchImpl = globalThis.fetch } = options;

  const url = new URL("/reverse", NOMINATIM_BASE_URL);
  url.searchParams.set("format", "jsonv2");
  // Only as precise as an address needs: the service never sees the exact pin.
  url.searchParams.set("lat", place.lat.toFixed(REVERSE_GEOCODE_DECIMALS));
  url.searchParams.set("lon", place.lng.toFixed(REVERSE_GEOCODE_DECIMALS));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const body = await nominatimJson(url, signal, fetchImpl);
  // "Nothing here" is a 200 with `{ "error": "Unable to geocode" }`.
  const result = parseResult(body);
  return result ? shortAddressLabel(addressParts(result)) : null;
}
