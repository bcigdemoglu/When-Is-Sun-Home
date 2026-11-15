"use client";

import { useEffect, useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { showToast } from "@/components/ui/toast";
import type { GeolocationState } from "@/hooks/useGeolocation";
import { parseListingLink } from "@/lib/geocode/listingLink";
import { parseCoordinates } from "@/lib/geocode/photon";
import { useListingLookup } from "@/lib/geocode/useListingLookup";
import { PLACE_SEARCH_MIN_LENGTH, usePlaceSearch } from "@/lib/geocode/usePlaceSearch";
import type { Place } from "@/lib/types";
import { usePlaces, type PlaceEntry } from "@/state/places";
import { locationSubtitle, type SearchResultsProps } from "./SearchResults";
import {
  approximateMessage,
  armListingLink,
  arrivedWhole,
  canReadClipboard,
  readListingFromClipboard,
  settleListingLink,
  useListingPaste,
} from "./listingPaste";
import {
  SUBMIT_MODE_ANNOUNCEMENT,
  buildSections,
  firstMatch,
  flattenRows,
  isPlaceRow,
  noAddressMessage,
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

/** Whether the clipboard can be read does not change while the page is open. */
const subscribeToNothing = () => () => {};
const getServerCanPaste = () => false;

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
  /** Put this text into the field (the clipboard's link; a link's address, to edit). */
  onReplaceText: (text: string) => void;
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
  /**
   * Tell the search that the field's text changed from `previous` to `next`:
   * a listing link that arrives whole (pasted, not typed) is opened without
   * a second tap when its house is found.
   */
  noteInput: (previous: string, next: string) => void;
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
  onReplaceText,
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

  const canPaste = useSyncExternalStore(subscribeToNothing, canReadClipboard, getServerCanPaste);

  const q = query.trim();
  // Coordinates typed by hand need no geocoder (and work offline).
  const typedCoordinates = parseCoordinates(q) !== null;
  // A listing link is searched for by the address inside it, never by its
  // own text — and nothing is ever requested from the listing site.
  const listing = q === "" || typedCoordinates ? null : parseListingLink(q);
  const listed = listing?.kind === "address" ? listing : null;
  // A link that arrived whole gets the one thorough lookup; one that is
  // being typed gets suggestions for its address like any typed text.
  const armed = useListingPaste((state) => state.armed);
  const thorough = listed !== null && armed?.key === listed.key;
  const search = usePlaceSearch(
    typedCoordinates || listing ? (listed && !thorough ? listed.query : "") : query,
    place,
  );
  const lookup = useListingLookup(thorough ? listed : null);
  const status = thorough ? lookup.status : search.status;

  const sections = buildSections({
    query: q,
    saved,
    recent,
    suggestions: thorough ? lookup.suggestions : search.suggestions,
    awaitingSubmit: !thorough && search.awaitingSubmit,
    // A way in for an empty field. Once something is typed the row steps
    // aside: under a phone's keyboard every row above the results costs one.
    canPaste: canPaste && q === "",
    listing,
    listingSettled: status === "ready",
  });
  const rows = flattenRows(sections);
  const hasPlaceRows = rows.some(isPlaceRow);
  const hasSuggestionRows = rows.some((row) => row.kind === "suggestion");
  const submitRow = rows.find((row) => row.kind === "submit") ?? null;

  let suggestions: SuggestionsState;
  if (q === "") suggestions = "none";
  else if (typedCoordinates) suggestions = "ready";
  else if (listing?.kind === "no-address") suggestions = "no-address";
  else if (!listing && q.length < PLACE_SEARCH_MIN_LENGTH) suggestions = "short";
  else if (submitRow) suggestions = "submit";
  else if (status === "error") suggestions = "error";
  else if (status === "loading") {
    // Nothing can arrive while offline: say so instead of loading forever.
    suggestions = hasSuggestionRows ? "ready" : online ? "loading" : "error";
  } else suggestions = hasPlaceRows ? "ready" : "empty";

  // The pasted link's lookup has answered. If the answer is clearly that
  // house, open it — once per pasted link; otherwise the list is there to
  // choose from.
  useEffect(() => {
    if (!thorough || !listed || lookup.status !== "ready") return;
    if (!settleListingLink(listed.key)) return;
    const match = lookup.match;
    if (!match) return;
    const { lat, lng, name } = match;
    onPick({ place: name ? { lat, lng, name } : { lat, lng }, source: "search" });
    if (match.approximate) showToast(approximateMessage(match.label));
  });

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
      case "paste":
        // Straight from the tap: the browser only hands the clipboard over then.
        void readListingFromClipboard().then((text) => {
          if (text === null) return;
          armListingLink(text);
          onReplaceText(text);
        });
        break;
      case "edit":
        onReplaceText(row.address);
        break;
      case "submit":
        // A link's address is looked up thoroughly, like a pasted one.
        if (listed) armListingLink(q);
        else search.submit();
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
        // Enter on a listing link that was typed is the same as pasting it.
        if (!active && !submitRow && listed && !thorough) {
          event.preventDefault();
          armListingLink(q);
          return true;
        }
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
    // Worded differently from the visible lines, so each stays the only element with its text.
    if (suggestions === "no-address" && listing?.kind === "no-address") {
      announcement = `No address in this link. ${noAddressMessage(listing)}`;
    } else if (suggestions === "loading") {
      announcement = listed ? `Looking up ${listed.address}…` : "Searching…";
    } else if (suggestions === "empty") {
      announcement = listed ? `Nothing found for ${listed.address}` : `No address matches ${q}`;
    } else if (suggestions === "error") announcement = "Couldn’t search. Check your connection.";
    else if (suggestions === "submit") announcement = SUBMIT_MODE_ANNOUNCEMENT;
    else if (suggestions === "ready") announcement = resultCountLabel(sections);
  }

  return {
    listId,
    results: {
      listId,
      sections,
      // What is marked in bold in the rows: for a link, the words of its address
      // (not the state: "CA" would mark every "Ca…").
      query: listed
        ? [listed.houseNumber, ...listed.words, listed.postcode].filter(Boolean).join(" ")
        : listing
          ? ""
          : q,
      listing,
      activeKey: active?.key ?? null,
      optionId,
      geo,
      suggestions,
      stale: !thorough && search.isStale,
      onActivate: activate,
      onHover: (key) => {
        if (active?.key !== key) setHighlight({ key, query: q });
      },
      onRemoveRecent: remove,
      onClearRecents: clearRecents,
      onRetry: thorough ? lookup.retry : search.retry,
    },
    activeOptionId: active ? optionId(active.key) : undefined,
    announcement,
    onKeyDown,
    resetActive: () => setHighlight(null),
    noteInput: (previous, next) => {
      if (arrivedWhole(previous, next)) armListingLink(next);
    },
  };
}
