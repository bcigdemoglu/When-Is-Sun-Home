"use client";

/**
 * Saved and recent places: the shortlist a house hunter builds up.
 *
 * Guarantees:
 *  - The store only ever holds canonical data (see `./model.ts`): one entry
 *    per pin position, in at most one list, within the caps.
 *  - An action that changes nothing does not notify subscribers or touch
 *    storage; a list that did not change keeps its identity, so
 *    `usePlaces((s) => s.saved)` re-renders only when the saved list changes.
 *  - Persistence (localStorage, `PLACES_STORAGE_KEY`) can never throw, and
 *    nothing is read before `hydratePlaces()` runs on the client, so the
 *    server render and the first client render agree (both lists empty).
 *  - Stored data is untrusted: it is repaired entry by entry on the way in.
 *  - Two tabs stay in sync through the `storage` event.
 */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import type { LatLng } from "@/lib/types";
import {
  PLACES_LIMITS,
  canSave,
  clearRecents,
  placeEntryId,
  recordVisit,
  removeRecent,
  rename,
  reorder,
  sanitizePlacesData,
  save,
  setNote,
  shareList,
  unionPlaces,
  unsave,
  type PlacesData,
} from "./model";
import type { PlaceEntry, PlacesState } from "./types";

export type { PlaceEntry, PlacesActions, PlacesState } from "./types";
export {
  PLACES_LIMITS,
  defaultPlaceLabel,
  entryAddress,
  entryLabel,
  formatPlaceCoordinates,
  placeEntryId,
} from "./model";
export type { PlacesData } from "./model";

// ─── Persistence ───────────────────────────────────────────────────────────

export const PLACES_STORAGE_KEY = "sun-home:places:v1";
/** Version of the persisted shape under `PLACES_STORAGE_KEY`. */
export const PLACES_STORAGE_VERSION = 1;

let hydrationStarted = false;
let hydrated = false;
/** False until storage has been read once: until then, earlier state is merged, not replaced. */
let firstReadDone = false;
/** Something changed the store before hydration; see `hydratePlaces`. */
let skippedEarlyWrite = false;

function writeToStorage(name: string, value: StorageValue<PlacesData>): void {
  try {
    window.localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // blocked, full or missing storage: the places live on in memory
  }
}

/**
 * Plain JSON in localStorage, where every access may fail (Safari private
 * mode, sandboxed iframes, quota, hand-edited values) and failing means
 * "nothing stored" / "write skipped". Closed for writing until hydration has
 * begun, so that pre-hydration (empty) state never overwrites the user's list.
 */
const placesStorage: PersistStorage<PlacesData> = {
  getItem(name) {
    try {
      const raw = window.localStorage.getItem(name);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as StorageValue<PlacesData>)
        : null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    if (hydrationStarted) writeToStorage(name, value);
    else skippedEarlyWrite = true;
  },
  removeItem(name) {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // nothing to remove
    }
  },
};

