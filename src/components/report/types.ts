import type {
  DayAnalysis,
  HorizonProfile,
  Observer,
  Place,
  SunInstant,
  SunYearGrid,
  YearAnalysis,
} from "@/lib/types";

export interface BuildingDataStatus {
  status: "idle" | "loading" | "ready" | "error";
  /** How many buildings were used and where their heights came from. */
  stats: { total: number; tagged: number; levels: number; default: number } | null;
  onRetry: () => void;
}

/**
 * Everything the sun report needs. The report is purely presentational: the
 * app shell computes these values and passes them down.
 *
 * Analysis values are `null` while they are being computed (or when there is
 * nothing to compute yet) — render skeletons, not zeros.
 */
export interface SunReportProps {
  place: Place;
  /** IANA zone of the place; all dates/minutes below are wall-clock there. */
  timeZone: string;
  observer: Observer;
  /** The selected calendar date ("YYYY-MM-DD") and minute of day (0..1439). */
  date: string;
  minuteOfDay: number;
  /** Whole-year result for the year of `date`. */
  year: YearAnalysis | null;
  /** Sun positions on the same grid as `year` (for drawing sun paths). */
  grid: SunYearGrid | null;
  /** 1-minute analysis of the selected date. */
  day: DayAnalysis | null;
  /** Skyline around the observer; null when building data is unavailable. */
  horizon: HorizonProfile | null;
  /** The sun at the selected instant. */
  instant: SunInstant | null;
  buildings: BuildingDataStatus;
  /** True when the pin sits inside a building footprint. */
  pinOnBuilding: boolean;
  /** Jump the app to a date (and optionally a time) — e.g. clicking the heatmap. */
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}
