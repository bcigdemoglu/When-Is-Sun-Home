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
  /**
   * The parts of the address as the geocoder gave them — what a listing
   * link's address is checked against (see `./listingMatch`). Absent on
   * suggestions that are not from a geocoder (typed coordinates).
   */
  address?: SuggestionAddress;
  /**
   * True when the position is worked out, not mapped: the geocoder knows the
   * range of house numbers along the street and placed this one between its
   * ends (Nominatim does, from US census data). The right stretch of the
   * right street, possibly a few doors off.
   */
  approximate?: boolean;
};

/** A suggestion's address in parts. Every part may be missing. */
export interface SuggestionAddress {
  houseNumber?: string;
  street?: string;
  /** The names the place goes by: city, district, neighbourhood (never the county). */
  places: string[];
  state?: string;
  postcode?: string;
  /** ISO 3166-1 alpha-2, lower case. */
  countryCode?: string;
}

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
