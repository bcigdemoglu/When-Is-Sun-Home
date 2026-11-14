/**
 * Test-only builders: small synthetic sun grids and skylines with known
 * answers, so report tests do not depend on real astronomy.
 */
import { analyzeYear, dateFromDayIndex } from "@/lib/analysis";
import {
  HORIZON_BINS,
  type DayAnalysis,
  type DaySample,
  type HorizonProfile,
  type Observer,
  type SunStateCode,
  type SunYearGrid,
  type YearAnalysis,
} from "@/lib/types";

export const YARD: Observer = { mode: "yard", heightM: 1.5, facingDeg: 180, fovDeg: 360 };

export interface SyntheticSun {
  year?: number;
  stepMinutes?: number;
  timeZone?: string;
  lat?: number;
  /** Sunrise / sunset as wall-clock minutes for a day index. */
  riseMinute?: (dayIndex: number) => number;
  setMinute?: (dayIndex: number) => number;
  /** Highest altitude of the day, degrees. */
  peakDeg?: (dayIndex: number) => number;
}

/**
 * A toy sun: up between `riseMinute` and `setMinute`, climbing to `peakDeg`
 * at the middle of that span while its azimuth sweeps from due east (90°) to
 * due west (270°). Below the horizon the altitude is -10°.
 */
export function syntheticGrid(options: SyntheticSun = {}): SunYearGrid {
  const {
    year = 2026,
    stepMinutes = 30,
    timeZone = "Etc/UTC",
    lat = 40,
    riseMinute = () => 6 * 60,
    setMinute = () => 18 * 60,
    peakDeg = () => 50,
  } = options;
  const dayCount = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const slotsPerDay = 1440 / stepMinutes;
  const azimuthDeg = new Float32Array(dayCount * slotsPerDay);
  const altitudeDeg = new Float32Array(dayCount * slotsPerDay);
  for (let day = 0; day < dayCount; day++) {
    const rise = riseMinute(day);
    const set = setMinute(day);
    for (let slot = 0; slot < slotsPerDay; slot++) {
      const minute = (slot + 0.5) * stepMinutes;
      const t = set > rise ? (minute - rise) / (set - rise) : -1;
      const index = day * slotsPerDay + slot;
      if (t > 0 && t < 1) {
        altitudeDeg[index] = Math.max(0.5, peakDeg(day) * 4 * t * (1 - t));
        azimuthDeg[index] = 90 + 180 * t;
      } else {
        altitudeDeg[index] = -10;
        azimuthDeg[index] = t <= 0 ? 80 : 280;
      }
    }
  }
  return { lat, lng: 0, year, timeZone, stepMinutes, dayCount, slotsPerDay, azimuthDeg, altitudeDeg };
}

/** A skyline from a function of the bin's centre azimuth; 0 = open sky. */
export function syntheticHorizon(
  elevationAt: (azimuthDeg: number) => number,
  blockerAt: (azimuthDeg: number) => number = () => 0,
  distanceM = 40,
): HorizonProfile {
  const elevationDeg = new Float32Array(HORIZON_BINS);
  const blockerIndex = new Int32Array(HORIZON_BINS).fill(-1);
  const blockerDistanceM = new Float32Array(HORIZON_BINS);
  for (let bin = 0; bin < HORIZON_BINS; bin++) {
    const azimuth = ((bin + 0.5) * 360) / HORIZON_BINS;
    const elevation = elevationAt(azimuth);
    if (elevation > 0) {
      elevationDeg[bin] = elevation;
      blockerIndex[bin] = blockerAt(azimuth);
      blockerDistanceM[bin] = distanceM;
    }
  }
  return {
    binCount: HORIZON_BINS,
    elevationDeg,
    blockerIndex,
    blockerDistanceM,
    containingBuildingIndex: -1,
  };
}

/** A year analysis of the toy sun (the real `analyzeYear` does the classifying). */
export function syntheticYear(
  options: SyntheticSun = {},
  horizon: HorizonProfile | null = null,
  observer: Observer = YARD,
): { grid: SunYearGrid; year: YearAnalysis } {
  const grid = syntheticGrid(options);
  return { grid, year: analyzeYear(grid, horizon, observer) };
}

/** A hand-written day analysis from `[startMinute, endMinute, state]` runs. */
export function syntheticDay(
  date: string,
  runs: readonly (readonly [number, number, SunStateCode])[],
  stepMinutes = 1,
): DayAnalysis {
  const samples: DaySample[] = [];
  const windows: { startMinute: number; endMinute: number }[] = [];
  let sunMinutes = 0;
  let daylightMinutes = 0;
  for (let minute = 0; minute < 1440; minute += stepMinutes) {
    const run = runs.find(([start, end]) => minute >= start && minute < end);
    const state: SunStateCode = run ? run[2] : 0;
    samples.push({ minute, azimuthDeg: 90 + minute / 8, altitudeDeg: state === 0 ? -5 : 30, state });
    if (state !== 0) daylightMinutes += stepMinutes;
    if (state === 1) {
      sunMinutes += stepMinutes;
      const last = windows[windows.length - 1];
      if (last && last.endMinute === minute) last.endMinute = minute + stepMinutes;
      else windows.push({ startMinute: minute, endMinute: minute + stepMinutes });
    }
  }
  const lit = runs.filter(([, , state]) => state !== 0);
  return {
    date,
    timeZone: "Etc/UTC",
    stepMinutes,
    samples,
    windows,
    sunMinutes,
    daylightMinutes,
    sunriseMinute: lit.length ? Math.min(...lit.map(([start]) => start)) : null,
    sunsetMinute: lit.length ? Math.max(...lit.map(([, end]) => end)) : null,
    solarNoonMinute: lit.length ? 720 : null,
  };
}

export function dateOfDay(year: number, dayIndex: number): string {
  return dateFromDayIndex(year, dayIndex);
}
