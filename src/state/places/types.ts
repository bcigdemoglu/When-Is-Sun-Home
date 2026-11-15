import type { Observer, Place, PlaceSummary } from "@/lib/types";

/**
 * A place the user has looked at (a "recent") or kept (a "saved place").
 * One entry per pin position: `id` is derived from the coordinates rounded to
 * ~1 m, so re-visiting the same spot updates the entry instead of adding one.
 */
export interface PlaceEntry {
  id: string;
  place: Place;
  /** The observer settings the summary was computed for. */
  observer: Observer;
  /** What to call it: the user's own name if given, else the address. */
  label: string;
  /** Free-text note ("lovely garden, noisy road"). */
  note?: string;
  /** Headline numbers, once the analysis for this place has finished. */
  summary: PlaceSummary | null;
  /** Epoch ms when it was saved; null for a recent that is not saved. */
  savedAt: number | null;
  /** Epoch ms of the last visit. */
  visitedAt: number;
}

export interface PlacesActions {
  /** Note that a place is being viewed: adds/refreshes a recent, or refreshes a saved entry. */
  recordVisit(place: Place, observer: Observer, summary: PlaceSummary | null): void;
  /** Keep a place. Returns the entry. `label` defaults to the place name or coordinates. */
  save(place: Place, observer: Observer, summary: PlaceSummary | null, label?: string): PlaceEntry;
  /** Stop keeping a place (it becomes a recent again). */
  unsave(id: string): void;
  rename(id: string, label: string): void;
  setNote(id: string, note: string): void;
  /** New order of the saved list, by id. */
  reorder(ids: string[]): void;
  removeRecent(id: string): void;
  clearRecents(): void;
}

export interface PlacesState extends PlacesActions {
  /** Saved places in the user's order. */
  saved: PlaceEntry[];
  /** Recently viewed places that are not saved, newest first (capped). */
  recent: PlaceEntry[];
}
