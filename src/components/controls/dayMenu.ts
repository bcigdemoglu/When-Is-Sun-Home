/** The shortcuts of the day menu: the days people actually want to compare. */
import type { YearAnalysis } from "@/lib/types";

export interface KeyDates {
  /** The day with the most / least daylight in the year, "YYYY-MM-DD". */
  longest: string;
  shortest: string;
  marchEquinox: string;
  septemberEquinox: string;
}

/**
 * Solstices are read off the year's own daylight figures, so they are right
 * for either hemisphere (and for the place's calendar); the equinoxes are the
 * usual calendar dates, which is as exact as "equal day and night" gets.
 */
export function keyDates(year: Pick<YearAnalysis, "year" | "days">): KeyDates {
  const y = String(year.year).padStart(4, "0");
  // Day lengths come from a coarse grid, so around a solstice many days tie:
  // the middle of the run of extreme days is the solstice itself.
  const middleOfExtreme = (sign: 1 | -1): string | null => {
    let extreme = -Infinity;
    for (const day of year.days) extreme = Math.max(extreme, sign * day.daylightMinutes);
    const tied = year.days.filter((day) => sign * day.daylightMinutes === extreme);
    return tied.length > 0 ? tied[Math.floor((tied.length - 1) / 2)].date : null;
  };
  return {
    longest: middleOfExtreme(1) ?? `${y}-06-21`,
    shortest: middleOfExtreme(-1) ?? `${y}-12-21`,
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
