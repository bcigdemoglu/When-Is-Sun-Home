import { useState, useEffect, useRef } from "react";
import {
  fetchBuildings,
  simplifyBuildingGeometries,
  type BuildingGeoJSON,
  type BuildingFeature,
} from "@/lib/overpass";
import {
  makeBuildingCacheKey,
  loadCachedBuildings,
  saveBuildingsToCache,
} from "@/lib/buildingCache";
import { detectPinBuilding } from "@/lib/sunBlockage";
import type { Location } from "@/types/sun";

/** Detect AbortController cancellation errors */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !location) {
      setBuildingData(null);
      setPinBuilding(null);
      return;
    }

    const cacheKey = makeBuildingCacheKey(location.lat, location.lng);

    // 1. In-memory cache hit
    const memCached = cacheRef.current.get(cacheKey);
    if (memCached) {
      setBuildingData(memCached);
      setPinBuilding(detectPinBuilding(memCached, location));
      return;
    }

    // 2. localStorage cache hit
    const diskCached = loadCachedBuildings(cacheKey);
    if (diskCached) {
      cacheRef.current.set(cacheKey, diskCached);
      setBuildingData(diskCached);
      setPinBuilding(detectPinBuilding(diskCached, location));
      return;
    }

    // 3. Fetch from Overpass (debounced)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      try {
        const raw = await fetchBuildings(
          location.lat,
          location.lng,
          300,
          controller.signal
        );
        const data = simplifyBuildingGeometries(raw);
        cacheRef.current.set(cacheKey, data);
        saveBuildingsToCache(cacheKey, data);
        setBuildingData(data);
        setPinBuilding(detectPinBuilding(data, location));
      } catch (err) {
        if (!isAbortError(err)) {
          console.error("Failed to fetch buildings:", err);
        }
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [location, enabled]);

  return { buildingData, pinBuilding, isLoading };
}
