import { describe, expect, test } from "vitest";

import { angularDistanceDeg } from "@/lib/geo/local";
import type { LatLng, SunYearGrid } from "@/lib/types";

import { sunPositionAt } from "./position";
import { dateFromDayIndex, zonedToUtc } from "./timezone";
import { computeSunYearGrid } from "./yearGrid";

const RAD = Math.PI / 180;

const SF: LatLng = { lat: 37.7906, lng: -122.4294 };

/**
 * Check every cell of a grid against suncalc (via `sunPositionAt`) at the
 * instant the public `zonedToUtc` gives for that wall-clock sample.
 */
function expectGridMatchesSuncalc(grid: SunYearGrid): { cells: number; gaps: number } {
  let gaps = 0;
  let worstAltitude = 0;
  let worstAzimuth = 0;
  let mismatchedGaps = 0;
  for (let day = 0; day < grid.dayCount; day++) {
    const date = dateFromDayIndex(grid.year, day);
    for (let slot = 0; slot < grid.slotsPerDay; slot++) {
      const index = day * grid.slotsPerDay + slot;
      const instant = zonedToUtc(date, (slot + 0.5) * grid.stepMinutes, grid.timeZone);
      const azimuth = grid.azimuthDeg[index];
      const altitude = grid.altitudeDeg[index];
      if (instant === null) {
        gaps++;
        if (!Number.isNaN(azimuth) || !Number.isNaN(altitude)) mismatchedGaps++;
        continue;
      }
      if (Number.isNaN(azimuth) || Number.isNaN(altitude)) {
        mismatchedGaps++;
        continue;
      }
      const expected = sunPositionAt(grid.lat, grid.lng, instant);
      worstAltitude = Math.max(worstAltitude, Math.abs(altitude - expected.altitudeDeg));
      // On-sky azimuth difference (azimuth is ill-conditioned near the zenith).
      worstAzimuth = Math.max(
        worstAzimuth,
        angularDistanceDeg(azimuth, expected.azimuthDeg) * Math.cos(expected.altitudeDeg * RAD),
      );
    }
  }
  expect(mismatchedGaps).toBe(0);
  // Float32 storage: one ulp is ≈ 8e-6° at 90° and ≈ 3e-5° at 360°.
  expect(worstAltitude).toBeLessThan(1e-5);
  expect(worstAzimuth).toBeLessThan(5e-5);
  return { cells: grid.dayCount * grid.slotsPerDay, gaps };
}

