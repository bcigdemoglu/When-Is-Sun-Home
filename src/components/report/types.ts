import type { ReactNode } from "react";

import type {
  DayAnalysis,
  HorizonProfile,
  Observer,
  Place,
  SunInstant,
  SunYearGrid,
  YearAnalysis,
} from "@/lib/types";

import type { ReportSection } from "./sections";

/** Which part of the report a date/time selection came from. */
export type SelectionOrigin = "heatmap" | "today" | "days" | "months" | "table";

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
  /** Ground-elevation data: "ready" means hills and slopes are included. Defaults to "idle". */
  terrain?: "idle" | "loading" | "ready" | "error";
  /** True when the pin sits inside a building footprint. */
  pinOnBuilding: boolean;
  /** Jump the app to a date (and optionally a time) — e.g. clicking the heatmap. */
  onSelectDateTime: (date: string, minuteOfDay?: number, origin?: SelectionOrigin) => void;
  /**
   * A control to share one section (a link that opens the report there),
   * drawn right after that section's title. The report knows nothing about
   * sharing: the shell renders whatever it likes, or leaves this out.
   */
  renderSectionShare?: (section: ReportSection) => ReactNode;
}

/**
 * The compact answer shown where space is tight (the collapsed bottom sheet
 * on phones, the top of the side panel on desktop): today's direct sun and
 * what the sun is doing right now. Null analysis values render skeletons.
 */
export interface SunSummaryHeaderProps {
  /** The selected date and minute, wall-clock at the place. */
  date: string;
  minuteOfDay: number;
  /** True while date and time follow the clock ("now"). */
  isLive: boolean;
  day: DayAnalysis | null;
  instant: SunInstant | null;
  year: YearAnalysis | null;
  /** While building data is loading the numbers describe an open sky. */
  buildingsStatus: BuildingDataStatus["status"];
  className?: string;
}
