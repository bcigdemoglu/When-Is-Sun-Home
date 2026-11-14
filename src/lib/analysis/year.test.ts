import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { computeHorizonProfile } from "@/lib/horizon/profile";
import { buildingFromLocal, collectionOf, rect, rotatedRect } from "@/lib/horizon/testing";
import { dateFromDayIndex, daysInYear } from "@/lib/solar/timezone";
import { computeSunYearGrid } from "@/lib/solar/yearGrid";
import {
  SunState,
  type BuildingFeature,
  type HorizonProfile,
  type LatLng,
  type Observer,
  type SunYearGrid,
  type YearAnalysis,
} from "@/lib/types";

import { classifySun } from "./classify";
import { analyzeYear } from "./year";

const SF: LatLng = { lat: 37.79, lng: -122.4294 };
const SYDNEY: LatLng = { lat: -33.8688, lng: 151.2093 };
const TROMSO: LatLng = { lat: 69.6492, lng: 18.9553 };
const QUITO: LatLng = { lat: -0.1807, lng: -78.4678 };

const yard = (heightM = 0): Observer => ({ mode: "yard", heightM, facingDeg: 0, fovDeg: 360 });
const windowFacing = (facingDeg: number, fovDeg: number, heightM = 0): Observer => ({
  mode: "window",
  heightM,
  facingDeg,
  fovDeg,
});

/** Plain assertion for hot loops (`expect` is slow when called 100k times). */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Real sun grids, computed once. 15-minute steps keep the property tests quick.
const sfGrid = computeSunYearGrid(SF, { year: 2026, timeZone: "America/Los_Angeles", stepMinutes: 15 });
const sydneyGrid = computeSunYearGrid(SYDNEY, {
  year: 2026,
  timeZone: "Australia/Sydney",
  stepMinutes: 15,
});
const tromsoGrid = computeSunYearGrid(TROMSO, { year: 2026, timeZone: "Europe/Oslo", stepMinutes: 15 });
const quitoGrid = computeSunYearGrid(QUITO, {
  year: 2026,
  timeZone: "America/Guayaquil",
  stepMinutes: 15,
});
const sfGrid5 = computeSunYearGrid(SF, { year: 2026, timeZone: "America/Los_Angeles", stepMinutes: 5 });

/**
 * A hand-made grid: every cell is night unless listed.
 * 6-hour steps → 4 slots per day, starting at minutes 0, 360, 720, 1080.
 */
function syntheticGrid(
  year: number,
  cells: { day: number; slot: number; azimuth: number; altitude: number }[],
): SunYearGrid {
  const dayCount = daysInYear(year);
  const slotsPerDay = 4;
  const azimuthDeg = new Float32Array(dayCount * slotsPerDay);
  const altitudeDeg = new Float32Array(dayCount * slotsPerDay).fill(-30);
  for (const cell of cells) {
    azimuthDeg[cell.day * slotsPerDay + cell.slot] = cell.azimuth;
    altitudeDeg[cell.day * slotsPerDay + cell.slot] = cell.altitude;
  }
  return {
    lat: 0,
    lng: 0,
    year,
    timeZone: "UTC",
    stepMinutes: 360,
    dayCount,
    slotsPerDay,
    azimuthDeg,
    altitudeDeg,
  };
}

/** A 30 m wall 10 m due south of the origin: 71.6° high over azimuths 180° ± 63°. */
const southWallHorizon = computeHorizonProfile(
  SF,
  collectionOf([buildingFromLocal(SF, [[rect(-20, -12, 20, -10)]], 30)]),
  0,
);

