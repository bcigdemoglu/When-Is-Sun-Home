import { describe, expect, it } from "vitest";
import type { DaySummary } from "@/lib/types";
import { keyDates, minuteRatio, thumbLeft } from "./dayMenu";

function day(date: string, daylightMinutes: number): DaySummary {
  return {
    dayIndex: 0,
    date,
    sunMinutes: 0,
    daylightMinutes,
    blockedMinutes: 0,
    outOfViewMinutes: 0,
    firstSunMinute: null,
    lastSunMinute: null,
  };
}

describe("keyDates", () => {
  it("reads the solstices off the year's daylight (northern hemisphere)", () => {
    const dates = keyDates({
      year: 2026,
      days: [day("2026-01-01", 570), day("2026-06-21", 885), day("2026-12-21", 565)],
    });
    expect(dates.longest).toBe("2026-06-21");
    expect(dates.shortest).toBe("2026-12-21");
    expect(dates.marchEquinox).toBe("2026-03-20");
    expect(dates.septemberEquinox).toBe("2026-09-22");
  });

  it("gets the southern hemisphere right too", () => {
    const dates = keyDates({
      year: 2026,
      days: [day("2026-06-21", 590), day("2026-12-22", 870), day("2026-03-01", 760)],
    });
    expect(dates.longest).toBe("2026-12-22");
    expect(dates.shortest).toBe("2026-06-21");
  });

  it("takes the middle of a run of equally long days (the grid is coarse)", () => {
    const days = [];
    for (let d = 10; d <= 30; d++) days.push(day(`2026-06-${d}`, d >= 14 && d <= 28 ? 885 : 880));
    expect(keyDates({ year: 2026, days }).longest).toBe("2026-06-21");
  });

  it("falls back to calendar dates without data", () => {
    expect(keyDates({ year: 2027, days: [] })).toMatchObject({
      longest: "2027-06-21",
      shortest: "2027-12-21",
    });
  });
});

describe("slider geometry", () => {
  it("maps minutes to a 0..1 position", () => {
    expect(minuteRatio(0)).toBe(0);
    expect(minuteRatio(1439)).toBe(1);
    expect(minuteRatio(719.5)).toBeCloseTo(0.5);
    expect(minuteRatio(-5)).toBe(0);
    expect(minuteRatio(NaN)).toBe(0);
  });

  it("keeps overlays on the thumb's centre, which stops half a thumb short of each end", () => {
    expect(thumbLeft(0, 28)).toBe("calc(14px + (100% - 28px) * 0.0000)");
    expect(thumbLeft(1, 28)).toBe("calc(14px + (100% - 28px) * 1.0000)");
    expect(thumbLeft(2, 28)).toBe("calc(14px + (100% - 28px) * 1.0000)");
  });
});
