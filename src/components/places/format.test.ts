import { describe, expect, it } from "vitest";
import type { PlaceSummary } from "@/lib/types";
import { bestIndexes } from "./CompareView";
import {
  bestLeastLine,
  commonMonthlyMax,
  formatHours,
  formatHoursUnit,
  formatShare,
  monthHours,
  monthValue,
  seasonAverages,
  viewpointLabel,
} from "./format";

function summary(monthlySunHours: number[], overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  let best = 0;
  let worst = 0;
  monthlySunHours.forEach((hours, month) => {
    if (hours > monthlySunHours[best]) best = month;
    if (hours < monthlySunHours[worst]) worst = month;
  });
  return {
    year: 2026,
    avgSunHoursPerDay: 6.4,
    sunFraction: 0.52,
    totalSunHours: 2336,
    monthlySunHours,
    monthlyDaylightHours: Array(12).fill(12),
    bestMonth: best,
    worstMonth: worst,
    ...overrides,
  };
}

const NORTHERN = summary([1.2, 2.5, 4.4, 6.8, 8.6, 9.8, 9.5, 8.1, 6.2, 4.1, 2, 1.2]);

describe("hours and shares", () => {
  it("writes hours with one decimal, and a plain 0", () => {
    expect(formatHours(6.4)).toBe("6.4");
    expect(formatHours(10)).toBe("10.0");
    expect(formatHours(0)).toBe("0");
    expect(formatHours(0.04)).toBe("0");
    expect(formatHours(-3)).toBe("0");
    expect(formatHours(Number.NaN)).toBe("–");
    expect(formatHoursUnit(9.84)).toBe("9.8 h");
  });

  it("writes the share of daylight as a whole percentage", () => {
    expect(formatShare(0.52)).toBe("52%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(1.4)).toBe("100%");
  });
});

describe("best and least months", () => {
  it("names the months with their hours", () => {
    expect(bestLeastLine(NORTHERN)).toBe("Best Jun 9.8 · Least Jan 1.2");
    expect(monthValue(NORTHERN, "best")).toBe("Jun · 9.8 h");
    expect(monthValue(NORTHERN, "least")).toBe("Jan · 1.2 h");
    expect(monthHours(NORTHERN, "best")).toBe(9.8);
  });

  it("survives a month index that is out of range", () => {
    expect(bestLeastLine({ ...NORTHERN, bestMonth: 99, worstMonth: -1 })).toBe(
      "Best Jan 1.2 · Least Jan 1.2",
    );
  });
});

describe("seasonAverages", () => {
  it("is June–August vs December–February north of the equator", () => {
    const seasons = seasonAverages(NORTHERN, 37.8);
    expect(seasons.summerMonths).toBe("Jun–Aug");
    expect(seasons.winterMonths).toBe("Dec–Feb");
    // (9.8·30 + 9.5·31 + 8.1·31) / 92 and (1.2·31 + 1.2·31 + 2.5·28.25) / 90.25
    expect(seasons.summer).toBe(9.1);
    expect(seasons.winter).toBe(1.6);
  });

  it("flips south of the equator", () => {
    const sydney = summary([9.8, 9, 7.5, 6, 4.8, 4.1, 4.4, 5.6, 7, 8.2, 9.1, 9.9]);
    const seasons = seasonAverages(sydney, -33.87);
    expect(seasons.summerMonths).toBe("Dec–Feb");
    expect(seasons.winterMonths).toBe("Jun–Aug");
    expect(seasons.summer).toBeGreaterThan(9);
    expect(seasons.winter).toBeLessThan(5);
    // The same numbers read the other way round in the north.
    const north = seasonAverages(sydney, 33.87);
    expect(north.summer).toBe(seasons.winter);
    expect(north.winter).toBe(seasons.summer);
  });

  it("counts the equator as north", () => {
    expect(seasonAverages(NORTHERN, 0).summerMonths).toBe("Jun–Aug");
  });
});

describe("viewpointLabel", () => {
  it("describes yards and windows in plain words", () => {
    expect(viewpointLabel({ mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 })).toBe(
      "Yard · ground",
    );
    expect(viewpointLabel({ mode: "yard", heightM: 7, facingDeg: 180, fovDeg: 180 })).toBe(
      "Yard · 3rd floor",
    );
    expect(viewpointLabel({ mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 })).toBe(
      "Window · 2nd floor · facing S",
    );
    expect(viewpointLabel({ mode: "window", heightM: 1.5, facingDeg: 315, fovDeg: 90 })).toBe(
      "Window · ground floor · facing NW",
    );
    expect(viewpointLabel({ mode: "window", heightM: 31.5, facingDeg: 350, fovDeg: 90 })).toBe(
      "Window · 11th floor · facing N",
    );
    expect(viewpointLabel({ mode: "window", heightM: 61.5, facingDeg: 90, fovDeg: 90 })).toBe(
      "Window · 21st floor · facing E",
    );
  });
});

describe("commonMonthlyMax", () => {
  it("is the largest month of any place, and at least 1", () => {
    const low = summary(Array(12).fill(0.2));
    expect(commonMonthlyMax([NORTHERN, low, null])).toBe(9.8);
    expect(commonMonthlyMax([low])).toBe(1);
    expect(commonMonthlyMax([null])).toBe(1);
    expect(commonMonthlyMax([])).toBe(1);
  });
});

describe("bestIndexes", () => {
  it("marks the largest value, ties included", () => {
    expect([...bestIndexes([7.8, 0.3, 3.6])]).toEqual([0]);
    expect([...bestIndexes([2, 5, 5])]).toEqual([1, 2]);
    expect([...bestIndexes([null, 1, 4])]).toEqual([2]);
  });

  it("marks nothing when there is nothing to compare", () => {
    expect(bestIndexes([4, null]).size).toBe(0);
    expect(bestIndexes([3, 3, 3]).size).toBe(0);
    expect(bestIndexes([null, null]).size).toBe(0);
    expect(bestIndexes([]).size).toBe(0);
  });
});
