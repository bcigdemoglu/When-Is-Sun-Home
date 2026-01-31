import { useState, useEffect, useRef } from "react";
import { fetchBuildings, type BuildingGeoJSON, type BuildingFeature } from "@/lib/overpass";
import * as turf from "@turf/turf";
import type { Location } from "@/types/sun";

function roundCoord(val: number, decimals = 3): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

interface BuildingDataResult {
  buildingData: BuildingGeoJSON | null;
  pinBuilding: BuildingFeature | null;
  isLoading: boolean;
}

export function useBuildingData(
  location: Location | null,
  enabled: boolean
): BuildingDataResult {
  const [buildingData, setBuildingData] = useState<BuildingGeoJSON | null>(null);
  const [pinBuilding, setPinBuilding] = useState<BuildingFeature | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cacheRef = useRef<Map<string, BuildingGeoJSON>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !location) {
      setBuildingData(null);
      setPinBuilding(null);
      return;
    }

    const roundedLat = roundCoord(location.lat);
    const roundedLng = roundCoord(location.lng);
    const cacheKey = `${roundedLat},${roundedLng}`;

    // Check cache
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setBuildingData(cached);
      detectPinBuilding(cached, location);
      return;
    }

    // Debounce fetch
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await fetchBuildings(location.lat, location.lng);
        cacheRef.current.set(cacheKey, data);
        setBuildingData(data);
        detectPinBuilding(data, location);
      } catch (err) {
        console.error("Failed to fetch buildings:", err);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [location, enabled]);

  function detectPinBuilding(data: BuildingGeoJSON, loc: Location) {
    const point = turf.point([loc.lng, loc.lat]);
    for (const feature of data.features) {
      if (turf.booleanPointInPolygon(point, feature)) {
        setPinBuilding(feature);
        return;
      }
    }
    setPinBuilding(null);
  }

  return { buildingData, pinBuilding, isLoading };
}