/** Every structural invariant a YearAnalysis must satisfy, checked against its own state grid. */
function expectInternallyConsistent(analysis: YearAnalysis, grid: SunYearGrid): void {
  const { dayCount, slotsPerDay, stepMinutes, state, days, months, annual } = analysis;
  check(analysis.year === grid.year, "year");
  check(analysis.timeZone === grid.timeZone, "timeZone");
  check(stepMinutes === grid.stepMinutes, "stepMinutes");
  check(dayCount === grid.dayCount && slotsPerDay === grid.slotsPerDay, "shape");
  check(state instanceof Uint8Array && state.length === dayCount * slotsPerDay, "state shape");
  check(days.length === dayCount, "days length");
  check(months.length === 12, "months length");

  let totalSun = 0;
  let totalDaylight = 0;
  let best = 0;
  let worst = 0;
  for (let d = 0; d < dayCount; d++) {
    const day = days[d];
    let sun = 0;
    let blocked = 0;
    let outOfView = 0;
    let first = -1;
    let last = -1;
    for (let s = 0; s < slotsPerDay; s++) {
      const code = state[d * slotsPerDay + s];
      check(code >= 0 && code <= 3, `invalid state ${code}`);
      if (code === SunState.Sun) {
        sun++;
        if (first < 0) first = s;
        last = s;
      } else if (code === SunState.Blocked) blocked++;
      else if (code === SunState.OutOfView) outOfView++;
    }
    check(day.dayIndex === d, `day ${d} index`);
    check(day.date === dateFromDayIndex(grid.year, d), `day ${d} date`);
    check(day.sunMinutes === sun * stepMinutes, `day ${d} sunMinutes`);
    check(day.blockedMinutes === blocked * stepMinutes, `day ${d} blockedMinutes`);
    check(day.outOfViewMinutes === outOfView * stepMinutes, `day ${d} outOfViewMinutes`);
    check(
      day.sunMinutes + day.blockedMinutes + day.outOfViewMinutes === day.daylightMinutes,
      `day ${d}: sun + blocked + outOfView !== daylight`,
    );
    check(day.daylightMinutes <= 1440, `day ${d} daylight > 24 h`);
    check(day.firstSunMinute === (first < 0 ? null : first * stepMinutes), `day ${d} firstSun`);
    check(day.lastSunMinute === (last < 0 ? null : (last + 1) * stepMinutes), `day ${d} lastSun`);
    totalSun += day.sunMinutes;
    totalDaylight += day.daylightMinutes;
    if (day.sunMinutes > days[best].sunMinutes) best = d;
    if (day.sunMinutes < days[worst].sunMinutes) worst = d;
  }

  // Months partition the year and add up to the days they contain.
  let cursor = 0;
  let monthSunHours = 0;
  months.forEach((month, m) => {
    check(month.month === m, `month ${m} index`);
    const slice = days.slice(cursor, cursor + month.dayCount);
    check(slice.length === month.dayCount && month.dayCount >= 28, `month ${m} dayCount`);
    check(
      slice.every((day) => Number(day.date.slice(5, 7)) === m + 1),
      `month ${m} holds the wrong days`,
    );
    const sun = slice.reduce((sum, day) => sum + day.sunMinutes, 0);
    const daylight = slice.reduce((sum, day) => sum + day.daylightMinutes, 0);
    expect(month.totalSunHours).toBeCloseTo(sun / 60, 9);
    expect(month.avgSunHours).toBeCloseTo(sun / 60 / month.dayCount, 9);
    expect(month.avgDaylightHours).toBeCloseTo(daylight / 60 / month.dayCount, 9);
    expect(month.minSunHours).toBeCloseTo(Math.min(...slice.map((day) => day.sunMinutes)) / 60, 9);
    expect(month.maxSunHours).toBeCloseTo(Math.max(...slice.map((day) => day.sunMinutes)) / 60, 9);
    check(month.minSunHours <= month.avgSunHours + 1e-9, `month ${m} min > avg`);
    check(month.avgSunHours <= month.maxSunHours + 1e-9, `month ${m} avg > max`);
    check(month.avgSunHours <= month.avgDaylightHours + 1e-9, `month ${m} sun > daylight`);
    cursor += month.dayCount;
    monthSunHours += month.totalSunHours;
  });
  check(cursor === dayCount, "months do not cover the year");

  expect(annual.totalSunHours).toBeCloseTo(totalSun / 60, 9);
  expect(annual.totalDaylightHours).toBeCloseTo(totalDaylight / 60, 9);
  expect(monthSunHours).toBeCloseTo(annual.totalSunHours, 6);
  expect(annual.avgSunHoursPerDay).toBeCloseTo(totalSun / 60 / dayCount, 9);
  expect(annual.sunFraction).toBeCloseTo(totalDaylight > 0 ? totalSun / totalDaylight : 0, 12);
  expect(annual.sunFraction).toBeGreaterThanOrEqual(0);
  expect(annual.sunFraction).toBeLessThanOrEqual(1);
  expect(annual.bestDayIndex).toBe(best);
  expect(annual.worstDayIndex).toBe(worst);
}

