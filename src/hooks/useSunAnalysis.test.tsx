// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseBuildingsResult } from "@/lib/buildings/useBuildings";
import { loadPacificHeightsTerrain } from "@/lib/terrain/testing";
import type { UseTerrainResult } from "@/lib/terrain";
import { SunState, type BuildingCollection } from "@/lib/types";
import { useSettings } from "@/state";
import { OBSERVER_THROTTLE_MS, TERRAIN_HOLD_MS, useSunAnalysis } from "./useSunAnalysis";

// The real engine, with every entry point counted.
const calls = vi.hoisted(() => ({ grid: 0, horizon: 0, year: 0, day: 0, instant: 0 }));
vi.mock("@/lib/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis")>();
  return {
    ...actual,
    computeSunYearGrid: (...args: Parameters<typeof actual.computeSunYearGrid>) => {
      calls.grid++;
      return actual.computeSunYearGrid(...args);
    },
    computeHorizonProfile: (...args: Parameters<typeof actual.computeHorizonProfile>) => {
      calls.horizon++;
      return actual.computeHorizonProfile(...args);
    },
    analyzeYear: (...args: Parameters<typeof actual.analyzeYear>) => {
      calls.year++;
      return actual.analyzeYear(...args);
    },
    analyzeDay: (...args: Parameters<typeof actual.analyzeDay>) => {
      calls.day++;
      return actual.analyzeDay(...args);
    },
    sunInstantAt: (...args: Parameters<typeof actual.sunInstantAt>) => {
      calls.instant++;
      return actual.sunInstantAt(...args);
    },
  };
});

const buildingsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/buildings/useBuildings", () => ({
  // A fresh object on every render, like the real hook.
  useBuildings: () => ({ ...(buildingsState.current as object) }),
}));

// Terrain itself is exercised in the engine's own tests; here only its
// loading state is steered. Unless a test says otherwise there is none.
const terrainState = vi.hoisted(() => ({
  current: { terrain: null, status: "idle", error: null } as unknown,
}));
vi.mock("@/lib/terrain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/terrain")>();
  return { ...actual, useTerrain: () => ({ ...(terrainState.current as object) }) };
});

const PLACE = { lat: 37.79, lng: -122.43 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((PLACE.lat * Math.PI) / 180));

/** A 30 m tall wall 10 m south of the pin, 80 m wide: it hides the low winter sun. */
function wallToTheSouth(): BuildingCollection {
  const x0 = PLACE.lng - 40 * M_LNG;
  const x1 = PLACE.lng + 40 * M_LNG;
  const y0 = PLACE.lat - 20 * M_LAT;
  const y1 = PLACE.lat - 10 * M_LAT;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "way/1", heightM: 30, heightSource: "tagged", levels: null, kind: "yes" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
              [x0, y0],
            ],
          ],
        },
      },
    ],
  };
}

const refetch = () => {};
function buildingsResult(partial: Partial<UseBuildingsResult>): UseBuildingsResult {
  return {
    buildings: null,
    status: "idle",
    error: null,
    isFetching: false,
    isPlaceholder: false,
    refetch,
    stats: null,
    ...partial,
  };
}

const WALL = wallToTheSouth();
const READY = buildingsResult({ status: "ready", buildings: WALL });

const NO_TERRAIN: UseTerrainResult = { terrain: null, status: "idle", error: null };
const TERRAIN_LOADING: UseTerrainResult = { terrain: null, status: "loading", error: null };
const TERRAIN_READY: UseTerrainResult = {
  terrain: loadPacificHeightsTerrain(),
  status: "ready",
  error: null,
};
const TERRAIN_FAILED: UseTerrainResult = {
  terrain: null,
  status: "error",
  error: new Error("tiles unreachable"),
};

function resetCalls() {
  calls.grid = calls.horizon = calls.year = calls.day = calls.instant = 0;
}

