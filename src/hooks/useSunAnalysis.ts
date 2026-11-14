"use client";

/**
 * The one place that turns settings + building data into everything the UI
 * shows. Each piece is memoised on exactly its own inputs:
 *
 *   grid    ← lat, lng, year, timeZone                 (≈ 25–50 ms)
 *   horizon ← lat, lng, buildings, observer.heightM    (≈ 1–20 ms)
 *   year    ← grid, horizon, observer                  (≈ 1–2 ms)
 *   day     ← lat, lng, date, timeZone, horizon, observer   (≈ 0.6 ms)
 *   instant ← day's inputs + minuteOfDay               (microseconds)
 *
 * so dragging the time slider recomputes only `instant`, and dragging the
 * date slider only `day` and `instant` (plus `grid`/`year` when the year
 * itself changes).
 *
 * The observer is throttled before it reaches the engine: while a height or
 * direction slider is dragged the controls stay live and the analysis follows
 * at ~25 updates a second.
 */
import { useMemo } from "react";
import {
  analyzeDay,
  analyzeYear,
  computeHorizonProfile,
  computeSunYearGrid,
  sunInstantAt,
  timeZoneAt,
  yearOfDate,
} from "@/lib/analysis";
import { useBuildings, type UseBuildingsResult } from "@/lib/buildings/useBuildings";
import type {
  DayAnalysis,
  HorizonProfile,
  Observer,
  Place,
  SunInstant,
  SunYearGrid,
  YearAnalysis,
} from "@/lib/types";
import {
  selectDate,
  selectMinuteOfDay,
  selectObserver,
  selectPlace,
  useSettings,
} from "@/state";
import { buildingIdAt, resolveDateTime, usableBuildings } from "./sunAnalysis";
import { useNow } from "./useNow";
import { useThrottledValue } from "./useThrottledValue";

/** Sampling step of the whole-year grid, minutes. */
export const YEAR_GRID_STEP_MINUTES = 5;
/** How often a changing observer is handed to the engine, ms. */
export const OBSERVER_THROTTLE_MS = 40;

export interface SunAnalysis {
  place: Place;
  /** IANA zone of the place. Every date / minute here is wall-clock there. */
  timeZone: string;
  date: string;
  minuteOfDay: number;
  /** True while date and time follow the clock. */
  isLive: boolean;
  /** The observer the results below were computed for (lags the store by ≤ 40 ms). */
  observer: Observer;
  buildings: UseBuildingsResult;
  /**
   * True while the numbers ignore buildings because their data is not (yet)
   * available: every result then describes an unobstructed sky.
   */
  isUnobstructed: boolean;
  grid: SunYearGrid | null;
  horizon: HorizonProfile | null;
  year: YearAnalysis | null;
  day: DayAnalysis | null;
  instant: SunInstant | null;
  /** True when the pin sits inside a building footprint. */
  pinOnBuilding: boolean;
  /** `properties.id` of the building the pin sits in / that hides the sun right now. */
  pinBuildingId: string | null;
  blockerBuildingId: string | null;
}

/** `null` until a place is pinned (and, in live mode, until the clock is known). */
export function useSunAnalysis(): SunAnalysis | null {
  const place = useSettings(selectPlace);
  const dateSetting = useSettings(selectDate);
  const minuteSetting = useSettings(selectMinuteOfDay);
  const observer = useThrottledValue(useSettings(selectObserver), OBSERVER_THROTTLE_MS);

  const lat = place ? place.lat : null;
  const lng = place ? place.lng : null;

  const timeZone = useMemo(
    () => (lat === null || lng === null ? null : timeZoneAt(lat, lng)),
    [lat, lng],
  );
  const now = useNow(timeZone);
  const selected = resolveDateTime(dateSetting, minuteSetting, now);
  const date = selected ? selected.date : null;
  const minuteOfDay = selected ? selected.minuteOfDay : null;
  const isLive = selected ? selected.isLive : false;
  const year = date === null ? null : yearOfDate(date);

  // `useBuildings` hands out a fresh object per render; keep ours stable so
  // that consumers (and the throttles below them) only see real changes.
  const query = useBuildings(place);
  const {
    buildings: collection,
    status,
    error,
    isFetching,
    isPlaceholder,
    refetch,
    stats,
  } = query;
  const buildings = useMemo<UseBuildingsResult>(
    () => ({ buildings: collection, status, error, isFetching, isPlaceholder, refetch, stats }),
    [collection, status, error, isFetching, isPlaceholder, refetch, stats],
  );
  const measured = usableBuildings(buildings);

  const grid = useMemo(() => {
    if (lat === null || lng === null || year === null || timeZone === null) return null;
    return computeSunYearGrid(
      { lat, lng },
      { year, timeZone, stepMinutes: YEAR_GRID_STEP_MINUTES },
    );
  }, [lat, lng, year, timeZone]);

  const heightM = observer.heightM;
  const horizon = useMemo(() => {
    if (lat === null || lng === null || measured === null) return null;
    return computeHorizonProfile({ lat, lng }, measured, heightM);
  }, [lat, lng, measured, heightM]);

  const yearAnalysis = useMemo(
    () => (grid === null ? null : analyzeYear(grid, horizon, observer)),
    [grid, horizon, observer],
  );

  const day = useMemo(() => {
    if (lat === null || lng === null || date === null || timeZone === null) return null;
    return analyzeDay({ lat, lng }, date, timeZone, horizon, observer);
  }, [lat, lng, date, timeZone, horizon, observer]);

  const instant = useMemo(() => {
    if (lat === null || lng === null || date === null || minuteOfDay === null || timeZone === null)
      return null;
    return sunInstantAt({ lat, lng }, date, minuteOfDay, timeZone, horizon, observer);
  }, [lat, lng, date, minuteOfDay, timeZone, horizon, observer]);

  const containingIndex = horizon ? horizon.containingBuildingIndex : -1;
  const blockerIndex = instant && instant.blocker ? instant.blocker.buildingIndex : -1;
  const pinBuildingId = buildingIdAt(measured, containingIndex);
  const blockerBuildingId = buildingIdAt(measured, blockerIndex);

  return useMemo(() => {
    if (place === null || timeZone === null || date === null || minuteOfDay === null) return null;
    return {
      place,
      timeZone,
      date,
      minuteOfDay,
      isLive,
      observer,
      buildings,
      isUnobstructed: measured === null,
      grid,
      horizon,
      year: yearAnalysis,
      day,
      instant,
      pinOnBuilding: containingIndex >= 0,
      pinBuildingId,
      blockerBuildingId,
    };
  }, [
    place,
    timeZone,
    date,
    minuteOfDay,
    isLive,
    observer,
    buildings,
    measured,
    grid,
    horizon,
    yearAnalysis,
    day,
    instant,
    containingIndex,
    pinBuildingId,
    blockerBuildingId,
  ]);
}
