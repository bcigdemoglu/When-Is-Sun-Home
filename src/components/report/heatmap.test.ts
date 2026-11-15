import { describe, expect, it } from "vitest";

import { SunState } from "@/lib/types";

import {
  buildHeatmapPixels,
  cellAtPoint,
  dayCenterX,
  dayIndexInYear,
  daylightTimeRange,
  dayX,
  findClockShifts,
  FULL_DAY,
  hourTicks,
  minuteY,
  monthSpans,
  moveSelection,
  type HeatmapGeometry,
} from "./heatmap";
import { resolveStateColors } from "./states";
import { syntheticYear } from "./testing";

describe("daylightTimeRange", () => {
  it("crops to the hours that ever see daylight, padded to whole hours", () => {
    // Sun up 06:00–18:00 every day, 30-minute slots.
    const { year } = syntheticYear();
    expect(daylightTimeRange(year)).toEqual({ startMinute: 5 * 60, endMinute: 19 * 60 });
    expect(daylightTimeRange(year, 0)).toEqual({ startMinute: 6 * 60, endMinute: 18 * 60 });
  });

  it("uses the longest day of the year", () => {
    const { year } = syntheticYear({
      riseMinute: (day) => (day === 180 ? 4 * 60 + 30 : 7 * 60),
      setMinute: (day) => (day === 10 ? 20 * 60 + 30 : 17 * 60),
    });
    expect(daylightTimeRange(year)).toEqual({ startMinute: 4 * 60, endMinute: 21 * 60 });
  });

  it("shows the whole day when (nearly) all of it is used, or none is", () => {
    const polarDay = syntheticYear({ riseMinute: () => 0, setMinute: () => 1440 }).year;
    expect(daylightTimeRange(polarDay)).toEqual(FULL_DAY);
    const polarNight = syntheticYear({ riseMinute: () => 720, setMinute: () => 720 }).year;
    expect(daylightTimeRange(polarNight)).toEqual(FULL_DAY);
  });
});

describe("hourTicks", () => {
  it("spaces gridlines so labels do not collide", () => {
    const range = { startMinute: 5 * 60, endMinute: 21 * 60 };
    // 16 hours on 320 px = 20 px per hour → every 2 hours.
    expect(hourTicks(range, 320)).toEqual([6, 8, 10, 12, 14, 16, 18, 20].map((h) => h * 60));
    // On 160 px → every 3 hours.
    expect(hourTicks(range, 160)).toEqual([6, 9, 12, 15, 18, 21].map((h) => h * 60));
    expect(hourTicks(FULL_DAY, 290)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => h * 60));
  });
});

