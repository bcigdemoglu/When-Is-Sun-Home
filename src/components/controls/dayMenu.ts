/** The shortcuts of the day menu: the days people actually want to compare. */
import { dateFromDayIndex } from "@/lib/solar/timezone";
import type { SunYearGrid } from "@/lib/types";

/** One day's daylight, as coarse as the year grid measures it. */
export interface CoarseDay {
  /** "YYYY-MM-DD". */
  date: string;
  daylightMinutes: number;
}

/**
 * Minutes of daylight (sun above the horizon) for every day of a sun grid.
 * Depends only on the place and the year — not on buildings or the viewpoint —
 * so it does not change while a viewpoint slider is dragged.
 */
export function daylightFromGrid(
  grid: Pick<SunYearGrid, "year" | "dayCount" | "slotsPerDay" | "stepMinutes" | "altitudeDeg">,
): CoarseDay[] {
  const days: CoarseDay[] = new Array(grid.dayCount);
  for (let day = 0; day < grid.dayCount; day++) {
    const row = day * grid.slotsPerDay;
    let slots = 0;
    for (let slot = 0; slot < grid.slotsPerDay; slot++) {
      if (grid.altitudeDeg[row + slot] > 0) slots++;
    }
    days[day] = {
      date: dateFromDayIndex(grid.year, day),
      daylightMinutes: slots * grid.stepMinutes,
    };
  }
  return days;
}

export interface KeyDates {
  /** The day with the most / least daylight in the year, "YYYY-MM-DD". */
  longest: string;
  shortest: string;
  marchEquinox: string;
  septemberEquinox: string;
}

/** How far off the coarse per-day daylight figures can be, minutes (two 5-minute grid steps). */
const COARSE_SLACK_MINUTES = 10;

/** Exact length of a day (sunrise to sunset), minutes, or null when the sun does not rise and set. */
export type DayLength = (date: string) => number | null;

/**
 * Solstices are read off the year's own daylight figures, so they are right
 * for either hemisphere (and for the place's calendar); the equinoxes are the
 * usual calendar dates, which is as exact as "equal day and night" gets.
 *
 * The year's figures come from a coarse grid, so around a solstice two or
 * three weeks of days tie. `exactDayLength` (sunrise to sunset, to the
 * second) picks the true extreme among them; without it the middle of the
 * run has to do.
 */
export function keyDates(
  year: { year: number; days: readonly CoarseDay[] },
  exactDayLength?: DayLength,
): KeyDates {
  const y = String(year.year).padStart(4, "0");
  const extremeDay = (sign: 1 | -1): string | null => {
    let extreme = -Infinity;
    for (const day of year.days) extreme = Math.max(extreme, sign * day.daylightMinutes);
    const tied = year.days.filter((day) => sign * day.daylightMinutes === extreme);
    if (tied.length === 0) return null;
    let best = tied[Math.floor((tied.length - 1) / 2)].date;
    if (exactDayLength) {
      // One grid step of slack: the true extreme can sit just outside the tied run.
      const near = year.days.filter(
        (day) => sign * day.daylightMinutes >= extreme - COARSE_SLACK_MINUTES,
      );
      let bestLength = -Infinity;
      for (const day of near) {
        const length = exactDayLength(day.date);
        if (length !== null && sign * length > bestLength) {
          bestLength = sign * length;
          best = day.date;
        }
      }
    }
    return best;
  };
  return {
    longest: extremeDay(1) ?? `${y}-06-21`,
    shortest: extremeDay(-1) ?? `${y}-12-21`,
    marchEquinox: `${y}-03-20`,
    septemberEquinox: `${y}-09-22`,
  };
}

/** Where along a slider (0..1) a minute of the day sits. */
export function minuteRatio(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.min(1, Math.max(0, minute / 1439));
}

/**
 * CSS `left` for something that should sit over the centre of the thumb when
 * the slider is at `ratio`: the thumb's centre travels from half a thumb in
 * to half a thumb short of the end.
 */
export function thumbLeft(ratio: number, thumbPx: number): string {
  const r = Math.min(1, Math.max(0, ratio));
  return `calc(${thumbPx / 2}px + (100% - ${thumbPx}px) * ${r.toFixed(4)})`;
}
