/**
 * Place search and reverse geocoding with Photon (https://photon.komoot.io),
 * an OpenStreetMap geocoder that, unlike Nominatim, permits
 * search-as-you-type.
 */
import { z } from "zod";
import type { LatLng, Place } from "@/lib/types";

export const PHOTON_BASE_URL = "https://photon.komoot.io";
export const DEFAULT_SEARCH_LIMIT = 6;

export type PlaceSuggestion = Place & {
  /** Stable within one result list, e.g. "W259269865" or "coord:37.79000,-122.43000". */
  id: string;
  /** Primary line: the place name, or "housenumber street". */
  label: string;
  /** Secondary line: street / city / state / country. May be empty. */
  detail: string;
};

export interface SearchPlacesOptions {
  signal?: AbortSignal;
  /** Maximum number of suggestions (default 6). */
  limit?: number;
  /** Prefer results near this point. */
  bias?: LatLng;
  fetchImpl?: typeof fetch;
}

export interface ReverseGeocodeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

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

type PhotonProperties = z.infer<typeof photonPropertiesSchema>;

// ─── Labels ────────────────────────────────────────────────────────────────

/** Countries that write the house number after the street name. */
const NUMBER_AFTER_STREET: ReadonlySet<string> = new Set(
  "AT BE BG CH CZ DE DK EE ES FI GR HR HU IS IT LT LV NL NO PL PT RO RS SE SI SK TR".split(" "),
);

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function streetAddress(p: PhotonProperties): string | undefined {
  const street = clean(p.street);
  const number = clean(p.housenumber);
  if (!street || !number) return street;
  return NUMBER_AFTER_STREET.has((p.countrycode ?? "").toUpperCase())
    ? `${street} ${number}`
    : `${number} ${street}`;
}

/** Join non-empty parts, dropping case-insensitive repeats and anything in `exclude`. */
function joinDistinct(parts: (string | undefined)[], exclude: string[] = []): string {
  const seen = new Set(exclude.map((part) => part.toLowerCase()));
  const kept: string[] = [];
  for (const part of parts) {
    const value = clean(part);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    kept.push(value);
  }
  return kept.join(", ");
}

function describe(p: PhotonProperties): { label: string; detail: string } | null {
  const address = streetAddress(p);
  const town = clean(p.city) ?? clean(p.locality) ?? clean(p.district) ?? clean(p.county);
  const label =
    clean(p.name) ?? address ?? town ?? clean(p.state) ?? clean(p.country) ?? clean(p.postcode);
  if (!label) return null;
  const detail = joinDistinct([address, town, p.state, p.country], [label]);
  return { label, detail };
}

/** A short "where is this" label for a pin: the address if there is one, plus the town. */
function shortLabel(p: PhotonProperties): string | null {
  const town = clean(p.city) ?? clean(p.locality) ?? clean(p.district) ?? clean(p.county);
  const label = joinDistinct([streetAddress(p) ?? p.name, town]);
  return label || joinDistinct([p.state, p.country]) || null;
}

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
  const properties = parsed.data.properties ?? {};
  const description = describe(properties);
  if (!description) return null;
  const { label, detail } = description;
  const id =
    properties.osm_type && properties.osm_id !== undefined
      ? `${properties.osm_type}${properties.osm_id}`
      : `${lat},${lng}`;
  return { id, lat, lng, name: detail ? `${label}, ${detail}` : label, label, detail };
}

async function photonFeatures(
  url: URL,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  // No custom headers: this stays a CORS "simple request".
  const response = await fetchImpl(url.toString(), { signal });
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status})`);
  const parsed = photonResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Place search returned an unexpected response");
  return parsed.data.features;
}

/**
 * Suggestions for a free-text query.
 *
 * A query that is a "lat, lng" pair resolves to exactly that point without a
 * network request. An empty query resolves to no suggestions. Rejects on
 * network / HTTP errors and when aborted.
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
  for (const feature of await photonFeatures(url, signal, fetchImpl)) {
    const suggestion = toSuggestion(feature);
    // Photon lists one OSM object once per matching tag; keep the first.
    if (!suggestion || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  }
  return suggestions;
}

/** A short label ("2200 Sacramento Street, San Francisco") for a point, or null on any failure. */
export async function reverseGeocode(
  place: LatLng,
  options: ReverseGeocodeOptions = {},
): Promise<string | null> {
  try {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
    const { signal, fetchImpl = globalThis.fetch } = options;
    const url = new URL("/reverse", PHOTON_BASE_URL);
    url.searchParams.set("lat", String(place.lat));
    url.searchParams.set("lon", String(place.lng));
    url.searchParams.set("lang", "en");
    for (const feature of await photonFeatures(url, signal, fetchImpl)) {
      const parsed = photonFeatureSchema.safeParse(feature);
      if (!parsed.success) continue;
      const label = shortLabel(parsed.data.properties ?? {});
      if (label) return label;
    }
    return null;
  } catch {
    return null;
  }
}
