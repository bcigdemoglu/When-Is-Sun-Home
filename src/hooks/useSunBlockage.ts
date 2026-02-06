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
  // Use individual position values as deps instead of the sunData object
  // reference, which changes on every tick. This avoids recomputing blockage
  // when only the object wrapper changed but the values are identical.
  const azimuth = sunData?.position.azimuth;
  const altitude = sunData?.position.altitude;
  return useMemo(() => {
    if (!enabled || !location || !sunData || !buildingData) return null;
    return computeBlockage(location, sunData, buildingData, userElevation, pinDirection, pinFov);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng, azimuth, altitude, buildingData, enabled, userElevation, pinDirection, pinFov]);
}
