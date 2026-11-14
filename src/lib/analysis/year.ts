/**
 * Whole-year analysis: classify every cell of a sun grid for one observer and
 * roll the result up into day / month / year summaries.
 *
 * This re-runs on every observer tweak, so it is a single pass over typed
 * arrays with no allocation per cell.
 */
import { angularDistanceDeg, normalizeDeg } from "@/lib/geo/local";
import { dateFromDayIndex, isLeapYear } from "@/lib/solar/timezone";
import {
  SunState,
  type AnnualSummary,
  type DaySummary,
  type HorizonProfile,
  type MonthSummary,
  type Observer,
  type SunYearGrid,
  type YearAnalysis,
} from "@/lib/types";

/**
 * Classify every grid cell (exactly as `classifySun` would) and summarise.
 *
 * Each cell stands for `grid.stepMinutes` minutes around its sample, so all
 * minute counts are multiples of the step. `firstSunMinute` is the START of
 * the first sunny slot of a day and `lastSunMinute` the END of the last one.
 * Wall-clock slots lost to DST (NaN in the grid) count as Night.
 *
 * `horizon` must have been computed for `observer.heightM`; `null` means there
 * is no building data and nothing is ever Blocked.
 */
export function analyzeYear(
  grid: SunYearGrid,
  horizon: HorizonProfile | null,
  observer: Observer,
): YearAnalysis {
  const { year, timeZone, stepMinutes, dayCount, slotsPerDay, azimuthDeg, altitudeDeg } = grid;
  const cellCount = dayCount * slotsPerDay;
  if (azimuthDeg.length !== cellCount || altitudeDeg.length !== cellCount) {
    throw new RangeError("Sun grid arrays do not match dayCount × slotsPerDay");
  }

  const state = new Uint8Array(cellCount); // zero-filled = Night
  const days: DaySummary[] = new Array(dayCount);

  const coneLimited = observer.mode === "window" && observer.fovDeg < 360;
  const facingDeg = observer.facingDeg;
  const halfFovDeg = observer.fovDeg / 2;

  const skyline = horizon === null ? null : horizon.elevationDeg;
  const binCount = horizon === null ? 0 : horizon.binCount;
  const lastBin = binCount - 1;

  for (let day = 0; day < dayCount; day++) {
    const row = day * slotsPerDay;
    let sunSlots = 0;
    let blockedSlots = 0;
    let outOfViewSlots = 0;
    let firstSunSlot = -1;
    let lastSunSlot = -1;

    for (let slot = 0; slot < slotsPerDay; slot++) {
      const index = row + slot;
      const altitude = altitudeDeg[index];
      if (!(altitude > 0)) continue; // Night (also NaN)

      let azimuth = azimuthDeg[index];
      if (!(azimuth >= 0 && azimuth < 360)) azimuth = normalizeDeg(azimuth);

      if (coneLimited && angularDistanceDeg(azimuth, facingDeg) > halfFovDeg) {
        state[index] = SunState.OutOfView;
        outOfViewSlots++;
        continue;
      }

      if (skyline !== null) {
        let bin = Math.floor((azimuth * binCount) / 360);
        if (bin > lastBin) bin = lastBin;
        if (altitude < skyline[bin]) {
          state[index] = SunState.Blocked;
          blockedSlots++;
          continue;
        }
      }

      state[index] = SunState.Sun;
      sunSlots++;
      if (firstSunSlot < 0) firstSunSlot = slot;
      lastSunSlot = slot;
    }

    days[day] = {
      dayIndex: day,
      date: dateFromDayIndex(year, day),
      sunMinutes: sunSlots * stepMinutes,
      daylightMinutes: (sunSlots + blockedSlots + outOfViewSlots) * stepMinutes,
      blockedMinutes: blockedSlots * stepMinutes,
      outOfViewMinutes: outOfViewSlots * stepMinutes,
      firstSunMinute: firstSunSlot < 0 ? null : firstSunSlot * stepMinutes,
      lastSunMinute: lastSunSlot < 0 ? null : (lastSunSlot + 1) * stepMinutes,
    };
  }

  return {
    year,
    timeZone,
    stepMinutes,
    dayCount,
    slotsPerDay,
    state,
    days,
    months: summarizeMonths(year, days),
    annual: summarizeYear(days),
  };
}

function summarizeMonths(year: number, days: DaySummary[]): MonthSummary[] {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const months: MonthSummary[] = [];
  let start = 0;
  for (let month = 0; month < 12; month++) {
    const end = Math.min(start + lengths[month], days.length);
    const dayCount = Math.max(0, end - start);
    let sunMinutes = 0;
    let daylightMinutes = 0;
    let minSun = Infinity;
    let maxSun = -Infinity;
    for (let d = start; d < end; d++) {
      const day = days[d];
      sunMinutes += day.sunMinutes;
      daylightMinutes += day.daylightMinutes;
      if (day.sunMinutes < minSun) minSun = day.sunMinutes;
      if (day.sunMinutes > maxSun) maxSun = day.sunMinutes;
    }
    months.push({
      month,
      dayCount,
      avgSunHours: dayCount > 0 ? sunMinutes / dayCount / 60 : 0,
      avgDaylightHours: dayCount > 0 ? daylightMinutes / dayCount / 60 : 0,
      minSunHours: dayCount > 0 ? minSun / 60 : 0,
      maxSunHours: dayCount > 0 ? maxSun / 60 : 0,
      totalSunHours: sunMinutes / 60,
    });
    start = end;
  }
  return months;
}

function summarizeYear(days: DaySummary[]): AnnualSummary {
  let sunMinutes = 0;
  let daylightMinutes = 0;
  let bestDayIndex = 0;
  let worstDayIndex = 0;
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    sunMinutes += day.sunMinutes;
    daylightMinutes += day.daylightMinutes;
    // Strict comparisons: the earliest day wins a tie.
    if (day.sunMinutes > days[bestDayIndex].sunMinutes) bestDayIndex = d;
    if (day.sunMinutes < days[worstDayIndex].sunMinutes) worstDayIndex = d;
  }
  return {
    totalSunHours: sunMinutes / 60,
    totalDaylightHours: daylightMinutes / 60,
    avgSunHoursPerDay: days.length > 0 ? sunMinutes / days.length / 60 : 0,
    sunFraction: daylightMinutes > 0 ? sunMinutes / daylightMinutes : 0,
    bestDayIndex,
    worstDayIndex,
  };
}