describe("computeSunYearGrid", () => {
  const grid = computeSunYearGrid(SF, {
    year: 2026,
    timeZone: "America/Los_Angeles",
    stepMinutes: 5,
  });

  test("has the documented shape", () => {
    expect(grid.lat).toBe(SF.lat);
    expect(grid.lng).toBe(SF.lng);
    expect(grid.year).toBe(2026);
    expect(grid.timeZone).toBe("America/Los_Angeles");
    expect(grid.stepMinutes).toBe(5);
    expect(grid.dayCount).toBe(365);
    expect(grid.slotsPerDay).toBe(288);
    expect(grid.azimuthDeg).toBeInstanceOf(Float32Array);
    expect(grid.altitudeDeg).toBeInstanceOf(Float32Array);
    expect(grid.azimuthDeg.length).toBe(365 * 288);
    expect(grid.altitudeDeg.length).toBe(365 * 288);
  });

  test("leap years have 366 rows", () => {
    const leap = computeSunYearGrid(SF, {
      year: 2024,
      timeZone: "America/Los_Angeles",
      stepMinutes: 60,
    });
    expect(leap.dayCount).toBe(366);
    expect(leap.slotsPerDay).toBe(24);
    expect(leap.azimuthDeg.length).toBe(366 * 24);
  });

  test("equals suncalc in every cell (San Francisco, 5-minute steps, DST zone)", () => {
    const { cells, gaps } = expectGridMatchesSuncalc(grid);
    expect(cells).toBe(105_120);
    expect(gaps).toBe(12); // the one skipped hour on 8 March
  });

  test("equals suncalc in every cell for very different places and zones", () => {
    const cases: [LatLng, string, number, number, number][] = [
      // place, zone, year, step, expected gap cells
      [{ lat: -33.8688, lng: 151.2093 }, "Australia/Sydney", 2026, 15, 4],
      [{ lat: 51.5074, lng: -0.1278 }, "Europe/London", 2024, 20, 3],
      [{ lat: 69.6492, lng: 18.9553 }, "Europe/Oslo", 2026, 30, 2],
      [{ lat: -0.1807, lng: -78.4678 }, "America/Guayaquil", 2026, 30, 0],
      [{ lat: -31.55, lng: 159.08 }, "Australia/Lord_Howe", 2026, 10, 3],
      [{ lat: 30.0444, lng: 31.2357 }, "Africa/Cairo", 2026, 20, 3],
      [{ lat: 27.7172, lng: 85.324 }, "Asia/Kathmandu", 2026, 60, 0],
      [{ lat: 1.87, lng: -157.43 }, "Pacific/Kiritimati", 2026, 60, 0],
      [{ lat: -77.85, lng: 166.67 }, "Antarctica/McMurdo", 2026, 60, 1],
      [{ lat: 89.9, lng: 0 }, "UTC", 2026, 120, 0],
    ];
    for (const [place, timeZone, year, stepMinutes, expectedGaps] of cases) {
      const g = computeSunYearGrid(place, { year, timeZone, stepMinutes });
      const { gaps } = expectGridMatchesSuncalc(g);
      expect(gaps, timeZone).toBe(expectedGaps);
    }
  });

  test("a day that never happened is all NaN (Samoa, 30 December 2011)", () => {
    const g = computeSunYearGrid(
      { lat: -13.83, lng: -171.77 },
      { year: 2011, timeZone: "Pacific/Apia", stepMinutes: 30 },
    );
    const { gaps } = expectGridMatchesSuncalc(g);
    // The whole of 30 December (48 slots) plus the two ordinary DST gaps that year.
    expect(gaps).toBeGreaterThanOrEqual(48);
    const row = 363 * g.slotsPerDay;
    for (let slot = 0; slot < g.slotsPerDay; slot++) {
      expect(Number.isNaN(g.altitudeDeg[row + slot])).toBe(true);
      expect(Number.isNaN(g.azimuthDeg[row + slot])).toBe(true);
    }
  });

  test("the DST gap holds NaN exactly in the skipped wall-clock hour", () => {
    const row = 66 * grid.slotsPerDay; // 2026-03-08
    expect(dateFromDayIndex(2026, 66)).toBe("2026-03-08");
    for (let slot = 0; slot < grid.slotsPerDay; slot++) {
      const inGap = slot >= 24 && slot < 36; // 02:00–03:00
      expect(Number.isNaN(grid.altitudeDeg[row + slot]), `slot ${slot}`).toBe(inGap);
      expect(Number.isNaN(grid.azimuthDeg[row + slot]), `slot ${slot}`).toBe(inGap);
    }
    // No NaN anywhere else in the year.
    let nanCount = 0;
    for (let i = 0; i < grid.altitudeDeg.length; i++) {
      if (Number.isNaN(grid.altitudeDeg[i])) nanCount++;
    }
    expect(nanCount).toBe(12);
  });

  test("slot s is sampled at wall-clock minute (s + 0.5) × step", () => {
    // 21 June, slot 150 → 12:32:30 PDT → 19:32:30 UTC.
    const day = 171;
    expect(dateFromDayIndex(2026, day)).toBe("2026-06-21");
    const expected = sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T19:32:30Z"));
    const index = day * grid.slotsPerDay + 150;
    expect(grid.altitudeDeg[index]).toBeCloseTo(expected.altitudeDeg, 4);
    expect(grid.azimuthDeg[index]).toBeCloseTo(expected.azimuthDeg, 3);
    // 15 January (standard time), slot 0 → 00:02:30 PST → 08:02:30 UTC.
    const winter = sunPositionAt(SF.lat, SF.lng, new Date("2026-01-15T08:02:30Z"));
    expect(grid.altitudeDeg[14 * grid.slotsPerDay]).toBeCloseTo(winter.altitudeDeg, 4);
  });

  test("azimuths are compass bearings in [0, 360) and altitudes in [-90, 90]", () => {
    for (let i = 0; i < grid.azimuthDeg.length; i++) {
      const azimuth = grid.azimuthDeg[i];
      if (Number.isNaN(azimuth)) continue;
      if (!(azimuth >= 0 && azimuth < 360)) throw new Error(`azimuth ${azimuth} at ${i}`);
      const altitude = grid.altitudeDeg[i];
      if (!(altitude >= -90 && altitude <= 90)) throw new Error(`altitude ${altitude} at ${i}`);
    }
  });

  test("the midday sun is in the south in San Francisco, every day of the year", () => {
    // 13:00 wall clock is always within ~1h15 of solar noon there.
    const slot = 13 * 12;
    for (let day = 0; day < grid.dayCount; day++) {
      const index = day * grid.slotsPerDay + slot;
      expect(grid.altitudeDeg[index]).toBeGreaterThan(25);
      expect(angularDistanceDeg(grid.azimuthDeg[index], 180)).toBeLessThan(45);
    }
  });

  test("rejects steps that do not divide the day and non-integer years", () => {
    const spec = { year: 2026, timeZone: "UTC" };
    expect(() => computeSunYearGrid(SF, { ...spec, stepMinutes: 7 })).toThrow(RangeError);
    expect(() => computeSunYearGrid(SF, { ...spec, stepMinutes: 0 })).toThrow(RangeError);
    expect(() => computeSunYearGrid(SF, { ...spec, stepMinutes: -5 })).toThrow(RangeError);
    expect(() => computeSunYearGrid(SF, { ...spec, stepMinutes: NaN })).toThrow(RangeError);
    expect(() => computeSunYearGrid(SF, { ...spec, year: 2026.5, stepMinutes: 5 })).toThrow(
      RangeError,
    );
    expect(() =>
      computeSunYearGrid(SF, { year: 2026, timeZone: "Not/AZone", stepMinutes: 60 }),
    ).toThrow(RangeError);
  });

  test("is deterministic", () => {
    const again = computeSunYearGrid(SF, {
      year: 2026,
      timeZone: "America/Los_Angeles",
      stepMinutes: 5,
    });
    expect(again.azimuthDeg).toEqual(grid.azimuthDeg);
    expect(again.altitudeDeg).toEqual(grid.altitudeDeg);
  });
});
