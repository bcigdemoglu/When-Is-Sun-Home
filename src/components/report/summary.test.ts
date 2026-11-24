import { describe, expect, it } from "vitest";

import { SunState, type DaySummary } from "@/lib/types";

import { buildReportModel } from "./model";
import {
  bestAndWorstMonths,
  daylightSplit,
  dayTotals,
  hemisphereOf,
  median,
  modalStates,
  monthDetails,
  SEASON_MONTHS,
  seasonOfMonth,
  stateRuns,
  summarizeSeasons,
  typicalSunTimes,
} from "./summary";
import { syntheticDay, syntheticHorizon, syntheticYear } from "./testing";

describe("hemisphere and seasons", () => {
  it("splits the globe at the equator", () => {
    expect(hemisphereOf(37.79)).toBe("north");
    expect(hemisphereOf(0)).toBe("north");
    expect(hemisphereOf(-33.87)).toBe("south");
  });

  it("names the seasons of the solstice and equinox months in the north", () => {
    expect(SEASON_MONTHS.map((month) => seasonOfMonth(month, "north"))).toEqual([
      "Spring",
      "Summer",
      "Autumn",
      "Winter",
    ]);
  });

  it("flips them in the south", () => {
    expect(SEASON_MONTHS.map((month) => seasonOfMonth(month, "south"))).toEqual([
      "Autumn",
      "Winter",
      "Spring",
      "Summer",
    ]);
  });

  it("assigns every month to a three-month season", () => {
    const north = Array.from({ length: 12 }, (_, month) => seasonOfMonth(month, "north"));
    expect(north).toEqual([
      "Winter",
      "Winter",
      "Spring",
      "Spring",
      "Spring",
      "Summer",
      "Summer",
      "Summer",
      "Autumn",
      "Autumn",
      "Autumn",
      "Winter",
    ]);
    expect(seasonOfMonth(0, "south")).toBe("Summer");
    expect(seasonOfMonth(6, "south")).toBe("Winter");
  });
});

