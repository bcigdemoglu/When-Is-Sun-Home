"use client";

import { useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { GeolocationState } from "@/hooks/useGeolocation";
import { parseCoordinates } from "@/lib/geocode/photon";
import { PLACE_SEARCH_MIN_LENGTH, usePlaceSearch } from "@/lib/geocode/usePlaceSearch";
import type { Place } from "@/lib/types";
import { usePlaces, type PlaceEntry } from "@/state/places";
import { locationSubtitle, type SearchResultsProps } from "./SearchResults";
import {
  SUBMIT_MODE_ANNOUNCEMENT,
  buildSections,
  firstMatch,
  flattenRows,
  isPlaceRow,
  resultCountLabel,
  type SearchRow,
  type SuggestionsState,
} from "./rows";
import type { PlaceSelection } from "./types";

function subscribeToOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const getOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);
const getServerOnline = () => true;

export interface SearchControllerOptions {
  /** What the user typed. Empty while the field still shows the current place. */
  query: string;
  /** The current pin: results near it rank first. */
  place: Place | null;
  geo: GeolocationState;
  /** "Use my current location" was chosen. */
  onLocate: () => void;
  /** A place was chosen. */
  onPick: (selection: PlaceSelection) => void;
  onChooseOnMap: () => void;
}

export interface SearchController {
  listId: string;
  /** Props for `<SearchResults>`. */
  results: SearchResultsProps;
  /** DOM id of the highlighted option, for `aria-activedescendant`. */
  activeOptionId: string | undefined;
  /** Polite announcement for screen readers (result counts, errors). */
  announcement: string;
  /** Handles ↑ ↓ Enter and Shift+Delete. Returns true if it used the key. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** Forget the keyboard highlight. */
  resetActive: () => void;
}

/**
 * Everything the two search variants share: which rows to show for a query,
 * the keyboard highlight, and what picking a row does.
 */
export function useSearchController({
  query,
  place,
  geo,
  onLocate,
  onPick,
  onChooseOnMap,
}: SearchControllerOptions): SearchController {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (key: string) => `${baseId}-${key}`;

  // Only the two lists: nothing else in the store re-renders the search.
  const saved = usePlaces((state) => state.saved);
  const recent = usePlaces((state) => state.recent);
  const removeRecent = usePlaces((state) => state.removeRecent);
  const clearRecents = usePlaces((state) => state.clearRecents);

  const online = useSyncExternalStore(subscribeToOnline, getOnline, getServerOnline);

  const q = query.trim();
  // Coordinates typed by hand need no geocoder (and work offline).
  const typedCoordinates = parseCoordinates(q) !== null;
  const search = usePlaceSearch(typedCoordinates ? "" : query, place);

  const sections = buildSections({
    query: q,
    saved,
    recent,
    suggestions: search.suggestions,
    awaitingSubmit: search.awaitingSubmit,
  });
  const rows = flattenRows(sections);
  const hasPlaceRows = rows.some(isPlaceRow);
  const hasSuggestionRows = rows.some((row) => row.kind === "suggestion");
  const submitRow = rows.find((row) => row.kind === "submit") ?? null;

  let suggestions: SuggestionsState;
  if (q === "") suggestions = "none";
  else if (typedCoordinates) suggestions = "ready";
  else if (q.length < PLACE_SEARCH_MIN_LENGTH) suggestions = "short";
  else if (submitRow) suggestions = "submit";
  else if (search.status === "error") suggestions = "error";
  else if (search.status === "loading") {
    // Nothing can arrive while offline: say so instead of loading forever.
    suggestions = hasSuggestionRows ? "ready" : online ? "loading" : "error";
  } else suggestions = hasPlaceRows ? "ready" : "empty";

  // The highlight belongs to the query it was made for.
  const [highlight, setHighlight] = useState<{ key: string; query: string } | null>(null);
  const active =
    highlight && highlight.query === q
      ? (rows.find((row) => row.key === highlight.key) ?? null)
      : null;

  const activate = (row: SearchRow) => {
    switch (row.kind) {
      case "location":
        onLocate();
        break;
      case "map":
        onChooseOnMap();
        break;
      case "submit":
        search.submit();
        break;
      case "saved":
      case "recent":
        onPick({ place: row.entry.place, observer: row.entry.observer, source: row.kind });
        break;
      case "suggestion": {
        const { lat, lng, name } = row.suggestion;
        if (row.coordinates) onPick({ place: { lat, lng }, source: "coordinates" });
        else onPick({ place: name ? { lat, lng, name } : { lat, lng }, source: "search" });
        break;
      }
    }
  };

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const index = active ? rows.indexOf(active) : -1;
    const next =
      index < 0 ? (delta > 0 ? 0 : rows.length - 1) : (index + delta + rows.length) % rows.length;
    const key = rows[next].key;
    setHighlight({ key, query: q });
    const element = document.getElementById(optionId(key));
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  };

  const remove = (entry: PlaceEntry) => removeRecent(entry.id);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    // Leave keys alone while an IME is composing text.
    if (event.nativeEvent.isComposing) return false;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return true;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return true;
      case "Enter": {
        // "Press Enter to search": while the typed text waits to be submitted,
        // Enter searches for it rather than picking a saved place that matches.
        const target = active ?? submitRow ?? firstMatch(sections, q);
        if (!target) return false;
        event.preventDefault();
        // Without a highlight, never pick an address that belongs to an earlier query.
        const outdated =
          !active && target.kind === "suggestion" && !target.coordinates && search.isStale;
        if (!outdated) activate(target);
        return true;
      }
      case "Delete":
        if (event.shiftKey && active?.kind === "recent") {
          event.preventDefault();
          remove(active.entry);
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  let announcement = "";
  if (geo.status === "locating" || geo.status === "error") {
    announcement = locationSubtitle(geo).text;
  }
  if (q !== "") {
    if (suggestions === "loading") announcement = "Searching…";
    else if (suggestions === "empty") announcement = `No address matches ${q}`;
    else if (suggestions === "error") announcement = "Couldn’t search. Check your connection.";
    else if (suggestions === "submit") announcement = SUBMIT_MODE_ANNOUNCEMENT;
    else if (suggestions === "ready") announcement = resultCountLabel(sections);
  }

  return {
    listId,
    results: {
      listId,
      sections,
      query: q,
      activeKey: active?.key ?? null,
      optionId,
      geo,
      suggestions,
      stale: search.isStale,
      onActivate: activate,
      onHover: (key) => {
        if (active?.key !== key) setHighlight({ key, query: q });
      },
      onRemoveRecent: remove,
      onClearRecents: clearRecents,
      onRetry: search.retry,
    },
    activeOptionId: active ? optionId(active.key) : undefined,
    announcement,
    onKeyDown,
    resetActive: () => setHighlight(null),
  };
}
