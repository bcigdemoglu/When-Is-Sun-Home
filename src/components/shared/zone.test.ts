import { describe, expect, it } from "vitest";
import { utcOffsetLabel, zoneAbbreviation, zoneCity, zoneLabel } from "./zone";

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

describe("zone names", () => {
  it("names a zone in one line", () => {
    expect(zoneLabel("America/Los_Angeles", "2026-07-01", 720)).toBe(
      "Los Angeles time (PDT, UTC−7)",
    );
    expect(zoneLabel("Asia/Tokyo", "2026-07-01", 720)).toBe("Tokyo time (GMT+9, UTC+9)");
    expect(zoneLabel("Etc/GMT", "2026-07-01", 720)).toBe("GMT time (UTC)");
  });

  it("shortens zone names", () => {
    expect(zoneCity("America/Los_Angeles")).toBe("Los Angeles");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("Etc/GMT+8")).toBe("GMT+8");
  });
});