describe("median and typical sun times", () => {
  it("takes the middle value", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("uses only days that have sun", () => {
    const day = (first: number | null, last: number | null): DaySummary => ({
      dayIndex: 0,
      date: "2026-01-01",
      sunMinutes: first === null ? 0 : (last ?? 0) - first,
      daylightMinutes: 600,
      blockedMinutes: 0,
      outOfViewMinutes: 0,
      firstSunMinute: first,
      lastSunMinute: last,
    });
    expect(
      typicalSunTimes([day(540, 900), day(null, null), day(560, 880), day(600, 1000)]),
    ).toEqual({
      firstMinute: 560,
      lastMinute: 900,
      sunDays: 3,
      dayCount: 4,
    });
    expect(typicalSunTimes([day(null, null)])).toEqual({
      firstMinute: null,
      lastMinute: null,
      sunDays: 0,
      dayCount: 1,
    });
  });
});

describe("modalStates and stateRuns", () => {
  it("finds the most common state per slot, ties going to sun", () => {
    // Two slots per day, three days.
    const year = { slotsPerDay: 2, state: Uint8Array.from([1, 0, 1, 2, 2, 2]) };
    expect(Array.from(modalStates(year, 0, 3))).toEqual([SunState.Sun, SunState.Blocked]);
    expect(Array.from(modalStates(year, 0, 2))).toEqual([SunState.Sun, SunState.Blocked]);
    expect(
      Array.from(modalStates({ slotsPerDay: 1, state: Uint8Array.from([1, 2]) }, 0, 2)),
    ).toEqual([SunState.Sun]);
  });

  it("collapses states into runs", () => {
    expect(stateRuns([0, 0, 1, 1, 1, 2, 0], 60)).toEqual([
      { startMinute: 0, endMinute: 120, state: 0 },
      { startMinute: 120, endMinute: 300, state: 1 },
      { startMinute: 300, endMinute: 360, state: 2 },
      { startMinute: 360, endMinute: 420, state: 0 },
    ]);
  });

  it("never merges across a gap in the clock", () => {
    // Minutes 120–179 are missing (a spring-forward hour).
    expect(stateRuns([0, 0, 0], 60, [0, 60, 180])).toEqual([
      { startMinute: 0, endMinute: 120, state: 0 },
      { startMinute: 180, endMinute: 240, state: 0 },
    ]);
  });
});

describe("year summaries", () => {
  // Sun up 06:00–18:00; a wall to the south-west hides it from 15:00 on.
  // In June the sun rises two hours earlier.
  const wall = syntheticHorizon((azimuth) => (azimuth >= 225 ? 85 : 0));
  const { year } = syntheticYear(
    { riseMinute: (day) => (day >= 151 && day < 181 ? 4 * 60 : 6 * 60) },
    wall,
  );

  it("adds typical first and last sun to every month", () => {
    const details = monthDetails(year);
    expect(details).toHaveLength(12);
    expect(details[0]).toMatchObject({
      month: 0,
      label: "Jan",
      longLabel: "January",
      firstMinute: 6 * 60,
      lastMinute: 15 * 60,
      sunDays: 31,
      dayCount: 31,
    });
    expect(details[0].avgSunHours).toBeCloseTo(9, 5);
    expect(details[0].avgDaylightHours).toBeCloseTo(12, 5);
    expect(details[0].sunFraction).toBeCloseTo(0.75, 5);
    // The wall takes 15:00–18:00: three hours of shade a day, nothing out of view (a yard).
    expect(details[0].avgShadedHours).toBeCloseTo(3, 5);
    expect(details[0].avgOutOfViewHours).toBe(0);
    expect(
      details[0].avgSunHours + details[0].avgShadedHours + details[0].avgOutOfViewHours,
    ).toBeCloseTo(details[0].avgDaylightHours, 5);
    // June: 14 h of daylight; the wall sits at azimuth 225° = 3/4 of the way.
    expect(details[5].firstMinute).toBe(4 * 60);
    expect(details[5].avgDaylightHours).toBeCloseTo(14, 5);
  });

  it("summarises the four season months with a typical-day strip", () => {
    const seasons = summarizeSeasons(year, 40);
    expect(seasons.map((s) => [s.label, s.season])).toEqual([
      ["Mar", "Spring"],
      ["Jun", "Summer"],
      ["Sep", "Autumn"],
      ["Dec", "Winter"],
    ]);
    expect(seasons[3].typicalRuns).toEqual([
      { startMinute: 0, endMinute: 360, state: SunState.Night },
      { startMinute: 360, endMinute: 900, state: SunState.Sun },
      { startMinute: 900, endMinute: 1080, state: SunState.Blocked },
      { startMinute: 1080, endMinute: 1440, state: SunState.Night },
    ]);
    expect(seasons[1].typicalRuns[1]).toMatchObject({ startMinute: 240, state: SunState.Sun });
    expect(summarizeSeasons(year, -40).map((s) => s.season)).toEqual([
      "Autumn",
      "Winter",
      "Spring",
      "Summer",
    ]);
  });

  it("ranks months and splits the daylight", () => {
    const { best, worst } = bestAndWorstMonths(year.months);
    expect(best?.month).toBe(5);
    expect(worst?.month).toBe(0); // all the other months tie; the earliest wins
    expect(bestAndWorstMonths([])).toEqual({ best: null, worst: null });

    const split = daylightSplit(year.days);
    expect(split.sunHours + split.blockedHours + split.outOfViewHours).toBeCloseTo(
      split.daylightHours,
      6,
    );
    expect(split.sunHours).toBeCloseTo(year.annual.totalSunHours, 6);
    expect(split.outOfViewHours).toBe(0);
    expect(split.blockedHours).toBeGreaterThan(0);
  });

  it("builds the whole model once", () => {
    const model = buildReportModel(year, 40);
    expect(model.range).toEqual({ startMinute: 3 * 60, endMinute: 19 * 60 });
    expect(model.months).toHaveLength(12);
    expect(model.details).toHaveLength(12);
    expect(model.seasons).toHaveLength(4);
    expect(model.best?.month).toBe(5);
    expect(model.clockShifts).toEqual([]);
  });
});

describe("dayTotals", () => {
  // The grid says 12 h of sun every day; the day analysis of 15 June says 5 h 10 m.
  const { year } = syntheticYear();
  const day = syntheticDay("2026-06-15", [
    [360, 550, SunState.Blocked],
    [550, 860, SunState.Sun],
    [860, 1080, SunState.Blocked],
  ]);
  const june15 = 165;

  it("reads the selected day from its own 1-minute analysis", () => {
    expect(dayTotals(year, day, "2026-06-15", june15)).toEqual({
      sunMinutes: 310,
      daylightMinutes: 720,
      precise: true,
    });
    // Without a day index the selected date itself is meant; the year is not needed.
    expect(dayTotals(null, day, "2026-06-15", null)).toMatchObject({
      sunMinutes: 310,
      precise: true,
    });
    expect(dayTotals(year, day, "2026-06-15", null)).toMatchObject({ precise: true });
  });

  it("reads every other day from the grid", () => {
    expect(dayTotals(year, day, "2026-06-15", june15 + 1)).toEqual({
      sunMinutes: 720,
      daylightMinutes: 720,
      precise: false,
    });
    expect(dayTotals(year, day, "2026-06-15", 0)).toMatchObject({
      sunMinutes: 720,
      precise: false,
    });
  });

  it("reads the grid for the selected day too while the analysis is stale or missing", () => {
    // The selection moved to 16 June; `day` is still for the 15th: never show its number.
    expect(dayTotals(year, day, "2026-06-16", june15 + 1)).toMatchObject({
      sunMinutes: 720,
      precise: false,
    });
    expect(dayTotals(year, null, "2026-06-15", june15)).toMatchObject({
      sunMinutes: 720,
      precise: false,
    });
    // Hovering the 15th while the 16th is selected is a preview of another day.
    expect(dayTotals(year, day, "2026-06-16", june15)).toMatchObject({ precise: false });
  });

  it("returns null when neither source has the day", () => {
    expect(dayTotals(null, null, "2026-06-15", june15)).toBeNull();
    expect(dayTotals(null, day, "2026-06-16", null)).toBeNull();
    expect(dayTotals(null, day, "2026-06-15", june15)).toBeNull();
    expect(dayTotals(year, null, "2026-06-15", null)).toBeNull();
  });
});
