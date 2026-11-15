/**
 * Place search and reverse geocoding with Photon (https://photon.komoot.io),
 * an OpenStreetMap geocoder that, unlike Nominatim, permits
 * search-as-you-type.
 *
 * Photon is a public service and can cut a client off. `reverseGeocode`
 * therefore has a second path (Nominatim, see `./nominatim`), and both it and
 * the search hook keep `./photonHealth` informed.
 */
import { z } from "zod";
import type { LatLng } from "@/lib/types";
import { describeAddress, shortAddressLabel, suggestionAddress, type AddressParts } from "./labels";
import { getJson, isAbortError } from "./net";
import { NOMINATIM_ENABLED, reverseGeocodeNominatim } from "./nominatim";
import { isPhotonResting, reportPhotonFailure, reportPhotonSuccess } from "./photonHealth";
import {
  DEFAULT_SEARCH_LIMIT,
  REVERSE_GEOCODE_DECIMALS,
  type PlaceSuggestion,
  type ReverseGeocodeOptions,
  type SearchPlacesOptions,
} from "./types";

export { DEFAULT_SEARCH_LIMIT, REVERSE_GEOCODE_DECIMALS } from "./types";
export type { PlaceSuggestion, ReverseGeocodeOptions, SearchPlacesOptions } from "./types";

export const PHOTON_BASE_URL = "https://photon.komoot.io";
/** A typed search that has not answered by now counts as failed. */
export const PHOTON_SEARCH_TIMEOUT_MS = 6000;
/** A pin's label is a nicety: give up on Photon sooner and ask the second service. */
export const PHOTON_REVERSE_TIMEOUT_MS = 5000;

// ─── Response schema ───────────────────────────────────────────────────────

/** A string field that degrades to "missing" instead of failing the feature. */
const text = z.string().optional().catch(undefined);

const photonPropertiesSchema = z.object({
  osm_type: text,
  osm_id: z.number().optional().catch(undefined),
  name: text,
  housenumber: text,
  street: text,
  locality: text,
  district: text,
  city: text,
  county: text,
  state: text,
  country: text,
  countrycode: text,
  postcode: text,
});

const photonFeatureSchema = z.object({
  geometry: z.object({
    // GeoJSON order: [lon, lat].
    coordinates: z.array(z.number()).min(2),
  }),
  properties: photonPropertiesSchema.optional().catch(undefined),
});

const photonResponseSchema = z.object({ features: z.array(z.unknown()) });

// ─── Coordinates typed by hand ─────────────────────────────────────────────

const DECIMAL = String.raw`[+-]?\d+(?:\.\d+)?`;
const FRACTIONAL = String.raw`[+-]?\d+\.\d+`;
/** "37.79, -122.43" or "37.79; -122.43" — a comma or semicolon separates the two. */
const COORDS_SEPARATED_RE = new RegExp(`^(${DECIMAL})\\s*[,;]\\s*(${DECIMAL})$`);
/** "37.79 -122.43" — with only a space, both numbers need decimals ("12 34" is an address). */
const COORDS_SPACED_RE = new RegExp(`^(${FRACTIONAL})\\s+(${FRACTIONAL})$`);

/** Parse "lat, lng" typed by hand. Null if it is not a coordinate pair in range. */
export function parseCoordinates(query: string): LatLng | null {
  const input = query.trim();
  const match = COORDS_SEPARATED_RE.exec(input) ?? COORDS_SPACED_RE.exec(input);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
  return { lat, lng };
}

function coordinateSuggestion({ lat, lng }: LatLng): PlaceSuggestion {
  const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return {
    id: `coord:${lat.toFixed(5)},${lng.toFixed(5)}`,
    lat,
    lng,
    name: label,
    label,
    detail: "Coordinates",
  };
}

// ─── Requests ──────────────────────────────────────────────────────────────

