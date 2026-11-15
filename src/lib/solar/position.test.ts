import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { angularDistanceDeg } from "@/lib/geo/local";
import { real } from "@/lib/geo/testing";

import { HORIZONS_INSTANTS, HORIZONS_SITES } from "./horizons.testdata";
import { sunEphemerisAt, sunPositionAt, sunPositionAtMs, sunTimesFor } from "./position";
import { dateFromDayIndex, timeZoneAt, zonedToUtc, zonedToUtcMs } from "./timezone";

const RAD = Math.PI / 180;

const SF = { lat: 37.7749, lng: -122.4194, zone: "America/Los_Angeles" };
const LONDON = { lat: 51.5074, lng: -0.1278, zone: "Europe/London" };
const SYDNEY = { lat: -33.8688, lng: 151.2093, zone: "Australia/Sydney" };
const TROMSO = { lat: 69.6492, lng: 18.9553, zone: "Europe/Oslo" };
/** North Iceland, just below the Arctic Circle; Iceland keeps UTC all year. */
const AKUREYRI = { lat: 65.6835, lng: -18.0878, zone: "Atlantic/Reykjavik" };

const declinationDeg = (iso: string) => Math.asin(sunEphemerisAt(Date.parse(iso)).sinDec) / RAD;
/** Equation of time (apparent − mean solar time), minutes, at a UTC noon. */
const equationOfTimeMin = (isoNoon: string) => sunEphemerisAt(Date.parse(isoNoon)).ghaDeg * 4;

describe("accuracy against JPL Horizons", () => {
  // The oracle: NASA/JPL's reference ephemeris (DE441), queried for the
  // airless apparent azimuth / elevation of the sun's centre at five sites
  // from the equator to the Arctic, 32 instants in each of 2000, 2026, 2050
  // and 2100. See horizons.testdata.ts for the exact query.
  test("the table is what the header says", () => {
    expect(HORIZONS_SITES.map((s) => s.name)).toEqual([
      "San Francisco",
      "London",
      "Sydney",
      "Quito",
      "Tromsø",
    ]);
    expect(HORIZONS_INSTANTS).toHaveLength(128);
    for (const site of HORIZONS_SITES) expect(site.azEl).toHaveLength(128);
    expect(new Set(HORIZONS_INSTANTS.map((iso) => iso.slice(0, 4)))).toEqual(
      new Set(["2000", "2026", "2050", "2100"]),
    );
  });

  test("position is within 0.02° of Horizons everywhere, 2000–2100 (target: 0.05°)", () => {
    let worstAltitude = 0;
    let worstAzimuth = 0;
    for (const site of HORIZONS_SITES) {
      site.azEl.forEach(([azimuth, elevation], i) => {
        const instant = new Date(HORIZONS_INSTANTS[i].replace("Z", ":00Z"));
        const actual = sunPositionAt(site.lat, site.lng, instant);
        const altitudeError = Math.abs(actual.altitudeDeg - elevation);
        // Azimuth error measured on the sky: near the zenith a tiny shift of
        // the sun is a large change of azimuth.
        const azimuthError =
          angularDistanceDeg(actual.azimuthDeg, azimuth) * Math.cos(elevation * RAD);
        const where = `${site.name} ${HORIZONS_INSTANTS[i]}`;
        expect(altitudeError, `${where} altitude`).toBeLessThan(0.02);
        expect(azimuthError, `${where} azimuth`).toBeLessThan(0.02);
        worstAltitude = Math.max(worstAltitude, altitudeError);
        worstAzimuth = Math.max(worstAzimuth, azimuthError);
      });
    }
    console.log(
      `sun position vs JPL Horizons (640 samples, 2000–2100): ` +
        `max altitude error ${worstAltitude.toFixed(4)}°, max azimuth error ${worstAzimuth.toFixed(4)}°`,
    );
  });

  test("spot values straight from the table", () => {
    // San Francisco, 2026-06-21 20:30 UTC (13:30 PDT), just after local noon.
    const i = HORIZONS_INSTANTS.indexOf("2026-06-21T20:30Z");
    const [azimuth, elevation] = HORIZONS_SITES[0].azEl[i];
    const actual = sunPositionAt(37.7906, -122.4294, new Date("2026-06-21T20:30:00Z"));
    expect(actual.azimuthDeg).toBeCloseTo(azimuth, 1);
    expect(actual.altitudeDeg).toBeCloseTo(elevation, 1);
    expect(elevation).toBeGreaterThan(74);
    expect(azimuth).toBeGreaterThan(180);
  });
});

