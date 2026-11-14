import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { computeHorizonProfile } from "@/lib/horizon/profile";
import { buildingFromLocal, collectionOf, rect } from "@/lib/horizon/testing";
import { sunPositionAt, sunTimesFor } from "@/lib/solar/position";
import { dateFromDayIndex, dayIndexFromDate } from "@/lib/solar/timezone";
import { computeSunYearGrid } from "@/lib/solar/yearGrid";
import { SunState, type LatLng, type Observer, type SunStateCode } from "@/lib/types";

import { classifySun } from "./classify";
import { analyzeDay, windowsFromStates } from "./day";
import { analyzeYear } from "./year";

const SF: LatLng = { lat: 37.7906, lng: -122.4294 };
const ZONE = "America/Los_Angeles";
const TROMSO: LatLng = { lat: 69.6492, lng: 18.9553 };

const yard = (heightM = 0): Observer => ({ mode: "yard", heightM, facingDeg: 0, fovDeg: 360 });
const windowFacing = (facingDeg: number, fovDeg: number): Observer => ({
  mode: "window",
  heightM: 0,
  facingDeg,
  fovDeg,
});

const N = SunState.Night;
const S = SunState.Sun;
const B = SunState.Blocked;
const O = SunState.OutOfView;

describe("windowsFromStates", () => {
  test("empty input and sunless days have no windows", () => {
    expect(windowsFromStates([], 60)).toEqual([]);
    expect(windowsFromStates([N, N, N, N], 60)).toEqual([]);
    expect(windowsFromStates([N, B, O, B, N], 60)).toEqual([]);
  });

  test("adjacent sunny steps merge into one [start, end) window", () => {
    expect(windowsFromStates([N, S, S, S, N], 60)).toEqual([{ startMinute: 60, endMinute: 240 }]);
    expect(windowsFromStates([N, S, N], 5)).toEqual([{ startMinute: 5, endMinute: 10 }]);
  });

  test("anything that is not Sun splits windows", () => {
    expect(windowsFromStates([S, S, B, S, O, S, N, S], 10)).toEqual([
      { startMinute: 0, endMinute: 20 },
      { startMinute: 30, endMinute: 40 },
      { startMinute: 50, endMinute: 60 },
      { startMinute: 70, endMinute: 80 },
    ]);
  });

  test("windows touching midnight at either end", () => {
    const states = new Array<SunStateCode>(24).fill(N);
    states[0] = S;
    states[1] = S;
    states[23] = S;
    expect(windowsFromStates(states, 60)).toEqual([
      { startMinute: 0, endMinute: 120 },
      { startMinute: 1380, endMinute: 1440 },
    ]);
  });

  test("an all-sun polar day is one window covering the whole day", () => {
    expect(windowsFromStates(new Array(1440).fill(S), 1)).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
    expect(windowsFromStates(new Uint8Array(288).fill(S), 5)).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });

  test("explicit minutes: a missing stretch of the clock splits a window", () => {
    // Steps at 00:00, 01:00, then (DST gap) 03:00, 04:00 — all sunny.
    expect(windowsFromStates([S, S, S, S], 60, [0, 60, 180, 240])).toEqual([
      { startMinute: 0, endMinute: 120 },
      { startMinute: 180, endMinute: 300 },
    ]);
    // Contiguous explicit minutes still merge.
    expect(windowsFromStates([S, S, B, S], 30, [600, 630, 660, 690])).toEqual([
      { startMinute: 600, endMinute: 660 },
      { startMinute: 690, endMinute: 720 },
    ]);
  });

  test("windows are disjoint, ordered, maximal, and cover exactly the sunny steps", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<SunStateCode>(N, S, B, O), { maxLength: 300 }),
        fc.constantFrom(1, 5, 15, 60),
        (states, step) => {
          const windows = windowsFromStates(states, step);
          const covered = new Array(states.length).fill(false);
          let previousEnd = -1;
          for (const w of windows) {
            expect(w.startMinute).toBeLessThan(w.endMinute);
            // Strictly after the previous window, with a gap (else they would have merged).
            expect(w.startMinute).toBeGreaterThan(previousEnd);
            previousEnd = w.endMinute;
            for (let i = w.startMinute / step; i < w.endMinute / step; i++) covered[i] = true;
          }
          expect(covered).toEqual(states.map((state) => state === S));
          const total = windows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
          expect(total).toBe(states.filter((state) => state === S).length * step);
        },
      ),
    );
  });
});

