import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { angularDistanceDeg } from "@/lib/geo/local";

import { sunPositionAt, sunTimesFor } from "./position";
import { dateFromDayIndex, timeZoneAt, zonedToUtc } from "./timezone";

const RAD = Math.PI / 180;

const SF = { lat: 37.7749, lng: -122.4194, zone: "America/Los_Angeles" };
const LONDON = { lat: 51.5074, lng: -0.1278, zone: "Europe/London" };
const SYDNEY = { lat: -33.8688, lng: 151.2093, zone: "Australia/Sydney" };
const TROMSO = { lat: 69.6492, lng: 18.9553, zone: "Europe/Oslo" };
const REYKJAVIK = { lat: 64.1466, lng: -21.9426, zone: "Atlantic/Reykjavik" };

/**
 * Independent reference: the NOAA Solar Calculator algorithm (Meeus,
 * "Astronomical Algorithms"), good to ~0.01° for this century. Geometric
 * altitude, no refraction. Shares no code and no constants with suncalc.
 */
function noaaSunPosition(lat: number, lng: number, utcMs: number) {
  const julianDay = utcMs / 86_400_000 + 2440587.5;
  const t = (julianDay - 2451545) / 36525;
  const meanLong = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = meanLong + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD));
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTimeMin =
    (4 / RAD) *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * eccentricity * Math.sin(meanAnomaly * RAD) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD));
  const utcMinutes = (((utcMs / 60_000) % 1440) + 1440) % 1440;
  const trueSolarMinutes = (((utcMinutes + equationOfTimeMin + 4 * lng) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarMinutes / 4 - 180;
  const zenith = Math.acos(
    Math.sin(lat * RAD) * Math.sin(declination) +
      Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle * RAD),
  );
  const cosAzimuth =
    (Math.sin(lat * RAD) * Math.cos(zenith) - Math.sin(declination)) /
    (Math.cos(lat * RAD) * Math.sin(zenith));
  const a = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) / RAD;
  return {
    altitudeDeg: 90 - zenith / RAD,
    azimuthDeg: hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360,
  };
}

/** Largest disagreement with the NOAA reference over a year, in degrees on the sky. */
function maxErrorVsNoaa(year: number) {
  let maxAltitude = 0;
  let maxAzimuth = 0;
  for (const place of [SF, LONDON, SYDNEY, { lat: 0, lng: 0 }, REYKJAVIK]) {
    for (let ms = Date.UTC(year, 0, 1); ms < Date.UTC(year + 1, 0, 1); ms += 37 * 60_000) {
      const reference = noaaSunPosition(place.lat, place.lng, ms);
      const actual = sunPositionAt(place.lat, place.lng, new Date(ms));
      maxAltitude = Math.max(maxAltitude, Math.abs(actual.altitudeDeg - reference.altitudeDeg));
      // Scale azimuth differences by cos(altitude): near the zenith a tiny
      // shift on the sky is a huge change of azimuth.
      const onSky =
        angularDistanceDeg(actual.azimuthDeg, reference.azimuthDeg) *
        Math.cos(reference.altitudeDeg * RAD);
      maxAzimuth = Math.max(maxAzimuth, onSky);
    }
  }
  return { maxAltitude, maxAzimuth };
}

