/**
 * What the search list shows for a query, as plain data: which rows, in which
 * order, under which headings. Pure — the components only draw the result.
 *
 * The order never changes: use my location, choose on the map, saved places,
 * recent places, then addresses from the geocoder. While the user types,
 * saved and recent places are filtered down to the ones that match.
 */
import type { ListingLink, ListingWithoutAddress } from "@/lib/geocode/listingLink";
import { parseCoordinates, type PlaceSuggestion } from "@/lib/geocode/photon";
import { PLACE_SEARCH_MIN_LENGTH } from "@/lib/geocode/usePlaceSearch";
import { formatPlaceCoordinates, placeEntryId, type PlaceEntry } from "@/state/places";

export type SearchRow =
  | { kind: "location"; key: string }
  | { kind: "map"; key: string }
  /** "Paste a listing link": reads the clipboard. */
  | { kind: "paste"; key: string }
  /** "Edit this address": puts a listing link's address into the field as text. */
  | { kind: "edit"; key: string; address: string }
  | { kind: "saved" | "recent"; key: string; entry: PlaceEntry }
  | { kind: "suggestion"; key: string; suggestion: PlaceSuggestion; coordinates: boolean }
  /** "Search for …": runs one search for the typed text (live suggestions are unavailable). */
  | { kind: "submit"; key: string; query: string };

export interface SearchSection {
  id: "actions" | "saved" | "recent" | "suggestions" | "submit";
  /** Heading shown above the rows; null for the two actions at the top. */
  title: string | null;
  /** A line of explanation between the heading and the rows. */
  note?: string;
  rows: SearchRow[];
}

/** What the "addresses" part of the list is doing. */
export type SuggestionsState =
  /** Nothing typed. */
  | "none"
  /** Typed, but too little to search for. */
  | "short"
  /** First results for this query are on their way. */
  | "loading"
  | "ready"
  /** Live suggestions are unavailable: the typed text waits to be submitted. */
  | "submit"
  /** The geocoder knows no such address. */
  | "empty"
  /** The field holds a listing link that does not spell its address out. */
  | "no-address"
  | "error";

export const LOCATION_ROW: SearchRow = { kind: "location", key: "location" };
export const MAP_ROW: SearchRow = { kind: "map", key: "map" };
export const PASTE_ROW: SearchRow = { kind: "paste", key: "paste" };

/** The heading over what a listing link's address led to. */
export function listingTitle(link: ListingLink): string {
  return `From this ${link.site} link`;
}

/**
 * What to do about a listing link that does not carry its address. Plain,
 * specific, and with the way out.
 */
export function noAddressMessage(link: ListingWithoutAddress): string {
  switch (link.reason) {
    case "short-link":
      return `This ${link.site} short link doesn’t show the address. Open it, copy the link from the listing’s page, and paste that — or type the address.`;
    case "building":
      return `This ${link.site} link is for a whole building and names it without its address. Type the building’s street address instead.`;
    case "id":
      return `This ${link.site} link doesn’t include the address. Copy the link from the listing’s Share button, or type the address.`;
  }
}

/** Nothing was found for a listing link's address. */
export function listingNotFoundNote(address: string): string {
  return `No match for “${address}”. The map may not have this house yet — edit the address, or choose the spot on the map.`;
}

/** Shown above the "Search for …" row while suggestions cannot arrive as the user types. */
export const SUBMIT_MODE_NOTE =
  "Live suggestions are unavailable right now. Press Enter to search.";

/**
 * The same, for the screen-reader announcement — worded differently so the
 * visible line stays the only element with its text.
 */
export const SUBMIT_MODE_ANNOUNCEMENT =
  "Suggestions as you type are unavailable. Press Enter to search.";