describe("almanac facts for 2026", () => {
  // Equinox and solstice instants as published by the U.S. Naval Observatory
  // ("Earth's Seasons", UT): 20 Mar 14:46, 21 Jun 08:24, 23 Sep 00:05,
  // 21 Dec 20:50. (Horizons gives an apparent declination of +0.0001° at the
  // first of these.) The declination moves 0.0165°/hour at an equinox.
  test("the declination is zero at the equinoxes", () => {
    expect(Math.abs(declinationDeg("2026-03-20T14:46:00Z"))).toBeLessThan(0.006);
    expect(Math.abs(declinationDeg("2026-09-23T00:05:00Z"))).toBeLessThan(0.006);
    // …rising in March, falling in September.
    expect(declinationDeg("2026-03-20T20:46:00Z")).toBeGreaterThan(0.05);
    expect(declinationDeg("2026-09-23T06:05:00Z")).toBeLessThan(-0.05);
  });

  test("the declination peaks at ±(obliquity = 23.44°) at the solstices", () => {
    const june = declinationDeg("2026-06-21T08:24:00Z");
    const december = declinationDeg("2026-12-21T20:50:00Z");
    expect(june).toBeCloseTo(23.437, 2);
    expect(december).toBeCloseTo(-23.437, 2);
    for (const offsetDays of [-3, -1, 1, 3]) {
      const ms = offsetDays * 86_400_000;
      const juneNear = Math.asin(sunEphemerisAt(Date.parse("2026-06-21T08:24:00Z") + ms).sinDec);
      const decemberNear = Math.asin(
        sunEphemerisAt(Date.parse("2026-12-21T20:50:00Z") + ms).sinDec,
      );
      expect(juneNear / RAD).toBeLessThan(june);
      expect(decemberNear / RAD).toBeGreaterThan(december);
    }
  });

  test("equation of time: the four yearly extremes and the four zeros", () => {
    // Classic values (e.g. Meeus, "Astronomical Algorithms", ch. 28; any
    // analemma table): −14 min 15 s on 11 Feb, +3 min 41 s on 14 May,
    // −6 min 30 s on 26 Jul, +16 min 25 s on 3 Nov; zero near 15 Apr, 13 Jun,
    // 1 Sep and 25 Dec.
    expect(equationOfTimeMin("2026-02-11T12:00:00Z")).toBeCloseTo(-14.25, 0);
    expect(equationOfTimeMin("2026-05-14T12:00:00Z")).toBeCloseTo(3.68, 0);
    expect(equationOfTimeMin("2026-07-26T12:00:00Z")).toBeCloseTo(-6.5, 0);
    expect(equationOfTimeMin("2026-11-03T12:00:00Z")).toBeCloseTo(16.42, 0);
    expect(Math.abs(equationOfTimeMin("2026-02-11T12:00:00Z") + 14.25)).toBeLessThan(0.15);
    expect(Math.abs(equationOfTimeMin("2026-11-03T12:00:00Z") - 16.42)).toBeLessThan(0.15);
    for (const zero of ["2026-04-15", "2026-06-13", "2026-09-01", "2026-12-25"]) {
      expect(Math.abs(equationOfTimeMin(`${zero}T12:00:00Z`)), zero).toBeLessThan(0.5);
    }
  });

  test("noon altitude is 90° − |latitude − declination|", () => {
    for (const place of [SF, LONDON, SYDNEY, TROMSO, { lat: 10, lng: 0 }, { lat: 0, lng: 100 }]) {
      for (const iso of ["2026-03-20T14:46:00Z", "2026-06-21T08:24:00Z", "2026-12-21T20:50:00Z"]) {
        // Find the day's highest altitude by brute force: every minute, then
        // every 100 ms around the best minute (the sun can move 0.25°/minute).
        const start = Date.parse(iso) - 12 * 3_600_000;
        let highest = -90;
        let highestMs = start;
        const scan = (from: number, to: number, step: number) => {
          for (let ms = from; ms <= to; ms += step) {
            const altitude = sunPositionAtMs(place.lat, place.lng, ms).altitudeDeg;
            if (altitude > highest) {
              highest = altitude;
              highestMs = ms;
            }
          }
        };
        scan(start, start + 24 * 3_600_000, 60_000);
        scan(highestMs - 60_000, highestMs + 60_000, 100);
        const declination = Math.asin(sunEphemerisAt(highestMs).sinDec) / RAD;
        expect(highest).toBeCloseTo(90 - Math.abs(place.lat - declination), 2);
      }
    }
  });
});