/** Is `a` at least as sunny as `b` in every single cell? */
function expectNeverSunnier(less: YearAnalysis, more: YearAnalysis): void {
  for (let i = 0; i < less.state.length; i++) {
    if (less.state[i] === SunState.Sun && more.state[i] !== SunState.Sun) {
      throw new Error(`cell ${i} is sunny in the case that should have less sun`);
    }
  }
  for (let d = 0; d < less.days.length; d++) {
    check(less.days[d].sunMinutes <= more.days[d].sunMinutes, `day ${d} has more sun`);
    check(less.days[d].daylightMinutes === more.days[d].daylightMinutes, `day ${d} daylight differs`);
  }
  check(less.annual.totalSunHours <= more.annual.totalSunHours, "annual total has more sun");
}

// ─── Generators ────────────────────────────────────────────────────────────

const span = (min: number, max: number) => fc.double({ min, max, noNaN: true });

const localBuilding = fc.record({
  cx: span(-120, 120),
  cy: span(-120, 120),
  halfWidth: span(2, 25),
  halfHeight: span(2, 25),
  rotation: span(0, 180),
  heightM: span(2, 60),
});
type LocalBuilding = typeof localBuilding extends fc.Arbitrary<infer T> ? T : never;

const toFeature = (place: LatLng, b: LocalBuilding, i: number): BuildingFeature =>
  buildingFromLocal(
    place,
    [[rotatedRect(b.cx, b.cy, b.halfWidth, b.halfHeight, b.rotation)]],
    b.heightM,
    `way/${i}`,
  );

const horizonFor = (place: LatLng, buildings: LocalBuilding[], observerHeightM: number) =>
  computeHorizonProfile(
    place,
    collectionOf(buildings.map((b, i) => toFeature(place, b, i))),
    observerHeightM,
  );

const scene = fc.record({
  site: fc.constantFrom(
    { place: SF, grid: sfGrid },
    { place: SYDNEY, grid: sydneyGrid },
    { place: TROMSO, grid: tromsoGrid },
    { place: QUITO, grid: quitoGrid },
  ),
  buildings: fc.array(localBuilding, { minLength: 0, maxLength: 12 }),
});

