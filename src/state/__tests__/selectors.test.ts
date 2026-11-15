import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, type Settings } from "../schema";
import {
  EYE_HEIGHT_M,
  MAX_FLOOR,
  STOREY_HEIGHT_M,
  floorToHeightM,
  heightMToFloor,
  selectDate,
  selectHasPlace,
  selectIsLive,
  selectLayers,
  selectMinuteOfDay,
  selectObserver,
  selectObserverMode,
  selectPlace,
} from "../selectors";

describe("selectors", () => {
  const s: Settings = {
    place: { lat: 1, lng: 2, name: "Here" },
    date: "2026-06-21",
    minuteOfDay: 600,
    observer: { mode: "window", heightM: 4.5, facingDeg: 90, fovDeg: 120 },
    layers: { buildings3d: false, shadows: true, trees: true },
  };

  test("return the stored slices themselves (stable references)", () => {
    expect(selectPlace(s)).toBe(s.place);
    expect(selectObserver(s)).toBe(s.observer);
    expect(selectLayers(s)).toBe(s.layers);
    expect(selectDate(s)).toBe("2026-06-21");
    expect(selectMinuteOfDay(s)).toBe(600);
    expect(selectObserverMode(s)).toBe("window");
    expect(selectHasPlace(s)).toBe(true);
    expect(selectHasPlace(DEFAULT_SETTINGS)).toBe(false);
  });

  test("selectIsLive is true only while both date and time follow the clock", () => {
    expect(selectIsLive(DEFAULT_SETTINGS)).toBe(true);
    expect(selectIsLive(s)).toBe(false);
    expect(selectIsLive({ ...DEFAULT_SETTINGS, date: "2026-06-21" })).toBe(false);
    expect(selectIsLive({ ...DEFAULT_SETTINGS, minuteOfDay: 0 })).toBe(false);
  });
});

describe("floors ⇄ heights", () => {
  test("constants", () => {
    expect(STOREY_HEIGHT_M).toBe(3);
    expect(EYE_HEIGHT_M).toBe(1.5);
    expect(MAX_FLOOR).toBe(100);
    expect(floorToHeightM(MAX_FLOOR)).toBeLessThanOrEqual(SETTINGS_LIMITS.heightM.max);
    expect(floorToHeightM(MAX_FLOOR) + STOREY_HEIGHT_M).toBeGreaterThan(
      SETTINGS_LIMITS.heightM.max,
    );
  });

  test("floor 1 is the ground floor, eye height 1.5 m, 3 m per storey", () => {
    expect(floorToHeightM(1)).toBe(1.5);
    expect(floorToHeightM(2)).toBe(4.5);
    expect(floorToHeightM(3)).toBe(7.5);
    expect(floorToHeightM(10)).toBe(28.5);
  });

  test("the old app's formula plus eye height: (floor − 1) × 3 + 1.5", () => {
    for (let floor = 1; floor <= MAX_FLOOR; floor++) {
      expect(floorToHeightM(floor)).toBe((floor - 1) * 3 + 1.5);
    }
  });

  test("odd floors are rounded and clamped", () => {
    expect(floorToHeightM(0)).toBe(1.5);
    expect(floorToHeightM(-4)).toBe(1.5);
    expect(floorToHeightM(2.4)).toBe(4.5);
    expect(floorToHeightM(2.5)).toBe(7.5);
    expect(floorToHeightM(1e9)).toBe(298.5);
    expect(floorToHeightM(NaN)).toBe(1.5);
    expect(floorToHeightM(Infinity)).toBe(1.5);
  });

  test("a height maps to the storey that contains it", () => {
    expect(heightMToFloor(0)).toBe(1);
    expect(heightMToFloor(1)).toBe(1);
    expect(heightMToFloor(1.5)).toBe(1);
    expect(heightMToFloor(2.99)).toBe(1);
    expect(heightMToFloor(3)).toBe(2);
    expect(heightMToFloor(4.5)).toBe(2);
    expect(heightMToFloor(7.5)).toBe(3);
    expect(heightMToFloor(300)).toBe(100);
    expect(heightMToFloor(-5)).toBe(1);
    expect(heightMToFloor(1e9)).toBe(100);
    expect(heightMToFloor(NaN)).toBe(1);
  });

  test("heightMToFloor inverts floorToHeightM for every floor", () => {
    for (let floor = 1; floor <= MAX_FLOOR; floor++) {
      expect(heightMToFloor(floorToHeightM(floor))).toBe(floor);
    }
  });

  test("for any store height: a whole floor in range, monotonic, within one storey", () => {
    const height = fc.double({ min: 0, max: 300, noNaN: true });
    fc.assert(
      fc.property(height, height, (a, b) => {
        const floor = heightMToFloor(a);
        expect(Number.isInteger(floor)).toBe(true);
        expect(floor).toBeGreaterThanOrEqual(1);
        expect(floor).toBeLessThanOrEqual(MAX_FLOOR);
        if (a <= b) expect(heightMToFloor(b)).toBeGreaterThanOrEqual(floor);
        if (a < 300) expect(Math.abs(floorToHeightM(floor) - a)).toBeLessThanOrEqual(1.5);
      }),
    );
  });
});
