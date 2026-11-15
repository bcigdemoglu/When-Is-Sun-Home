/**
 * Where the sun is, and when it rises and sets.
 *
 * The astronomy is the "low accuracy" solar theory of Jean Meeus,
 * "Astronomical Algorithms" (2nd ed., ch. 12, 13, 22 and 25) — the same
 * formulas the NOAA Solar Calculator uses — written out here with no
 * dependency. Checked against JPL Horizons (DE441) it is good to about 0.01°
 * for 2000–2100; see `position.test.ts`.
 *
 * ONE daylight convention is used everywhere in the engine: the sun is "up"
 * when the GEOMETRIC altitude of the CENTRE of its disc is above the
 * mathematical horizon (altitude > 0°), seen from the observer's position on
 * the Earth's surface, with no atmospheric refraction. Sunrise and sunset are
 * the instants that altitude crosses 0°, so they coincide exactly with the
 * first and last daylight samples. (An almanac's sunrise is a few minutes
 * earlier: it waits only for the upper limb to appear on a refracted horizon,
 * i.e. the centre at −0.833°.)
 */
import type { SunPosition } from "@/lib/types";

import { addDays, localMidnightMs, utcOffsetMinutes, utcToZoned, zonedToUtcMs } from "./timezone";

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** Days from the Unix epoch to J2000.0 (2000-01-01 12:00). */
const UNIX_EPOCH_TO_J2000_DAYS = 10_957.5;
/**
 * Terrestrial Time minus UTC, in days. The orbit runs on TT, the Earth's
 * rotation on UT. 69.184 s is exact from 2017 until the next leap second and
 * within ~5 s for 2000–2030; the sun moves 0.00001° per second, so even a
 * minute of drift by 2100 is far below the model's own accuracy.
 */
const TT_MINUS_UTC_DAYS = 69.184 / 86_400;
/** Equatorial horizontal parallax of the sun at 1 au (8.794″), degrees. */
const SOLAR_PARALLAX_DEG = 8.794 / 3600;

/** Apparent geocentric position of the sun relative to the rotating Earth. */
export interface SunEphemeris {
  /** Sine and cosine of the apparent declination. */
  sinDec: number;
  cosDec: number;
  /**
   * Greenwich hour angle of the sun, degrees in (-180, 180]: how far WEST of
   * the Greenwich meridian the sun stands (0 at Greenwich apparent noon).
   */
  ghaDeg: number;
}

/** Wrap an angle in degrees into (-180, 180]. */
function wrap180(deg: number): number {
  const r = deg % 360;
  return r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
}

/**
 * The sun's apparent declination and Greenwich hour angle at a UTC instant
 * (epoch milliseconds). Everything about the sun that does not depend on
 * where the observer is.
 */
export function sunEphemerisAt(utcMs: number): SunEphemeris {
  // Days since J2000.0 on the UT scale (Earth rotation)…
  const d = utcMs / MS_PER_DAY - UNIX_EPOCH_TO_J2000_DAYS;
  // …and Julian centuries on the TT scale (orbital motion).
  const t = (d + TT_MINUS_UTC_DAYS) / 36_525;

  // Geometric mean longitude and mean anomaly of the sun (Meeus 25.2, 25.3).
  const meanLongitude = 280.46646 + t * (36_000.76983 + t * 0.0003032);
  const meanAnomaly = (357.52911 + t * (35_999.05029 - t * 0.0001537)) * RAD;
  // Equation of the centre.
  const centre =
    (1.914602 - t * (0.004817 + t * 0.000014)) * Math.sin(meanAnomaly) +
    (0.019993 - t * 0.000101) * Math.sin(2 * meanAnomaly) +
    0.000289 * Math.sin(3 * meanAnomaly);
  // Longitude of the Moon's ascending node, which drives the nutation.
  const omega = (125.04 - 1934.136 * t) * RAD;
  const nutationInLongitude = -0.00478 * Math.sin(omega);
  // Apparent longitude: true longitude, minus aberration, plus nutation.
  const longitude = (meanLongitude + centre - 0.00569 + nutationInLongitude) * RAD;

  // Obliquity of the ecliptic (Meeus 22.2), corrected for nutation.
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;
  const cosObliquity = Math.cos(obliquity);

  const sinLongitude = Math.sin(longitude);
  const sinDec = Math.sin(obliquity) * sinLongitude;
  const rightAscension = Math.atan2(cosObliquity * sinLongitude, Math.cos(longitude)) / RAD;

  // Greenwich APPARENT sidereal time (Meeus 12.4 plus the equation of the
  // equinoxes), so that it is consistent with the apparent right ascension.
  // 360.98564736629·d is split into whole turns and the rest to keep precision.
  const siderealTime =
    280.46061837 +
    360 * (d - Math.floor(d)) +
    0.98564736629 * d +
    t * t * (0.000387933 - t / 38_710_000) +
    nutationInLongitude * cosObliquity;

  return {
    sinDec,
    cosDec: Math.sqrt(1 - sinDec * sinDec),
    ghaDeg: wrap180(siderealTime - rightAscension),
  };
}