const anyObserver = fc.oneof(
  span(0, 20).map((h) => yard(h)),
  fc.tuple(span(0, 360), span(1, 360), span(0, 20)).map(([f, v, h]) => windowFacing(f, v, h)),
);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("analyzeYear: hand-made grid", () => {
  const grid = syntheticGrid(2026, [
    // 1 Jan: sun in the north at 06:00–12:00 and 12:00–18:00.
    { day: 0, slot: 1, azimuth: 0, altitude: 30 },
    { day: 0, slot: 2, azimuth: 10, altitude: 30 },
    // 2 Jan: nothing.
    // 3 Jan: one slot of open sun (north), one behind the 71.6° south wall.
    { day: 2, slot: 1, azimuth: 0, altitude: 30 },
    { day: 2, slot: 2, azimuth: 180, altitude: 30 },
    // 4 Jan: sun above the south wall.
    { day: 3, slot: 3, azimuth: 180, altitude: 80 },
    // 1 Feb (day 31): sun at the very first slot.
    { day: 31, slot: 0, azimuth: 90, altitude: 5 },
    // 31 Dec: all four slots sunny.
    { day: 364, slot: 0, azimuth: 0, altitude: 10 },
    { day: 364, slot: 1, azimuth: 0, altitude: 10 },
    { day: 364, slot: 2, azimuth: 0, altitude: 10 },
    { day: 364, slot: 3, azimuth: 0, altitude: 10 },
  ]);

  test("days", () => {
    const analysis = analyzeYear(grid, southWallHorizon, yard());
    expect(analysis.days[0]).toEqual({
      dayIndex: 0,
      date: "2026-01-01",
      sunMinutes: 720,
      daylightMinutes: 720,
      blockedMinutes: 0,
      outOfViewMinutes: 0,
      firstSunMinute: 360,
      lastSunMinute: 1080,
    });
    expect(analysis.days[1]).toEqual({
      dayIndex: 1,
      date: "2026-01-02",
      sunMinutes: 0,
      daylightMinutes: 0,
      blockedMinutes: 0,
      outOfViewMinutes: 0,
      firstSunMinute: null,
      lastSunMinute: null,
    });
    expect(analysis.days[2]).toEqual({
      dayIndex: 2,
      date: "2026-01-03",
      sunMinutes: 360,
      daylightMinutes: 720,
      blockedMinutes: 360,
      outOfViewMinutes: 0,
      firstSunMinute: 360,
      lastSunMinute: 720,
    });
    expect(analysis.days[3]).toMatchObject({ sunMinutes: 360, firstSunMinute: 1080, lastSunMinute: 1440 });
    expect(analysis.days[31]).toMatchObject({
      date: "2026-02-01",
      sunMinutes: 360,
      firstSunMinute: 0,
      lastSunMinute: 360,
    });
    expect(analysis.days[364]).toMatchObject({
      date: "2026-12-31",
      sunMinutes: 1440,
      daylightMinutes: 1440,
      firstSunMinute: 0,
      lastSunMinute: 1440,
    });
    expect(Array.from(analysis.state.subarray(0, 16))).toEqual([
      ...[SunState.Night, SunState.Sun, SunState.Sun, SunState.Night],
      ...[SunState.Night, SunState.Night, SunState.Night, SunState.Night],
      ...[SunState.Night, SunState.Sun, SunState.Blocked, SunState.Night],
      ...[SunState.Night, SunState.Night, SunState.Night, SunState.Sun],
    ]);
    expectInternallyConsistent(analysis, grid);
  });

  test("months and year", () => {
    const analysis = analyzeYear(grid, southWallHorizon, yard());
    expect(analysis.months).toHaveLength(12);
    expect(analysis.months.map((m) => m.dayCount)).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    // January: 12 + 0 + 6 + 6 = 24 h of sun out of 12 + 0 + 12 + 6 = 30 h of daylight.
    expect(analysis.months[0]).toMatchObject({
      month: 0,
      dayCount: 31,
      minSunHours: 0,
      maxSunHours: 12,
      totalSunHours: 24,
    });
    expect(analysis.months[0].avgSunHours).toBeCloseTo(24 / 31, 12);
    expect(analysis.months[0].avgDaylightHours).toBeCloseTo(30 / 31, 12);
    expect(analysis.months[1]).toMatchObject({ totalSunHours: 6, maxSunHours: 6, minSunHours: 0 });
    expect(analysis.months[5]).toEqual({
      month: 5,
      dayCount: 30,
      avgSunHours: 0,
      avgDaylightHours: 0,
      minSunHours: 0,
      maxSunHours: 0,
      totalSunHours: 0,
    });
    expect(analysis.months[11]).toMatchObject({ totalSunHours: 24, maxSunHours: 24 });
    expect(analysis.annual).toMatchObject({
      totalSunHours: 54,
      totalDaylightHours: 60,
      sunFraction: 0.9,
      bestDayIndex: 364,
      worstDayIndex: 1,
    });
    expect(analysis.annual.avgSunHoursPerDay).toBeCloseTo(54 / 365, 12);
  });

  test("without a horizon nothing is blocked", () => {
    const analysis = analyzeYear(grid, null, yard());
    expect(analysis.days[2]).toMatchObject({ sunMinutes: 720, blockedMinutes: 0, lastSunMinute: 1080 });
    expect(analysis.annual.sunFraction).toBe(1);
    expect(analysis.annual.totalSunHours).toBe(60);
  });

  test("a window only gets sun inside its cone", () => {
    // South-facing, 90° wide: the northern sun is out of view; the southern
    // sun is in view but (below 71.6°) behind the wall.
    const analysis = analyzeYear(grid, southWallHorizon, windowFacing(180, 90));
    expect(analysis.days[0]).toMatchObject({
      sunMinutes: 0,
      outOfViewMinutes: 720,
      blockedMinutes: 0,
      daylightMinutes: 720,
      firstSunMinute: null,
      lastSunMinute: null,
    });
    expect(analysis.days[2]).toMatchObject({ sunMinutes: 0, outOfViewMinutes: 360, blockedMinutes: 360 });
    expect(analysis.days[3]).toMatchObject({ sunMinutes: 360, outOfViewMinutes: 0, blockedMinutes: 0 });
    expect(analysis.annual.totalSunHours).toBe(6);
    expect(analysis.annual.totalDaylightHours).toBe(60);
    expect(analysis.annual.sunFraction).toBe(0.1);
    expectInternallyConsistent(analysis, grid);
  });

  test("an all-night year has zero fraction, not NaN", () => {
    const analysis = analyzeYear(syntheticGrid(2026, []), southWallHorizon, yard());
    expect(analysis.annual).toEqual({
      totalSunHours: 0,
      totalDaylightHours: 0,
      avgSunHoursPerDay: 0,
      sunFraction: 0,
      bestDayIndex: 0,
      worstDayIndex: 0,
    });
    expect(analysis.state.every((s) => s === SunState.Night)).toBe(true);
  });

  test("NaN cells (DST gap) are night", () => {
    const withGap = syntheticGrid(2026, [{ day: 5, slot: 1, azimuth: NaN, altitude: NaN }]);
    const analysis = analyzeYear(withGap, null, yard());
    expect(analysis.days[5].daylightMinutes).toBe(0);
    expect(analysis.state[5 * 4 + 1]).toBe(SunState.Night);
  });

  test("leap years: 29 February belongs to February", () => {
    const cell = { day: 59, slot: 1, azimuth: 0, altitude: 30 };
    const leap = analyzeYear(syntheticGrid(2024, [cell]), null, yard());
    expect(leap.dayCount).toBe(366);
    expect(leap.days).toHaveLength(366);
    expect(leap.days[59].date).toBe("2024-02-29");
    expect(leap.months[1]).toMatchObject({ dayCount: 29, totalSunHours: 6 });
    expect(leap.months[2].totalSunHours).toBe(0);
    expect(leap.months.reduce((n, m) => n + m.dayCount, 0)).toBe(366);
    expectInternallyConsistent(leap, syntheticGrid(2024, [cell]));

    const common = analyzeYear(syntheticGrid(2026, [cell]), null, yard());
    expect(common.days[59].date).toBe("2026-03-01");
    expect(common.months[1]).toMatchObject({ dayCount: 28, totalSunHours: 0 });
    expect(common.months[2].totalSunHours).toBe(6);
  });

  test("rejects a grid whose arrays do not match its shape", () => {
    const broken = { ...syntheticGrid(2026, []), altitudeDeg: new Float32Array(10) };
    expect(() => analyzeYear(broken, null, yard())).toThrow(RangeError);
  });
});