function toSuggestion(feature: unknown): PlaceSuggestion | null {
  const parsed = photonFeatureSchema.safeParse(feature);
  if (!parsed.success) return null;
  const [lng, lat] = parsed.data.geometry.coordinates;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
  const properties: AddressParts = parsed.data.properties ?? {};
  const osm = parsed.data.properties;
  const description = describeAddress(properties);
  if (!description) return null;
  const { label, detail } = description;
  const id =
    osm?.osm_type && osm.osm_id !== undefined ? `${osm.osm_type}${osm.osm_id}` : `${lat},${lng}`;
  return {
    id,
    lat,
    lng,
    name: detail ? `${label}, ${detail}` : label,
    label,
    detail,
    // A street's own name is its `name`; only addresses have a `street`.
    address: suggestionAddress(properties),
  };
}

async function photonFeatures(
  url: URL,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown[]> {
  const parsed = photonResponseSchema.safeParse(
    await getJson(url, { signal, fetchImpl, timeoutMs }),
  );
  if (!parsed.success) throw new Error("Place search returned an unexpected response");
  return parsed.data.features;
}

/**
 * Suggestions for a free-text query.
 *
 * A query that is a "lat, lng" pair resolves to exactly that point without a
 * network request. An empty query resolves to no suggestions. Rejects on
 * network / HTTP errors, on a timeout (`GeocoderTimeoutError`) and when
 * aborted.
 */
export async function searchPlaces(
  query: string,
  options: SearchPlacesOptions = {},
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q === "") return [];

  const coordinates = parseCoordinates(q);
  if (coordinates) return [coordinateSuggestion(coordinates)];

  const { signal, limit = DEFAULT_SEARCH_LIMIT, bias, fetchImpl = globalThis.fetch } = options;
  const url = new URL("/api/", PHOTON_BASE_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "en");
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    url.searchParams.set("lat", String(bias.lat));
    url.searchParams.set("lon", String(bias.lng));
  }

  const suggestions: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  const features = await photonFeatures(url, signal, fetchImpl, PHOTON_SEARCH_TIMEOUT_MS);
  for (const feature of features) {
    const suggestion = toSuggestion(feature);
    // Photon lists one OSM object once per matching tag; keep the first.
    if (!suggestion || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  }
  return suggestions;
}

/**
 * Photon's label for a point, or null when it knows no address there.
 * Rejects when Photon cannot be asked (network, HTTP status, timeout, a
 * response that makes no sense) and when aborted.
 */
export async function reverseGeocodePhoton(
  place: LatLng,
  options: ReverseGeocodeOptions = {},
): Promise<string | null> {
  const { signal, fetchImpl = globalThis.fetch } = options;
  const url = new URL("/reverse", PHOTON_BASE_URL);
  // Only as precise as an address needs: the service never sees the exact
  // pin or GPS fix.
  url.searchParams.set("lat", place.lat.toFixed(REVERSE_GEOCODE_DECIMALS));
  url.searchParams.set("lon", place.lng.toFixed(REVERSE_GEOCODE_DECIMALS));
  url.searchParams.set("lang", "en");
  const features = await photonFeatures(url, signal, fetchImpl, PHOTON_REVERSE_TIMEOUT_MS);
  for (const feature of features) {
    const parsed = photonFeatureSchema.safeParse(feature);
    if (!parsed.success) continue;
    const label = shortAddressLabel(parsed.data.properties ?? {});
    if (label) return label;
  }
  return null;
}

/**
 * A short label ("2200 Sacramento Street, San Francisco") for a point, or
 * null — never a rejection.
 *
 * Photon is asked first. If it cannot be reached (network / CORS failure,
 * 429 or 5xx, timeout, nonsense) Nominatim is asked instead — once; while
 * Photon is known to be down it is not tried at all. An aborted lookup and a
 * clean "no address here" from Photon do NOT fall back.
 */
export async function reverseGeocode(
  place: LatLng,
  options: ReverseGeocodeOptions = {},
): Promise<string | null> {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  const { signal } = options;
  if (signal?.aborted) return null;

  if (!(NOMINATIM_ENABLED && isPhotonResting())) {
    try {
      const label = await reverseGeocodePhoton(place, options);
      reportPhotonSuccess();
      return label;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return null;
      reportPhotonFailure();
    }
  }

  if (!NOMINATIM_ENABLED) return null;
  try {
    return await reverseGeocodeNominatim(place, options);
  } catch {
    return null;
  }
}