describe("sunPositionAt", () => {
  test("northern mid-latitudes: the sun is due south at solar noon", () => {
    // San Francisco, winter solstice 2026; local apparent noon is 20:08 UTC.
    const noon = sunPositionAt(SF.lat, SF.lng, new Date("2026-12-21T20:08:00Z"));
    expect(noon.azimuthDeg).toBeCloseTo(180, 0);
    expect(Math.abs(noon.azimuthDeg - 180)).toBeLessThan(0.3);
    // Altitude at transit = 90° − latitude + declination (−23.44° at the solstice).
    expect(noon.altitudeDeg).toBeCloseTo(90 - SF.lat - 23.44, 1);

    // Summer solstice: transit at 20:11:35 UTC, altitude 90 − lat + 23.44.
    const summer = sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T20:11:35Z"));
    expect(Math.abs(summer.azimuthDeg - 180)).toBeLessThan(1);
    expect(summer.altitudeDeg).toBeCloseTo(90 - SF.lat + 23.44, 1);
  });

  test("southern hemisphere: the sun is due north at solar noon", () => {
    // Sydney, 21 June 2026; local apparent noon ≈ 01:57 UTC (11:57 AEST).
    const noon = sunPositionAt(SYDNEY.lat, SYDNEY.lng, new Date("2026-06-21T01:57:00Z"));
    expect(angularDistanceDeg(noon.azimuthDeg, 0)).toBeLessThan(0.5);
    expect(noon.altitudeDeg).toBeCloseTo(90 - 33.8688 - 23.44, 1);
  });

  test("equator at the March equinox: the noon sun is overhead", () => {
    // Greenwich meridian; the equation of time puts transit at ≈ 12:07:30 UTC.
    const noon = sunPositionAt(0, 0, new Date("2026-03-20T12:07:30Z"));
    expect(noon.altitudeDeg).toBeGreaterThan(89.5);
  });

  test("tropics in June: the noon sun passes to the NORTH even in the northern hemisphere", () => {
    // 10°N, 0°E: the sun's declination (+23.4°) exceeds the latitude.
    const noon = sunPositionAt(10, 0, new Date("2026-06-21T12:01:50Z"));
    expect(angularDistanceDeg(noon.azimuthDeg, 0)).toBeLessThan(1.5);
    expect(noon.altitudeDeg).toBeCloseTo(90 - (23.44 - 10), 1);
  });

  test("sunrise is in the east, sunset in the west", () => {
    // At an equinox the sun rises due east and sets due west everywhere.
    const times = sunTimesFor(SF.lat, SF.lng, "2026-03-20", SF.zone);
    const rise = sunPositionAt(SF.lat, SF.lng, zonedToUtc("2026-03-20", times.sunriseMinute!, SF.zone)!);
    const set = sunPositionAt(SF.lat, SF.lng, zonedToUtc("2026-03-20", times.sunsetMinute!, SF.zone)!);
    expect(Math.abs(rise.azimuthDeg - 90)).toBeLessThan(1.5);
    expect(Math.abs(set.azimuthDeg - 270)).toBeLessThan(1.5);
  });

  test("solstice sunrise azimuths follow cos(az) = sin(dec) / cos(lat)", () => {
    // San Francisco: ≈ 59.8° (north of east) in June, ≈ 120.2° in December.
    // Evaluate where the geometric altitude crosses zero.
    const azimuthAtGeometricSunrise = (date: string) => {
      let lo = zonedToUtc(date, 4 * 60, SF.zone)!.getTime();
      let hi = zonedToUtc(date, 9 * 60, SF.zone)!.getTime();
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (sunPositionAt(SF.lat, SF.lng, new Date(mid)).altitudeDeg < 0) lo = mid;
        else hi = mid;
      }
      return sunPositionAt(SF.lat, SF.lng, new Date(hi)).azimuthDeg;
    };
    const expected = (declinationDeg: number) =>
      Math.acos(Math.sin(declinationDeg * RAD) / Math.cos(SF.lat * RAD)) / RAD;
    expect(azimuthAtGeometricSunrise("2026-06-21")).toBeCloseTo(expected(23.44), 0);
    expect(azimuthAtGeometricSunrise("2026-12-21")).toBeCloseTo(expected(-23.44), 0);
    expect(Math.abs(azimuthAtGeometricSunrise("2026-06-21") - 59.8)).toBeLessThan(0.3);
    expect(Math.abs(azimuthAtGeometricSunrise("2026-12-21") - 120.2)).toBeLessThan(0.3);
  });

  test("the sun is below the horizon at local midnight", () => {
    expect(sunPositionAt(SF.lat, SF.lng, new Date("2026-06-21T08:00:00Z")).altitudeDeg).toBeLessThan(
      -20,
    );
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
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2050, 0, 1) }),
        (lat, lng, ms) => {
          const p = sunPositionAt(lat, lng, new Date(ms));
          expect(p.azimuthDeg).toBeGreaterThanOrEqual(0);
          expect(p.azimuthDeg).toBeLessThan(360);
          expect(p.altitudeDeg).toBeGreaterThanOrEqual(-90);
          expect(p.altitudeDeg).toBeLessThanOrEqual(90);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("agrees with the independent NOAA algorithm", () => {
    // suncalc is a low-precision model. Measured against NOAA it is off by up
    // to ≈ 0.2–0.3° on the sky (roughly one minute of sun motion):
    //  - its sidereal-time constant puts the hour angle ≈ 0.3° (74 s) out in
    //    2000, shrinking to ≈ 0.13° (32 s) by 2026;
    //  - it keeps the Earth's perihelion fixed at its J2000 longitude, so the
    //    declination error grows by ≈ 0.007°/year (0.18° near the 2026 equinoxes).
    // These bounds pin that known accuracy so a regression (or a swap to a
    // better model, which could tighten them) is visible.
    const y2000 = maxErrorVsNoaa(2000);
    expect(y2000.maxAltitude).toBeLessThan(0.35);
    expect(y2000.maxAzimuth).toBeLessThan(0.35);

    const y2026 = maxErrorVsNoaa(2026);
    expect(y2026.maxAltitude).toBeLessThan(0.25);
    expect(y2026.maxAzimuth).toBeLessThan(0.25);
  });
});

