/**
 * Sun positions for a whole year on a (day × wall-clock slot) grid.
 *
 * This is the only expensive astronomy in the app (~105k positions at 5-minute
 * steps), and it depends on nothing but the place and the year, so it is
 * computed once and re-used for every observer / building change.
 *
 * The sun's own motion is slow, so the orbital part of the calculation is
 * hoisted out of the hot loop: the declination and the "equation of time"
 * (see {@link sunEphemerisAt}) are evaluated once per UTC midnight and
 * interpolated linearly in between. Over one day their curvature is below
 * 0.001°, so every cell agrees with `sunPositionAt` to better than 0.002° —
 * a test checks all of them — while the loop itself is four trig calls.
 */
import type { LatLng, SunYearGrid, YearGridSpec } from "@/lib/types";

import { sunEphemerisAt } from "./position";
import { daysInYear, localMidnightMs, localMsToUtcMs, zoneOffsetTable } from "./timezone";

const RAD = Math.PI / 180;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** Equatorial horizontal parallax of the sun at 1 au (8.794″), degrees. */
const SOLAR_PARALLAX_DEG = 8.794 / 3600;
/** Ephemeris nodes kept before / after the calendar year (zones reach ±14 h). */
const NODE_MARGIN_DAYS = 2;

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

  const stepMs = stepMinutes * MS_PER_MINUTE;
  const yearStartLocalMs = localMidnightMs(`${String(year).padStart(4, "0")}-01-01`);

  // Ephemeris at every UTC midnight around the year. Between two nodes the
  // sun's hour angle at Greenwich is `180° + 360°·(fraction of the day) + e`,
  // where e (the equation of time, in degrees) drifts by at most 0.13° a day.
  const firstNodeMs = yearStartLocalMs - NODE_MARGIN_DAYS * MS_PER_DAY;
  const nodeCount = dayCount + 2 * NODE_MARGIN_DAYS + 1;
  const nodeSinDec = new Float64Array(nodeCount);
  const nodeCosDec = new Float64Array(nodeCount);
  const nodeEquationDeg = new Float64Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    const ephemeris = sunEphemerisAt(firstNodeMs + n * MS_PER_DAY);
    nodeSinDec[n] = ephemeris.sinDec;
    nodeCosDec[n] = ephemeris.cosDec;
    // At UTC midnight the hour angle is within a few degrees of ±180°.
    const e = ephemeris.ghaDeg - 180;
    nodeEquationDeg[n] = e <= -180 ? e + 360 : e;
  }

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

      // Interpolate the slow terms between the two surrounding UTC midnights.
      const sinceFirstNode = (utcMs - firstNodeMs) / MS_PER_DAY;
      const node = Math.floor(sinceFirstNode);
      const f = sinceFirstNode - node;
      // (sin δ, cos δ) interpolated along the chord is slightly shorter than a
      // unit vector; rescale it, or the error is magnified near the zenith.
      const chordSin = nodeSinDec[node] + f * (nodeSinDec[node + 1] - nodeSinDec[node]);
      const chordCos = nodeCosDec[node] + f * (nodeCosDec[node + 1] - nodeCosDec[node]);
      const norm = 1 / Math.sqrt(chordSin * chordSin + chordCos * chordCos);
      const sinDec = chordSin * norm;
      const cosDec = chordCos * norm;
      const equationDeg =
        nodeEquationDeg[node] + f * (nodeEquationDeg[node + 1] - nodeEquationDeg[node]);

      // Local hour angle, then the same horizontal coordinates as sunPositionAt.
      const hourAngle = RAD * (180 + 360 * f + equationDeg + place.lng);
      const cosH = Math.cos(hourAngle);
      const sinAltitude = sinPhi * sinDec + cosPhi * cosDec * cosH;
      const geocentric = Math.asin(sinAltitude > 1 ? 1 : sinAltitude < -1 ? -1 : sinAltitude);
      const east = -cosDec * Math.sin(hourAngle);
      const north = sinDec * cosPhi - cosDec * cosH * sinPhi;

      // atan2 ∈ [-180°, 180°] → compass [0, 360); a value that rounds up to
      // 360 in float32 is folded back to 0.
      const azimuthSigned = Math.atan2(east, north) / RAD;
      const azimuth = Math.fround(azimuthSigned < 0 ? azimuthSigned + 360 : azimuthSigned);
      azimuthDeg[index] = azimuth >= 360 ? azimuth - 360 : azimuth;
      // cos(altitude) = √(1 − sin²): the parallax term without another trig call.
      altitudeDeg[index] =
        geocentric / RAD -
        SOLAR_PARALLAX_DEG *
          Math.sqrt(sinAltitude >= 1 || sinAltitude <= -1 ? 0 : 1 - sinAltitude * sinAltitude);
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
