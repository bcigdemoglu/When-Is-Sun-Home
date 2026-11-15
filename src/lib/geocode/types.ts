import type { LatLng, Place } from "@/lib/types";

/** One geocoder result, shaped the same whichever service found it. */
export type PlaceSuggestion = Place & {
  /**
   * Stable within one result list, e.g. "W259269865" (Photon),
   * "nominatim:W259269865" or "coord:37.79000,-122.43000".
   */
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

export const DEFAULT_SEARCH_LIMIT = 6;
/**
 * Decimal places of the position sent for reverse geocoding: 4 places is
 * about 11 m, enough to find the address and no more exact than that.
 */
export const REVERSE_GEOCODE_DECIMALS = 4;
