"use client";

/**
 * The single client store for the app's settings.
 *
 * Guarantees:
 *  - The store can only ever hold canonical `Settings`: every action runs its
 *    result through the same normalisation as `sanitizeSettings`. A value that
 *    cannot be used (NaN, wrong type) leaves the field as it was.
 *  - Slices stay referentially stable: `place`, `observer` and `layers` keep
 *    their identity until their content changes, and an action that changes
 *    nothing does not notify subscribers or touch storage. Moving the time
 *    slider never re-renders (or recomputes) something that depends only on
 *    the observer.
 *  - Persistence is throttled (one localStorage write per 500 ms at most, plus
 *    a flush when the page hides), can never throw, and never happens before
 *    hydration.
 *  - Nothing is read from storage or the URL until `hydrateSettings()` runs on
 *    the client, so the server render and the first client render agree.
 */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Observer, Place } from "@/lib/types";
import {
  defaultSettings,
  mergeSettings,
  sanitizeSettings,
  type LayerKey,
  type Layers,
  type Settings,
  type SettingsPatch,
} from "./schema";
import {
  DEFAULT_PERSIST_INTERVAL_MS,
  createThrottledStorage,
  flushWhenPageHides,
  type ThrottledStorage,
} from "./throttledStorage";
import {
  isEmptyPatch,
  overlayUrlSettings,
  searchParamsToSettings,
  type SearchParamsToSettingsOptions,
} from "./urlCodec";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SettingsActions {
  /** Pins a place, or clears it with null. */
  setPlace(place: Place | null): void;
  /** "YYYY-MM-DD" at the place, or null for "today". */
  setDate(date: string | null): void;
  /** 0..1439 at the place (clamped, rounded), or null for "now". */
  setMinuteOfDay(minuteOfDay: number | null): void;
  /** Sets both in one update (one notification, one URL / storage write). */
  setDateTime(date: string | null, minuteOfDay: number | null): void;
  /** Back to "today, now": date and minute become null. */
  resetToNow(): void;
  /** Merges into the observer; `{ facingDeg: 370 }` stores 10. */
  setObserver(patch: Partial<Observer>): void;
  setLayer(key: LayerKey, value: boolean): void;
  /** Back to the defaults, optionally keeping the pinned place. */
  reset(options?: { keepPlace?: boolean }): void;
  /** Merges a partial update (leaf by leaf for observer / layers). */
  hydrate(patch: SettingsPatch): void;
}

export type SettingsStore = Settings & SettingsActions;

// ─── Persistence ───────────────────────────────────────────────────────────

export const SETTINGS_STORAGE_KEY = "sun-home:v2";
/** Version of the persisted shape under `SETTINGS_STORAGE_KEY`. */
export const SETTINGS_STORAGE_VERSION = 1;
/** localStorage keys of the old app; removed on hydration. */
export const LEGACY_STORAGE_KEYS = ["sun-home-state", "sun-building-cache"] as const;
export const PERSIST_THROTTLE_MS = DEFAULT_PERSIST_INTERVAL_MS;

function getLocalStorage(): Storage | null {
  // Reading the property itself can throw (blocked storage, sandboxed iframe);
  // the throttled storage catches that.
  return typeof window === "undefined" ? null : window.localStorage;
}

const throttledStorage = createThrottledStorage<Settings>({
  getStorage: getLocalStorage,
  intervalMs: PERSIST_THROTTLE_MS,
});

let hydrationStarted = false;
let hydrated = false;
/** Something changed the store before hydration; see `hydrateSettings`. */
let skippedEarlyWrite = false;

/**
 * The storage behind `useSettings`: throttled, and closed for writing until
 * hydration has begun. A store update that happens before `hydrateSettings()`
 * holds pre-hydration (default) state; persisting it would overwrite the
 * user's saved settings before they were ever read. Exposed so that callers
 * (and tests) can `flush()` pending writes.
 */
export const settingsStorage: ThrottledStorage<Settings> = {
  ...throttledStorage,
  setItem(name, value) {
    if (hydrationStarted) throttledStorage.setItem(name, value);
    else skippedEarlyWrite = true;
  },
};

/** The `Settings` part of the store state (drops the actions). Returns a new object. */
export function pickSettings(state: Settings): Settings {
  return {
    place: state.place,
    date: state.date,
    minuteOfDay: state.minuteOfDay,
    observer: state.observer,
    layers: state.layers,
  };
}

// ─── Structural sharing ────────────────────────────────────────────────────

function samePlace(a: Place | null, b: Place | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lat === b.lat && a.lng === b.lng && a.name === b.name;
}

function sameObserver(a: Observer, b: Observer): boolean {
  return (
    a.mode === b.mode &&
    a.heightM === b.heightM &&
    a.facingDeg === b.facingDeg &&
    a.fovDeg === b.fovDeg
  );
}

function sameLayers(a: Layers, b: Layers): boolean {
  return a.buildings3d === b.buildings3d && a.shadows === b.shadows && a.trees === b.trees;
}

