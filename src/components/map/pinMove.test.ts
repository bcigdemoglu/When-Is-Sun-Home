import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLACE_ZOOM,
  REFINE_ZOOM,
  cameraMoveFor,
  createClickGate,
  offsetByMeters,
  sameSpot,
  wrapLng,
} from "./pinMove";

const A = { lat: 37.79, lng: -122.43 };
const B = { lat: 37.7905, lng: -122.4302 };

describe("sameSpot", () => {
  it("compares coordinates, not identity", () => {
    expect(sameSpot(A, { ...A })).toBe(true);
    expect(sameSpot(A, B)).toBe(false);
    expect(sameSpot(null, null)).toBe(true);
    expect(sameSpot(A, null)).toBe(false);
  });
});

describe("cameraMoveFor", () => {
  const base = { handled: A, placedOnMap: null, zoom: 17, inView: true, reducedMotion: false };

  it("does nothing when the place did not move (e.g. only its name changed)", () => {
    expect(cameraMoveFor({ ...base, next: { ...A } })).toEqual({ type: "none" });
    expect(cameraMoveFor({ ...base, next: null })).toEqual({ type: "none" });
  });

  it("flies to a place that came from search, the URL or geolocation", () => {
    expect(cameraMoveFor({ ...base, next: B })).toEqual({ type: "fly", zoom: PLACE_ZOOM });
    expect(cameraMoveFor({ ...base, handled: null, next: B })).toEqual({
      type: "fly",
      zoom: PLACE_ZOOM,
    });
  });

  it("stays put when the user picked the spot on the map", () => {
    expect(cameraMoveFor({ ...base, next: B, placedOnMap: { ...B } })).toEqual({ type: "none" });
  });

  it("eases only when a map-picked pin is out of view", () => {
    expect(cameraMoveFor({ ...base, next: B, placedOnMap: B, inView: false })).toEqual({
      type: "ease",
    });
  });

  it("zooms in on a pin dropped on a zoomed-out map", () => {
    expect(cameraMoveFor({ ...base, next: B, placedOnMap: B, zoom: 3 })).toEqual({
      type: "fly",
      zoom: REFINE_ZOOM,
    });
  });

  it("never animates with reduced motion", () => {
    const reduced = { ...base, reducedMotion: true };
    expect(cameraMoveFor({ ...reduced, next: B })).toEqual({ type: "jump", zoom: PLACE_ZOOM });
    expect(cameraMoveFor({ ...reduced, next: B, placedOnMap: B, zoom: 3 })).toEqual({
      type: "jump",
      zoom: REFINE_ZOOM,
    });
    expect(cameraMoveFor({ ...reduced, next: B, placedOnMap: B, inView: false })).toEqual({
      type: "jump",
      zoom: 17,
    });
  });

  it("treats an older map pick as unrelated to a new place", () => {
    expect(cameraMoveFor({ ...base, next: B, placedOnMap: A })).toEqual({
      type: "fly",
      zoom: PLACE_ZOOM,
    });
  });
});

describe("createClickGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits a single click after the delay", () => {
    const gate = createClickGate({ delayMs: 250 });
    const commit = vi.fn();
    gate.click({ x: 10, y: 10, timeMs: 0 }, commit);
    vi.advanceTimersByTime(249);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("drops both halves of a double-click", () => {
    const gate = createClickGate();
    const first = vi.fn();
    const second = vi.fn();
    gate.click({ x: 10, y: 10, timeMs: 0, detail: 1 }, first);
    vi.advanceTimersByTime(120);
    gate.click({ x: 12, y: 11, timeMs: 120, detail: 2 }, second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("recognises a double-tap without a click count (touch)", () => {
    const gate = createClickGate();
    const first = vi.fn();
    const second = vi.fn();
    gate.click({ x: 100, y: 100, timeMs: 1000 }, first);
    gate.click({ x: 110, y: 95, timeMs: 1200 }, second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("lets the newest of several quick clicks in different places win", () => {
    const gate = createClickGate();
    const commits = [vi.fn(), vi.fn(), vi.fn()];
    gate.click({ x: 10, y: 10, timeMs: 0 }, commits[0]);
    vi.advanceTimersByTime(60);
    gate.click({ x: 200, y: 10, timeMs: 60 }, commits[1]);
    vi.advanceTimersByTime(60);
    gate.click({ x: 400, y: 300, timeMs: 120 }, commits[2]);
    vi.advanceTimersByTime(1000);
    expect(commits[0]).not.toHaveBeenCalled();
    expect(commits[1]).not.toHaveBeenCalled();
    expect(commits[2]).toHaveBeenCalledTimes(1);
  });

  it("treats a slow second click on the same spot as a new click", () => {
    const gate = createClickGate();
    const first = vi.fn();
    const second = vi.fn();
    gate.click({ x: 10, y: 10, timeMs: 0 }, first);
    vi.advanceTimersByTime(600);
    gate.click({ x: 10, y: 10, timeMs: 600 }, second);
    vi.advanceTimersByTime(600);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled (a dblclick event arrived, or the map unmounted)", () => {
    const gate = createClickGate();
    const commit = vi.fn();
    gate.click({ x: 10, y: 10, timeMs: 0 }, commit);
    gate.cancel();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("geometry helpers", () => {
  it("wraps longitudes from a map panned around the world", () => {
    expect(wrapLng(-122.43)).toBe(-122.43);
    expect(wrapLng(237.57)).toBeCloseTo(-122.43);
    expect(wrapLng(-482.43)).toBeCloseTo(-122.43);
    expect(wrapLng(180)).toBe(-180);
  });

  it("nudges a point by metres", () => {
    const moved = offsetByMeters({ lat: 0, lng: 0 }, 111.32, 111.32);
    expect(moved.lat).toBeCloseTo(0.001, 6);
    expect(moved.lng).toBeCloseTo(0.001, 6);
    const north = offsetByMeters(A, 0, 10);
    expect(north.lng).toBe(A.lng);
    expect(north.lat).toBeGreaterThan(A.lat);
  });
});
