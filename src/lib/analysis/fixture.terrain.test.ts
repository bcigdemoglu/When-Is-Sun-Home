/**
 * End-to-end on real buildings AND real ground: Pacific Heights, San
 * Francisco — a ridge about 95 m above the bay, with streets dropping away
 * steeply on both sides. Compares the year with and without terrain and
 * prints both monthly tables.
 */
import { describe, expect, test } from "vitest";

import { toLocalMeters } from "@/lib/geo/local";
import { loadPacificHeights, PACIFIC_HEIGHTS } from "@/lib/horizon/testing";
import { elevationAt } from "@/lib/terrain/elevation";
import { loadPacificHeightsTerrain } from "@/lib/terrain/testing";
import { SunState, TERRAIN_BLOCKER, type Observer, type YearAnalysis } from "@/lib/types";

import {
  analyzeDay,
  analyzeYear,
  classifySun,
  computeHorizonProfile,
  computeSunYearGrid,
  sunInstantAt,
  timeZoneAt,
} from "./index";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function timeIt<T>(run: () => T, repeats = 7): { result: T; firstMs: number; bestMs: number } {
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

describe("Pacific Heights fixture with terrain, end to end", () => {
  const place = PACIFIC_HEIGHTS;
  const buildings = loadPacificHeights();
  const terrain = loadPacificHeightsTerrain();
  const observer: Observer = { mode: "yard", heightM: 1, facingDeg: 0, fovDeg: 360 };
  const timeZone = timeZoneAt(place.lat, place.lng);

  const gridRun = timeIt(
    () => computeSunYearGrid(place, { year: 2026, timeZone, stepMinutes: 5 }),
    5,
  );
  const grid = gridRun.result;
  const flatRun = timeIt(() => computeHorizonProfile(place, buildings, observer.heightM));
  const hillyRun = timeIt(() =>
    computeHorizonProfile(place, buildings, observer.heightM, { terrain }),
  );
  const flatHorizon = flatRun.result;
  const hillyHorizon = hillyRun.result;
  const flat = analyzeYear(grid, flatHorizon, observer);
  const hilly = analyzeYear(grid, hillyHorizon, observer);
  const open = analyzeYear(grid, null, observer);

  test("both runs are sane and internally consistent", () => {
    for (const year of [flat, hilly]) {
      expect(year.dayCount).toBe(365);
      expect(year.annual.sunFraction).toBeGreaterThan(0);
      expect(year.annual.sunFraction).toBeLessThan(1);
      expect(year.annual.totalDaylightHours).toBe(open.annual.totalDaylightHours);
      for (const day of year.days) {
        expect(day.sunMinutes + day.blockedMinutes + day.outOfViewMinutes).toBe(
          day.daylightMinutes,
        );
        expect(day.terrainBlockedMinutes!).toBeGreaterThanOrEqual(0);
        expect(day.terrainBlockedMinutes!).toBeLessThanOrEqual(day.blockedMinutes);
        expect(day.sunMinutes).toBeLessThanOrEqual(open.days[day.dayIndex].sunMinutes);
      }
    }
    expect(flat.days.every((day) => day.terrainBlockedMinutes === 0)).toBe(true);
    expect(hillyHorizon.observerHeightM).toBe(1);
    // Cell by cell: analyzeYear is exactly classifySun over the grid.
    for (let i = 0; i < hilly.state.length; i++) {
      const expected = classifySun(grid.azimuthDeg[i], grid.altitudeDeg[i], hillyHorizon, observer);
      if (hilly.state[i] !== expected)
        throw new Error(`cell ${i}: ${hilly.state[i]} vs ${expected}`);
    }
  });

  test("monthly sun hours with and without terrain (printed)", () => {
    const pin = toLocalMeters(terrain.near.origin, place);
    const ground = elevationAt(terrain.near, pin.x, pin.y);
    const terrainBins = Array.from(hillyHorizon.blockerIndex).filter(
      (i) => i === TERRAIN_BLOCKER,
    ).length;
    const mean = (values: Float32Array) => values.reduce((a, b) => a + b, 0) / values.length;
    const terrainHours = (year: YearAnalysis, month: number) =>
      year.days
        .filter((day) => Number(day.date.slice(5, 7)) === month + 1)
        .reduce((sum, day) => sum + day.terrainBlockedMinutes!, 0) / 60;
    const lines = [
      `Pacific Heights (${place.lat}, ${place.lng}), yard observer at ${observer.heightM} m, 2026, 5-minute steps`,
      `ground at the pin: ${ground.toFixed(1)} m above sea level; skyline mean ${mean(flatHorizon.elevationDeg).toFixed(1)}° flat → ` +
        `${mean(hillyHorizon.elevationDeg).toFixed(1)}° with terrain; ground is the skyline in ${terrainBins}/720 directions`,
      "month  daylight h/day | flat ground: sun h/day  share | with terrain: sun h/day  share  lost to hills h/day | change",
      ...MONTHS.map((name, m) => {
        const a = flat.months[m];
        const b = hilly.months[m];
        return (
          `${name}    ${a.avgDaylightHours.toFixed(2).padStart(14)} | ${a.avgSunHours.toFixed(2).padStart(22)}  ` +
          `${((100 * a.avgSunHours) / a.avgDaylightHours).toFixed(0).padStart(4)}% | ${b.avgSunHours.toFixed(2).padStart(23)}  ` +
          `${((100 * b.avgSunHours) / b.avgDaylightHours).toFixed(0).padStart(4)}%  ${(terrainHours(hilly, m) / b.dayCount).toFixed(2).padStart(19)} | ` +
          `${(b.avgSunHours - a.avgSunHours >= 0 ? "+" : "") + (b.avgSunHours - a.avgSunHours).toFixed(2)}`
        );
      }),
      `year   ${(flat.annual.totalDaylightHours / 365).toFixed(2).padStart(14)} | ${flat.annual.avgSunHoursPerDay.toFixed(2).padStart(22)}  ` +
        `${(100 * flat.annual.sunFraction).toFixed(0).padStart(4)}% | ${hilly.annual.avgSunHoursPerDay.toFixed(2).padStart(23)}  ` +
        `${(100 * hilly.annual.sunFraction).toFixed(0).padStart(4)}%  ` +
        `${(hilly.days.reduce((s, d) => s + d.terrainBlockedMinutes!, 0) / 60 / 365).toFixed(2).padStart(19)} | ` +
        `${(hilly.annual.avgSunHoursPerDay - flat.annual.avgSunHoursPerDay >= 0 ? "+" : "") + (hilly.annual.avgSunHoursPerDay - flat.annual.avgSunHoursPerDay).toFixed(2)}`,
      `totals: ${flat.annual.totalSunHours.toFixed(0)} h (flat) vs ${hilly.annual.totalSunHours.toFixed(0)} h (terrain) of ${flat.annual.totalDaylightHours.toFixed(0)} h daylight`,
    ];
    console.log(lines.join("\n"));

    // The pin is on a ridge: the ground is plausible, and terrain makes a real
    // difference to the answer in at least some months.
    expect(ground).toBeGreaterThan(80);
    expect(ground).toBeLessThan(110);
    const largestMonthlyChange = Math.max(
      ...MONTHS.map((_, m) => Math.abs(hilly.months[m].avgSunHours - flat.months[m].avgSunHours)),
    );
    expect(largestMonthlyChange).toBeGreaterThan(0.1);
  });

  test("the day view and instant lookups agree with the terrain year", () => {
    for (const dayIndex of [14, 171, 354]) {
      const date = hilly.days[dayIndex].date;
      const fine = analyzeDay(place, date, timeZone, hillyHorizon, observer);
      const edges = 2 * Math.max(fine.windows.length, 1);
      expect(Math.abs(fine.sunMinutes - hilly.days[dayIndex].sunMinutes), date).toBeLessThanOrEqual(
        5 * edges,
      );
      // Sunrise / sunset markers line up with the daylight samples (same 0° definition).
      const daylight = fine.samples.filter((s) => s.state !== SunState.Night);
      expect(Math.abs(daylight[0].minute - fine.sunriseMinute!)).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(daylight[daylight.length - 1].minute + 1 - fine.sunsetMinute!),
      ).toBeLessThanOrEqual(0.5);
    }
    // Wherever the terrain year says Blocked, an instant lookup names a blocker of the right kind.
    let checked = 0;
    for (let slot = 0; slot < 288 && checked < 40; slot++) {
      const i = 354 * 288 + slot;
      if (hilly.state[i] !== SunState.Blocked) continue;
      const instant = sunInstantAt(
        place,
        hilly.days[354].date,
        (slot + 0.5) * 5,
        timeZone,
        hillyHorizon,
        observer,
      );
      if (instant.state !== SunState.Blocked) continue; // float32 knife edge
      expect(instant.blocker!.kind).toBe(
        instant.blocker!.buildingIndex === TERRAIN_BLOCKER ? "terrain" : "building",
      );
      expect(instant.blocker!.elevationDeg).toBeGreaterThan(instant.altitudeDeg);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  test("performance budgets with terrain", () => {
    console.log(
      [
        "timings (ms): first call / best repeat",
        `  computeSunYearGrid (${grid.azimuthDeg.length} samples): ${gridRun.firstMs.toFixed(1)} / ${gridRun.bestMs.toFixed(1)}`,
        `  computeHorizonProfile, flat ground: ${flatRun.firstMs.toFixed(2)} / ${flatRun.bestMs.toFixed(2)}`,
        `  computeHorizonProfile, with terrain (fixture crop: near ±700 m, far ±6.5 km): ` +
          `${hillyRun.firstMs.toFixed(2)} / ${hillyRun.bestMs.toFixed(2)}`,
      ].join("\n"),
    );
    expect(gridRun.firstMs).toBeLessThan(1500);
    expect(flatRun.firstMs).toBeLessThan(100);
    expect(hillyRun.firstMs).toBeLessThan(200);
  });
});
