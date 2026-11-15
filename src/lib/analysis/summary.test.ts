import { describe, expect, test } from "vitest";
import { analyzeYear, computeSunYearGrid, summarizeYear } from "@/lib/analysis";
import type { Observer } from "@/lib/types";

const YARD: Observer = { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 };

describe("summarizeYear", () => {
  const grid = computeSunYearGrid(
    { lat: 37.79, lng: -122.43 },
    { year: 2026, timeZone: "America/Los_Angeles", stepMinutes: 15 },
  );
  const summary = summarizeYear(analyzeYear(grid, null, YARD));

  test("has twelve months of rounded hours", () => {
    expect(summary.monthlySunHours).toHaveLength(12);
    expect(summary.monthlyDaylightHours).toHaveLength(12);
    for (const hours of summary.monthlySunHours) {
      expect(Math.round(hours * 10)).toBeCloseTo(hours * 10, 9);
    }
  });

  test("an open sky gets all of the daylight", () => {
    expect(summary.sunFraction).toBe(1);
    expect(summary.monthlySunHours).toEqual(summary.monthlyDaylightHours);
    expect(summary.avgSunHoursPerDay).toBeGreaterThan(11.9);
    expect(summary.avgSunHoursPerDay).toBeLessThan(12.3);
  });

  test("the northern summer is the sunniest", () => {
    expect(summary.bestMonth).toBe(5);
    expect(summary.worstMonth).toBe(11);
    expect(summary.year).toBe(2026);
  });
});
