/**
 * Single-day analysis at fine (default 1-minute) resolution, for the day view.
 */
import { sunPositionAt, sunTimesFor } from "@/lib/solar/position";
import {
  localMidnightMs,
  localMsToUtcMs,
  yearOfDate,
  zoneOffsetTable,
} from "@/lib/solar/timezone";
import {
  SunState,
  type DayAnalysis,
  type DaySample,
  type HorizonProfile,
  type LatLng,
  type Observer,
  type SunWindow,
} from "@/lib/types";

import { classifySun } from "./classify";

const MS_PER_MINUTE = 60_000;

/**
 * Collapse a sequence of per-step states into maximal stretches of direct sun,
 * as wall-clock `[startMinute, endMinute)` windows.
 *
 * `states[i]` is the state of the step starting at `minutes[i]` (default
 * `i * stepMinutes`) and lasting `stepMinutes`. Steps merge into one window
 * only when they are sunny AND contiguous on the clock, so a window never
 * spans missing steps (e.g. a DST gap) and the window lengths always add up to
 * `stepMinutes × (number of sunny steps)`.
 *
 * Also works on one day's row of `YearAnalysis.state`.
 */
export function windowsFromStates(
  states: ArrayLike<number>,
  stepMinutes: number,
  minutes?: ArrayLike<number>,
): SunWindow[] {
  const windows: SunWindow[] = [];
  let current: SunWindow | null = null;
  for (let i = 0; i < states.length; i++) {
    if (states[i] !== SunState.Sun) {
      current = null;
      continue;
    }
    const start = minutes ? minutes[i] : i * stepMinutes;
    if (current !== null && Math.abs(current.endMinute - start) < 1e-9) {
      current.endMinute = start + stepMinutes;
    } else {
      current = { startMinute: start, endMinute: start + stepMinutes };
      windows.push(current);
    }
  }
  return windows;
}

/**
 * Sun, skyline and view cone for one local calendar day.
 *
 * The wall-clock day is cut into steps of `stepMinutes` (which must divide
 * 1440). Step `i` starts at minute `i * stepMinutes` — that is its
 * `samples[i].minute` — and is classified by the sun's position at its
 * MIDPOINT, minute `(i + 0.5) * stepMinutes`: the same sampling rule as the
 * year grid, so a 5-minute day agrees with the corresponding year row.
 *
 * Steps whose midpoint does not exist on the clock (DST spring-forward) are
 * omitted; a wall-clock hour that happens twice (fall-back) is sampled at its
 * first occurrence. Every sample counts as `stepMinutes` minutes.
 */
export function analyzeDay(
  place: LatLng,
  date: string,
  timeZone: string,
  horizon: HorizonProfile | null,
  observer: Observer,
  stepMinutes = 1,
): DayAnalysis {
  const stepCount = 1440 / stepMinutes;
  if (!(stepMinutes > 0) || !Number.isInteger(stepCount)) {
    throw new RangeError(`stepMinutes must be positive and divide 1440, got ${stepMinutes}`);
  }

  const table = zoneOffsetTable(timeZone, yearOfDate(date));
  const midnightLocalMs = localMidnightMs(date);

  const samples: DaySample[] = [];
  const states: number[] = [];
  const minutes: number[] = [];
  let sunSteps = 0;
  let daylightSteps = 0;

  for (let i = 0; i < stepCount; i++) {
    const minute = i * stepMinutes;
    const sampleLocalMs = midnightLocalMs + (minute + stepMinutes / 2) * MS_PER_MINUTE;
    const utcMs = localMsToUtcMs(table, sampleLocalMs);
    if (Number.isNaN(utcMs)) continue;

    const { azimuthDeg, altitudeDeg } = sunPositionAt(place.lat, place.lng, new Date(utcMs));
    const state = classifySun(azimuthDeg, altitudeDeg, horizon, observer);
    samples.push({ minute, azimuthDeg, altitudeDeg, state });
    states.push(state);
    minutes.push(minute);
    if (state !== SunState.Night) daylightSteps++;
    if (state === SunState.Sun) sunSteps++;
  }

  const { sunriseMinute, sunsetMinute, solarNoonMinute } = sunTimesFor(
    place.lat,
    place.lng,
    date,
    timeZone,
  );

  return {
    date,
    timeZone,
    stepMinutes,
    samples,
    windows: windowsFromStates(states, stepMinutes, minutes),
    sunMinutes: sunSteps * stepMinutes,
    daylightMinutes: daylightSteps * stepMinutes,
    sunriseMinute,
    sunsetMinute,
    solarNoonMinute,
  };
}