describe("analyzeDay", () => {
  test("a clear summer day: one window from (geometric) sunrise to sunset", () => {
    const day = analyzeDay(SF, "2026-06-21", ZONE, null, yard());
    expect(day.date).toBe("2026-06-21");
    expect(day.timeZone).toBe(ZONE);
    expect(day.stepMinutes).toBe(1);
    expect(day.samples).toHaveLength(1440);
    expect(day.windows).toHaveLength(1);
    const [window] = day.windows;
    expect(window.endMinute - window.startMinute).toBe(day.sunMinutes);
    expect(day.sunMinutes).toBe(day.daylightMinutes);
    // ≈ 14 h 37 min with the sun's centre above the geometric horizon.
    expect(day.daylightMinutes).toBeGreaterThan(14 * 60 + 30);
    expect(day.daylightMinutes).toBeLessThan(14 * 60 + 45);

    // The almanac sunrise / sunset (upper limb, refracted) bracket the window
    // by a few minutes on each side.
    const times = sunTimesFor(SF.lat, SF.lng, "2026-06-21", ZONE);
    expect(day.sunriseMinute).toBe(times.sunriseMinute);
    expect(day.sunsetMinute).toBe(times.sunsetMinute);
    expect(day.solarNoonMinute).toBe(times.solarNoonMinute);
    expect(window.startMinute - day.sunriseMinute!).toBeGreaterThan(0);
    expect(window.startMinute - day.sunriseMinute!).toBeLessThan(8);
    expect(day.sunsetMinute! - window.endMinute).toBeGreaterThan(0);
    expect(day.sunsetMinute! - window.endMinute).toBeLessThan(8);
    expect(day.solarNoonMinute!).toBeGreaterThan(window.startMinute);
    expect(day.solarNoonMinute!).toBeLessThan(window.endMinute);
  });

  test("samples carry the start minute and the position at the step's midpoint", () => {
    const day = analyzeDay(SF, "2026-06-21", ZONE, null, yard(), 10);
    expect(day.stepMinutes).toBe(10);
    expect(day.samples).toHaveLength(144);
    expect(day.samples.map((s) => s.minute)).toEqual(Array.from({ length: 144 }, (_, i) => i * 10));
    // Step starting 12:00 PDT is sampled at 12:05 PDT = 19:05 UTC.
    const noonStep = day.samples[72];
    expect(noonStep.minute).toBe(720);
    const expected = sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T19:05:00Z"));
    expect(noonStep.azimuthDeg).toBe(expected.azimuthDeg);
    expect(noonStep.altitudeDeg).toBe(expected.altitudeDeg);
    expect(noonStep.state).toBe(SunState.Sun);
    for (const sample of day.samples) {
      expect(sample.state).toBe(classifySun(sample.azimuthDeg, sample.altitudeDeg, null, yard()));
    }
  });

  test("totals follow from the samples; windows add up to the sun minutes", () => {
    // A 30 m slab 40 m to the south hides the low sun around midday in winter.
    const horizon = computeHorizonProfile(
      SF,
      collectionOf([buildingFromLocal(SF, [[rect(-15, -50, 15, -40)]], 30)]),
      0,
    );
    const day = analyzeDay(SF, "2026-12-21", ZONE, horizon, yard());
    const count = (state: SunStateCode) => day.samples.filter((s) => s.state === state).length;
    expect(day.sunMinutes).toBe(count(S));
    expect(day.daylightMinutes).toBe(count(S) + count(B) + count(O));
    expect(count(B)).toBeGreaterThan(60);
    expect(count(O)).toBe(0);
    // Morning sun, hidden behind the slab, afternoon sun: two windows.
    expect(day.windows).toHaveLength(2);
    expect(day.windows[0].endMinute).toBeLessThan(day.solarNoonMinute!);
    expect(day.windows[1].startMinute).toBeGreaterThan(day.solarNoonMinute!);
    const total = day.windows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
    expect(total).toBe(day.sunMinutes);
    // Every sample inside a window is Sun, every sample outside is not.
    for (const sample of day.samples) {
      const inWindow = day.windows.some(
        (w) => sample.minute >= w.startMinute && sample.minute < w.endMinute,
      );
      expect(inWindow).toBe(sample.state === S);
    }
  });

  test("a window observer loses the part of the day outside its cone", () => {
    const east = analyzeDay(SF, "2026-06-21", ZONE, null, windowFacing(90, 180));
    const all = analyzeDay(SF, "2026-06-21", ZONE, null, yard());
    expect(east.daylightMinutes).toBe(all.daylightMinutes);
    expect(east.windows).toHaveLength(1);
    expect(east.windows[0].startMinute).toBe(all.windows[0].startMinute);
    // The sun crosses due south at solar noon, leaving an east-facing cone.
    expect(Math.abs(east.windows[0].endMinute - all.solarNoonMinute!)).toBeLessThan(3);
    expect(east.samples.filter((s) => s.state === O).length).toBe(
      all.daylightMinutes - east.sunMinutes,
    );
  });

  test("spring-forward day: the skipped hour has no samples", () => {
    const day = analyzeDay(SF, "2026-03-08", ZONE, null, yard());
    expect(day.samples).toHaveLength(1380);
    const minutes = new Set(day.samples.map((s) => s.minute));
    expect(minutes.has(119)).toBe(true);
    expect(minutes.has(120)).toBe(false);
    expect(minutes.has(179)).toBe(false);
    expect(minutes.has(180)).toBe(true);
    // The step before the gap and the step after it are one real minute apart.
    const before = day.samples.find((s) => s.minute === 119)!;
    const after = day.samples.find((s) => s.minute === 180)!;
    expect(Math.abs(after.azimuthDeg - before.azimuthDeg)).toBeLessThan(0.5);
    expect(day.windows).toHaveLength(1);
    // Daylight is unaffected (the change happens at night).
    const dayBefore = analyzeDay(SF, "2026-03-07", ZONE, null, yard());
    expect(Math.abs(day.daylightMinutes - dayBefore.daylightMinutes)).toBeLessThanOrEqual(4);
  });

  test("fall-back day: 1440 wall-clock samples, the repeated hour taken at its first pass", () => {
    const day = analyzeDay(SF, "2026-11-01", ZONE, null, yard());
    expect(day.samples).toHaveLength(1440);
    // 01:30 → first occurrence, 01:30:30 PDT = 08:30:30 UTC.
    const sample = day.samples.find((s) => s.minute === 90)!;
    expect(sample.altitudeDeg).toBe(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-11-01T08:30:30Z")).altitudeDeg,
    );
    // 02:00 is PST again: 10:00:30 UTC.
    const later = day.samples.find((s) => s.minute === 120)!;
    expect(later.altitudeDeg).toBe(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-11-01T10:00:30Z")).altitudeDeg,
    );
  });

  test("polar day: one window over the whole day; polar night: none", () => {
    const midsummer = analyzeDay(TROMSO, "2026-06-21", "Europe/Oslo", null, yard());
    expect(midsummer.windows).toEqual([{ startMinute: 0, endMinute: 1440 }]);
    expect(midsummer.sunMinutes).toBe(1440);
    expect(midsummer.daylightMinutes).toBe(1440);
    expect(midsummer.sunriseMinute).toBeNull();
    expect(midsummer.sunsetMinute).toBeNull();
    expect(midsummer.solarNoonMinute).not.toBeNull();

    const midwinter = analyzeDay(TROMSO, "2026-12-21", "Europe/Oslo", null, yard());
    expect(midwinter.windows).toEqual([]);
    expect(midwinter.sunMinutes).toBe(0);
    expect(midwinter.daylightMinutes).toBe(0);
    expect(midwinter.sunriseMinute).toBeNull();
    expect(midwinter.sunsetMinute).toBeNull();
    expect(midwinter.samples.every((s) => s.state === N)).toBe(true);
  });

  test("a 5-minute day reproduces the matching row of the year analysis", () => {
    const horizon = computeHorizonProfile(
      SF,
      collectionOf([
        buildingFromLocal(SF, [[rect(-15, -50, 15, -40)]], 30),
        buildingFromLocal(SF, [[rect(30, -10, 40, 30)]], 18, "way/2"),
      ]),
      1.5,
    );
    const observer = yard(1.5);
    const grid = computeSunYearGrid(SF, { year: 2026, timeZone: ZONE, stepMinutes: 5 });
    const year = analyzeYear(grid, horizon, observer);
    for (const date of ["2026-01-10", "2026-03-08", "2026-06-21", "2026-11-01", "2026-12-21"]) {
      const day = analyzeDay(SF, date, ZONE, horizon, observer, 5);
      const index = dayIndexFromDate(date);
      const row = year.state.subarray(index * 288, (index + 1) * 288);
      // The grid stores positions as float32, so a sample sitting exactly on
      // the skyline could in principle flip; allow one step of slack in total.
      let differences = 0;
      for (const sample of day.samples) {
        if (row[sample.minute / 5] !== sample.state) differences++;
      }
      expect(differences, date).toBeLessThanOrEqual(1);
      expect(Math.abs(day.sunMinutes - year.days[index].sunMinutes), date).toBeLessThanOrEqual(5);
      expect(Math.abs(day.daylightMinutes - year.days[index].daylightMinutes)).toBeLessThanOrEqual(
        5,
      );
      // windowsFromStates works on a year row too.
      const rowWindows = windowsFromStates(row, 5);
      if (differences === 0) {
        const gapFree = day.samples.length === 288;
        if (gapFree) expect(rowWindows).toEqual(day.windows);
        expect(rowWindows[0]?.startMinute ?? null).toBe(year.days[index].firstSunMinute);
        expect(rowWindows[rowWindows.length - 1]?.endMinute ?? null).toBe(
          year.days[index].lastSunMinute,
        );
      }
    }
  });

  test("finer steps converge on the same amount of sun", () => {
    const horizon = computeHorizonProfile(
      SF,
      collectionOf([buildingFromLocal(SF, [[rect(-15, -50, 15, -40)]], 30)]),
      0,
    );
    const fine = analyzeDay(SF, "2026-12-21", ZONE, horizon, yard(), 1);
    const coarse = analyzeDay(SF, "2026-12-21", ZONE, horizon, yard(), 5);
    // Each sun/shade boundary can be off by at most half a coarse step.
    expect(Math.abs(fine.sunMinutes - coarse.sunMinutes)).toBeLessThanOrEqual(10);
    expect(coarse.windows).toHaveLength(fine.windows.length);
  });

  test("rejects steps that do not divide the day, and bad dates", () => {
    expect(() => analyzeDay(SF, "2026-06-21", ZONE, null, yard(), 7)).toThrow(RangeError);
    expect(() => analyzeDay(SF, "2026-06-21", ZONE, null, yard(), 0)).toThrow(RangeError);
    expect(() => analyzeDay(SF, "2026-06-31", ZONE, null, yard())).toThrow(RangeError);
  });

  test("invariants hold on any day of the year", () => {
    const horizon = computeHorizonProfile(
      SF,
      collectionOf([buildingFromLocal(SF, [[rect(-15, -50, 15, -40)]], 30)]),
      0,
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.constantFrom(1, 2, 5, 15),
        fc.boolean(),
        (dayIndex, step, useWindow) => {
          const date = dateFromDayIndex(2026, dayIndex);
          const observer = useWindow ? windowFacing(200, 140) : yard();
          const day = analyzeDay(SF, date, ZONE, horizon, observer, step);
          const sunny = day.samples.filter((s) => s.state === S).length;
          const lit = day.samples.filter((s) => s.state !== N).length;
          expect(day.sunMinutes).toBe(sunny * step);
          expect(day.daylightMinutes).toBe(lit * step);
          expect(day.sunMinutes).toBeLessThanOrEqual(day.daylightMinutes);
          const total = day.windows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
          expect(total).toBe(day.sunMinutes);
          expect(day.samples.length).toBeLessThanOrEqual(1440 / step);
          for (let i = 1; i < day.samples.length; i++) {
            expect(day.samples[i].minute).toBeGreaterThan(day.samples[i - 1].minute);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
