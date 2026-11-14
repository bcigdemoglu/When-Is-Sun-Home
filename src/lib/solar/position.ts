/**
 * Sun position and rise/set times, as thin wrappers over `suncalc` that speak
 * the app's conventions (compass degrees, wall-clock minutes in the place's
 * time zone).
 */
import SunCalc from "suncalc";

import { normalizeDeg } from "@/lib/geo/local";
import type { SunPosition } from "@/lib/types";

import { addDays, localMidnightMs, utcOffsetMinutes, utcToZoned, zonedToUtcMs } from "./timezone";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Where the sun is at `instant`, seen from (lat, lng).
 *
 * The altitude is suncalc's GEOMETRIC altitude of the sun's centre: no
 * atmospheric refraction and no allowance for the solar disc.
 */
export function sunPositionAt(lat: number, lng: number, instant: Date): SunPosition {
  const { azimuth, altitude } = SunCalc.getPosition(instant, lat, lng);
  return {
    // suncalc measures azimuth from SOUTH, positive towards the west.
    azimuthDeg: normalizeDeg(azimuth * RAD_TO_DEG + 180),
    altitudeDeg: altitude * RAD_TO_DEG,
  };
}

export interface SunTimes {
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  solarNoonMinute: number | null;
}

type SunEvent = "sunrise" | "sunset" | "solarNoon";

/**
 * Wall-clock minutes (fractional) of the sunrise, sunset and solar noon that
 * happen ON the local calendar `date` in `timeZone`; `null` for an event that
 * does not occur on that date (polar day / polar night, or the event falls
 * just across local midnight).
 *
 * Sunrise and sunset follow the usual almanac convention (suncalc: centre of
 * the sun 0.833° below the horizon, i.e. the upper limb touching a refracted
 * horizon), so they sit a few minutes outside the span where
 * {@link sunPositionAt} reports a positive geometric altitude.
 *
 * At high latitudes a "solar day" can straddle local midnight (a sunset at
 * 00:10). Such an event is reported on the calendar date it actually falls on,
 * so `sunsetMinute < sunriseMinute` is possible and means the date starts in
 * daylight. If two events of one kind fall on the same date, the one belonging
 * to that date's own solar day wins.
 */
export function sunTimesFor(lat: number, lng: number, date: string, timeZone: string): SunTimes {
  const cache = new Map<number, SunCalc.GetTimesResult>();

  // suncalc picks the solar day whose transit is nearest to the Date it is
  // given, so anchor it at local noon of the calendar date.
  const timesForOffset = (dayOffset: number): SunCalc.GetTimesResult => {
    let times = cache.get(dayOffset);
    if (!times) {
      const anchorDate = dayOffset === 0 ? date : addDays(date, dayOffset);
      let anchorMs = zonedToUtcMs(anchorDate, 720, timeZone);
      if (Number.isNaN(anchorMs)) {
        // Local noon does not exist (a zone skipping the whole day): approximate.
        const localNoonMs = localMidnightMs(anchorDate) + 720 * 60_000;
        anchorMs = localNoonMs - utcOffsetMinutes(timeZone, localNoonMs) * 60_000;
      }
      times = SunCalc.getTimes(new Date(anchorMs), lat, lng);
      cache.set(dayOffset, times);
    }
    return times;
  };

  const pick = (event: SunEvent): number | null => {
    // The date's own solar day first, then the neighbours whose events can
    // spill across local midnight onto this date.
    for (const dayOffset of [0, -1, 1]) {
      const instant = timesForOffset(dayOffset)[event];
      if (Number.isNaN(instant.getTime())) continue; // polar day / night
      const zoned = utcToZoned(instant, timeZone);
      if (zoned.date === date) return zoned.minuteOfDay;
    }
    return null;
  };

  return {
    sunriseMinute: pick("sunrise"),
    sunsetMinute: pick("sunset"),
    solarNoonMinute: pick("solarNoon"),
  };
}
