/**
 * Sun positions for a whole year on a (day × wall-clock slot) grid.
 *
 * This is the only expensive astronomy in the app (~105k positions at 5-minute
 * steps), and it depends on nothing but the place and the year, so it is
 * computed once and re-used for every observer / building change.
 *
 * The position maths is suncalc's (https://github.com/mourner/suncalc, formulas
 * from https://aa.quae.nl/en/reken/zonpositie.html) written out inline so the
 * hot loop allocates nothing: no Date and no result object per sample. A test
 * proves it matches `SunCalc.getPosition` cell for cell.
 */
import type { LatLng, SunYearGrid, YearGridSpec } from "@/lib/types";

import { daysInYear, localMidnightMs, localMsToUtcMs, zoneOffsetTable } from "./timezone";

const RAD = Math.PI / 180;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Julian day of the Unix epoch, minus that of J2000.0, minus suncalc's half-day shift. */
const EPOCH_TO_J2000_DAYS = 2440588 - 2451545 - 0.5;
/** Obliquity of the ecliptic. */
const OBLIQUITY = RAD * 23.4397;
const SIN_OBLIQUITY = Math.sin(OBLIQUITY);
const COS_OBLIQUITY = Math.cos(OBLIQUITY);
/** Ecliptic longitude of the Earth's perihelion, plus 180°. */
const PERIHELION_PLUS_PI = RAD * 102.9372 + Math.PI;

function assertSpec(spec: YearGridSpec): void {
  const { year, stepMinutes } = spec;
  if (!Number.isInteger(year)) throw new RangeError(`year must be an integer, got ${year}`);
  const slots = 1440 / stepMinutes;
  if (!(stepMinutes > 0) || !Number.isInteger(slots)) {
    throw new RangeError(`stepMinutes must be positive and divide 1440, got ${stepMinutes}`);
  }
}

/**
 * Compute the sun's azimuth and geometric altitude for every slot of every day
 * of `spec.year`, on the wall clock of `spec.timeZone`.
 *
 * Slot `s` of a day is sampled at wall-clock minute `(s + 0.5) * stepMinutes`.
 * Wall-clock times skipped by a DST spring-forward hold NaN in both arrays;
 * times repeated by a fall-back are sampled at their first occurrence.
 */
export function computeSunYearGrid(place: LatLng, spec: YearGridSpec): SunYearGrid {
  assertSpec(spec);
  const { year, timeZone, stepMinutes } = spec;
  const dayCount = daysInYear(year);
  const slotsPerDay = 1440 / stepMinutes;
  const azimuthDeg = new Float32Array(dayCount * slotsPerDay);
  const altitudeDeg = new Float32Array(dayCount * slotsPerDay);

  const table = zoneOffsetTable(timeZone, year);
  const { startsMs, offsetsMin } = table;
  const lastSegment = offsetsMin.length - 1;

  const phi = RAD * place.lat;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const lw = RAD * -place.lng;

  const stepMs = stepMinutes * MS_PER_MINUTE;
  const yearStartLocalMs = localMidnightMs(`${String(year).padStart(4, "0")}-01-01`);

  for (let day = 0; day < dayCount; day++) {
    const dayStartLocalMs = yearStartLocalMs + day * MS_PER_DAY;
    const firstLocalMs = dayStartLocalMs + 0.5 * stepMs;
    const lastLocalMs = dayStartLocalMs + (slotsPerDay - 0.5) * stepMs;

    // Almost every day lies inside a single offset segment: find it once.
    // Days touched by a transition fall back to resolving each sample.
    //
    // The day is uniform when the FIRST segment that accepts its first sample
    // (the same "first occurrence" rule as localMsToUtcMs) also accepts its
    // last sample, and every earlier segment is already over on its own wall
    // clock — otherwise part of the day could belong to an earlier pass
    // through the same wall-clock times (e.g. Havana's 01:00 → 00:00 fall-back).
    let dayOffsetMs = NaN;
    for (let i = 0; i <= lastSegment; i++) {
      const offsetMs = offsetsMin[i] * MS_PER_MINUTE;
      const endMs = i === lastSegment ? Infinity : startsMs[i + 1];
      if (firstLocalMs - offsetMs >= startsMs[i] && firstLocalMs - offsetMs < endMs) {
        if (lastLocalMs - offsetMs < endMs) dayOffsetMs = offsetMs;
        break;
      }
      // Segment i does not hold the first sample. If its wall clock still
      // reaches into this day, the day is not uniform.
      if (endMs + offsetMs > firstLocalMs) break;
    }
    const uniform = !Number.isNaN(dayOffsetMs);

    const row = day * slotsPerDay;
    for (let slot = 0; slot < slotsPerDay; slot++) {
      const localMs = dayStartLocalMs + (slot + 0.5) * stepMs;
      const utcMs = uniform ? localMs - dayOffsetMs : localMsToUtcMs(table, localMs);
      const index = row + slot;
      if (Number.isNaN(utcMs)) {
        azimuthDeg[index] = NaN;
        altitudeDeg[index] = NaN;
        continue;
      }

      // Days since J2000.0.
      const d = utcMs / MS_PER_DAY + EPOCH_TO_J2000_DAYS;
      // Solar mean anomaly, equation of centre, ecliptic longitude.
      const m = RAD * (357.5291 + 0.98560028 * d);
      const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
      const l = m + c + PERIHELION_PLUS_PI;
      const sinL = Math.sin(l);
      // Equatorial coordinates (the sun's ecliptic latitude is taken as 0).
      const dec = Math.asin(SIN_OBLIQUITY * sinL);
      const ra = Math.atan2(sinL * COS_OBLIQUITY, Math.cos(l));
      // Local hour angle.
      const h = RAD * (280.16 + 360.9856235 * d) - lw - ra;
      const cosH = Math.cos(h);
      const azimuthFromSouth = Math.atan2(Math.sin(h), cosH * sinPhi - Math.tan(dec) * cosPhi);
      const altitude = Math.asin(sinPhi * Math.sin(dec) + cosPhi * Math.cos(dec) * cosH);

      // atan2 ∈ [-π, π] → compass [0, 360]; fold the top edge (and any value
      // that rounds up to 360 in float32) back to 0.
      const azimuth = Math.fround(azimuthFromSouth / RAD + 180);
      azimuthDeg[index] = azimuth >= 360 ? azimuth - 360 : azimuth;
      altitudeDeg[index] = altitude / RAD;
    }
  }

  return {
    lat: place.lat,
    lng: place.lng,
    year,
    timeZone,
    stepMinutes,
    dayCount,
    slotsPerDay,
    azimuthDeg,
    altitudeDeg,
  };
}