/** A row that IS a place (not an action such as "choose on the map" or "search for …"). */
export function isPlaceRow(
  row: SearchRow,
): row is Extract<SearchRow, { kind: "saved" | "recent" | "suggestion" }> {
  return row.kind === "saved" || row.kind === "recent" || row.kind === "suggestion";
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** Case-insensitive substring match on what the entry is called and where it is. */
export function entryMatches(entry: PlaceEntry, query: string): boolean {
  const q = normalize(query);
  if (q === "") return true;
  return (
    entry.label.toLowerCase().includes(q) || (entry.place.name ?? "").toLowerCase().includes(q)
  );
}

/** The suggestion for a "lat, lng" pair typed by hand, or null. */
export function coordinatesSuggestion(query: string): PlaceSuggestion | null {
  const spot = parseCoordinates(query);
  if (!spot) return null;
  return {
    id: `coord:${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`,
    lat: spot.lat,
    lng: spot.lng,
    label: formatPlaceCoordinates(spot),
    detail: "Go to these coordinates",
  };
}

export interface BuildSectionsInput {
  query: string;
  saved: readonly PlaceEntry[];
  recent: readonly PlaceEntry[];
  /** Geocoder results for `query` (ignored while it is too short). */
  suggestions: readonly PlaceSuggestion[];
  /**
   * Live suggestions are unavailable and `query` has not been searched for
   * yet: offer a "Search for …" row instead of addresses.
   */
  awaitingSubmit?: boolean;
  /** The clipboard can be read here: offer "Paste a listing link". */
  canPaste?: boolean;
  /**
   * `query` holds a listing link: `suggestions` are for the link's address,
   * not for the text in the field.
   */
  listing?: ListingLink | null;
  /** The search for the link's address has answered (with `suggestions`, or nothing). */
  listingSettled?: boolean;
}

export function buildSections({
  query,
  saved,
  recent,
  suggestions,
  awaitingSubmit = false,
  canPaste = false,
  listing = null,
  listingSettled = false,
}: BuildSectionsInput): SearchSection[] {
  const q = query.trim();
  const sections: SearchSection[] = [
    {
      id: "actions",
      title: null,
      rows: canPaste ? [LOCATION_ROW, MAP_ROW, PASTE_ROW] : [LOCATION_ROW, MAP_ROW],
    },
  ];

  const shown = new Set<string>();
  const entryRows = (kind: "saved" | "recent", entries: readonly PlaceEntry[]): SearchRow[] =>
    entries
      .filter((entry) => entryMatches(entry, q))
      .map((entry) => {
        shown.add(entry.id);
        return { kind, key: `${kind}:${entry.id}`, entry };
      });

  const savedRows = entryRows("saved", saved);
  if (savedRows.length > 0) sections.push({ id: "saved", title: "Saved", rows: savedRows });
  const recentRows = entryRows("recent", recent);
  if (recentRows.length > 0) sections.push({ id: "recent", title: "Recent", rows: recentRows });

  if (listing) {
    const section = listingSection(listing, suggestions, awaitingSubmit, listingSettled);
    if (section) sections.push(section);
    return sections;
  }

  const typed = coordinatesSuggestion(q);
  let suggestionRows: SearchRow[] = [];
  if (typed) {
    suggestionRows = [
      { kind: "suggestion", key: `suggestion:${typed.id}`, suggestion: typed, coordinates: true },
    ];
  } else if (q.length >= PLACE_SEARCH_MIN_LENGTH) {
    const seen = new Set<string>();
    for (const suggestion of suggestions) {
      // A place that is already listed above as saved / recent is not repeated.
      if (shown.has(placeEntryId(suggestion)) || seen.has(suggestion.id)) continue;
      seen.add(suggestion.id);
      suggestionRows.push({
        kind: "suggestion",
        key: `suggestion:${suggestion.id}`,
        suggestion,
        coordinates: suggestion.id.startsWith("coord:"),
      });
    }
  }
  if (suggestionRows.length > 0) {
    sections.push({
      id: "suggestions",
      title: typed ? "Coordinates" : "Addresses",
      rows: suggestionRows,
    });
  } else if (awaitingSubmit && !typed && q.length >= PLACE_SEARCH_MIN_LENGTH) {
    sections.push({
      id: "submit",
      title: "Addresses",
      note: SUBMIT_MODE_NOTE,
      rows: [{ kind: "submit", key: "submit", query: q }],
    });
  }
  return sections;
}

/**
 * What a listing link in the field puts under the saved and recent places:
 * the results for its address under a heading that says where they are from,
 * with a way to edit that address as text — the only row when nothing was
 * found. A link without an address has no rows (the list says why instead).
 */
function listingSection(
  listing: ListingLink,
  suggestions: readonly PlaceSuggestion[],
  awaitingSubmit: boolean,
  settled: boolean,
): SearchSection | null {
  if (listing.kind !== "address") return null;
  const title = listingTitle(listing);
  if (awaitingSubmit) {
    return {
      id: "submit",
      title,
      note: SUBMIT_MODE_NOTE,
      rows: [{ kind: "submit", key: "submit", query: listing.query }],
    };
  }
  const rows: SearchRow[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    if (seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    rows.push({
      kind: "suggestion",
      key: `suggestion:${suggestion.id}`,
      suggestion,
      coordinates: false,
    });
  }
  if (rows.length === 0 && !settled) return null;
  const found = rows.length > 0;
  if (settled) rows.push({ kind: "edit", key: "edit", address: listing.address });
  return {
    id: "suggestions",
    title,
    note: found ? listing.address : listingNotFoundNote(listing.address),
    rows,
  };
}

export function flattenRows(sections: readonly SearchSection[]): SearchRow[] {
  return sections.flatMap((section) => section.rows);
}

/**
 * The row Enter picks when nothing is highlighted: the first place that
 * matches what was typed (never one of the two actions at the top).
 */
export function firstMatch(sections: readonly SearchSection[], query: string): SearchRow | null {
  if (query.trim() === "") return null;
  return flattenRows(sections).find(isPlaceRow) ?? null;
}

export interface TextPart {
  text: string;
  match: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` cut into matching and non-matching runs, for showing in bold the
 * parts the user typed. Every word of the query is matched on its own, so
 * "2550 pac" marks both "2550" and "Pac" in "2550 Pacific Avenue".
 */
export function highlightParts(text: string, query: string): TextPart[] {
  const words = query
    .split(/[\s,;]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    // Longest first, so "pacific" wins over "pa" where both could match.
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (text === "" || words.length === 0) return text === "" ? [] : [{ text, match: false }];
  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
  const parts: TextPart[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index;
    if (found[0].length === 0) continue;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/** "1 result" / "4 results" — places matching what was typed. */
export function resultCountLabel(sections: readonly SearchSection[]): string {
  const count = flattenRows(sections).filter(isPlaceRow).length;
  return `${count} ${count === 1 ? "result" : "results"}`;
}
