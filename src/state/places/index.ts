/**
 * Saved and recent places. PLACEHOLDER implementation (in-memory, no
 * persistence) that pins down the public API; replaced by the real store.
 */
import { create } from "zustand";
import type { LatLng } from "@/lib/types";
import type { PlaceEntry, PlacesState } from "./types";

export type { PlaceEntry, PlacesActions, PlacesState } from "./types";

/** Stable id of the entry for a pin position (coordinates rounded to ~1 m). */
export function placeEntryId(place: LatLng): string {
  return `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
}

export const usePlaces = create<PlacesState>(() => ({
  saved: [],
  recent: [],
  recordVisit: () => {},
  save: (place, observer, summary, label) =>
    ({
      id: placeEntryId(place),
      place,
      observer,
      label: label ?? place.name ?? placeEntryId(place),
      summary,
      savedAt: Date.now(),
      visitedAt: Date.now(),
    }) satisfies PlaceEntry,
  unsave: () => {},
  rename: () => {},
  setNote: () => {},
  reorder: () => {},
  removeRecent: () => {},
  clearRecents: () => {},
}));

/** Load saved/recent places from storage. Call once on the client after mount. */
export function hydratePlaces(): void {}

/** The saved entry for this pin position, if any. */
export function selectSavedEntry(state: PlacesState, place: LatLng | null): PlaceEntry | null {
  if (!place) return null;
  const id = placeEntryId(place);
  return state.saved.find((entry) => entry.id === id) ?? null;
}
