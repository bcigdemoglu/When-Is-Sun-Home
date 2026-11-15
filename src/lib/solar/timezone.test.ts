import { TZDate } from "@date-fns/tz";
import fc from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  addDays,
  dateFromDayIndex,
  dayIndexFromDate,
  daysInYear,
  isLeapYear,
  localMidnightMs,
  nowInZone,
  timeZoneAt,
  utcOffsetMinutes,
  utcToZoned,
  yearOfDate,
  zonedToUtc,
  zonedToUtcMs,
  zoneOffsetTable,
} from "./timezone";

const ZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "America/St_Johns", // -03:30 / -02:30
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Oslo",
  "Africa/Cairo", // DST starts at local midnight
  "Asia/Kolkata", // +05:30, no DST
  "Asia/Kathmandu", // +05:45
  "Asia/Tokyo",
  "Australia/Sydney",
  "Australia/Lord_Howe", // 30-minute DST shift
  "Pacific/Auckland",
  "Pacific/Chatham", // +12:45 / +13:45
  "Pacific/Kiritimati", // +14
  "Etc/GMT+12", // -12
  "UTC",
];

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

describe("timeZoneAt", () => {
  test("finds the IANA zone of well-known places", () => {
    expect(timeZoneAt(37.7906, -122.4294)).toBe("America/Los_Angeles");
    expect(timeZoneAt(51.5074, -0.1278)).toBe("Europe/London");
    expect(timeZoneAt(-33.8688, 151.2093)).toBe("Australia/Sydney");
    expect(timeZoneAt(35.6762, 139.6503)).toBe("Asia/Tokyo");
    expect(timeZoneAt(27.7172, 85.324)).toBe("Asia/Kathmandu");
  });

  test("returns a usable zone in the open ocean", () => {
    const zone = timeZoneAt(0, -140);
    expect(() => utcOffsetMinutes(zone, 0)).not.toThrow();
    expect(utcOffsetMinutes(zone, Date.UTC(2026, 5, 1))).toBeCloseTo(-9 * 60, -2);
  });

  test("falls back to a fixed-offset zone from the longitude when lookup throws", () => {
    // Latitude out of range makes tz-lookup throw.
    expect(timeZoneAt(95, -122.4)).toBe("Etc/GMT+8");
    expect(timeZoneAt(-95, 151.2)).toBe("Etc/GMT-10");
    expect(timeZoneAt(95, 3)).toBe("Etc/GMT");
    expect(timeZoneAt(95, 179)).toBe("Etc/GMT-12");
    expect(timeZoneAt(95, -179)).toBe("Etc/GMT+12");
    expect(timeZoneAt(NaN, NaN)).toBe("Etc/GMT");
    // The POSIX-style sign really is inverted: Etc/GMT+8 is UTC−8.
    expect(utcOffsetMinutes("Etc/GMT+8", 0)).toBe(-480);
    expect(utcOffsetMinutes("Etc/GMT-10", 0)).toBe(600);
  });
});

describe("calendar helpers", () => {
  test("leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
  });

  test("dateFromDayIndex", () => {
    expect(dateFromDayIndex(2026, 0)).toBe("2026-01-01");
    expect(dateFromDayIndex(2026, 30)).toBe("2026-01-31");
    expect(dateFromDayIndex(2026, 31)).toBe("2026-02-01");
    expect(dateFromDayIndex(2026, 58)).toBe("2026-02-28");
    expect(dateFromDayIndex(2026, 59)).toBe("2026-03-01");
    expect(dateFromDayIndex(2024, 59)).toBe("2024-02-29");
    expect(dateFromDayIndex(2026, 364)).toBe("2026-12-31");
    expect(dateFromDayIndex(2024, 365)).toBe("2024-12-31");
  });

  test("dayIndexFromDate and yearOfDate invert dateFromDayIndex for every day", () => {
    for (const year of [2023, 2024, 2026, 2100]) {
      for (let i = 0; i < daysInYear(year); i++) {
        const date = dateFromDayIndex(year, i);
        expect(dayIndexFromDate(date)).toBe(i);
        expect(yearOfDate(date)).toBe(year);
      }
    }
  });

  test("addDays crosses months, years and leap days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-08", 0)).toBe("2026-03-08");
    expect(addDays("2026-03-07", 365)).toBe("2027-03-07");
  });

  test("rejects things that are not real dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "20260101", "", "2026-00-10"]) {
      expect(() => localMidnightMs(bad)).toThrow(RangeError);
      expect(() => dayIndexFromDate(bad)).toThrow(RangeError);
      expect(() => yearOfDate(bad)).toThrow(RangeError);
      expect(() => addDays(bad, 1)).toThrow(RangeError);
    }
  });
});