/** The top-level slices of `next` that differ from `prev`, or null if none do. */
function changedSlices(prev: Settings, next: Settings): Partial<Settings> | null {
  const diff: Partial<Settings> = {};
  if (!samePlace(prev.place, next.place)) diff.place = next.place;
  if (prev.date !== next.date) diff.date = next.date;
  if (prev.minuteOfDay !== next.minuteOfDay) diff.minuteOfDay = next.minuteOfDay;
  if (!sameObserver(prev.observer, next.observer)) diff.observer = next.observer;
  if (!sameLayers(prev.layers, next.layers)) diff.layers = next.layers;
  return Object.keys(diff).length > 0 ? diff : null;
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useSettings = create<SettingsStore>()(
  persist<SettingsStore, [], [], Settings>(
    (set, get) => {
      /** Stores canonical settings, touching only the slices that changed. */
      const commit = (next: Settings) => {
        const diff = changedSlices(get(), next);
        if (diff) set(diff);
      };
      const apply = (patch: SettingsPatch) => commit(mergeSettings(get(), patch));

      return {
        ...defaultSettings(),
        setPlace: (place) => apply({ place }),
        setDate: (date) => apply({ date }),
        setMinuteOfDay: (minuteOfDay) => apply({ minuteOfDay }),
        setDateTime: (date, minuteOfDay) => apply({ date, minuteOfDay }),
        resetToNow: () => apply({ date: null, minuteOfDay: null }),
        setObserver: (patch) => apply({ observer: patch }),
        setLayer: (key, value) => apply({ layers: { [key]: value } }),
        reset: (options) =>
          commit({ ...defaultSettings(), place: options?.keepPlace ? get().place : null }),
        hydrate: apply,
      };
    },
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_STORAGE_VERSION,
      storage: settingsStorage,
      skipHydration: true,
      partialize: pickSettings,
      // There is only one version so far. Whatever an older or newer build
      // left behind is repaired field by field rather than thrown away.
      migrate: (persisted) => sanitizeSettings(persisted),
      // Persisted state is untrusted (hand-edited, truncated, written by a
      // different build). Nothing stored → keep the current state as is.
      merge: (persisted, current) =>
        persisted === undefined || persisted === null
          ? current
          : { ...current, ...sanitizeSettings(persisted) },
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

/** True once `hydrateSettings()` has finished (successfully or not). */
export function isSettingsHydrated(): boolean {
  return hydrated;
}

/**
 * Calls `listener` once hydration has finished — immediately if it already
 * has. Returns an unsubscribe function.
 */
export function onSettingsHydrated(listener: () => void): () => void {
  if (hydrated) {
    listener();
    return () => {};
  }
  const unsubscribe = subscribeToHydration(() => {
    unsubscribe();
    listener();
  });
  return unsubscribe;
}

export interface HydrateSettingsOptions extends SearchParamsToSettingsOptions {
  /** Query string to overlay. Default: `window.location.search`. */
  search?: string;
}

/**
 * Loads the user's settings, once per page load. Client only; on the server
 * and on every call after the first it does nothing. In order:
 *
 *  1. removes the old app's localStorage keys,
 *  2. restores the settings persisted under `SETTINGS_STORAGE_KEY`,
 *  3. overlays what the URL says (`overlayUrlSettings`: the URL wins),
 *  4. starts flushing pending writes when the page hides,
 *  5. flips the `hydrated` flag.
 *
 * Every step is isolated: blocked or corrupt storage and malformed URLs leave
 * the defaults in place, and the flag is flipped regardless so the UI is never
 * stuck waiting.
 *
 * Call it (or `useHydrateSettings`) before anything changes the store: state
 * set before hydration is not persisted and is replaced by what storage holds
 * (it is kept only if nothing was stored).
 */
export function hydrateSettings(options: HydrateSettingsOptions = {}): void {
  if (hydrationStarted || typeof window === "undefined") return;
  hydrationStarted = true;

  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // storage blocked: nothing to clean up
    }
  }

  try {
    // Synchronous: the storage is synchronous, and so are `migrate` / `merge`.
    void useSettings.persist.rehydrate();
  } catch {
    // keep the current state
  }

  let overlaid = false;
  try {
    const search = options.search ?? window.location.search;
    const urlPatch = searchParamsToSettings(new URLSearchParams(search), options);
    if (!isEmptyPatch(urlPatch)) {
      const current = useSettings.getState();
      const next = overlayUrlSettings(pickSettings(current), urlPatch);
      const diff = changedSlices(current, next);
      if (diff) {
        useSettings.setState(diff);
        overlaid = true;
      }
    }
  } catch {
    // malformed URL: keep what storage gave us
  }

  // If the store was changed before hydration (that write was skipped) and
  // nothing has queued one since, persist the state we ended up with.
  if (skippedEarlyWrite && !overlaid) useSettings.setState({});

  try {
    flushWhenPageHides(settingsStorage.flush, window);
  } catch {
    // no document (exotic embedders): writes still flush on the timer
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
 * Whether the settings have been loaded. False during server render and the
 * first client render. Until it is true the store holds defaults, so do not
 * render controls (sliders, date pickers) from it yet.
 */
export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, isSettingsHydrated, getServerHydrated);
}

/**
 * Mount once near the root of the client tree. Runs `hydrateSettings()` after
 * the first render (safe under StrictMode's double-invoked effects and with
 * several mounted callers) and returns the `hydrated` flag.
 */
export function useHydrateSettings(): boolean {
  useEffect(() => {
    hydrateSettings();
  }, []);
  return useSettingsHydrated();
}