describe("pixel ⇄ (day, minute) mapping", () => {
  // A cropped plot: 365 days across 730 px, 05:00–21:00 down 320 px, 5-minute slots.
  const g: HeatmapGeometry = {
    x: 40,
    y: 20,
    width: 730,
    height: 320,
    dayCount: 365,
    stepMinutes: 5,
    startMinute: 5 * 60,
    endMinute: 21 * 60,
  };

  it("places days and minutes", () => {
    expect(dayX(g, 0)).toBe(40);
    expect(dayX(g, 365)).toBe(770);
    expect(dayCenterX(g, 0)).toBe(41);
    expect(minuteY(g, 5 * 60)).toBe(20);
    expect(minuteY(g, 13 * 60)).toBe(180);
    expect(minuteY(g, 21 * 60)).toBe(340);
  });

  it("maps a point to its cell, honouring the cropped time range", () => {
    expect(cellAtPoint(g, 40, 20)).toEqual({ dayIndex: 0, slot: 60, minute: 300 });
    // Day 100 spans x = 240…242; 15:20 is 10 h 20 min below the top → y = 226.67.
    expect(cellAtPoint(g, 241, 227)).toEqual({ dayIndex: 100, slot: 184, minute: 920 });
    expect(cellAtPoint(g, 769.9, 339.9)).toEqual({ dayIndex: 364, slot: 251, minute: 1255 });
  });

  it("round-trips every cell through its centre point", () => {
    for (const dayIndex of [0, 1, 58, 59, 180, 363, 364]) {
      for (const slot of [60, 61, 100, 144, 250, 251]) {
        const x = dayCenterX(g, dayIndex);
        const y = minuteY(g, (slot + 0.5) * g.stepMinutes);
        expect(cellAtPoint(g, x, y)).toEqual({ dayIndex, slot, minute: slot * 5 });
      }
    }
  });

  it("rejects points outside the plot unless asked to clamp", () => {
    expect(cellAtPoint(g, 39.9, 100)).toBeNull();
    expect(cellAtPoint(g, 770, 100)).toBeNull();
    expect(cellAtPoint(g, 100, 19)).toBeNull();
    expect(cellAtPoint(g, 100, 340)).toBeNull();
    expect(cellAtPoint(g, -500, 9999, true)).toEqual({ dayIndex: 0, slot: 251, minute: 1255 });
    expect(cellAtPoint(g, 9999, -50, true)).toEqual({ dayIndex: 364, slot: 60, minute: 300 });
    expect(cellAtPoint(g, NaN, 100, true)).toBeNull();
    expect(cellAtPoint({ ...g, width: 0 }, 50, 50, true)).toBeNull();
  });

  it("handles a leap year and an uncropped day", () => {
    const leap: HeatmapGeometry = { ...g, dayCount: 366, startMinute: 0, endMinute: 1440 };
    expect(cellAtPoint(leap, 769.9, 20)).toEqual({ dayIndex: 365, slot: 0, minute: 0 });
    expect(cellAtPoint(leap, 40, 339.99)).toEqual({ dayIndex: 0, slot: 287, minute: 1435 });
  });
});

describe("calendar furniture", () => {
  it("lists the months with their first day index", () => {
    const spans = monthSpans(2026);
    expect(spans).toHaveLength(12);
    expect(spans[0]).toEqual({ month: 0, label: "Jan", startDay: 0, dayCount: 31 });
    expect(spans[2].startDay).toBe(59);
    expect(spans[11].startDay + spans[11].dayCount).toBe(365);
    expect(monthSpans(2028)[2].startDay).toBe(60);
  });

  it("finds a date's day index only within the analysed year", () => {
    const year = { year: 2026, dayCount: 365 };
    expect(dayIndexInYear(year, "2026-01-01")).toBe(0);
    expect(dayIndexInYear(year, "2026-11-14")).toBe(317);
    expect(dayIndexInYear(year, "2025-12-31")).toBeNull();
    expect(dayIndexInYear(year, "2026-02-30")).toBeNull();
    expect(dayIndexInYear(year, "nonsense")).toBeNull();
  });
});

describe("findClockShifts", () => {
  it("finds both daylight-saving changes in San Francisco", () => {
    expect(findClockShifts(2026, "America/Los_Angeles", 365)).toEqual([
      { dayIndex: 66, date: "2026-03-08", deltaMinutes: 60 },
      { dayIndex: 304, date: "2026-11-01", deltaMinutes: -60 },
    ]);
  });

  it("finds the mirrored changes in Sydney", () => {
    expect(findClockShifts(2026, "Australia/Sydney", 365)).toEqual([
      { dayIndex: 94, date: "2026-04-05", deltaMinutes: -60 },
      { dayIndex: 276, date: "2026-10-04", deltaMinutes: 60 },
    ]);
  });

  it("finds none where clocks never change", () => {
    expect(findClockShifts(2026, "Etc/UTC", 365)).toEqual([]);
    expect(findClockShifts(2026, "Asia/Tokyo", 365)).toEqual([]);
  });

  it("gives up quietly on an unknown zone", () => {
    expect(findClockShifts(2026, "Not/AZone", 365)).toEqual([]);
  });
});

