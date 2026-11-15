/**
 * Numbers the report derives from a `YearAnalysis`: seasons, typical sun
 * times, the split of daylight, month rankings. Pure functions.
 */
import {
  SunState,
  type DayAnalysis,
  type DaySummary,
  type MonthSummary,
  type YearAnalysis,
} from "@/lib/types";

import { MONTHS_LONG, MONTHS_SHORT } from "./format";
import { monthSpans } from "./heatmap";

// ─── Hemisphere & seasons ──────────────────────────────────────────────────

export type Hemisphere = "north" | "south";
export type SeasonName = "Winter" | "Spring" | "Summer" | "Autumn";

export function hemisphereOf(lat: number): Hemisphere {
  return lat < 0 ? "south" : "north";
}

/** The months that hold the equinoxes and solstices, in calendar order. */
export const SEASON_MONTHS = [2, 5, 8, 11] as const;

const NORTHERN_SEASONS: SeasonName[] = ["Winter", "Spring", "Summer", "Autumn"];

/** Season a calendar month (0 = January) falls in, for a hemisphere. */
export function seasonOfMonth(month: number, hemisphere: Hemisphere): SeasonName {
  // Dec–Feb, Mar–May, Jun–Aug, Sep–Nov.
  const quarter = Math.floor(((((month + 1) % 12) + 12) % 12) / 3);
  return NORTHERN_SEASONS[hemisphere === "north" ? quarter : (quarter + 2) % 4];
}

// ─── Small statistics ──────────────────────────────────────────────────────

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TypicalSunTimes {
  /** Median wall-clock minute of the first / last direct sun; null if never. */
  firstMinute: number | null;
  lastMinute: number | null;
  /** Days with any direct sun, out of `dayCount`. */
  sunDays: number;
  dayCount: number;
}

/** Median first and last direct sun over a run of days (days without sun are skipped). */
export function typicalSunTimes(days: readonly DaySummary[]): TypicalSunTimes {
  const firsts: number[] = [];
  const lasts: number[] = [];
  for (const day of days) {
    if (day.firstSunMinute !== null && day.lastSunMinute !== null) {
      firsts.push(day.firstSunMinute);
      lasts.push(day.lastSunMinute);
    }
  }
  return {
    firstMinute: median(firsts),
    lastMinute: median(lasts),
    sunDays: firsts.length,
    dayCount: days.length,
  };
}

/**
 * The most common state of every time slot over days `[startDay, endDay)` —
 * "what a typical day of this month looks like". Ties go to the lower code
 * order Sun, Blocked, OutOfView, Night so a 50/50 slot reads as sun.
 */
export function modalStates(
  year: Pick<YearAnalysis, "state" | "slotsPerDay">,
  startDay: number,
  endDay: number,
): Uint8Array {
  const { state, slotsPerDay } = year;
  const result = new Uint8Array(slotsPerDay);
  const counts = [0, 0, 0, 0];
  const order = [SunState.Sun, SunState.Blocked, SunState.OutOfView, SunState.Night];
  for (let slot = 0; slot < slotsPerDay; slot++) {
    counts[0] = counts[1] = counts[2] = counts[3] = 0;
    for (let day = startDay; day < endDay; day++) counts[state[day * slotsPerDay + slot]]++;
    let best: number = SunState.Night;
    let bestCount = -1;
    for (const code of order) {
      if (counts[code] > bestCount) {
        best = code;
        bestCount = counts[code];
      }
    }
    result[slot] = best;
  }
  return result;
}

/** A run of equal state on the clock, `[startMinute, endMinute)`. */
export interface StateRun {
  startMinute: number;
  endMinute: number;
  state: number;
}

/**
 * Collapse per-step states into runs. `minutes[i]` is the start of step `i`
 * (default `i * stepMinutes`); steps that are not contiguous on the clock
 * (a DST gap) never merge.
 */
export function stateRuns(
  states: ArrayLike<number>,
  stepMinutes: number,
  minutes?: ArrayLike<number>,
): StateRun[] {
  const runs: StateRun[] = [];
  let current: StateRun | null = null;
  for (let i = 0; i < states.length; i++) {
    const start = minutes ? minutes[i] : i * stepMinutes;
    if (current && current.state === states[i] && Math.abs(current.endMinute - start) < 1e-9) {
      current.endMinute = start + stepMinutes;
    } else {
      current = { startMinute: start, endMinute: start + stepMinutes, state: states[i] };
      runs.push(current);
    }
  }
  return runs;
}

// ─── Season & month summaries ──────────────────────────────────────────────

export interface MonthDetail extends TypicalSunTimes {
  month: number;
  label: string;
  longLabel: string;
  avgSunHours: number;
  avgDaylightHours: number;
  /** avgSunHours / avgDaylightHours, 0 when the month has no daylight. */
  sunFraction: number;
  totalSunHours: number;
}

