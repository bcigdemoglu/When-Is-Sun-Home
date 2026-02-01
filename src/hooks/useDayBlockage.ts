import { useMemo } from "react";
import {
  computeDayBlockageMap,
  computeSunWindows,
  type DayBlockageMap,
  type SunWindow,
} from "@/lib/sunBlockage";
import type { Location, SunData } from "@/types/sun";
import type { BuildingGeoJSON } from "@/lib/overpass";

interface DayBlockageResult {
  dayBlockageMap: DayBlockageMap | null;
  sunWindows: SunWindow[] | null;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function useDayBlockage(
  location: Location | null,
  sunData: SunData | null,
  buildingData: BuildingGeoJSON | null,
  enabled: boolean,
  userElevation: number,
  pinDirection?: number,
  pinFov = 180
): DayBlockageResult {
  // Only recompute when the day changes, not on every time tick
  const dateKeyStr = sunData?.arc?.[0] ? dayKey(sunData.arc[0].time) : "";

  return useMemo(() => {
    if (!enabled || !location || !sunData?.arc || !buildingData) {
      return { dayBlockageMap: null, sunWindows: null };
    }

    const map = computeDayBlockageMap(location, sunData.arc, buildingData, userElevation, pinDirection, pinFov);
    const windows = computeSunWindows(map);
    return { dayBlockageMap: map, sunWindows: windows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng, dateKeyStr, buildingData, enabled, userElevation, pinDirection, pinFov]);
}
