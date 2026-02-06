import { useMemo } from "react";
import { computeBlockage } from "@/lib/sunBlockage";
import type { Location, SunData, SunBlockageInfo } from "@/types/sun";
import type { BuildingGeoJSON } from "@/lib/overpass";

export { bearingToCompass, angularDifference, filterBuildingsBySunBearing } from "@/lib/sunBlockage";

export function useSunBlockage(
  location: Location | null,
  sunData: SunData | null,
  buildingData: BuildingGeoJSON | null,
  enabled: boolean,
  userElevation: number,
  pinDirection?: number,
  pinFov = 180
): SunBlockageInfo | null {
  return useMemo(() => {
    if (!enabled || !location || !sunData || !buildingData) return null;
    return computeBlockage(location, sunData, buildingData, userElevation, pinDirection, pinFov);
  }, [location, sunData, buildingData, enabled, userElevation, pinDirection, pinFov]);
}
