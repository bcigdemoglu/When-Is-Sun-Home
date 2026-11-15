/**
 * How an address becomes the two lines of a search row and the short label
 * of a pin. One set of rules for every geocoder, so a row looks the same
 * whichever service found it. Pure.
 */

import type { SuggestionAddress } from "./types";

/** The parts of an address the labels are built from (Photon's vocabulary). */
export interface AddressParts {
  name?: string;
  housenumber?: string;
  street?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, any case. */
  countrycode?: string;
  postcode?: string;
}

/** Countries that write the house number after the street name. */
const NUMBER_AFTER_STREET: ReadonlySet<string> = new Set(
  "AT BE BG CH CZ DE DK EE ES FI GR HR HU IS IT LT LV NL NO PL PT RO RS SE SI SK TR".split(" "),
);

export function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function streetAddress(p: AddressParts): string | undefined {
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

function townOf(p: AddressParts): string | undefined {
  return clean(p.city) ?? clean(p.locality) ?? clean(p.district) ?? clean(p.county);
}

/** The two lines of a search row, or null if the address has nothing to show. */
export function describeAddress(p: AddressParts): { label: string; detail: string } | null {
  const address = streetAddress(p);
  const town = townOf(p);
  const label =
    clean(p.name) ?? address ?? town ?? clean(p.state) ?? clean(p.country) ?? clean(p.postcode);
  if (!label) return null;
  const detail = joinDistinct([address, town, p.state, p.country], [label]);
  return { label, detail };
}

/** A short "where is this" label for a pin: the address if there is one, plus the town. */
export function shortAddressLabel(p: AddressParts): string | null {
  const label = joinDistinct([streetAddress(p) ?? p.name, townOf(p)]);
  return label || joinDistinct([p.state, p.country]) || null;
}

/** The parts a listing link's address is compared with (see `./listingMatch`). */
export function suggestionAddress(p: AddressParts): SuggestionAddress {
  // Not the county: "Orange" is a city, and Orange County has thirty more —
  // a house in another of them must not pass for one in Orange.
  const places: string[] = [];
  for (const place of [p.city, p.locality, p.district]) {
    const value = clean(place);
    if (value && !places.includes(value)) places.push(value);
  }
  return {
    houseNumber: clean(p.housenumber),
    street: clean(p.street),
    places,
    state: clean(p.state),
    postcode: clean(p.postcode),
    countryCode: clean(p.countrycode)?.toLowerCase(),
  };
}
