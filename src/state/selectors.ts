/**
 * Selectors for `useSettings` and small pure helpers for the UI.
 *
 * Every selector here returns either a primitive or an object that the store
 * keeps referentially stable while its content is unchanged, so
 * `useSettings(selectObserver)` re-renders only when the observer really
 * changes — a time-slider drag does not touch it. Do NOT write selectors that
 * build a new object on each call (`(s) => ({ ...s.observer })`); with
 * zustand v5 that loops forever. Use `useShallow` for ad-hoc picks.
 *
 * Pure and server-safe.
 */
import type { Observer, ObserverMode, Place } from "@/lib/types";
import { SETTINGS_LIMITS, type Layers, type Settings } from "./schema";

export const selectPlace = (s: Settings): Place | null => s.place;
export const selectHasPlace = (s: Settings): boolean => s.place !== null;
/** "YYYY-MM-DD" at the place, or null for "today". */
export const selectDate = (s: Settings): string | null => s.date;
/** 0..1439 at the place, or null for "now". */
export const selectMinuteOfDay = (s: Settings): number | null => s.minuteOfDay;
/** True while both date and time follow the clock ("today, now"). */
export const selectIsLive = (s: Settings): boolean => s.date === null && s.minuteOfDay === null;
export const selectObserver = (s: Settings): Observer => s.observer;
export const selectObserverMode = (s: Settings): ObserverMode => s.observer.mode;
export const selectLayers = (s: Settings): Layers => s.layers;

// ─── Floors ⇄ heights ──────────────────────────────────────────────────────

/** Height of one storey, metres. */
export const STOREY_HEIGHT_M = 3;
/** Eye height above the floor slab, metres. */
export const EYE_HEIGHT_M = 1.5;
/** Highest floor whose eye height still fits `SETTINGS_LIMITS.heightM` (100). */
export const MAX_FLOOR =
  Math.floor((SETTINGS_LIMITS.heightM.max - EYE_HEIGHT_M) / STOREY_HEIGHT_M) + 1;

/**
 * Eye height of someone standing on `floor`, where floor 1 is the ground
 * floor: floor 1 → 1.5 m, floor 2 → 4.5 m, floor 3 → 7.5 m.
 * The floor is rounded to a whole number and clamped to 1..MAX_FLOOR;
 * anything that is not a finite number counts as floor 1.
 */
export function floorToHeightM(floor: number): number {
  const f = Number.isFinite(floor) ? Math.min(MAX_FLOOR, Math.max(1, Math.round(floor))) : 1;
  return (f - 1) * STOREY_HEIGHT_M + EYE_HEIGHT_M;
}

/**
 * The floor (1 = ground floor) whose storey contains a point `heightM` above
 * ground: 0..<3 m → 1, 3..<6 m → 2, … Inverse of `floorToHeightM` for every
 * floor it can return. Clamped to 1..MAX_FLOOR; non-finite input → 1.
 */
export function heightMToFloor(heightM: number): number {
  if (!Number.isFinite(heightM)) return 1;
  return Math.min(MAX_FLOOR, Math.max(1, Math.floor(heightM / STOREY_HEIGHT_M) + 1));
}
