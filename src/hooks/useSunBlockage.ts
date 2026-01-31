import { useMemo } from "react";
import * as turf from "@turf/turf";
import type { Location, SunData, SunBlockageInfo } from "@/types/sun";
import type { BuildingGeoJSON } from "@/lib/overpass";

export function useSunBlockage(
  location: Location | null,
  sunData: SunData | null,
  buildingData: BuildingGeoJSON | null,
  enabled: boolean,
  userElevation: number // meters above ground
): SunBlockageInfo | null {
  return useMemo(() => {
    if (!enabled || !location || !sunData || !buildingData) return null;
    if (sunData.position.altitude <= 0) {
      return { isBlocked: false };
    }

    const { azimuth, altitude } = sunData.position;
    const altitudeRad = (altitude * Math.PI) / 180;
    const pin = turf.point([location.lng, location.lat]);

    // Cast a ray from the pin toward the sun (azimuth direction)
    // Check each building along that ray
    const rayEnd = turf.destination(pin, 0.5, azimuth); // 500m ray
    const rayLine = turf.lineString([
      [location.lng, location.lat],
      rayEnd.geometry.coordinates,
    ]);

    for (const building of buildingData.features) {
      const buildingHeight = building.properties.height;
      if (buildingHeight <= 0) continue;

      // Check if the ray intersects this building
      let intersects = false;
      try {
        const intersection = turf.lineIntersect(rayLine, building);
        intersects = intersection.features.length > 0;
      } catch {
        continue;
      }

      if (!intersects) continue;

      // Calculate distance from pin to building centroid
      const centroid = turf.centroid(building);
      const distanceKm = turf.distance(pin, centroid);
      const distanceM = distanceKm * 1000;

      if (distanceM < 5) continue; // Skip if pin is essentially inside the building

      // At this distance and sun altitude, what height would the sun ray be at?
      const sunRayHeight = userElevation + distanceM * Math.tan(altitudeRad);

      if (buildingHeight > sunRayHeight) {
        return {
          isBlocked: true,
          blockingBuildingHeight: buildingHeight,
          blockDistance: Math.round(distanceM),
        };
      }
    }

    return { isBlocked: false };
  }, [location, sunData, buildingData, enabled, userElevation]);
}