describe("analyzeYear: real sun grids", () => {
  test("every cell is classified exactly as classifySun would", () => {
    const horizons: (HorizonProfile | null)[] = [null, southWallHorizon];
    const observers = [yard(), windowFacing(180, 120), windowFacing(350, 60), windowFacing(90, 1)];
    for (const grid of [sfGrid, tromsoGrid]) {
      for (const horizon of horizons) {
        for (const observer of observers) {
          const analysis = analyzeYear(grid, horizon, observer);
          for (let i = 0; i < analysis.state.length; i++) {
            const expected = classifySun(grid.azimuthDeg[i], grid.altitudeDeg[i], horizon, observer);
            if (analysis.state[i] !== expected) {
              throw new Error(`cell ${i}: got ${analysis.state[i]}, classifySun says ${expected}`);
            }
          }
          expectInternallyConsistent(analysis, grid);
        }
      }
    }
  });

  test("no buildings, yard: direct sun for the whole of daylight", () => {
    for (const grid of [sfGrid, sydneyGrid, tromsoGrid, quitoGrid]) {
      const analysis = analyzeYear(grid, null, yard());
      for (const day of analysis.days) {
        check(day.sunMinutes === day.daylightMinutes, `${day.date}: sun !== daylight`);
        check(day.blockedMinutes === 0 && day.outOfViewMinutes === 0, `${day.date}: losses`);
      }
      expect(analysis.annual.sunFraction).toBe(1);
      expectInternallyConsistent(analysis, grid);
    }
  });

  test("seasons: longer days in June in the north, in December in the south", () => {
    const north = analyzeYear(sfGrid, null, yard());
    expect(north.months[5].avgDaylightHours).toBeGreaterThan(north.months[11].avgDaylightHours);
    expect(north.months[5].avgDaylightHours).toBeCloseTo(14.7, 0);
    expect(north.months[11].avgDaylightHours).toBeCloseTo(9.5, 0);
    expect(north.days[north.annual.bestDayIndex].date.slice(0, 7)).toBe("2026-06");
    expect(north.days[north.annual.worstDayIndex].date.slice(0, 7)).toBe("2026-12");

    const south = analyzeYear(sydneyGrid, null, yard());
    expect(south.months[11].avgDaylightHours).toBeGreaterThan(south.months[5].avgDaylightHours);
    expect(south.months[11].avgDaylightHours).toBeCloseTo(14.3, 0);
    expect(south.months[5].avgDaylightHours).toBeCloseTo(9.9, 0);
    // Day lengths are whole steps, so many days around a solstice tie and the
    // earliest wins: the southern "best day" of a calendar year is in early
    // January (the tail of the previous summer), not in December.
    expect(south.days[south.annual.bestDayIndex].date.slice(0, 7)).toBe("2026-01");
    expect(south.days[south.annual.bestDayIndex].sunMinutes).toBe(
      Math.max(...south.days.map((day) => day.sunMinutes)),
    );
    expect(["2026-05", "2026-06"]).toContain(south.days[south.annual.worstDayIndex].date.slice(0, 7));
  });

  test("at 37.79°N the year averages ≈ 12.1 h of daylight per day", () => {
    const analysis = analyzeYear(sfGrid5, null, yard());
    const meanDaylight = analysis.annual.totalDaylightHours / analysis.dayCount;
    expect(meanDaylight).toBeGreaterThan(12.0);
    expect(meanDaylight).toBeLessThan(12.3);
    expect(analysis.annual.avgSunHoursPerDay).toBeCloseTo(meanDaylight, 9);
    // Solstice day lengths (geometric, centre of the sun): ≈ 14 h 37 and ≈ 9 h 23.
    expect(analysis.days[171].daylightMinutes).toBeGreaterThanOrEqual(870);
    expect(analysis.days[171].daylightMinutes).toBeLessThanOrEqual(885);
    expect(analysis.days[354].daylightMinutes).toBeGreaterThanOrEqual(555);
    expect(analysis.days[354].daylightMinutes).toBeLessThanOrEqual(570);
  });

  test("the equator has ≈ 12 h days all year", () => {
    const analysis = analyzeYear(quitoGrid, null, yard());
    for (const month of analysis.months) {
      expect(month.avgDaylightHours).toBeGreaterThan(11.9);
      expect(month.avgDaylightHours).toBeLessThan(12.2);
    }
  });

  test("polar day and polar night", () => {
    const analysis = analyzeYear(tromsoGrid, null, yard());
    const midsummer = analysis.days[171];
    expect(midsummer.date).toBe("2026-06-21");
    expect(midsummer).toMatchObject({ sunMinutes: 1440, firstSunMinute: 0, lastSunMinute: 1440 });
    const midwinter = analysis.days[354];
    expect(midwinter.date).toBe("2026-12-21");
    expect(midwinter).toMatchObject({ sunMinutes: 0, daylightMinutes: 0, firstSunMinute: null });
    expect(analysis.months[5].avgDaylightHours).toBe(24);
    expect(analysis.months[11].avgDaylightHours).toBeLessThan(0.5);
    expect(analysis.annual.worstDayIndex).toBeLessThan(31); // the first sunless day, in January
  });

  test("a DST change does not create or destroy daylight", () => {
    const analysis = analyzeYear(sfGrid5, null, yard());
    // 8 March (spring forward) and 1 November (fall back) vs their neighbours.
    for (const day of [66, 304]) {
      const before = analysis.days[day - 1].daylightMinutes;
      const after = analysis.days[day + 1].daylightMinutes;
      expect(analysis.days[day].daylightMinutes).toBeGreaterThanOrEqual(Math.min(before, after) - 5);
      expect(analysis.days[day].daylightMinutes).toBeLessThanOrEqual(Math.max(before, after) + 5);
    }
    // …but first sun moves an hour later on the clock.
    expect(analysis.days[66].firstSunMinute! - analysis.days[65].firstSunMinute!).toBeGreaterThanOrEqual(55);
    expect(analysis.days[304].firstSunMinute! - analysis.days[303].firstSunMinute!).toBeLessThanOrEqual(-55);
  });

  test("a tall wall to the south costs winter sun but not summer-noon sun (northern hemisphere)", () => {
    const analysis = analyzeYear(sfGrid5, southWallHorizon, yard());
    const open = analyzeYear(sfGrid5, null, yard());
    expectNeverSunnier(analysis, open);
    // December: the sun never climbs above 29°, and spends most of the day
    // within the wall's ±63° of south.
    expect(analysis.months[11].avgSunHours).toBeLessThan(open.months[11].avgSunHours * 0.4);
    // June: the sun rises and sets north of east/west and peaks at 75.7° > 71.6°.
    expect(analysis.months[5].avgSunHours).toBeGreaterThan(open.months[5].avgSunHours * 0.5);
    expect(analysis.months[5].avgSunHours).toBeGreaterThan(analysis.months[11].avgSunHours * 3);
    expect(analysis.annual.sunFraction).toBeGreaterThan(0);
    expect(analysis.annual.sunFraction).toBeLessThan(1);
  });

  test("windows: north-facing gets no winter sun in the north; south-facing gets the midday sun", () => {
    const north = analyzeYear(sfGrid5, null, windowFacing(0, 160));
    const south = analyzeYear(sfGrid5, null, windowFacing(180, 160));
    expect(north.months[11].totalSunHours).toBe(0);
    expect(north.months[0].totalSunHours).toBe(0);
    expect(north.months[5].avgSunHours).toBeGreaterThan(2); // early morning + late evening
    expect(south.months[11].avgSunHours).toBeGreaterThan(9);
    expect(south.annual.totalSunHours).toBeGreaterThan(north.annual.totalSunHours * 3);
    // Opposite 180° windows split the daylight between them (each cell goes to
    // at least one; cells exactly on the shared edge go to both).
    const east = analyzeYear(sfGrid5, null, windowFacing(90, 180));
    const west = analyzeYear(sfGrid5, null, windowFacing(270, 180));
    const all = analyzeYear(sfGrid5, null, yard());
    const minutes = (a: YearAnalysis) => a.days.reduce((sum, day) => sum + day.sunMinutes, 0);
    expect(minutes(east) + minutes(west)).toBeGreaterThanOrEqual(minutes(all));
    expect(minutes(east) + minutes(west)).toBeLessThan(minutes(all) + 60);
    for (const analysis of [north, south, east, west]) expectInternallyConsistent(analysis, sfGrid5);
  });
});