describe("sunPositionAt", () => {
  test("northern mid-latitudes: the sun is due south at solar noon", () => {
    // San Francisco, winter solstice 2026; local apparent noon is 20:07:55 UTC.
    const noon = sunPositionAt(SF.lat, SF.lng, new Date("2026-12-21T20:07:55Z"));
    expect(Math.abs(noon.azimuthDeg - 180)).toBeLessThan(0.05);
    // Altitude at transit = 90° − latitude + declination (−23.44° at the solstice).
    expect(noon.altitudeDeg).toBeCloseTo(90 - SF.lat - 23.44, 1);

    // Summer solstice: transit at 20:11:35 UTC, altitude 90 − lat + 23.44.
    const summer = sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T20:11:35Z"));
    expect(Math.abs(summer.azimuthDeg - 180)).toBeLessThan(0.3);
    expect(summer.altitudeDeg).toBeCloseTo(90 - SF.lat + 23.44, 1);
  });

  test("southern hemisphere: the sun is due north at solar noon", () => {
    // Sydney, 21 June 2026; local apparent noon ≈ 01:57 UTC (11:57 AEST).
    const noon = sunPositionAt(SYDNEY.lat, SYDNEY.lng, new Date("2026-06-21T01:57:00Z"));
    expect(angularDistanceDeg(noon.azimuthDeg, 0)).toBeLessThan(0.3);
    expect(noon.altitudeDeg).toBeCloseTo(90 - 33.8688 - 23.44, 1);
  });

  test("equator at the March equinox: the noon sun is overhead", () => {
    // Greenwich meridian; the equation of time (−7.4 min) puts transit at 12:07:25 UTC.
    const noon = sunPositionAt(0, 0, new Date("2026-03-20T12:07:25Z"));
    expect(noon.altitudeDeg).toBeGreaterThan(89.9);
  });

  test("tropics in June: the noon sun passes to the NORTH even in the northern hemisphere", () => {
    // 10°N, 0°E: the sun's declination (+23.4°) exceeds the latitude.
    const noon = sunPositionAt(10, 0, new Date("2026-06-21T12:01:50Z"));
    expect(angularDistanceDeg(noon.azimuthDeg, 0)).toBeLessThan(0.5);
    expect(noon.altitudeDeg).toBeCloseTo(90 - (23.44 - 10), 1);
  });

  test("solstice sunrise azimuths follow cos(az) = sin(dec) / cos(lat)", () => {
    // San Francisco: 59.8° (north of east) in June, 120.2° in December; due
    // east (90°) at an equinox — where the geometric altitude crosses zero.
    const azimuthAtSunrise = (date: string) => {
      const minute = sunTimesFor(SF.lat, SF.lng, date, SF.zone).sunriseMinute!;
      return sunPositionAt(SF.lat, SF.lng, zonedToUtc(date, minute, SF.zone)!).azimuthDeg;
    };
    const expected = (declination: number) =>
      Math.acos(Math.sin(declination * RAD) / Math.cos(SF.lat * RAD)) / RAD;
    expect(expected(23.44)).toBeCloseTo(59.8, 1);
    expect(azimuthAtSunrise("2026-06-21")).toBeCloseTo(expected(23.437), 1);
    expect(azimuthAtSunrise("2026-12-21")).toBeCloseTo(expected(-23.437), 1);
    // On 20 March the sun rises ~8 h before the equinox instant (dec ≈ −0.13°).
    expect(Math.abs(azimuthAtSunrise("2026-03-20") - 90)).toBeLessThan(0.3);
  });

  test("the sun is below the horizon at local midnight", () => {
    expect(
      sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T08:00:00Z")).altitudeDeg,
    ).toBeLessThan(-20);
    expect(
      sunPositionAt(SYDNEY.lat, SYDNEY.lng, new Date("2026-06-21T14:00:00Z")).altitudeDeg,
    ).toBeLessThan(-40);
  });

  test("mornings are east of the meridian and afternoons west (northern mid-latitudes)", () => {
    for (let hour = 6; hour <= 11; hour++) {
      const p = sunPositionAt(SF.lat, SF.lng, zonedToUtc("2026-06-21", hour * 60, SF.zone)!);
      expect(p.azimuthDeg).toBeGreaterThan(0);
      expect(p.azimuthDeg).toBeLessThan(180);
    }
    for (let hour = 14; hour <= 20; hour++) {
      const p = sunPositionAt(SF.lat, SF.lng, zonedToUtc("2026-06-21", hour * 60, SF.zone)!);
      expect(p.azimuthDeg).toBeGreaterThan(180);
      expect(p.azimuthDeg).toBeLessThan(360);
    }
  });

  test("always returns a compass azimuth in [0, 360) and an altitude in [-90, 90]", () => {
    fc.assert(
      fc.property(
        real(-90, 90),
        real(-180, 180),
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) }),
        (lat, lng, ms) => {
          const p = sunPositionAt(lat, lng, new Date(ms));
          expect(p.azimuthDeg).toBeGreaterThanOrEqual(0);
          expect(p.azimuthDeg).toBeLessThan(360);
          expect(p.altitudeDeg).toBeGreaterThanOrEqual(-90);
          expect(p.altitudeDeg).toBeLessThanOrEqual(90);
          expect(sunPositionAtMs(lat, lng, ms)).toEqual(p);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("an invalid Date gives NaN, not a made-up position", () => {
    const p = sunPositionAt(SF.lat, SF.lng, new Date(NaN));
    expect(Number.isNaN(p.altitudeDeg)).toBe(true);
    expect(Number.isNaN(p.azimuthDeg)).toBe(true);
  });
});

describe("sunTimesFor", () => {
  const hhmm = (h: number, m: number) => h * 60 + m;
  const altitudeAt = (place: { lat: number; lng: number; zone: string }, date: string, m: number) =>
    sunPositionAtMs(place.lat, place.lng, zonedToUtcMs(date, m, place.zone)).altitudeDeg;

  test("sunrise and sunset are where the geometric altitude crosses exactly 0°", () => {
    for (const place of [SF, LONDON, SYDNEY]) {
      for (const date of ["2026-01-10", "2026-03-20", "2026-06-21", "2026-09-30", "2026-12-21"]) {
        const times = sunTimesFor(place.lat, place.lng, date, place.zone);
        const rise = times.sunriseMinute!;
        const set = times.sunsetMinute!;
        expect(Math.abs(altitudeAt(place, date, rise))).toBeLessThan(1e-5);
        expect(Math.abs(altitudeAt(place, date, set))).toBeLessThan(1e-5);
        // Night one second before sunrise and after sunset, day on the inside.
        expect(altitudeAt(place, date, rise - 1 / 60)).toBeLessThan(0);
        expect(altitudeAt(place, date, rise + 1 / 60)).toBeGreaterThan(0);
        expect(altitudeAt(place, date, set - 1 / 60)).toBeGreaterThan(0);
        expect(altitudeAt(place, date, set + 1 / 60)).toBeLessThan(0);
      }
    }
  });

  test("they sit a few minutes inside the published (upper limb, refracted) times", () => {
    // Almanac sunrise / sunset, local wall-clock time. The almanac event is
    // the centre at −0.833°; the sun climbs 0.1–0.2° per minute at these
    // latitudes, so our 0° crossing is 4–8 minutes later (earlier at sunset).
    const cases: [typeof SF, string, number, number][] = [
      [SF, "2026-06-21", hhmm(5, 48), hhmm(20, 35)],
      [SF, "2026-12-21", hhmm(7, 21), hhmm(16, 54)],
      [LONDON, "2026-06-21", hhmm(4, 43), hhmm(21, 21)],
      [LONDON, "2026-12-21", hhmm(8, 4), hhmm(15, 53)],
      [SYDNEY, "2026-12-21", hhmm(5, 41), hhmm(20, 5)],
      [SYDNEY, "2026-06-21", hhmm(7, 0), hhmm(16, 54)],
    ];
    for (const [place, date, almanacSunrise, almanacSunset] of cases) {
      const times = sunTimesFor(place.lat, place.lng, date, place.zone);
      const label = `${place.zone} ${date}`;
      expect(times.sunriseMinute! - almanacSunrise, `${label} sunrise`).toBeGreaterThan(2.5);
      expect(times.sunriseMinute! - almanacSunrise, `${label} sunrise`).toBeLessThan(9);
      expect(almanacSunset - times.sunsetMinute!, `${label} sunset`).toBeGreaterThan(2.5);
      expect(almanacSunset - times.sunsetMinute!, `${label} sunset`).toBeLessThan(9);

      // And the almanac instants themselves are where the centre is at −0.833°:
      // an independent check of the model against published times (±1 minute).
      for (const [minute, name] of [
        [almanacSunrise, "sunrise"],
        [almanacSunset, "sunset"],
      ] as const) {
        const altitude = altitudeAt(place, date, minute + 0.5);
        expect(Math.abs(altitude + 0.833), `${label} almanac ${name}`).toBeLessThan(0.2);
      }
    }
  });

  test("solar noon in San Francisco is 13:11:35 PDT in June and 12:07:55 PST in December", () => {
    expect(sunTimesFor(SF.lat, SF.lng, "2026-06-21", SF.zone).solarNoonMinute).toBeCloseTo(
      hhmm(13, 11) + 35 / 60,
      0,
    );
    expect(sunTimesFor(SF.lat, SF.lng, "2026-12-21", SF.zone).solarNoonMinute).toBeCloseTo(
      hhmm(12, 7) + 55 / 60,
      0,
    );
  });

  test("uses the place's wall clock across a DST change", () => {
    // Sunrise drifts ~1.5 min earlier per day in March, but the clock jumps an hour.
    const before = sunTimesFor(SF.lat, SF.lng, "2026-03-07", SF.zone);
    const after = sunTimesFor(SF.lat, SF.lng, "2026-03-08", SF.zone);
    expect(after.sunriseMinute! - before.sunriseMinute!).toBeGreaterThan(57);
    expect(after.sunriseMinute! - before.sunriseMinute!).toBeLessThan(60);
    expect(after.sunsetMinute! - before.sunsetMinute!).toBeGreaterThan(60);
    expect(after.sunsetMinute! - before.sunsetMinute!).toBeLessThan(62);
  });

  test("polar day and polar night have no sunrise or sunset", () => {
    const midsummer = sunTimesFor(TROMSO.lat, TROMSO.lng, "2026-06-21", TROMSO.zone);
    expect(midsummer.sunriseMinute).toBeNull();
    expect(midsummer.sunsetMinute).toBeNull();
    expect(midsummer.solarNoonMinute).not.toBeNull();

    const midwinter = sunTimesFor(TROMSO.lat, TROMSO.lng, "2026-12-21", TROMSO.zone);
    expect(midwinter.sunriseMinute).toBeNull();
    expect(midwinter.sunsetMinute).toBeNull();
    expect(midwinter.solarNoonMinute).not.toBeNull();
  });

  test("a sunset just after midnight is reported on the date it falls on", () => {
    // Akureyri (65.7°N, on UTC), 21 June: the sun dips below the horizon a few
    // minutes past midnight and is back before 02:30. The sunset that happens
    // ON the 21st is therefore the early-morning one, before that day's sunrise.
    const times = sunTimesFor(AKUREYRI.lat, AKUREYRI.lng, "2026-06-21", AKUREYRI.zone);
    expect(times.sunsetMinute!).toBeGreaterThan(0);
    expect(times.sunsetMinute!).toBeLessThan(30);
    expect(times.sunriseMinute!).toBeGreaterThan(hhmm(1, 45));
    expect(times.sunriseMinute!).toBeLessThan(hhmm(2, 45));
    expect(times.sunsetMinute!).toBeLessThan(times.sunriseMinute!);
    const atSunset = sunPositionAt(
      AKUREYRI.lat,
      AKUREYRI.lng,
      zonedToUtc("2026-06-21", times.sunsetMinute!, AKUREYRI.zone)!,
    );
    expect(Math.abs(atSunset.altitudeDeg)).toBeLessThan(1e-5);
    // It is on the north-north-western horizon: really a sunset, not a sunrise.
    expect(atSunset.azimuthDeg).toBeGreaterThan(330);
    // The sun is up for the rest of the date, from sunrise to midnight.
    expect(altitudeAt(AKUREYRI, "2026-06-21", 1439)).toBeGreaterThan(0);
    expect(altitudeAt(AKUREYRI, "2026-06-21", 60)).toBeLessThan(0);
  });

  test("events are real: on the horizon at sunrise/sunset, on the meridian at solar noon", () => {
    fc.assert(
      fc.property(
        real(-62, 62),
        real(-179.9, 179.9),
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 0, max: 364 }),
        (lat, lng, year, day) => {
          const zone = timeZoneAt(lat, lng);
          const date = dateFromDayIndex(year, day);
          const times = sunTimesFor(lat, lng, date, zone);
          const positionAt = (minute: number) => {
            const instant = zonedToUtc(date, minute, zone);
            return instant === null ? null : sunPositionAt(lat, lng, instant);
          };

          for (const minute of [times.sunriseMinute, times.sunsetMinute, times.solarNoonMinute]) {
            if (minute !== null) {
              expect(minute).toBeGreaterThanOrEqual(0);
              expect(minute).toBeLessThan(1440);
            }
          }
          // (A position is null only if the event falls in a DST gap label.)
          if (times.sunriseMinute !== null) {
            const sun = positionAt(times.sunriseMinute);
            if (sun) {
              expect(Math.abs(sun.altitudeDeg)).toBeLessThan(1e-4);
              expect(sun.azimuthDeg).toBeLessThan(180); // eastern half
            }
          }
          if (times.sunsetMinute !== null) {
            const sun = positionAt(times.sunsetMinute);
            if (sun) {
              expect(Math.abs(sun.altitudeDeg)).toBeLessThan(1e-4);
              expect(sun.azimuthDeg).toBeGreaterThan(180); // western half
            }
          }
          if (times.solarNoonMinute !== null) {
            const sun = positionAt(times.solarNoonMinute);
            if (sun) {
              // Due south or due north, measured on the sky.
              const offMeridian = Math.min(
                angularDistanceDeg(sun.azimuthDeg, 180),
                angularDistanceDeg(sun.azimuthDeg, 0),
              );
              expect(offMeridian * Math.cos(sun.altitudeDeg * RAD)).toBeLessThan(1e-3);
              const earlier = positionAt(Math.max(0, times.solarNoonMinute - 20));
              const later = positionAt(Math.min(1439.99, times.solarNoonMinute + 20));
              if (earlier) expect(sun.altitudeDeg).toBeGreaterThan(earlier.altitudeDeg - 0.01);
              if (later) expect(sun.altitudeDeg).toBeGreaterThan(later.altitudeDeg - 0.01);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test("ordinary days: sunrise < solar noon < sunset, all on the requested date", () => {
    for (const place of [SF, LONDON, SYDNEY]) {
      for (let day = 0; day < 365; day += 7) {
        const date = dateFromDayIndex(2026, day);
        const t = sunTimesFor(place.lat, place.lng, date, place.zone);
        expect(t.sunriseMinute).not.toBeNull();
        expect(t.sunsetMinute).not.toBeNull();
        expect(t.solarNoonMinute).not.toBeNull();
        expect(t.sunriseMinute!).toBeLessThan(t.solarNoonMinute!);
        expect(t.solarNoonMinute!).toBeLessThan(t.sunsetMinute!);
      }
    }
  });
});