describe("sunTimesFor", () => {
  const hhmm = (h: number, m: number) => h * 60 + m;

  test("matches published sunrise / sunset times within 3 minutes", () => {
    // Almanac values (local wall-clock time, DST where in force).
    const cases: [typeof SF, string, number, number][] = [
      [SF, "2026-06-21", hhmm(5, 48), hhmm(20, 35)],
      [SF, "2026-12-21", hhmm(7, 21), hhmm(16, 54)],
      [LONDON, "2026-06-21", hhmm(4, 43), hhmm(21, 21)],
      [LONDON, "2026-12-21", hhmm(8, 4), hhmm(15, 53)],
      [SYDNEY, "2026-12-21", hhmm(5, 41), hhmm(20, 5)],
      [SYDNEY, "2026-06-21", hhmm(7, 0), hhmm(16, 54)],
    ];
    for (const [place, date, sunrise, sunset] of cases) {
      const times = sunTimesFor(place.lat, place.lng, date, place.zone);
      expect(Math.abs(times.sunriseMinute! - sunrise), `${place.zone} ${date} sunrise`).toBeLessThan(3);
      expect(Math.abs(times.sunsetMinute! - sunset), `${place.zone} ${date} sunset`).toBeLessThan(3);
    }
  });

  test("solar noon in San Francisco is ≈ 13:11 PDT in June and ≈ 12:08 PST in December", () => {
    expect(sunTimesFor(SF.lat, SF.lng, "2026-06-21", SF.zone).solarNoonMinute).toBeCloseTo(
      hhmm(13, 11.6),
      -0.5,
    );
    expect(sunTimesFor(SF.lat, SF.lng, "2026-12-21", SF.zone).solarNoonMinute).toBeCloseTo(
      hhmm(12, 8),
      -0.5,
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
    // Reykjavik (UTC all year), 21 June: the sun sets a few minutes past
    // midnight and rises again before 03:00. The sunset that happens ON the
    // 21st is therefore the early-morning one, before that day's sunrise.
    const times = sunTimesFor(REYKJAVIK.lat, REYKJAVIK.lng, "2026-06-21", REYKJAVIK.zone);
    expect(times.sunsetMinute!).toBeGreaterThan(0);
    expect(times.sunsetMinute!).toBeLessThan(15);
    expect(times.sunriseMinute!).toBeGreaterThan(hhmm(2, 45));
    expect(times.sunriseMinute!).toBeLessThan(hhmm(3, 5));
    const atSunset = sunPositionAt(
      REYKJAVIK.lat,
      REYKJAVIK.lng,
      zonedToUtc("2026-06-21", times.sunsetMinute!, REYKJAVIK.zone)!,
    );
    expect(atSunset.altitudeDeg).toBeCloseTo(-0.833, 0);
    // It is on the north-western horizon, i.e. really a sunset, not a sunrise.
    expect(atSunset.azimuthDeg).toBeGreaterThan(270);
  });

  test("events are real: the sun is on the horizon at sunrise/sunset and highest at solar noon", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -58, max: 58, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        fc.integer({ min: 2020, max: 2030 }),
        fc.integer({ min: 0, max: 364 }),
        (lat, lng, year, day) => {
          const zone = timeZoneAt(lat, lng);
          const date = dateFromDayIndex(year, day);
          const times = sunTimesFor(lat, lng, date, zone);
          const altitudeAt = (minute: number) => {
            const instant = zonedToUtc(date, Math.min(Math.max(minute, 0), 1439.999), zone);
            return instant === null ? null : sunPositionAt(lat, lng, instant).altitudeDeg;
          };

          for (const minute of [times.sunriseMinute, times.sunsetMinute, times.solarNoonMinute]) {
            if (minute !== null) {
              expect(minute).toBeGreaterThanOrEqual(0);
              expect(minute).toBeLessThan(1440);
            }
          }
          // Below 58° latitude there is always a sunrise and a sunset; they can
          // only be missing here by landing on a neighbouring calendar date.
          // suncalc's rise/set times and its positions are separate
          // approximations that disagree by up to ~1.5 minutes, i.e. up to
          // ≈ 0.4° of altitude where the sun rises steeply.
          if (times.sunriseMinute !== null) {
            const altitude = altitudeAt(times.sunriseMinute);
            if (altitude !== null) expect(Math.abs(altitude + 0.833)).toBeLessThan(0.5);
          }
          if (times.sunsetMinute !== null) {
            const altitude = altitudeAt(times.sunsetMinute);
            if (altitude !== null) expect(Math.abs(altitude + 0.833)).toBeLessThan(0.5);
          }
          if (times.solarNoonMinute !== null) {
            const peak = altitudeAt(times.solarNoonMinute);
            const earlier = altitudeAt(times.solarNoonMinute - 20);
            const later = altitudeAt(times.solarNoonMinute + 20);
            if (peak !== null && earlier !== null && later !== null) {
              expect(peak).toBeGreaterThan(earlier - 0.02);
              expect(peak).toBeGreaterThan(later - 0.02);
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