/** Let the observer throttle (and anything else on a timer) run. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(OBSERVER_THROTTLE_MS * 3);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-21T20:00:00Z")); // noon in San Francisco
  useSettings.getState().reset();
  buildingsState.current = READY;
  terrainState.current = NO_TERRAIN;
  resetCalls();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  act(() => {
    useSettings.getState().setPlace(PLACE);
    useSettings.getState().setDateTime("2026-12-21", 12 * 60);
  });
  const hook = renderHook(() => useSunAnalysis());
  settle();
  return hook;
}

describe("useSunAnalysis", () => {
  it("is null until a place is pinned", () => {
    const { result } = renderHook(() => useSunAnalysis());
    expect(result.current).toBeNull();
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 0, day: 0, instant: 0 });
  });

  it("produces every piece for a pinned place, in the place's time zone", () => {
    const { result } = setup();
    const analysis = result.current!;
    expect(analysis.timeZone).toBe("America/Los_Angeles");
    expect(analysis.date).toBe("2026-12-21");
    expect(analysis.minuteOfDay).toBe(720);
    expect(analysis.isLive).toBe(false);
    expect(analysis.grid?.year).toBe(2026);
    expect(analysis.year?.days).toHaveLength(365);
    expect(analysis.day?.samples.length).toBe(1440);
    expect(analysis.isUnobstructed).toBe(false);
    // Winter noon sun is ~29° up; a 30 m wall 10 m away hides it.
    expect(analysis.instant?.state).toBe(SunState.Blocked);
    expect(analysis.blockerBuildingId).toBe("way/1");
    expect(analysis.pinOnBuilding).toBe(false);
    expect(calls).toEqual({ grid: 1, horizon: 1, year: 1, day: 1, instant: 1 });
  });

  it("recomputes only the instant when the time of day changes", () => {
    const { result } = setup();
    const before = result.current!;
    resetCalls();
    for (let minute = 721; minute <= 760; minute++) {
      act(() => useSettings.getState().setMinuteOfDay(minute));
    }
    settle();
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 0, day: 0, instant: 40 });
    const after = result.current!;
    expect(after.minuteOfDay).toBe(760);
    expect(after.grid).toBe(before.grid);
    expect(after.horizon).toBe(before.horizon);
    expect(after.year).toBe(before.year);
    expect(after.day).toBe(before.day);
    expect(after.instant).not.toBe(before.instant);
  });

  it("recomputes the day and the instant, not the year, when the date changes within a year", () => {
    const { result } = setup();
    const before = result.current!;
    resetCalls();
    act(() => useSettings.getState().setDate("2026-06-21"));
    settle();
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 0, day: 1, instant: 1 });
    expect(result.current!.year).toBe(before.year);
    expect(result.current!.day?.date).toBe("2026-06-21");
    // The midsummer sun clears the wall.
    expect(result.current!.instant?.state).toBe(SunState.Sun);
    expect(result.current!.blockerBuildingId).toBeNull();
  });

  it("recomputes the grid and the year when the date moves to another year", () => {
    const { result } = setup();
    const horizon = result.current!.horizon;
    resetCalls();
    act(() => useSettings.getState().setDate("2027-01-01"));
    settle();
    expect(calls).toEqual({ grid: 1, horizon: 0, year: 1, day: 1, instant: 1 });
    expect(result.current!.grid?.year).toBe(2027);
    expect(result.current!.horizon).toBe(horizon);
  });

  it("keeps the grid when only the observer changes, and the horizon unless the height does", () => {
    const { result } = setup();
    const before = result.current!;
    resetCalls();
    act(() => useSettings.getState().setObserver({ mode: "window", facingDeg: 0, fovDeg: 90 }));
    settle();
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 1, day: 1, instant: 1 });
    expect(result.current!.horizon).toBe(before.horizon);
    // Facing north, the noon sun (due south) is outside the window's view.
    expect(result.current!.instant?.state).toBe(SunState.OutOfView);

    resetCalls();
    act(() => useSettings.getState().setObserver({ mode: "yard", heightM: 40 }));
    settle();
    expect(calls).toEqual({ grid: 0, horizon: 1, year: 1, day: 1, instant: 1 });
    expect(result.current!.grid).toBe(before.grid);
    // From above the wall nothing is in the way.
    expect(result.current!.instant?.state).toBe(SunState.Sun);
  });

  it("throttles a dragged observer instead of analysing every step", () => {
    setup();
    resetCalls();
    for (let i = 1; i <= 30; i++) {
      act(() => useSettings.getState().setObserver({ heightM: i / 2 }));
      act(() => {
        vi.advanceTimersByTime(4); // 30 steps in 120 ms
      });
    }
    settle();
    expect(calls.horizon).toBeGreaterThanOrEqual(2);
    expect(calls.horizon).toBeLessThanOrEqual(6);
    expect(calls.grid).toBe(0);
  });

  it("does not recompute anything when only the place's name changes", () => {
    const { result } = setup();
    const before = result.current!;
    resetCalls();
    act(() => useSettings.getState().setPlace({ ...PLACE, name: "2550 Pacific Avenue" }));
    settle();
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 0, day: 0, instant: 0 });
    expect(result.current!.place.name).toBe("2550 Pacific Avenue");
    expect(result.current!.year).toBe(before.year);
  });

  it("returns the same object while nothing changes (no render loops downstream)", () => {
    const { result, rerender } = setup();
    const before = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(before);
  });

  it("reports unobstructed sun, flagged as such, until the buildings are ready", () => {
    // A neighbouring area's placeholder is drawn while loading, but never measured with.
    buildingsState.current = buildingsResult({
      status: "loading",
      buildings: WALL,
      isPlaceholder: true,
      isFetching: true,
    });
    const { result, rerender } = setup();
    expect(result.current!.isUnobstructed).toBe(true);
    expect(result.current!.horizon).toBeNull();
    expect(result.current!.instant?.state).toBe(SunState.Sun);
    expect(result.current!.buildings.buildings).toBe(WALL);
    expect(calls.horizon).toBe(0);

    buildingsState.current = READY;
    rerender();
    settle();
    expect(result.current!.isUnobstructed).toBe(false);
    expect(result.current!.instant?.state).toBe(SunState.Blocked);
    expect(calls.horizon).toBe(1);
    expect(calls.grid).toBe(1); // the grid did not need the buildings
  });

  it("passes through whatever else the building data says about itself (its source …)", () => {
    buildingsState.current = {
      ...READY,
      source: "cache",
      originalSource: "tiles",
      sourceLabel: "OpenFreeMap vector tiles (saved copy)",
    };
    const { result } = setup();
    expect(result.current!.buildings).toMatchObject({
      status: "ready",
      source: "cache",
      originalSource: "tiles",
      sourceLabel: "OpenFreeMap vector tiles (saved copy)",
    });
  });

  it("stays unobstructed, with the error exposed, when the buildings fail to load", () => {
    const error = new Error("Overpass is down");
    buildingsState.current = buildingsResult({ status: "error", error });
    const { result } = setup();
    expect(result.current!.isUnobstructed).toBe(true);
    expect(result.current!.buildings.status).toBe("error");
    expect(result.current!.buildings.error).toBe(error);
    expect(result.current!.buildings.refetch).toBe(refetch);
    expect(result.current!.year).not.toBeNull();
  });

  it("flags a pin inside a building footprint", () => {
    const onTheWall = { lat: PLACE.lat - 15 * M_LAT, lng: PLACE.lng };
    act(() => {
      useSettings.getState().setPlace(onTheWall);
      useSettings.getState().setDateTime("2026-12-21", 720);
    });
    const { result } = renderHook(() => useSunAnalysis());
    settle();
    expect(result.current!.pinOnBuilding).toBe(true);
    expect(result.current!.pinBuildingId).toBe("way/1");
    // That building is ignored, so the sun gets through.
    expect(result.current!.instant?.state).toBe(SunState.Sun);
  });

  it("follows the clock at the place when no date or time is set", () => {
    act(() => useSettings.getState().setPlace(PLACE));
    const { result } = renderHook(() => useSunAnalysis());
    settle();
    expect(result.current!.isLive).toBe(true);
    expect(result.current!.date).toBe("2026-12-21");
    expect(result.current!.minuteOfDay).toBe(12 * 60);
    resetCalls();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current!.minuteOfDay).toBe(12 * 60 + 1);
    expect(calls).toEqual({ grid: 0, horizon: 0, year: 0, day: 0, instant: 1 });
  });
  describe("waiting for the ground elevations", () => {
    function advance(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }

    it("computes once, with the hills, when they arrive within the hold", () => {
      terrainState.current = TERRAIN_LOADING;
      const { result, rerender } = setup();
      // Buildings are in, hills are not: still the provisional answer.
      expect(result.current!.buildings.status).toBe("loading");
      expect(result.current!.buildings.buildings).toBe(WALL);
      expect(result.current!.isUnobstructed).toBe(true);
      expect(result.current!.isSettled).toBe(false);
      expect(result.current!.horizon).toBeNull();
      expect(calls.horizon).toBe(0);

      advance(800);
      expect(calls.horizon).toBe(0);
      terrainState.current = TERRAIN_READY;
      rerender();
      settle();
      expect(result.current!.buildings.status).toBe("ready");
      expect(result.current!.terrainStatus).toBe("ready");
      expect(result.current!.isUnobstructed).toBe(false);
      expect(result.current!.isSettled).toBe(true);
      expect(result.current!.horizon).not.toBeNull();
      expect(calls.horizon).toBe(1);

      // The cap passing afterwards changes nothing.
      const settled = result.current;
      advance(TERRAIN_HOLD_MS * 2);
      expect(result.current).toBe(settled);
      expect(calls.horizon).toBe(1);
    });

    it("goes ahead on flat ground after the cap, then refines when the hills arrive", () => {
      terrainState.current = TERRAIN_LOADING;
      const { result, rerender } = setup();
      advance(TERRAIN_HOLD_MS - 500);
      expect(result.current!.buildings.status).toBe("loading");
      expect(calls.horizon).toBe(0);

      advance(500);
      expect(result.current!.buildings.status).toBe("ready");
      expect(result.current!.isUnobstructed).toBe(false);
      expect(result.current!.terrainStatus).toBe("loading");
      // Shown, but not yet worth remembering.
      expect(result.current!.isSettled).toBe(false);
      expect(calls.horizon).toBe(1);
      const flat = result.current!.horizon;
      expect(flat).not.toBeNull();

      terrainState.current = TERRAIN_READY;
      rerender();
      settle();
      expect(result.current!.isSettled).toBe(true);
      expect(result.current!.horizon).not.toBe(flat);
      expect(calls.horizon).toBe(2);
    });

    it("counts the cap from when the buildings arrive, not from when the pin dropped", () => {
      terrainState.current = TERRAIN_LOADING;
      buildingsState.current = buildingsResult({ status: "loading", isFetching: true });
      const { result, rerender } = setup();
      advance(TERRAIN_HOLD_MS * 2);
      expect(calls.horizon).toBe(0);

      buildingsState.current = READY;
      rerender();
      advance(TERRAIN_HOLD_MS - 100);
      expect(result.current!.buildings.status).toBe("loading");
      expect(calls.horizon).toBe(0);
      advance(100);
      expect(result.current!.buildings.status).toBe("ready");
      expect(calls.horizon).toBe(1);
    });

    it("does not wait at all when the elevations have failed", () => {
      terrainState.current = TERRAIN_FAILED;
      const { result } = setup();
      expect(result.current!.buildings.status).toBe("ready");
      expect(result.current!.terrainStatus).toBe("error");
      expect(result.current!.isUnobstructed).toBe(false);
      expect(result.current!.isSettled).toBe(true);
      expect(calls.horizon).toBe(1);
    });

    it("stops waiting the moment the elevations fail", () => {
      terrainState.current = TERRAIN_LOADING;
      const { result, rerender } = setup();
      expect(calls.horizon).toBe(0);
      terrainState.current = TERRAIN_FAILED;
      rerender();
      expect(result.current!.buildings.status).toBe("ready");
      expect(result.current!.isSettled).toBe(true);
      expect(calls.horizon).toBe(1);
    });

    it("does not wait again for the same block of terrain once the cap has passed", () => {
      terrainState.current = TERRAIN_LOADING;
      const { result } = setup();
      advance(TERRAIN_HOLD_MS);
      expect(result.current!.buildings.status).toBe("ready");

      // The pin is nudged a few metres: same terrain tiles, still loading.
      act(() => {
        useSettings.getState().setPlace({ lat: PLACE.lat + 3 * M_LAT, lng: PLACE.lng });
      });
      settle();
      expect(result.current!.buildings.status).toBe("ready");
      expect(result.current!.isUnobstructed).toBe(false);
    });

    it("never calls the numbers settled while the buildings are missing", () => {
      buildingsState.current = buildingsResult({ status: "error", error: new Error("down") });
      const { result } = setup();
      expect(result.current!.isSettled).toBe(false);
    });
  });
});