describe("buildHeatmapPixels", () => {
  const colors = resolveStateColors(() => "");

  it("paints one pixel per day and slot of the cropped range", () => {
    const { year } = syntheticYear();
    const range = { startMinute: 5 * 60, endMinute: 19 * 60 };
    const pixels = buildHeatmapPixels(year, range, colors);
    expect(pixels.width).toBe(365);
    expect(pixels.height).toBe(28);
    expect(pixels.data).toHaveLength(365 * 28 * 4);
    expect(pixels.outMask).toBeNull();

    const at = (day: number, row: number) =>
      Array.from(pixels.data.slice((row * 365 + day) * 4, (row * 365 + day) * 4 + 4));
    // Row 0 = 05:00 (night), row 2 = 06:00 (first sunny slot), row 26 = 18:00 (night again).
    expect(at(0, 0)).toEqual([...colors.rgb[SunState.Night], 255]);
    expect(at(0, 2)).toEqual([...colors.rgb[SunState.Sun], 255]);
    expect(at(364, 25)).toEqual([...colors.rgb[SunState.Sun], 255]);
    expect(at(364, 26)).toEqual([...colors.rgb[SunState.Night], 255]);
  });

  it("matches the state array cell for cell", () => {
    const { year } = syntheticYear({ riseMinute: (d) => 300 + (d % 7) * 30 });
    const pixels = buildHeatmapPixels(year, FULL_DAY, colors);
    for (const [day, slot] of [
      [0, 0],
      [3, 12],
      [100, 20],
      [200, 35],
      [364, 47],
    ]) {
      const code = year.state[day * year.slotsPerDay + slot];
      const p = (slot * pixels.width + day) * 4;
      expect(Array.from(pixels.data.slice(p, p + 3))).toEqual([...colors.rgb[code]]);
    }
  });

  it("marks out-of-view cells for the hatch", () => {
    // A window facing east with a 90° view: the afternoon sun is out of view.
    const { year } = syntheticYear({}, null, {
      mode: "window",
      heightM: 1.5,
      facingDeg: 90,
      fovDeg: 90,
    });
    const pixels = buildHeatmapPixels(year, FULL_DAY, colors);
    expect(pixels.outMask).not.toBeNull();
    const slot = 30; // 15:00–15:30
    expect(year.state[slot]).toBe(SunState.OutOfView);
    expect(pixels.outMask![slot * pixels.width * 4 + 3]).toBe(255);
    const morning = 14; // 07:00–07:30: in view
    expect(year.state[morning]).toBe(SunState.Sun);
    expect(pixels.outMask![morning * pixels.width * 4 + 3]).toBe(0);
  });
});

describe("moveSelection", () => {
  it("moves by one day with the left and right arrows, across month and year ends", () => {
    expect(moveSelection("2026-03-01", 600, "ArrowLeft")).toEqual({
      date: "2026-02-28",
      minute: 600,
    });
    expect(moveSelection("2026-12-31", 600, "ArrowRight")).toEqual({
      date: "2027-01-01",
      minute: 600,
    });
  });

  it("moves by 15 minutes with up (earlier) and down (later), snapping to the quarter hour", () => {
    expect(moveSelection("2026-06-01", 600, "ArrowDown")).toEqual({
      date: "2026-06-01",
      minute: 615,
    });
    expect(moveSelection("2026-06-01", 600, "ArrowUp")).toEqual({
      date: "2026-06-01",
      minute: 585,
    });
    expect(moveSelection("2026-06-01", 607, "ArrowDown")?.minute).toBe(615);
    expect(moveSelection("2026-06-01", 607, "ArrowUp")?.minute).toBe(600);
    expect(moveSelection("2026-06-01", 0, "ArrowUp")?.minute).toBe(0);
    expect(moveSelection("2026-06-01", 1439, "ArrowDown")?.minute).toBe(1439);
    expect(moveSelection("2026-06-01", 1439, "ArrowUp")?.minute).toBe(1425);
  });

  it("jumps by 30 days and to the ends of the year", () => {
    expect(moveSelection("2026-06-15", 0, "PageDown")?.date).toBe("2026-07-15");
    expect(moveSelection("2026-06-15", 0, "PageUp")?.date).toBe("2026-05-16");
    expect(moveSelection("2026-06-15", 0, "Home")?.date).toBe("2026-01-01");
    expect(moveSelection("2026-06-15", 0, "End")?.date).toBe("2026-12-31");
  });

  it("ignores other keys", () => {
    expect(moveSelection("2026-06-15", 0, "a")).toBeNull();
    expect(moveSelection("2026-06-15", 0, "Tab")).toBeNull();
  });
});
