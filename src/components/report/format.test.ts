import { describe, expect, it } from "vitest";

import {
  compassPoint,
  compassWords,
  daysInMonth,
  detectHour12,
  formatAngle,
  formatBearing,
  formatClock,
  formatClockRange,
  formatCount,
  formatDate,
  formatDistance,
  formatDuration,
  formatHours,
  formatHourTick,
  formatPercent,
  parseIsoDate,
  toIsoDate,
  weekdayOf,
} from "./format";

describe("detectHour12", () => {
  it("follows the locale's hour cycle", () => {
    expect(detectHour12("en-US")).toBe(true);
    expect(detectHour12("en-GB")).toBe(false);
    expect(detectHour12("de-DE")).toBe(false);
    expect(detectHour12("ja-JP-u-hc-h11")).toBe(true);
  });

  it("falls back to 12-hour for a locale Intl rejects", () => {
    expect(detectHour12("not_a_locale!!")).toBe(true);
  });
});

describe("formatClock", () => {
  it("formats 12-hour times from wall-clock minutes", () => {
    expect(formatClock(0, true)).toBe("12:00 AM");
    expect(formatClock(9 * 60 + 10, true)).toBe("9:10 AM");
    expect(formatClock(12 * 60, true)).toBe("12:00 PM");
    expect(formatClock(12 * 60 + 40, true)).toBe("12:40 PM");
    expect(formatClock(23 * 60 + 59, true)).toBe("11:59 PM");
  });

  it("formats 24-hour times", () => {
    expect(formatClock(0, false)).toBe("00:00");
    expect(formatClock(9 * 60 + 5, false)).toBe("09:05");
    expect(formatClock(17 * 60 + 30, false)).toBe("17:30");
  });

  it("names the end of the day", () => {
    expect(formatClock(1440, true)).toBe("midnight");
    expect(formatClock(1440, false)).toBe("24:00");
  });

  it("rounds fractional minutes and clamps out-of-range input", () => {
    expect(formatClock(6 * 60 + 12.7, true)).toBe("6:13 AM");
    expect(formatClock(59.6, false)).toBe("01:00");
    expect(formatClock(-5, false)).toBe("00:00");
    expect(formatClock(5000, false)).toBe("24:00");
    expect(formatClock(NaN, true)).toBe("12:00 AM");
  });

  it("joins a range with an en dash", () => {
    expect(formatClockRange(550, 760, true)).toBe("9:10 AM – 12:40 PM");
    expect(formatClockRange(550, 760, false)).toBe("09:10 – 12:40");
  });
});

describe("formatHourTick", () => {
  it("labels whole hours", () => {
    expect(formatHourTick(0, true)).toBe("12 AM");
    expect(formatHourTick(360, true)).toBe("6 AM");
    expect(formatHourTick(720, true)).toBe("12 PM");
    expect(formatHourTick(1080, true)).toBe("6 PM");
    expect(formatHourTick(1440, true)).toBe("12 AM");
    expect(formatHourTick(360, false)).toBe("06:00");
    expect(formatHourTick(1440, false)).toBe("24:00");
  });
});

describe("durations and numbers", () => {
  it("formats durations as hours and minutes", () => {
    expect(formatDuration(385)).toBe("6 h 25 m");
    expect(formatDuration(210)).toBe("3 h 30 m");
    expect(formatDuration(180)).toBe("3 h");
    expect(formatDuration(45)).toBe("45 m");
    expect(formatDuration(0)).toBe("0 m");
    expect(formatDuration(1440)).toBe("24 h");
    expect(formatDuration(-10)).toBe("0 m");
    expect(formatDuration(NaN)).toBe("0 m");
  });

  it("formats hours with one decimal", () => {
    expect(formatHours(6.44)).toBe("6.4");
    expect(formatHours(6.45)).toBe("6.5");
    expect(formatHours(0)).toBe("0.0");
    expect(formatHours(-0.01)).toBe("0.0");
    expect(formatHours(12)).toBe("12.0");
  });

  it("formats percentages and counts", () => {
    expect(formatPercent(0.584)).toBe("58%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatCount(2336.4)).toBe("2,336");
    expect(formatCount(384)).toBe("384");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("dates", () => {
  it("parses and rebuilds ISO dates", () => {
    expect(parseIsoDate("2026-11-14")).toEqual({ year: 2026, month: 10, day: 14 });
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("14/11/2026")).toBeNull();
    expect(toIsoDate(2026, 0, 5)).toBe("2026-01-05");
  });

  it("knows month lengths, including leap years", () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2100, 1)).toBe(28);
    expect(daysInMonth(2026, 3)).toBe(30);
  });

  it("derives the weekday without a time zone", () => {
    expect(weekdayOf({ year: 2026, month: 10, day: 14 })).toBe(6); // Saturday
    expect(weekdayOf({ year: 2026, month: 0, day: 1 })).toBe(4); // Thursday
  });

  it("formats dates in words", () => {
    expect(formatDate("2026-11-14")).toBe("Nov 14");
    expect(formatDate("2026-11-14", { weekday: true })).toBe("Sat, Nov 14");
    expect(formatDate("2026-03-08", { weekday: true, year: true })).toBe("Sun, Mar 8, 2026");
    expect(formatDate("garbage")).toBe("garbage");
  });
});

describe("directions, angles and distances", () => {
  it("names compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(225)).toBe("SW");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
    expect(compassPoint(202.5, 16)).toBe("SSW");
    expect(compassWords(135)).toBe("south-east");
    expect(compassPoint(NaN)).toBe("");
  });

  it("formats bearings, angles and distances", () => {
    expect(formatBearing(224.6)).toBe("SW · 225°");
    expect(formatBearing(359.7)).toBe("N · 0°");
    expect(formatAngle(34.2)).toBe("34°");
    expect(formatAngle(4.46)).toBe("4.5°");
    expect(formatDistance(41.6)).toBe("42 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(-1)).toBe("");
  });
});