/**
 * Where the sun is at `instant`, seen from (lat, lng) at sea level.
 *
 * `altitudeDeg` is the geometric altitude of the centre of the disc above the
 * mathematical horizon: no refraction, but including the sun's (tiny, ≤ 0.0024°)
 * parallax, i.e. as actually seen from the surface rather than the Earth's centre.
 */
export function sunPositionAt(lat: number, lng: number, instant: Date): SunPosition {
  return sunPositionAtMs(lat, lng, instant.getTime());
}

/** {@link sunPositionAt} for an epoch-millisecond instant. */
export function sunPositionAtMs(lat: number, lng: number, utcMs: number): SunPosition {
  const { sinDec, cosDec, ghaDeg } = sunEphemerisAt(utcMs);
  const phi = lat * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  // Local hour angle: west of the observer's meridian.
  const hourAngle = (ghaDeg + lng) * RAD;
  const cosH = Math.cos(hourAngle);

  const sinAltitude = sinPhi * sinDec + cosPhi * cosDec * cosH;
  const geocentric = Math.asin(sinAltitude > 1 ? 1 : sinAltitude < -1 ? -1 : sinAltitude);
  // Components of the direction to the sun in the local east / north frame.
  const east = -cosDec * Math.sin(hourAngle);
  const north = sinDec * cosPhi - cosDec * cosH * sinPhi;
  const azimuth = Math.atan2(east, north) / RAD;

  return {
    azimuthDeg: azimuth < 0 ? azimuth + 360 : azimuth >= 360 ? azimuth - 360 : azimuth,
    altitudeDeg: geocentric / RAD - SOLAR_PARALLAX_DEG * Math.cos(geocentric),
  };
}

export interface SunTimes {
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  solarNoonMinute: number | null;
}

/** Epoch ms near `guessMs` at which the sun's local hour angle equals `targetDeg`. */
function solveHourAngle(lng: number, targetDeg: number, guessMs: number): number {
  let t = guessMs;
  // The hour angle advances 360° per (apparent solar) day to within 0.01%, so
  // each step shrinks the error by ~10⁴: three steps reach well under 1 ms.
  for (let i = 0; i < 4; i++) {
    const error = wrap180(sunEphemerisAt(t).ghaDeg + lng - targetDeg);
    t -= (error / 360) * MS_PER_DAY;
  }
  return t;
}

/**
 * The instant between `loMs` and `hiMs` at which the sun's altitude crosses
 * 0°, to better than a millisecond. The altitudes at the two ends must have
 * opposite signs (between a culmination and the next the altitude is monotonic).
 */
