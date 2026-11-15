/**
 * Is a geocoder's result clearly the house a listing link is about?
 *
 * Pasting a link takes the person straight to the place — but only when the
 * answer cannot be another house. That is decided here, from the parts of
 * the address the geocoder itself returned (never from its ranking alone):
 *
 *  1. the result HAS a house number, and it is the link's;
 *  2. its street is the link's street, word for word ("Clay Street" is
 *     "Clay St"; "Quail Court" is not "Quail Village Ln");
 *  3. its ZIP is the link's — or, failing that, its town is (maps misspell
 *     ZIPs, and listings use the postal town, so either may disagree alone);
 *  4. nothing contradicts: same state, a US result;
 *  5. every result that passes 1–4 is the same spot (within `SAME_SPOT_M`).
 *
 * Anything less is not clear: the caller shows the list and the person
 * chooses. Pure: no React, no DOM, no network.
 */
import type { ListingAddress } from "./listingLink";
import type { PlaceSuggestion } from "./types";

/** Results this close together are one address (a house and its garage, a point and its building). */
export const SAME_SPOT_M = 150;

/** One spelling for the words addresses abbreviate: "Street" and "Saint" are both "st". */
const CANONICAL: Readonly<Record<string, string>> = {
  street: "st",
  saint: "st",
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  drive: "dr",
  doctor: "dr",
  lane: "ln",
  road: "rd",
  court: "ct",
  place: "pl",
  circle: "cir",
  terrace: "ter",
  terr: "ter",
  parkway: "pkwy",
  highway: "hwy",
  trail: "trl",
  square: "sq",
  alley: "aly",
  crossing: "xing",
  cove: "cv",
  point: "pt",
  ridge: "rdg",
  crescent: "cres",
  heights: "hts",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  junior: "jr",
  senior: "sr",
  mount: "mt",
  fort: "ft",
  first: "1st",
  second: "2nd",
  third: "3rd",
  fourth: "4th",
  fifth: "5th",
  sixth: "6th",
  seventh: "7th",
  eighth: "8th",
  ninth: "9th",
  tenth: "10th",
};

/** Words a street name ends with, in their canonical spelling: types and compass points. */
const STREET_ENDINGS: ReadonlySet<string> = new Set(
  (
    "st ave blvd dr ln rd ct pl cir ter way pkwy hwy trl sq aly xing cv pt rdg cres hts " +
    "loop run path pass row walk n s e w ne nw se sw"
  ).split(" "),
);

const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  DC: "district of columbia",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new hampshire",
  NJ: "new jersey",
  NM: "new mexico",
  NY: "new york",
  NC: "north carolina",
  ND: "north dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode island",
  SC: "south carolina",
  SD: "south dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west virginia",
  WI: "wisconsin",
  WY: "wyoming",
  PR: "puerto rico",
  VI: "united states virgin islands",
  GU: "guam",
  AS: "american samoa",
  MP: "northern mariana islands",
};

/** The words of a street or town, spelled one way: lower case, no dots, abbreviations unified. */
export function canonicalWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) => CANONICAL[word] ?? word);
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((word, index) => word === b[index]);
const startsWith = (words: readonly string[], start: readonly string[]) =>
  words.length >= start.length && same(words.slice(0, start.length), start);
const hasDigit = (word: string) => /\d/.test(word);

/** A town's name as words: "The Bronx" is "bronx". */
function placeWords(name: string): string[] {
  const words = canonicalWords(name);
  if (words.length > 1 && words[0] === "the") words.shift();
  return words;
}

function sameHouseNumber(wanted: string, found: string): boolean {
  const number = wanted.toLowerCase();
  // "2218;2220" and "2218-2220" are one building with both numbers.
  return found
    .toLowerCase()
    .split(/[\s,;/-]+/)
    .some((part) => part === number);
}

/**
 * How surely a result is the link's house: by its ZIP ("zip"), by its town
 * alone ("town"), or not at all (null).
 */
export function listingAgreement(
  link: ListingAddress,
  suggestion: PlaceSuggestion,
): "zip" | "town" | null {
  const found = suggestion.address;
  if (!found || !link.houseNumber) return null;
  if (!found.houseNumber || !found.street) return null;
  if (!sameHouseNumber(link.houseNumber, found.houseNumber)) return null;

  // Nothing may contradict the link.
  if (found.countryCode !== undefined && found.countryCode !== "us") return null;
  if (link.state && found.state) {
    const state = found.state.toLowerCase();
    if (state !== STATE_NAMES[link.state] && state !== link.state.toLowerCase()) return null;
  }

  const street = canonicalWords(found.street);
  if (street.length === 0) return null;
  const places = found.places.map(placeWords);
  const isAPlace = (words: readonly string[]) =>
    words.length > 0 && places.some((place) => same(place, words));

  let townAgrees: boolean;
  if (link.street) {
    // The link says where its street ends: it must be this street, whole.
    // (What may follow is a unit that nothing marked: "… St 101".)
    const wanted = link.street.flatMap(canonicalWords);
    if (!startsWith(wanted, street) || !wanted.slice(street.length).every(hasDigit)) return null;
    townAgrees = link.city !== null && isAPlace(placeWords(link.city));
  } else {
    // The link's street runs on into its city. The result's street must be
    // how those words begin — and must be all of the street, not the start
    // of a longer name ("Park" for "Park Ave S").
    const words = link.words.flatMap(canonicalWords);
    if (!startsWith(words, street)) return null;
    let rest = words.slice(street.length);
    while (rest.length > 0 && hasDigit(rest[0])) rest = rest.slice(1);
    townAgrees = isAPlace(rest);
    const endsCleanly =
      STREET_ENDINGS.has(street[street.length - 1]) &&
      rest.length > 0 &&
      !STREET_ENDINGS.has(rest[0]);
    if (!townAgrees && !endsCleanly) return null;
  }

  const zipAgrees =
    link.postcode !== null &&
    found.postcode !== undefined &&
    found.postcode.trim().slice(0, 5) === link.postcode;
  if (zipAgrees) return "zip";
  return townAgrees ? "town" : null;
}

/** Metres between two points that are close together. */
function distanceM(a: PlaceSuggestion, b: PlaceSuggestion): number {
  const latM = (a.lat - b.lat) * 111_320;
  const lngM = (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(latM, lngM);
}

/**
 * The result that is clearly the link's house, or null when none is — or
 * when the results that could be it are in different places.
 *
 * Among results for one spot, a mapped one is preferred to a worked-out one
 * (`approximate`).
 */
export function findListingMatch(
  link: ListingAddress,
  suggestions: readonly PlaceSuggestion[],
): PlaceSuggestion | null {
  const agreeing = suggestions
    .map((suggestion) => ({ suggestion, by: listingAgreement(link, suggestion) }))
    .filter((entry) => entry.by !== null);
  // All of them if they are one spot; else the ones whose ZIP agrees, if those are.
  for (const group of [agreeing, agreeing.filter((entry) => entry.by === "zip")]) {
    if (group.length === 0) continue;
    const first = group[0].suggestion;
    if (!group.every((entry) => distanceM(first, entry.suggestion) <= SAME_SPOT_M)) continue;
    return group.find((entry) => !entry.suggestion.approximate)?.suggestion ?? first;
  }
  return null;
}
