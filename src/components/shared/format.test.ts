import { describe, expect, it } from "vitest";
import {
  compassName,
  compassPoint,
  formatClock,
  formatClockCompact,
  formatCoordinates,
  formatDuration,
  formatMonthDay,
  formatShortDate,
  utcOffsetLabel,
  zoneAbbreviation,
  zoneCity,
} from "./format";

describe("formatClock", () => {
  it("formats 12-hour wall-clock times", () => {
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(59)).toBe("12:59 AM");
    expect(formatClock(60)).toBe("1:00 AM");
    expect(formatClock(720)).toBe("12:00 PM");
    expect(formatClock(15 * 60 + 42)).toBe("3:42 PM");
    expect(formatClock(1439)).toBe("11:59 PM");
  });

  it("floors fractions, wraps out-of-range values and survives NaN", () => {
    expect(formatClock(942.9)).toBe("3:42 PM");
    expect(formatClock(1440)).toBe("12:00 AM");
    expect(formatClock(-1)).toBe("11:59 PM");
    expect(formatClock(NaN)).toBe("–");
  });

  it("has a compact form", () => {
    expect(formatClockCompact(6 * 60 + 5)).toBe("6:05a");
    expect(formatClockCompact(17 * 60)).toBe("5:00p");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(125)).toBe("2 h 05 min");
    expect(formatDuration(-3)).toBe("0 min");
  });
});

describe("zone naming across DST", () => {
  const LA = "America/Los_Angeles";

  it("uses the abbreviation in force on that date", () => {
    expect(zoneAbbreviation(LA, "2026-01-15", 720)).toBe("PST");
    expect(zoneAbbreviation(LA, "2026-07-01", 720)).toBe("PDT");
  });

  it("switches on the day of the change, at the hour of the change", () => {
    // Spring forward: 2026-03-08 02:00 PST → 03:00 PDT.
    expect(zoneAbbreviation(LA, "2026-03-08", 60)).toBe("PST");
    expect(zoneAbbreviation(LA, "2026-03-08", 200)).toBe("PDT");
    // 02:30 does not exist; the clocks show 03:30 PDT next.
    expect(zoneAbbreviation(LA, "2026-03-08", 150)).toBe("PDT");
    // Fall back: 2026-11-01 02:00 PDT → 01:00 PST.
    expect(zoneAbbreviation(LA, "2026-11-01", 30)).toBe("PDT");
    expect(zoneAbbreviation(LA, "2026-11-01", 180)).toBe("PST");
  });

  it("does not depend on the machine's own zone", () => {
    expect(zoneAbbreviation("Asia/Tokyo", "2026-06-01", 720)).toBe("GMT+9");
    expect(zoneAbbreviation("Not/AZone", "2026-06-01", 720)).toBe("");
  });

  it("labels the UTC offset", () => {
    expect(utcOffsetLabel(LA, "2026-01-15", 720)).toBe("UTC−8");
    expect(utcOffsetLabel(LA, "2026-07-01", 720)).toBe("UTC−7");
    expect(utcOffsetLabel(LA, "2026-03-08", 150)).toBe("UTC−7");
    expect(utcOffsetLabel("Asia/Kolkata", "2026-07-01", 0)).toBe("UTC+5:30");
    expect(utcOffsetLabel("Etc/GMT", "2026-07-01", 0)).toBe("UTC");
    expect(utcOffsetLabel("Not/AZone", "2026-07-01", 0)).toBe("");
  });
});

describe("dates", () => {
  it("formats ISO dates without a time zone", () => {
    expect(formatShortDate("2026-11-14")).toBe("Sat, Nov 14");
    expect(formatShortDate("2026-01-01", true)).toBe("Thu, Jan 1, 2026");
    expect(formatMonthDay("2024-02-29")).toBe("February 29");
  });

  it("returns unparseable input unchanged", () => {
    expect(formatShortDate("nope")).toBe("nope");
    expect(formatMonthDay("2026-13-01")).toBe("2026-13-01");
  });
});

describe("compass", () => {
  it("names the nearest of eight points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(22)).toBe("N");
    expect(compassPoint(23)).toBe("NE");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(337.5)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
    expect(compassPoint(NaN)).toBe("–");
    expect(compassName(135)).toBe("south-east");
  });
});

describe("places", () => {
  it("formats coordinates with hemispheres", () => {
    expect(formatCoordinates(37.7906, -122.4294)).toBe("37.7906° N, 122.4294° W");
    expect(formatCoordinates(-33.8568, 151.2153)).toBe("33.8568° S, 151.2153° E");
  });

  it("shortens zone names", () => {
    expect(zoneCity("America/Los_Angeles")).toBe("Los Angeles");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("Etc/GMT+8")).toBe("GMT+8");
  });
});