describe("zoneOffsetTable", () => {
  test("Los Angeles 2026: PST → PDT on 8 March, back on 1 November", () => {
    const table = zoneOffsetTable("America/Los_Angeles", 2026);
    expect(table.offsetsMin).toEqual([-480, -420, -480]);
    expect(table.startsMs.slice(1).map((ms) => new Date(ms).toISOString())).toEqual([
      "2026-03-08T10:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
    ]);
  });

  test("zones without DST have a single segment", () => {
    expect(zoneOffsetTable("Asia/Kolkata", 2026).offsetsMin).toEqual([330]);
    expect(zoneOffsetTable("UTC", 2026).offsetsMin).toEqual([0]);
    expect(zoneOffsetTable("Pacific/Kiritimati", 2026).offsetsMin).toEqual([840]);
  });

  test("southern-hemisphere DST: Sydney 2026 ends in April and restarts in October", () => {
    const table = zoneOffsetTable("Australia/Sydney", 2026);
    expect(table.offsetsMin).toEqual([660, 600, 660]);
    expect(table.startsMs.slice(1).map((ms) => new Date(ms).toISOString())).toEqual([
      "2026-04-04T16:00:00.000Z",
      "2026-10-03T16:00:00.000Z",
    ]);
  });

  test("reproduces the zone's real offset at every probed instant of the year", () => {
    // Direct check of the table against Intl, every 2 hours (off the hour, so
    // the probes never coincide with the table's own 12-hourly probes).
    const zones = [
      ...ZONES,
      "America/Havana",
      "America/Santiago",
      "America/Nuuk",
      "Asia/Beirut",
      "Asia/Gaza",
      "Africa/Casablanca",
      "Antarctica/Troll",
      "Europe/Dublin",
      "Pacific/Norfolk",
      "Pacific/Easter",
    ];
    for (const zone of zones) {
      for (const year of [2011, 2026]) {
        const table = zoneOffsetTable(zone, year);
        const start = Date.UTC(year, 0, 1) - 12 * 3_600_000 + 17 * 60_000;
        const end = Date.UTC(year + 1, 0, 1) + 12 * 3_600_000;
        for (let ms = start; ms < end; ms += 2 * 3_600_000) {
          let segment = 0;
          while (segment + 1 < table.startsMs.length && table.startsMs[segment + 1] <= ms)
            segment++;
          const actual = utcOffsetMinutes(zone, ms);
          if (table.offsetsMin[segment] !== actual) {
            throw new Error(
              `${zone} at ${new Date(ms).toISOString()}: table says ${table.offsetsMin[segment]}, Intl says ${actual}`,
            );
          }
        }
      }
    }
  });

  test("transition instants are exact to the second", () => {
    for (const zone of [
      "America/Los_Angeles",
      "Africa/Casablanca",
      "Antarctica/Troll",
      "Pacific/Apia",
    ]) {
      for (const year of [2011, 2026]) {
        const table = zoneOffsetTable(zone, year);
        for (let i = 1; i < table.startsMs.length; i++) {
          expect(table.offsetsMin[i]).not.toBe(table.offsetsMin[i - 1]);
          expect(utcOffsetMinutes(zone, table.startsMs[i])).toBe(table.offsetsMin[i]);
          expect(utcOffsetMinutes(zone, table.startsMs[i] - 1000)).toBe(table.offsetsMin[i - 1]);
        }
      }
    }
  });

  test("is cached", () => {
    expect(zoneOffsetTable("Europe/Oslo", 2026)).toBe(zoneOffsetTable("Europe/Oslo", 2026));
  });

  test("throws for an unknown zone", () => {
    expect(() => zoneOffsetTable("Mars/Olympus_Mons", 2026)).toThrow(RangeError);
  });
});