/** One row per calendar month, with the typical first / last sun added. */
export function monthDetails(year: YearAnalysis): MonthDetail[] {
  return monthSpans(year.year).map((span) => {
    const summary: MonthSummary | undefined = year.months[span.month];
    const days = year.days.slice(span.startDay, span.startDay + span.dayCount);
    const avgSunHours = summary?.avgSunHours ?? 0;
    const avgDaylightHours = summary?.avgDaylightHours ?? 0;
    return {
      month: span.month,
      label: MONTHS_SHORT[span.month],
      longLabel: MONTHS_LONG[span.month],
      avgSunHours,
      avgDaylightHours,
      sunFraction: avgDaylightHours > 0 ? avgSunHours / avgDaylightHours : 0,
      totalSunHours: summary?.totalSunHours ?? 0,
      ...typicalSunTimes(days),
    };
  });
}

export interface SeasonSummary extends MonthDetail {
  season: SeasonName;
  /** Typical-day strip: runs of the most common state per time slot. */
  typicalRuns: StateRun[];
}

/** The four season-defining months (Mar, Jun, Sep, Dec) for a latitude. */
export function summarizeSeasons(
  year: YearAnalysis,
  lat: number,
  details: MonthDetail[] = monthDetails(year),
): SeasonSummary[] {
  const hemisphere = hemisphereOf(lat);
  const spans = monthSpans(year.year);
  return SEASON_MONTHS.map((month) => {
    const span = spans[month];
    const endDay = Math.min(year.dayCount, span.startDay + span.dayCount);
    const typical = modalStates(year, span.startDay, endDay);
    return {
      ...details[month],
      season: seasonOfMonth(month, hemisphere),
      typicalRuns: stateRuns(typical, year.stepMinutes),
    };
  });
}

/** Months with the highest / lowest average direct sun (earliest wins a tie). */
export function bestAndWorstMonths(months: readonly MonthSummary[]): {
  best: MonthSummary | null;
  worst: MonthSummary | null;
} {
  let best: MonthSummary | null = null;
  let worst: MonthSummary | null = null;
  for (const month of months) {
    if (!best || month.avgSunHours > best.avgSunHours) best = month;
    if (!worst || month.avgSunHours < worst.avgSunHours) worst = month;
  }
  return { best, worst };
}

export interface DaylightSplit {
  sunHours: number;
  blockedHours: number;
  outOfViewHours: number;
  daylightHours: number;
}

/** Where the year's daylight went: direct sun, behind buildings, outside the view. */
export function daylightSplit(days: readonly DaySummary[]): DaylightSplit {
  let sun = 0;
  let blocked = 0;
  let out = 0;
  let daylight = 0;
  for (const day of days) {
    sun += day.sunMinutes;
    blocked += day.blockedMinutes;
    out += day.outOfViewMinutes;
    daylight += day.daylightMinutes;
  }
  return {
    sunHours: sun / 60,
    blockedHours: blocked / 60,
    outOfViewHours: out / 60,
    daylightHours: daylight / 60,
  };
}

// ─── One day's totals, the same on every card ──────────────────────────────

export interface DayTotals {
  sunMinutes: number;
  daylightMinutes: number;
  /** True when the figures come from the 1-minute analysis of the selected day. */
  precise: boolean;
}

/**
 * Direct sun and daylight of the day at `dayIndex` of the year — THE way every
 * card gets a day's total, so that one screen never shows two numbers for the
 * same day. (`dayIndex` null means "the selected date itself".)
 *
 * The year grid counts in 5-minute steps and the selected day's own analysis
 * in 1-minute steps, so the two can differ by a few minutes. The rule:
 *  - the SELECTED day (`date`) reads from its 1-minute analysis whenever that
 *    is available for this very date (`day.date === date`);
 *  - every other day — a hover or scrub preview — reads from the grid;
 *  - while `day` is stale (still for another date), the selected day reads
 *    from the grid as well: never another day's number. All cards then switch
 *    to the precise figure together when the analysis arrives.
 * Returns null when neither source has the day.
 */
export function dayTotals(
  year: Pick<YearAnalysis, "days"> | null,
  day: DayAnalysis | null,
  date: string,
  dayIndex: number | null,
): DayTotals | null {
  const gridDay = year && dayIndex !== null ? year.days[dayIndex] : undefined;
  const isSelectedDay = dayIndex === null ? true : gridDay?.date === date;
  if (day && day.date === date && isSelectedDay) {
    return { sunMinutes: day.sunMinutes, daylightMinutes: day.daylightMinutes, precise: true };
  }
  if (gridDay) {
    return {
      sunMinutes: gridDay.sunMinutes,
      daylightMinutes: gridDay.daylightMinutes,
      precise: false,
    };
  }
  return null;
}
