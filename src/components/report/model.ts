/**
 * Everything the report derives from a `YearAnalysis` once, up front — so
 * that nothing here is recomputed while the user scrubs the time of day.
 */
import type { MonthSummary, YearAnalysis } from "@/lib/types";

import {
  daylightTimeRange,
  findClockShifts,
  monthSpans,
  type ClockShift,
  type MonthSpan,
  type TimeRange,
} from "./heatmap";
import {
  bestAndWorstMonths,
  monthDetails,
  summarizeSeasons,
  type MonthDetail,
  type SeasonSummary,
} from "./summary";

export interface ReportModel {
  /** Part of the day the heat map (and the season strips) show. */
  range: TimeRange;
  months: MonthSpan[];
  details: MonthDetail[];
  seasons: SeasonSummary[];
  best: MonthSummary | null;
  worst: MonthSummary | null;
  /** Days on which the clocks change (DST). */
  clockShifts: ClockShift[];
}

export function buildReportModel(year: YearAnalysis, lat: number): ReportModel {
  const details = monthDetails(year);
  return {
    range: daylightTimeRange(year),
    months: monthSpans(year.year),
    details,
    seasons: summarizeSeasons(year, lat, details),
    ...bestAndWorstMonths(year.months),
    clockShifts: findClockShifts(year.year, year.timeZone, year.dayCount),
  };
}
