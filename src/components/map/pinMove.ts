/**
 * Pure decisions about the pin and the camera: was that a click or half of a
 * double-click, and should the map move when the place changes?
 */
import type { LatLng } from "@/lib/types";

/** Zoom to show a pinned place at: individual buildings and yards. */
export const PLACE_ZOOM = 17.5;
/** Below this zoom a pin dropped by a click is too coarse to judge; zoom in on it. */
export const COARSE_ZOOM = 14;
/** Zoom to fly to after such a coarse click: close enough to refine the spot. */
export const REFINE_ZOOM = 16.5;
/** Camera tilt that makes extruded buildings readable. */
export const PLACE_PITCH = 45;

/** True when two points are the same spot (within ~1 cm). */
export function sameSpot(a: LatLng | null, b: LatLng | null, epsilonDeg = 1e-7): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.lat - b.lat) <= epsilonDeg && Math.abs(a.lng - b.lng) <= epsilonDeg;
}

export type CameraMove =
  | { type: "none" }
  /** Animated long-distance move (or an instant one with reduced motion). */
  | { type: "fly" | "jump"; zoom: number }
  /** Short pan that keeps the current zoom. */
  | { type: "ease" };

export interface CameraMoveInput {
  /** The place now pinned. */
  next: LatLng | null;
  /** The place the camera has already dealt with. */
  handled: LatLng | null;
  /** The last spot the user picked ON THE MAP (click, drag), if any. */
  placedOnMap: LatLng | null;
  /** Current map zoom. */
  zoom: number;
  /** Whether `next` is comfortably inside the visible map. */
  inView: boolean;
  reducedMotion: boolean;
}

/**
 * How the camera should react to a new place.
 *
 *  - A place from search, the URL or geolocation: go there.
 *  - A spot the user just picked on the map is, by definition, already where
 *    they are looking: stay put. Two exceptions: when the map is zoomed far
 *    out (the pin is only approximate — zoom in so it can be refined), and
 *    when the pin ended up outside the view (bring it back in).
 */
export function cameraMoveFor(input: CameraMoveInput): CameraMove {
  const { next, handled, placedOnMap, zoom, inView, reducedMotion } = input;
  if (next === null || sameSpot(next, handled)) return { type: "none" };
  const animated = reducedMotion ? "jump" : "fly";

  if (sameSpot(next, placedOnMap)) {
    if (zoom < COARSE_ZOOM) return { type: animated, zoom: REFINE_ZOOM };
    if (!inView) return reducedMotion ? { type: "jump", zoom } : { type: "ease" };
    return { type: "none" };
  }
  return { type: animated, zoom: PLACE_ZOOM };
}

// ─── Click vs. double-click ────────────────────────────────────────────────

export interface ClickSample {
  /** Position in the map container, CSS pixels. */
  x: number;
  y: number;
  /** Event time, ms (any monotonic clock). */
  timeMs: number;
  /** The DOM event's click count (`MouseEvent.detail`), when known. */
  detail?: number;
}

export interface ClickGateOptions {
  /** How long a click waits for a possible second one before it counts, ms. */
  delayMs?: number;
  /** Two clicks closer than this (px) and within `doubleClickMs` are a double-click. */
  slopPx?: number;
  doubleClickMs?: number;
}

export interface ClickGate {
  /**
   * Report a click. `commit` runs after `delayMs` unless the click turns out
   * to be part of a double-click (which zooms the map and must not move the
   * pin) or is superseded by a newer click elsewhere.
   */
  click(sample: ClickSample, commit: () => void): void;
  /** Drop a pending click (a `dblclick` arrived, the map went away, …). */
  cancel(): void;
}

export function createClickGate(options: ClickGateOptions = {}): ClickGate {
  const delayMs = options.delayMs ?? 250;
  const slopPx = options.slopPx ?? 30;
  const doubleClickMs = options.doubleClickMs ?? 350;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: ClickSample | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    click(sample, commit) {
      const previous = last;
      last = sample;
      const repeat =
        (sample.detail ?? 1) >= 2 ||
        (previous !== null &&
          sample.timeMs - previous.timeMs >= 0 &&
          sample.timeMs - previous.timeMs <= doubleClickMs &&
          Math.hypot(sample.x - previous.x, sample.y - previous.y) <= slopPx);
      // Either way the earlier click must not fire: it was the first half of
      // a double-click, or the user has already clicked somewhere else.
      cancel();
      if (repeat) return;
      timer = setTimeout(() => {
        timer = null;
        commit();
      }, delayMs);
    },
    cancel,
  };
}

/** Normalise a longitude to [-180, 180) — a map can be panned around the world. */
export function wrapLng(lng: number): number {
  if (lng >= -180 && lng < 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The point `eastM` / `northM` metres from `origin` (for keyboard nudges of the pin). */
export function offsetByMeters(origin: LatLng, eastM: number, northM: number): LatLng {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1e-6, 111_320 * Math.cos((origin.lat * Math.PI) / 180));
  return {
    lat: Math.max(-90, Math.min(90, origin.lat + northM / metersPerDegLat)),
    lng: wrapLng(origin.lng + eastM / metersPerDegLng),
  };
}
