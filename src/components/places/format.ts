/**
 * Wording and small calculations shared by the saved-places list, the
 * compare view and the search rows. Pure.
 */
import type { Observer, PlaceSummary } from "@/lib/types";
import { heightMToFloor } from "@/state/selectors";

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

/** Hours with one decimal: 6.4 → "6.4", 10 → "10.0", 0 → "0". No unit. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "–";
  const rounded = Math.round(Math.max(0, hours) * 10) / 10;
  return rounded === 0 ? "0" : rounded.toFixed(1);
}

/** "6.4 h" */
export function formatHoursUnit(hours: number): string {
  return `${formatHours(hours)} h`;
}

/** 0.52 → "52%" */
export function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction)) return "–";
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

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
  const { name, hours } = monthAt(summary, which === "best" ? summary.bestMonth : summary.worstMonth);
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

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function compassPoint(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 45) % 8];
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Yard · ground", "Window · 2nd floor · facing S". Floor 1 is the ground floor. */
export function viewpointLabel(observer: Observer): string {
  const floor = heightMToFloor(observer.heightM);
  if (observer.mode === "window") {
    const level = floor <= 1 ? "ground floor" : `${ordinal(floor)} floor`;
    return `Window · ${level} · facing ${compassPoint(observer.facingDeg)}`;
  }
  return `Yard · ${floor <= 1 ? "ground" : `${ordinal(floor)} floor`}`;
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
