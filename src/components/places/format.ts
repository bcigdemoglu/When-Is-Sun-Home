/**
 * Wording and small calculations shared by the saved-places list, the
 * compare view and the search rows. Pure.
 */
import { MONTHS_SHORT, formatHours, formatHoursUnit } from "@/components/shared/format";
import type { PlaceSummary } from "@/lib/types";

// Months, hours, percentages and the viewpoint wording are the app-wide ones.
export {
  MONTHS_LONG,
  MONTHS_SHORT,
  MONTH_INITIALS,
  formatHours,
  formatHoursUnit,
  formatPercent as formatShare,
} from "@/components/shared/format";
export { viewpointLabel } from "@/components/shared/viewpoint";

function monthAt(summary: PlaceSummary, month: number): { name: string; hours: number } {
  const index = Number.isInteger(month) && month >= 0 && month < 12 ? month : 0;
  return { name: MONTHS_SHORT[index], hours: summary.monthlySunHours[index] ?? 0 };
}

/** "Best Jun 9.8 · Least Dec 1.2" */
export function bestLeastLine(summary: PlaceSummary): string {
  const best = monthAt(summary, summary.bestMonth);
  const least = monthAt(summary, summary.worstMonth);
  return `Best ${best.name} ${formatHours(best.hours)} · Least ${least.name} ${formatHours(least.hours)}`;
}

/** "Jun · 9.8 h" for the month with the most (or least) direct sun. */
export function monthValue(summary: PlaceSummary, which: "best" | "least"): string {
  const { name, hours } = monthAt(
    summary,
    which === "best" ? summary.bestMonth : summary.worstMonth,
  );
  return `${name} · ${formatHoursUnit(hours)}`;
}

export function monthHours(summary: PlaceSummary, which: "best" | "least"): number {
  return monthAt(summary, which === "best" ? summary.bestMonth : summary.worstMonth).hours;
}

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const JUN_AUG = [5, 6, 7];
const DEC_FEB = [11, 0, 1];

function weightedMean(monthly: readonly number[], months: readonly number[]): number {
  let hours = 0;
  let days = 0;
  for (const month of months) {
    hours += (monthly[month] ?? 0) * DAYS_IN_MONTH[month];
    days += DAYS_IN_MONTH[month];
  }
  return Math.round((hours / days) * 10) / 10;
}

export interface SeasonAverages {
  /** Mean direct sun per day over the three summer months, hours. */
  summer: number;
  winter: number;
  /** Which months those are at this latitude. */
  summerMonths: "Jun–Aug" | "Dec–Feb";
  winterMonths: "Jun–Aug" | "Dec–Feb";
}

/**
 * Summer and winter averages from the monthly means. Summer is June–August
 * north of the equator and December–February south of it.
 */
export function seasonAverages(summary: PlaceSummary, lat: number): SeasonAverages {
  const south = lat < 0;
  const junAug = weightedMean(summary.monthlySunHours, JUN_AUG);
  const decFeb = weightedMean(summary.monthlySunHours, DEC_FEB);
  return south
    ? { summer: decFeb, winter: junAug, summerMonths: "Dec–Feb", winterMonths: "Jun–Aug" }
    : { summer: junAug, winter: decFeb, summerMonths: "Jun–Aug", winterMonths: "Dec–Feb" };
}

/** The largest monthly value across summaries (at least 1, so empty bars stay empty). */
export function commonMonthlyMax(summaries: readonly (PlaceSummary | null)[]): number {
  let max = 1;
  for (const summary of summaries) {
    if (!summary) continue;
    for (const hours of summary.monthlySunHours) if (hours > max) max = hours;
  }
  return max;
}