describe("analyzeYear: invariants (property tests)", () => {
  test("internal consistency for any buildings and any observer", () => {
    fc.assert(
      fc.property(scene, anyObserver, ({ site, buildings }, observer) => {
        const horizon = horizonFor(site.place, buildings, observer.heightM);
        const analysis = analyzeYear(site.grid, horizon, observer);
        expectInternallyConsistent(analysis, site.grid);
        if (observer.mode === "yard") {
          check(!analysis.state.includes(SunState.OutOfView), "yard has out-of-view cells");
        }
        // Buildings and view cones only ever take daylight away.
        expectNeverSunnier(analysis, analyzeYear(site.grid, null, yard()));
      }),
      { numRuns: 60 },
    );
  });

  test("adding buildings never increases sun", () => {
    fc.assert(
      fc.property(
        scene,
        fc.array(localBuilding, { minLength: 1, maxLength: 4 }),
        anyObserver,
        ({ site, buildings }, extra, observer) => {
          const fewer = analyzeYear(
            site.grid,
            horizonFor(site.place, buildings, observer.heightM),
            observer,
          );
          const more = analyzeYear(
            site.grid,
            horizonFor(site.place, [...buildings, ...extra], observer.heightM),
            observer,
          );
          expectNeverSunnier(more, fewer);
        },
      ),
      { numRuns: 60 },
    );
  });

  test("raising the observer never decreases sun", () => {
    fc.assert(
      fc.property(scene, span(0, 30), span(0, 30), fc.boolean(), ({ site, buildings }, a, b, win) => {
        const lowHeight = Math.min(a, b);
        const highHeight = Math.max(a, b);
        const observerAt = (h: number) => (win ? windowFacing(170, 150, h) : yard(h));
        const low = analyzeYear(
          site.grid,
          horizonFor(site.place, buildings, lowHeight),
          observerAt(lowHeight),
        );
        const high = analyzeYear(
          site.grid,
          horizonFor(site.place, buildings, highHeight),
          observerAt(highHeight),
        );
        expectNeverSunnier(low, high);
      }),
      { numRuns: 60 },
    );
  });

  test("narrowing the field of view never increases sun", () => {
    fc.assert(
      fc.property(
        scene,
        span(0, 360),
        span(1, 360),
        span(1, 360),
        span(0, 20),
        ({ site, buildings }, facing, a, b, heightM) => {
          const horizon = horizonFor(site.place, buildings, heightM);
          const narrow = analyzeYear(site.grid, horizon, windowFacing(facing, Math.min(a, b), heightM));
          const wide = analyzeYear(site.grid, horizon, windowFacing(facing, Math.max(a, b), heightM));
          expectNeverSunnier(narrow, wide);
          // And a yard is at least as sunny as any window at the same spot.
          expectNeverSunnier(wide, analyzeYear(site.grid, horizon, yard(heightM)));
        },
      ),
      { numRuns: 60 },
    );
  });

  test("a full-circle window is exactly a yard", () => {
    fc.assert(
      fc.property(scene, span(0, 360), ({ site, buildings }, facing) => {
        const horizon = horizonFor(site.place, buildings, 0);
        const asWindow = analyzeYear(site.grid, horizon, windowFacing(facing, 360));
        const asYard = analyzeYear(site.grid, horizon, yard());
        expect(asWindow.state).toEqual(asYard.state);
        expect(asWindow.annual).toEqual(asYard.annual);
      }),
      { numRuns: 20 },
    );
  });
});

describe("analyzeYear: performance", () => {
  test("a 5-minute year takes a few milliseconds", () => {
    const observer = windowFacing(180, 150);
    for (let i = 0; i < 5; i++) analyzeYear(sfGrid5, southWallHorizon, observer); // warm up
    const timings: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      analyzeYear(sfGrid5, southWallHorizon, observer);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)];
    console.log(`analyzeYear (5-min grid, 105,120 cells): median ${median.toFixed(2)} ms`);
    // Target is < 10 ms; the assertion is looser so a busy CI box does not flake.
    expect(median).toBeLessThan(30);
  });
});