describe("zonedToUtc", () => {
  test("ordinary times", () => {
    expect(iso(zonedToUtc("2026-01-15", 12 * 60, "America/Los_Angeles"))).toBe(
      "2026-01-15T20:00:00.000Z",
    );
    expect(iso(zonedToUtc("2026-07-15", 12 * 60, "America/Los_Angeles"))).toBe(
      "2026-07-15T19:00:00.000Z",
    );
    expect(iso(zonedToUtc("2026-07-15", 0, "Asia/Kolkata"))).toBe("2026-07-14T18:30:00.000Z");
    expect(iso(zonedToUtc("2026-07-15", 0, "Asia/Kathmandu"))).toBe("2026-07-14T18:15:00.000Z");
    expect(iso(zonedToUtc("2026-01-01", 0, "Pacific/Kiritimati"))).toBe("2025-12-31T10:00:00.000Z");
    expect(iso(zonedToUtc("2026-12-31", 1439, "Etc/GMT+12"))).toBe("2027-01-01T11:59:00.000Z");
    expect(iso(zonedToUtc("2026-06-01", 60, "UTC"))).toBe("2026-06-01T01:00:00.000Z");
  });

  test("fractional minutes", () => {
    expect(iso(zonedToUtc("2026-01-15", 720.5, "America/Los_Angeles"))).toBe(
      "2026-01-15T20:00:30.000Z",
    );
  });

  test("spring-forward gap does not exist (Los Angeles, 8 March 2026, 02:00–03:00)", () => {
    const zone = "America/Los_Angeles";
    expect(iso(zonedToUtc("2026-03-08", 119, zone))).toBe("2026-03-08T09:59:00.000Z");
    expect(iso(zonedToUtc("2026-03-08", 119.99, zone))).toBe("2026-03-08T09:59:59.400Z");
    expect(zonedToUtc("2026-03-08", 120, zone)).toBeNull();
    expect(zonedToUtc("2026-03-08", 150, zone)).toBeNull();
    expect(zonedToUtc("2026-03-08", 179.99, zone)).toBeNull();
    expect(iso(zonedToUtc("2026-03-08", 180, zone))).toBe("2026-03-08T10:00:00.000Z");
    expect(Number.isNaN(zonedToUtcMs("2026-03-08", 150, zone))).toBe(true);
  });

  test("fall-back overlap returns the FIRST occurrence (Los Angeles, 1 November 2026)", () => {
    const zone = "America/Los_Angeles";
    // 00:59 PDT, then 01:00–01:59 happens twice (PDT first, then PST), then 02:00 PST.
    expect(iso(zonedToUtc("2026-11-01", 59, zone))).toBe("2026-11-01T07:59:00.000Z");
    expect(iso(zonedToUtc("2026-11-01", 60, zone))).toBe("2026-11-01T08:00:00.000Z");
    expect(iso(zonedToUtc("2026-11-01", 90, zone))).toBe("2026-11-01T08:30:00.000Z");
    expect(iso(zonedToUtc("2026-11-01", 119, zone))).toBe("2026-11-01T08:59:00.000Z");
    expect(iso(zonedToUtc("2026-11-01", 120, zone))).toBe("2026-11-01T10:00:00.000Z");
  });

  test("London: gap at 01:00 on 29 March, overlap at 01:00 on 25 October 2026", () => {
    expect(zonedToUtc("2026-03-29", 90, "Europe/London")).toBeNull();
    expect(iso(zonedToUtc("2026-03-29", 120, "Europe/London"))).toBe("2026-03-29T01:00:00.000Z");
    expect(iso(zonedToUtc("2026-10-25", 90, "Europe/London"))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(zonedToUtc("2026-10-25", 120, "Europe/London"))).toBe("2026-10-25T02:00:00.000Z");
  });

  test("half-hour DST shift (Lord Howe Island)", () => {
    const zone = "Australia/Lord_Howe";
    // 4 October 2026: 02:00 (+10:30) jumps to 02:30 (+11:00).
    expect(iso(zonedToUtc("2026-10-04", 119, zone))).toBe("2026-10-03T15:29:00.000Z");
    expect(zonedToUtc("2026-10-04", 120, zone)).toBeNull();
    expect(zonedToUtc("2026-10-04", 149, zone)).toBeNull();
    expect(iso(zonedToUtc("2026-10-04", 150, zone))).toBe("2026-10-03T15:30:00.000Z");
    // 5 April 2026: 02:00 (+11:00) falls back to 01:30 (+10:30).
    expect(iso(zonedToUtc("2026-04-05", 105, zone))).toBe("2026-04-04T14:45:00.000Z");
    expect(iso(zonedToUtc("2026-04-05", 120, zone))).toBe("2026-04-04T15:30:00.000Z");
  });

  test("a gap that starts at local midnight (Cairo, 24 April 2026)", () => {
    const zone = "Africa/Cairo";
    expect(iso(zonedToUtc("2026-04-23", 1439, zone))).toBe("2026-04-23T21:59:00.000Z");
    expect(zonedToUtc("2026-04-24", 0, zone)).toBeNull();
    expect(zonedToUtc("2026-04-24", 59, zone)).toBeNull();
    expect(iso(zonedToUtc("2026-04-24", 60, zone))).toBe("2026-04-23T22:00:00.000Z");
  });

  test("an overlap that ends at local midnight (Cairo, 29 October 2026, 23:00–24:00 twice)", () => {
    const zone = "Africa/Cairo";
    expect(iso(zonedToUtc("2026-10-29", 22 * 60 + 59, zone))).toBe("2026-10-29T19:59:00.000Z");
    // First pass through 23:xx is still summer time (UTC+3)…
    expect(iso(zonedToUtc("2026-10-29", 23 * 60 + 59, zone))).toBe("2026-10-29T20:59:00.000Z");
    // …and the next day starts in winter time (UTC+2), two real hours later.
    expect(iso(zonedToUtc("2026-10-30", 0, zone))).toBe("2026-10-29T22:00:00.000Z");
  });

  test("a whole calendar day that never happened (Samoa, 30 December 2011)", () => {
    const zone = "Pacific/Apia";
    expect(iso(zonedToUtc("2011-12-29", 1439, zone))).toBe("2011-12-30T09:59:00.000Z");
    for (const minute of [0, 1, 720, 1439]) {
      expect(zonedToUtc("2011-12-30", minute, zone)).toBeNull();
    }
    expect(iso(zonedToUtc("2011-12-31", 0, zone))).toBe("2011-12-30T10:00:00.000Z");
  });

  test("rejects minutes outside the day and unknown zones", () => {
    expect(() => zonedToUtc("2026-01-01", -1, "UTC")).toThrow(RangeError);
    expect(() => zonedToUtc("2026-01-01", 1440, "UTC")).toThrow(RangeError);
    expect(() => zonedToUtc("2026-01-01", NaN, "UTC")).toThrow(RangeError);
    expect(() => zonedToUtc("2026-01-01", 0, "Not/AZone")).toThrow(RangeError);
  });

  test("agrees with @date-fns/tz TZDate for every day of 2026 in many zones", () => {
    // TZDate is an independent wall-clock → instant implementation. Sample
    // times of day that are never inside a gap or an overlap in these zones
    // (all their transitions fall between 23:00 and 04:00 local time).
    for (const zone of ZONES) {
      for (let day = 0; day < 365; day++) {
        const date = dateFromDayIndex(2026, day);
        const [y, m, d] = date.split("-").map(Number);
        for (const minute of [5 * 60 + 7, 12 * 60, 18 * 60 + 30, 21 * 60 + 45]) {
          const expected = new TZDate(y, m - 1, d, Math.floor(minute / 60), minute % 60, zone);
          expect(zonedToUtcMs(date, minute, zone), `${zone} ${date} ${minute}`).toBe(
            expected.getTime(),
          );
        }
      }
    }
  });

  test("every existing wall-clock minute maps to an instant that reads back the same", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({ min: 2019, max: 2031 }),
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 0, max: 1439 }),
        (zone, year, day, minute) => {
          const date = dateFromDayIndex(year, day);
          const instant = zonedToUtc(date, minute, zone);
          fc.pre(instant !== null);
          expect(utcToZoned(instant!, zone)).toEqual({ date, minuteOfDay: minute });
        },
      ),
      { numRuns: 500 },
    );
  });

  test("instant → wall clock → instant returns the instant, or its earlier twin in an overlap", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({ min: Date.UTC(2019, 0, 2) / 1000, max: Date.UTC(2031, 11, 30) / 1000 }),
        (zone, seconds) => {
          const instant = new Date(seconds * 1000);
          const wall = utcToZoned(instant, zone);
          const back = zonedToUtc(wall.date, wall.minuteOfDay, zone);
          // A time that was just read off a clock always exists.
          expect(back).not.toBeNull();
          expect(utcToZoned(back!, zone)).toEqual(wall);
          const diffMs = instant.getTime() - back!.getTime();
          if (diffMs !== 0) {
            // Only possible in a fall-back overlap: `back` is the first occurrence.
            expect(diffMs).toBeGreaterThan(0);
            expect(utcOffsetMinutes(zone, back!.getTime())).toBeGreaterThan(
              utcOffsetMinutes(zone, instant.getTime()),
            );
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("around every transition: the day has exactly the right number of existing minutes", () => {
    // Count the wall-clock minutes of a day that exist. A spring-forward day
    // loses its gap; a fall-back day still shows all 1440 labels.
    const existing = (date: string, zone: string) => {
      let n = 0;
      for (let m = 0; m < 1440; m++) if (!Number.isNaN(zonedToUtcMs(date, m, zone))) n++;
      return n;
    };
    expect(existing("2026-03-07", "America/Los_Angeles")).toBe(1440);
    expect(existing("2026-03-08", "America/Los_Angeles")).toBe(1380);
    expect(existing("2026-03-09", "America/Los_Angeles")).toBe(1440);
    expect(existing("2026-11-01", "America/Los_Angeles")).toBe(1440);
    expect(existing("2026-10-04", "Australia/Lord_Howe")).toBe(1410);
    expect(existing("2026-04-24", "Africa/Cairo")).toBe(1380);
    expect(existing("2011-12-30", "Pacific/Apia")).toBe(0);
  });
});

describe("utcToZoned / nowInZone", () => {
  test("known instants", () => {
    expect(utcToZoned(new Date("2026-01-15T20:00:00Z"), "America/Los_Angeles")).toEqual({
      date: "2026-01-15",
      minuteOfDay: 720,
    });
    expect(utcToZoned(new Date("2026-07-15T06:59:00Z"), "America/Los_Angeles")).toEqual({
      date: "2026-07-14",
      minuteOfDay: 1439,
    });
    expect(utcToZoned(new Date("2026-07-14T18:15:00Z"), "Asia/Kathmandu")).toEqual({
      date: "2026-07-15",
      minuteOfDay: 0,
    });
    expect(utcToZoned(new Date("2025-12-31T10:00:00Z"), "Pacific/Kiritimati")).toEqual({
      date: "2026-01-01",
      minuteOfDay: 0,
    });
  });

  test("keeps sub-minute precision", () => {
    expect(utcToZoned(new Date("2026-01-15T20:00:30Z"), "America/Los_Angeles")).toEqual({
      date: "2026-01-15",
      minuteOfDay: 720.5,
    });
  });

  test("both sides of a fall-back read the same wall clock", () => {
    const first = utcToZoned(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles");
    const second = utcToZoned(new Date("2026-11-01T09:30:00Z"), "America/Los_Angeles");
    expect(first).toEqual({ date: "2026-11-01", minuteOfDay: 90 });
    expect(second).toEqual(first);
  });

  test("rejects an invalid Date", () => {
    expect(() => utcToZoned(new Date(NaN), "UTC")).toThrow(RangeError);
  });

  test("nowInZone floors to the whole minute and uses the place's date", () => {
    const now = new Date("2026-07-15T06:59:59.999Z");
    expect(nowInZone("America/Los_Angeles", now)).toEqual({
      date: "2026-07-14",
      minuteOfDay: 1439,
    });
    expect(nowInZone("Asia/Tokyo", now)).toEqual({ date: "2026-07-15", minuteOfDay: 959 });
    const live = nowInZone("Europe/London");
    expect(live.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isInteger(live.minuteOfDay)).toBe(true);
    expect(live.minuteOfDay).toBeGreaterThanOrEqual(0);
    expect(live.minuteOfDay).toBeLessThan(1440);
  });
});

describe("the engine never reads the machine's time zone", () => {
  test("no local-time Date API appears in engine source", () => {
    const forbidden =
      /\.(getHours|getMinutes|getSeconds|getDate|getDay|getMonth|getFullYear|getTimezoneOffset|setHours|setMinutes|setDate|setMonth|setFullYear|toLocale\w*String)\(/;
    const root = path.resolve(__dirname, "..");
    for (const dir of ["geo", "solar", "horizon", "analysis"]) {
      for (const file of readdirSync(path.join(root, dir))) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const source = readFileSync(path.join(root, dir, file), "utf8");
        expect(forbidden.test(source), `${dir}/${file} uses a local-time Date method`).toBe(false);
        // `new Date(y, m, d…)` (several numeric arguments) is local time too.
        expect(/new Date\([^()]*,/.test(source), `${dir}/${file} builds a local Date`).toBe(false);
      }
    }
  });
});