function pickData(state: PlacesData): PlacesData {
  return { saved: state.saved, recent: state.recent };
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const usePlaces = create<PlacesState>()(
  persist<PlacesState, [], [], PlacesData>(
    (set, get) => {
      /** Stores the result of an operation, touching only the lists that changed. */
      const commit = (next: PlacesData) => {
        const current = get();
        if (next.saved === current.saved && next.recent === current.recent) return;
        set({ saved: next.saved, recent: next.recent });
      };

      return {
        saved: [],
        recent: [],
        recordVisit: (place, observer, summary) =>
          commit(recordVisit(pickData(get()), place, observer, summary, Date.now())),
        save: (place, observer, summary, label) => {
          const result = save(pickData(get()), place, observer, summary, label, Date.now());
          commit(result.data);
          return result.entry;
        },
        unsave: (id) => commit(unsave(pickData(get()), id)),
        rename: (id, label) => commit(rename(pickData(get()), id, label)),
        setNote: (id, note) => commit(setNote(pickData(get()), id, note)),
        reorder: (ids) => commit(reorder(pickData(get()), ids)),
        removeRecent: (id) => commit(removeRecent(pickData(get()), id)),
        clearRecents: () => commit(clearRecents(pickData(get()))),
      };
    },
    {
      name: PLACES_STORAGE_KEY,
      version: PLACES_STORAGE_VERSION,
      storage: placesStorage,
      skipHydration: true,
      partialize: pickData,
      // There is only one version so far. Whatever an older or newer build
      // left behind is repaired entry by entry rather than thrown away.
      migrate: (persisted) => sanitizePlacesData(persisted),
      // Persisted state is untrusted. On the first read, anything done before
      // hydration is folded in; later reads (another tab wrote) replace the
      // lists, so a place removed over there is removed here too.
      merge: (persisted, current) => {
        const stored = sanitizePlacesData(persisted);
        const next = firstReadDone ? stored : unionPlaces(stored, pickData(current));
        return {
          ...current,
          saved: shareList(current.saved, next.saved),
          recent: shareList(current.recent, next.recent),
        };
      },
    },
  ),
);

// ─── Hydration ─────────────────────────────────────────────────────────────

const hydrationListeners = new Set<() => void>();

function subscribeToHydration(listener: () => void): () => void {
  hydrationListeners.add(listener);
  return () => {
    hydrationListeners.delete(listener);
  };
}

/** True once `hydratePlaces()` has finished (successfully or not). */
export function isPlacesHydrated(): boolean {
  return hydrated;
}

function readStorage(): void {
  try {
    // Synchronous: the storage is synchronous, and so are `migrate` / `merge`.
    void usePlaces.persist.rehydrate();
  } catch {
    // keep the current state
  }
}

/** Another tab changed (or cleared) the places: take over what it wrote. */
function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== PLACES_STORAGE_KEY) return;
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  readStorage();
}

/**
 * Load saved/recent places from storage, once per page load, and keep them in
 * sync with other tabs from then on. Client only; on the server and on every
 * call after the first it does nothing (safe under StrictMode's double
 * effects and with several mounted callers). Blocked or corrupt storage
 * leaves the lists empty; the `hydrated` flag is flipped regardless.
 */
export function hydratePlaces(): void {
  if (hydrationStarted || typeof window === "undefined") return;
  hydrationStarted = true;

  readStorage();
  firstReadDone = true;

  // Places kept before hydration (that write was skipped) are in the merged
  // state now: persist it.
  if (skippedEarlyWrite) {
    writeToStorage(PLACES_STORAGE_KEY, {
      state: pickData(usePlaces.getState()),
      version: PLACES_STORAGE_VERSION,
    });
  }

  try {
    window.addEventListener("storage", onStorageEvent);
  } catch {
    // no events (exotic embedders): this tab still works on its own
  }

  hydrated = true;
  for (const listener of Array.from(hydrationListeners)) {
    try {
      listener();
    } catch {
      // one broken subscriber must not keep the others waiting
    }
  }
}

const getServerHydrated = () => false;

/**
 * Whether the places have been loaded. False during server render and the
 * first client render; until it is true both lists are empty, so do not show
 * an "empty" message yet.
 */
export function usePlacesHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, isPlacesHydrated, getServerHydrated);
}

/**
 * Runs `hydratePlaces()` after the first render and returns the `hydrated`
 * flag. Every component that shows places calls it, so the lists load no
 * matter which of them mounts first.
 */
export function useHydratePlaces(): boolean {
  useEffect(() => {
    hydratePlaces();
  }, []);
  return usePlacesHydrated();
}

// ─── Selectors ─────────────────────────────────────────────────────────────

/** The saved entry for this pin position, if any. */
export function selectSavedEntry(state: PlacesData, place: LatLng | null): PlaceEntry | null {
  if (!place) return null;
  const id = placeEntryId(place);
  return state.saved.find((entry) => entry.id === id) ?? null;
}

/** The saved or recent entry with this id, if any. */
export function selectEntry(state: PlacesData, id: string | null): PlaceEntry | null {
  if (id === null) return null;
  return (
    state.saved.find((entry) => entry.id === id) ??
    state.recent.find((entry) => entry.id === id) ??
    null
  );
}

export function selectIsSaved(state: PlacesData, place: LatLng | null): boolean {
  return selectSavedEntry(state, place) !== null;
}

/** False when the saved list is full (`PLACES_LIMITS.saved`). */
export function selectCanSave(state: PlacesData): boolean {
  return canSave(state);
}

/** Total number of saved places — for the badge on the "Places" button. */
export function selectSavedCount(state: PlacesData): number {
  return state.saved.length;
}

export const MAX_SAVED_PLACES = PLACES_LIMITS.saved;
