/**
 * What the search list shows for a query, as plain data: which rows, in which
 * order, under which headings. Pure — the components only draw the result.
 *
 * The order never changes: use my location, choose on the map, saved places,
 * recent places, then addresses from the geocoder. While the user types,
 * saved and recent places are filtered down to the ones that match.
 */
import { parseCoordinates, type PlaceSuggestion } from "@/lib/geocode/photon";
import { PLACE_SEARCH_MIN_LENGTH } from "@/lib/geocode/usePlaceSearch";
import { formatPlaceCoordinates, placeEntryId, type PlaceEntry } from "@/state/places";

export type SearchRow =
  | { kind: "location"; key: string }
  | { kind: "map"; key: string }
  | { kind: "saved" | "recent"; key: string; entry: PlaceEntry }
  | { kind: "suggestion"; key: string; suggestion: PlaceSuggestion; coordinates: boolean };

export interface SearchSection {
  id: "actions" | "saved" | "recent" | "suggestions";
  /** Heading shown above the rows; null for the two actions at the top. */
  title: string | null;
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
  /** The geocoder knows no such address. */
  | "empty"
  | "error";

export const LOCATION_ROW: SearchRow = { kind: "location", key: "location" };
export const MAP_ROW: SearchRow = { kind: "map", key: "map" };

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
}

export function buildSections({
  query,
  saved,
  recent,
  suggestions,
}: BuildSectionsInput): SearchSection[] {
  const q = query.trim();
  const sections: SearchSection[] = [{ id: "actions", title: null, rows: [LOCATION_ROW, MAP_ROW] }];

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
  }
  return sections;
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
  for (const row of flattenRows(sections)) {
    if (row.kind !== "location" && row.kind !== "map") return row;
  }
  return null;
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
  const count = flattenRows(sections).filter(
    (row) => row.kind !== "location" && row.kind !== "map",
  ).length;
  return `${count} ${count === 1 ? "result" : "results"}`;
}
