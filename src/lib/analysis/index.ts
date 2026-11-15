/**
 * Public API of the sun engine: astronomy (solar), skyline (horizon) and the
 * analyses built on them. Pure TypeScript — no React, DOM or network.
 */
export {
  addDays,
  dateFromDayIndex,
  dayIndexFromDate,
  daysInYear,
  isLeapYear,
  nowInZone,
  timeZoneAt,
  utcToZoned,
  yearOfDate,
  zonedToUtc,
} from "@/lib/solar/timezone";
export { sunPositionAt, sunPositionAtMs, sunTimesFor, type SunTimes } from "@/lib/solar/position";
export { computeSunYearGrid } from "@/lib/solar/yearGrid";

export {
  computeHorizonProfile,
  horizonBinFor,
  horizonElevationAt,
  type HorizonOptions,
} from "@/lib/horizon/profile";

export { classifySun, isInViewCone, sunInstantAt } from "./classify";
export { analyzeDay, windowsFromStates } from "./day";
export { computeShadowPolygons, type ShadowOptions, type ShadowProperties } from "./shadows";
export { analyzeYear } from "./year";
export { summarizeYear } from "./summary";
