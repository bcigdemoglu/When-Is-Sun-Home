import type { PlaceSummary, YearAnalysis } from "@/lib/types";

const round1 = (hours: number) => Math.round(hours * 10) / 10;

/**
 * Boil a year analysis down to the handful of numbers shown wherever a place
 * appears outside its full report: saved-place rows, the compare view, share
 * text and link previews. Small enough to store and to put in a URL.
 */
export function summarizeYear(year: YearAnalysis): PlaceSummary {
  const monthlySunHours = year.months.map((m) => round1(m.avgSunHours));
  const monthlyDaylightHours = year.months.map((m) => round1(m.avgDaylightHours));
  let bestMonth = 0;
  let worstMonth = 0;
  for (let m = 1; m < 12; m++) {
    if (year.months[m].avgSunHours > year.months[bestMonth].avgSunHours) bestMonth = m;
    if (year.months[m].avgSunHours < year.months[worstMonth].avgSunHours) worstMonth = m;
  }
  return {
    year: year.year,
    avgSunHoursPerDay: round1(year.annual.avgSunHoursPerDay),
    sunFraction: Math.round(year.annual.sunFraction * 100) / 100,
    totalSunHours: Math.round(year.annual.totalSunHours),
    monthlySunHours,
    monthlyDaylightHours,
    bestMonth,
    worstMonth,
  };
}
