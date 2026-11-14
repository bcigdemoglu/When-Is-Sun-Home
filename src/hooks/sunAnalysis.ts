/**
 * The pure decisions behind `useSunAnalysis`: which date / time is selected,
 * and which building data may be used for numbers.
 */
import type { UseBuildingsResult } from "@/lib/buildings/useBuildings";
import type { BuildingCollection } from "@/lib/types";

export interface SelectedDateTime {
  /** "YYYY-MM-DD" on the place's wall clock. */
  date: string;
  /** 0..1439 on the place's wall clock. */
  minuteOfDay: number;
  /** True when both follow the clock ("today, now"). */
  isLive: boolean;
}

/**
 * The date and minute the app is looking at. A `null` setting follows the
 * clock at the place (`now`); with no clock yet (server render, hydration)
 * and something still to follow, there is nothing to show: `null`.
 */
export function resolveDateTime(
  dateSetting: string | null,
  minuteSetting: number | null,
  now: { date: string; minuteOfDay: number } | null,
): SelectedDateTime | null {
  const date = dateSetting ?? now?.date ?? null;
  const minuteOfDay = minuteSetting ?? now?.minuteOfDay ?? null;
  if (date === null || minuteOfDay === null) return null;
  return { date, minuteOfDay, isLive: dateSetting === null && minuteSetting === null };
}

/**
 * Buildings that may be used to compute sun hours: only the real data for the
 * current place. While loading, `buildings` can be a neighbouring area's
 * placeholder — good enough to draw, not to measure with.
 */
export function usableBuildings(
  result: Pick<UseBuildingsResult, "status" | "buildings">,
): BuildingCollection | null {
  return result.status === "ready" ? result.buildings : null;
}

/** `properties.id` of the building at `index`, or null when there is none. */
export function buildingIdAt(
  buildings: BuildingCollection | null,
  index: number | null | undefined,
): string | null {
  if (!buildings || index === null || index === undefined || index < 0) return null;
  return buildings.features[index]?.properties.id ?? null;
}