function solveHorizonCrossing(lat: number, lng: number, loMs: number, hiMs: number): number {
  let lo = loMs;
  let hi = hiMs;
  const risingFromLo = sunPositionAtMs(lat, lng, lo).altitudeDeg <= 0;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    const below = sunPositionAtMs(lat, lng, mid).altitudeDeg <= 0;
    if (below === risingFromLo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface SolarDay {
  /** Upper culmination (the sun crosses the meridian, highest point). */
  noonMs: number;
  /** Upward / downward crossings of the horizon around it; NaN if there is none. */
  sunriseMs: number;
  sunsetMs: number;
}

/** The solar day whose noon is nearest to `anchorMs`. */
function solarDayNear(lat: number, lng: number, anchorMs: number): SolarDay {
  const noonMs = solveHourAngle(lng, 0, anchorMs);
  const noonAltitude = sunPositionAtMs(lat, lng, noonMs).altitudeDeg;
  let sunriseMs = NaN;
  let sunsetMs = NaN;
  if (noonAltitude > 0) {
    // Lower culminations (the sun due "under" the pole) before and after.
    const previousMidnightMs = solveHourAngle(lng, 180, noonMs - MS_PER_DAY / 2);
    const nextMidnightMs = solveHourAngle(lng, 180, noonMs + MS_PER_DAY / 2);
    if (sunPositionAtMs(lat, lng, previousMidnightMs).altitudeDeg <= 0) {
      sunriseMs = solveHorizonCrossing(lat, lng, previousMidnightMs, noonMs);
    }
    if (sunPositionAtMs(lat, lng, nextMidnightMs).altitudeDeg <= 0) {
      sunsetMs = solveHorizonCrossing(lat, lng, noonMs, nextMidnightMs);
    }
  }
  return { noonMs, sunriseMs, sunsetMs };
}

type SunEvent = "sunriseMs" | "sunsetMs" | "noonMs";

/**
 * Wall-clock minutes (fractional) of the sunrise, sunset and solar noon that
 * happen ON the local calendar `date` in `timeZone`; `null` for an event that
 * does not occur on that date (polar day / polar night, or the event falls
 * just across local midnight).
 *
 * Sunrise and sunset are the instants the geometric altitude of the sun's
 * centre crosses 0° — exactly the boundary `sunPositionAt` and the sun grids
 * use between night and day (see the file comment). Solar noon is the upper
 * culmination: the sun due south or north, at its highest.
 *
 * At high latitudes a "solar day" can straddle local midnight (a sunset at
 * 00:10). Such an event is reported on the calendar date it actually falls on,
 * so `sunsetMinute < sunriseMinute` is possible and means the date starts in
 * daylight. If two events of one kind fall on the same date, the one belonging
 * to that date's own solar day wins.
 */
export function sunTimesFor(lat: number, lng: number, date: string, timeZone: string): SunTimes {
  const cache = new Map<number, SolarDay>();

  // Anchor each solar day at local noon of a calendar date.
  const solarDayFor = (dayOffset: number): SolarDay => {
    let day = cache.get(dayOffset);
    if (!day) {
      const anchorDate = dayOffset === 0 ? date : addDays(date, dayOffset);
      let anchorMs = zonedToUtcMs(anchorDate, 720, timeZone);
      if (Number.isNaN(anchorMs)) {
        // Local noon does not exist (a zone skipping the whole day): approximate.
        const localNoonMs = localMidnightMs(anchorDate) + 720 * MS_PER_MINUTE;
        anchorMs = localNoonMs - utcOffsetMinutes(timeZone, localNoonMs) * MS_PER_MINUTE;
      }
      day = solarDayNear(lat, lng, anchorMs);
      cache.set(dayOffset, day);
    }
    return day;
  };

  const pick = (event: SunEvent): number | null => {
    // The date's own solar day first, then the neighbours whose events can
    // spill across local midnight onto this date.
    for (const dayOffset of [0, -1, 1]) {
      const ms = solarDayFor(dayOffset)[event];
      if (Number.isNaN(ms)) continue; // polar day / night
      const zoned = utcToZoned(new Date(ms), timeZone);
      if (zoned.date === date) return zoned.minuteOfDay;
    }
    return null;
  };

  return {
    sunriseMinute: pick("sunriseMs"),
    sunsetMinute: pick("sunsetMs"),
    solarNoonMinute: pick("noonMs"),
  };
}
