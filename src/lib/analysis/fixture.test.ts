/**
 * End-to-end run on real buildings: ~300 m of Pacific Heights, San Francisco.
 * Horizon → year grid → year analysis → day analysis, checked for sanity,
 * invariants and speed. Prints a monthly table for eyeballing.
 */
import { describe, expect, test } from "vitest";

import { loadPacificHeights, PACIFIC_HEIGHTS } from "@/lib/horizon/testing";
import { SunState, type Observer } from "@/lib/types";

import {
  analyzeDay,
  analyzeYear,
  classifySun,
  computeHorizonProfile,
  computeShadowPolygons,
  computeSunYearGrid,
  dateFromDayIndex,
  sunInstantAt,
  timeZoneAt,
  windowsFromStates,
} from "./index";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Best-of-N wall-clock time of `run`, ms (the first call also warms the JIT). */
function timeIt<T>(run: () => T, repeats = 5): { result: T; firstMs: number; bestMs: number } {
  let start = performance.now();
  const result = run();
  const firstMs = performance.now() - start;
  let bestMs = firstMs;
  for (let i = 1; i < repeats; i++) {
    start = performance.now();
    run();
    bestMs = Math.min(bestMs, performance.now() - start);
  }
  return { result, firstMs, bestMs };
}

describe("Pacific Heights fixture, end to end", () => {
  const place = PACIFIC_HEIGHTS;
  const buildings = loadPacificHeights();
  const observer: Observer = { mode: "yard", heightM: 1, facingDeg: 0, fovDeg: 360 };
  const timeZone = timeZoneAt(place.lat, place.lng);

  const horizonRun = timeIt(() => computeHorizonProfile(place, buildings, observer.heightM));
  const gridRun = timeIt(
    () => computeSunYearGrid(place, { year: 2026, timeZone, stepMinutes: 5 }),
    3,
  );
  const horizon = horizonRun.result;
  const grid = gridRun.result;
  const yearRun = timeIt(() => analyzeYear(grid, horizon, observer), 10);
  const year = yearRun.result;
  const open = analyzeYear(grid, null, observer);

  test("fixture loads into the current contract", () => {
    expect(buildings.features.length).toBe(384);
    for (const feature of buildings.features) {
      expect(feature.properties.id).toMatch(/^way\/\d+$/);
      expect(feature.properties.heightM).toBeGreaterThan(0);
      expect(feature.properties.heightSource).toBe("tagged");
    }
  });

  test("time zone and calendar", () => {
    expect(timeZone).toBe("America/Los_Angeles");
    expect(year.timeZone).toBe("America/Los_Angeles");
    expect(year.year).toBe(2026);
    expect(year.dayCount).toBe(365);
    expect(year.days).toHaveLength(365);
    expect(year.slotsPerDay).toBe(288);
    expect(year.stepMinutes).toBe(5);
    expect(year.state.length).toBe(365 * 288);
    expect(year.months).toHaveLength(12);
    expect(year.days[0].date).toBe("2026-01-01");
    expect(year.days[364].date).toBe("2026-12-31");
  });

  test("the skyline is plausible for a dense low-rise neighbourhood", () => {
    expect(horizon.binCount).toBe(720);
    const elevations = Array.from(horizon.elevationDeg);
    const blocked = elevations.filter((e) => e > 0).length;
    const max = Math.max(...elevations);
    const mean = elevations.reduce((a, b) => a + b, 0) / elevations.length;
    console.log(
      `horizon: ${blocked}/720 bins obstructed, mean ${mean.toFixed(1)}°, max ${max.toFixed(1)}°, ` +
        `containing building index ${horizon.containingBuildingIndex}`,
    );
    expect(blocked).toBeGreaterThan(360); // built up on most sides
    expect(max).toBeGreaterThan(5);
    expect(max).toBeLessThan(90);
    for (let bin = 0; bin < 720; bin++) {
      const index = horizon.blockerIndex[bin];
      if (horizon.elevationDeg[bin] > 0) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(buildings.features.length);
        expect(index).not.toBe(horizon.containingBuildingIndex);
        const rise = buildings.features[index].properties.heightM - observer.heightM;
        const distance = horizon.blockerDistanceM[bin];
        expect(distance).toBeGreaterThanOrEqual(0.5);
        expect(distance).toBeLessThan(1000);
        expect((Math.atan2(rise, distance) * 180) / Math.PI).toBeCloseTo(
          horizon.elevationDeg[bin],
          3,
        );
      } else {
        expect(index).toBe(-1);
      }
    }
  });

  test("annual result is sane: some sun, some shade", () => {
    const { annual } = year;
    expect(annual.sunFraction).toBeGreaterThan(0);
    expect(annual.sunFraction).toBeLessThan(1);
    expect(annual.totalSunHours).toBeGreaterThan(0);
    expect(annual.totalSunHours).toBeLessThan(annual.totalDaylightHours);
    expect(annual.totalDaylightHours).toBe(open.annual.totalDaylightHours);
    // ≈ 12.1 h of daylight per day over the year at 37.79°N.
    const meanDaylight = annual.totalDaylightHours / year.dayCount;
    expect(meanDaylight).toBeGreaterThan(12.0);
    expect(meanDaylight).toBeLessThan(12.3);
    expect(annual.avgSunHoursPerDay).toBeCloseTo(annual.totalSunHours / 365, 9);
    expect(annual.sunFraction).toBeCloseTo(annual.totalSunHours / annual.totalDaylightHours, 12);
    expect(year.days[annual.bestDayIndex].sunMinutes).toBe(
      Math.max(...year.days.map((d) => d.sunMinutes)),
    );
    expect(year.days[annual.worstDayIndex].sunMinutes).toBe(
      Math.min(...year.days.map((d) => d.sunMinutes)),
    );
    // Northern hemisphere: more daylight, and here more sun, in June than December.
    expect(year.months[5].avgDaylightHours).toBeGreaterThan(year.months[11].avgDaylightHours);
    expect(year.months[5].avgSunHours).toBeGreaterThan(year.months[11].avgSunHours);

    const lines = [
      `Pacific Heights (${place.lat}, ${place.lng}), yard observer at ${observer.heightM} m, 2026, 5-minute steps`,
      "month  days  sun h/day  daylight h/day  sun/daylight  min..max sun h",
      ...year.months.map(
        (m) =>
          `${MONTH_NAMES[m.month]}    ${String(m.dayCount).padStart(4)}  ` +
          `${m.avgSunHours.toFixed(2).padStart(9)}  ${m.avgDaylightHours.toFixed(2).padStart(14)}  ` +
          `${((100 * m.avgSunHours) / m.avgDaylightHours).toFixed(0).padStart(11)}%  ` +
          `${m.minSunHours.toFixed(2)}..${m.maxSunHours.toFixed(2)}`,
      ),
      `year   ${String(year.dayCount).padStart(4)}  ${annual.avgSunHoursPerDay.toFixed(2).padStart(9)}  ` +
        `${meanDaylight.toFixed(2).padStart(14)}  ${(100 * annual.sunFraction).toFixed(0).padStart(11)}%  ` +
        `total ${annual.totalSunHours.toFixed(0)} h of ${annual.totalDaylightHours.toFixed(0)} h; ` +
        `best ${year.days[annual.bestDayIndex].date}, worst ${year.days[annual.worstDayIndex].date}`,
    ];
    console.log(lines.join("\n"));
  });

  test("every invariant holds on the real data", () => {
    let totalSun = 0;
    let totalDaylight = 0;
    for (const day of year.days) {
      expect(day.sunMinutes + day.blockedMinutes + day.outOfViewMinutes).toBe(day.daylightMinutes);
      expect(day.outOfViewMinutes).toBe(0); // yard
      expect(day.date).toBe(dateFromDayIndex(2026, day.dayIndex));
      // Buildings never add sun, and never change daylight.
      expect(day.sunMinutes).toBeLessThanOrEqual(open.days[day.dayIndex].sunMinutes);
      expect(day.daylightMinutes).toBe(open.days[day.dayIndex].daylightMinutes);
      if (day.sunMinutes > 0) {
        expect(day.firstSunMinute).not.toBeNull();
        expect(day.lastSunMinute! - day.firstSunMinute!).toBeGreaterThanOrEqual(day.sunMinutes);
      } else {
        expect(day.firstSunMinute).toBeNull();
        expect(day.lastSunMinute).toBeNull();
      }
      totalSun += day.sunMinutes;
      totalDaylight += day.daylightMinutes;
    }
    expect(year.annual.totalSunHours).toBeCloseTo(totalSun / 60, 9);
    expect(year.annual.totalDaylightHours).toBeCloseTo(totalDaylight / 60, 9);
    expect(year.months.reduce((sum, m) => sum + m.totalSunHours, 0)).toBeCloseTo(totalSun / 60, 6);
    expect(year.months.reduce((sum, m) => sum + m.dayCount, 0)).toBe(365);

    // Without building data, a yard gets sun for the whole of daylight.
    for (const day of open.days) expect(day.sunMinutes).toBe(day.daylightMinutes);
    expect(open.annual.sunFraction).toBe(1);

    // Cell by cell: analyzeYear is exactly classifySun over the grid.
    for (let i = 0; i < year.state.length; i++) {
      const expected = classifySun(grid.azimuthDeg[i], grid.altitudeDeg[i], horizon, observer);
      if (year.state[i] !== expected) throw new Error(`cell ${i}: ${year.state[i]} vs ${expected}`);
    }
  });

  test("raising the observer never loses sun; a rooftop clears almost everything", () => {
    let previous = year;
    for (const heightM of [3, 6, 10, 20, 40, 80]) {
      const raised = analyzeYear(grid, computeHorizonProfile(place, buildings, heightM), {
        ...observer,
        heightM,
      });
      for (let i = 0; i < raised.state.length; i++) {
        if (previous.state[i] === SunState.Sun && raised.state[i] !== SunState.Sun) {
          throw new Error(`cell ${i} lost its sun when the observer rose to ${heightM} m`);
        }
      }
      expect(raised.annual.totalSunHours).toBeGreaterThanOrEqual(previous.annual.totalSunHours);
      previous = raised;
    }
    // Above the tallest building in the fixture (60 m) nothing is left to block.
    expect(previous.annual.sunFraction).toBe(1);
  });

  test("removing half the buildings never loses sun; a window never beats the yard", () => {
    const thinned = {
      ...buildings,
      features: buildings.features.filter((_, i) => i % 2 === 0),
    };
    const fewer = analyzeYear(
      grid,
      computeHorizonProfile(place, thinned, observer.heightM),
      observer,
    );
    for (let i = 0; i < year.state.length; i++) {
      if (year.state[i] === SunState.Sun && fewer.state[i] !== SunState.Sun) {
        throw new Error(`cell ${i} lost its sun when buildings were removed`);
      }
    }
    expect(fewer.annual.totalSunHours).toBeGreaterThanOrEqual(year.annual.totalSunHours);

    const wide = analyzeYear(grid, horizon, {
      ...observer,
      mode: "window",
      facingDeg: 180,
      fovDeg: 160,
    });
    const narrow = analyzeYear(grid, horizon, {
      ...observer,
      mode: "window",
      facingDeg: 180,
      fovDeg: 60,
    });
    expect(wide.annual.totalSunHours).toBeLessThanOrEqual(year.annual.totalSunHours);
    expect(narrow.annual.totalSunHours).toBeLessThanOrEqual(wide.annual.totalSunHours);
    for (const window of [wide, narrow]) {
      for (const day of window.days) {
        expect(day.sunMinutes + day.blockedMinutes + day.outOfViewMinutes).toBe(
          day.daylightMinutes,
        );
      }
    }
  });

  test("the day view agrees with the year view", () => {
    for (const dayIndex of [14, 79, 171, 265, 354]) {
      const date = dateFromDayIndex(2026, dayIndex);
      const fine = analyzeDay(place, date, timeZone, horizon, observer);
      const summary = year.days[dayIndex];
      // 1-minute vs 5-minute sampling: each sun/shade edge moves by < 5 minutes.
      const edges = 2 * Math.max(fine.windows.length, 1);
      expect(Math.abs(fine.sunMinutes - summary.sunMinutes), date).toBeLessThanOrEqual(5 * edges);
      expect(Math.abs(fine.daylightMinutes - summary.daylightMinutes), date).toBeLessThanOrEqual(5);
      expect(fine.windows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0)).toBe(
        fine.sunMinutes,
      );
      const rowWindows = windowsFromStates(
        year.state.subarray(dayIndex * 288, (dayIndex + 1) * 288),
        5,
      );
      expect(rowWindows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0)).toBe(
        summary.sunMinutes,
      );
      if (summary.firstSunMinute !== null) {
        expect(rowWindows[0].startMinute).toBe(summary.firstSunMinute);
        expect(rowWindows[rowWindows.length - 1].endMinute).toBe(summary.lastSunMinute);
      }
      expect(fine.sunriseMinute).not.toBeNull();
      expect(fine.sunsetMinute).not.toBeNull();
    }
  });

  test("instant lookups and shadows work on the real data", () => {
    // Winter solstice, 08:30: the sun is ≈ 10° up in the south-east.
    const instant = sunInstantAt(place, "2026-12-21", 8 * 60 + 30, timeZone, horizon, observer);
    expect(instant.altitudeDeg).toBeGreaterThan(5);
    expect(instant.altitudeDeg).toBeLessThan(15);
    expect(instant.azimuthDeg).toBeGreaterThan(110);
    expect(instant.azimuthDeg).toBeLessThan(140);
    expect([SunState.Sun, SunState.Blocked]).toContain(instant.state);
    if (instant.state === SunState.Blocked) {
      expect(instant.blocker!.elevationDeg).toBeGreaterThan(instant.altitudeDeg);
      expect(buildings.features[instant.blocker!.buildingIndex]).toBeDefined();
    } else {
      expect(instant.blocker).toBeUndefined();
    }

    const shadows = computeShadowPolygons(
      place,
      buildings,
      instant.azimuthDeg,
      instant.altitudeDeg,
    );
    const outerEdges = buildings.features.reduce(
      (sum, f) => sum + (f.geometry.coordinates as number[][][])[0].length - 1,
      0,
    );
    expect(shadows.features).toHaveLength(buildings.features.length + outerEdges);
  });

  test("performance budgets", () => {
    console.log(
      [
        "timings (ms): first call / best repeat",
        `  computeHorizonProfile (${buildings.features.length} buildings): ` +
          `${horizonRun.firstMs.toFixed(2)} / ${horizonRun.bestMs.toFixed(2)}`,
        `  computeSunYearGrid (${grid.azimuthDeg.length} samples): ` +
          `${gridRun.firstMs.toFixed(1)} / ${gridRun.bestMs.toFixed(1)}`,
        `  analyzeYear: ${yearRun.firstMs.toFixed(2)} / ${yearRun.bestMs.toFixed(2)}`,
      ].join("\n"),
    );
    // Budgets apply even to the cold first call.
    expect(horizonRun.firstMs).toBeLessThan(100);
    expect(gridRun.firstMs).toBeLessThan(1500);
    expect(yearRun.firstMs).toBeLessThan(100);
  });
});
