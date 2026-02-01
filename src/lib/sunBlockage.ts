import * as turf from "@turf/turf";
import type { Location, SunData, SunBlockageInfo, ArcPoint } from "@/types/sun";
import type { BuildingGeoJSON, BuildingFeature } from "@/lib/overpass";

// ─── Angular helpers ────────────────────────────────────────────────────

/** Convert turf bearing (-180..180) to compass (0..360) */
export function bearingToCompass(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

/** Minimum angle between two compass bearings (0..180) */
export function angularDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Check whether the sun azimuth falls within the observer's field of view. */
export function isSunInFieldOfView(
  sunAzimuth: number,
  pinDirection: number,
  fov = 180
): boolean {
  return angularDifference(sunAzimuth, pinDirection) <= fov / 2;
}

/** Keep only buildings roughly in the sun's direction from the pin */
export function filterBuildingsBySunBearing(
  buildings: BuildingFeature[],
  pinLocation: Location,
  sunAzimuth: number,
  tolerance = 30
): BuildingFeature[] {
  const pin = turf.point([pinLocation.lng, pinLocation.lat]);
  return buildings.filter((b) => {
    const centroid = turf.centroid(b);
    const bearing = bearingToCompass(turf.bearing(pin, centroid));
    return angularDifference(bearing, sunAzimuth) <= tolerance;
  });
}

// ─── Pin building detection ─────────────────────────────────────────────

/** Find the building polygon that contains the given point, or null */
export function detectPinBuilding(
  data: BuildingGeoJSON,
  loc: Location
): BuildingFeature | null {
  const point = turf.point([loc.lng, loc.lat]);
  for (const feature of data.features) {
    if (turf.booleanPointInPolygon(point, feature)) {
      return feature;
    }
  }
  return null;
}

// ─── Blockage computation ───────────────────────────────────────────────

export function computeBlockage(
  location: Location,
  sunData: SunData,
  buildingData: BuildingGeoJSON,
  userElevation: number,
  pinDirection?: number,
  pinFov = 180
): SunBlockageInfo {
  if (sunData.position.altitude <= 0) {
    return { isBlocked: false };
  }

  // If observer faces a specific direction, sun outside FOV is blocked
  if (pinDirection !== undefined && !isSunInFieldOfView(sunData.position.azimuth, pinDirection, pinFov)) {
    return { isBlocked: true };
  }

  const { azimuth, altitude } = sunData.position;
  const altitudeRad = (altitude * Math.PI) / 180;
  const pin = turf.point([location.lng, location.lat]);

  // Cast a ray from the pin toward the sun (azimuth direction)
  const rayEnd = turf.destination(pin, 0.5, azimuth); // 500m ray
  const rayLine = turf.lineString([
    [location.lng, location.lat],
    rayEnd.geometry.coordinates,
  ]);

  const candidates = filterBuildingsBySunBearing(
    buildingData.features,
    location,
    azimuth
  );

  for (const building of candidates) {
    const buildingHeight = building.properties.height;
    if (buildingHeight <= 0) continue;

    let intersectionPts: ReturnType<typeof turf.lineIntersect>;
    try {
      intersectionPts = turf.lineIntersect(rayLine, building);
      if (intersectionPts.features.length === 0) continue;
    } catch {
      continue;
    }

    // Use the nearest intersection point — the building edge closest to
    // the observer in the sun's direction.  For an observer *inside* the
    // building this is the exit point (the wall facing the sun).
    let nearestDistM = Infinity;
    for (const pt of intersectionPts.features) {
      const d = turf.distance(pin, pt) * 1000; // km → m
      if (d >= 1 && d < nearestDistM) nearestDistM = d;
    }
    if (nearestDistM === Infinity) continue;

    const sunRayHeight = userElevation + nearestDistM * Math.tan(altitudeRad);

    if (buildingHeight > sunRayHeight) {
      return {
        isBlocked: true,
        blockingBuildingHeight: buildingHeight,
        blockDistance: Math.round(nearestDistM),
      };
    }
  }

  return { isBlocked: false };
}

// ─── Day-level blockage map ─────────────────────────────────────────────

export interface BlockagePoint {
  time: Date;
  azimuth: number;
  altitude: number;
  blocked: boolean;
}

export interface DayBlockageMap {
  points: BlockagePoint[];
}

export interface SunWindow {
  start: Date;
  end: Date;
}

/** Compute blockage status for every above-horizon arc point in a day. */
export function computeDayBlockageMap(
  location: Location,
  arc: ArcPoint[],
  buildingData: BuildingGeoJSON,
  userElevation: number,
  pinDirection?: number,
  pinFov = 180
): DayBlockageMap {
  const points: BlockagePoint[] = [];

  for (const p of arc) {
    if (p.altitude <= 0) continue;

    const sunData: SunData = {
      position: { azimuth: p.azimuth, altitude: p.altitude },
      times: {} as SunData["times"],
      arc: [],
    };

    const result = computeBlockage(location, sunData, buildingData, userElevation, pinDirection, pinFov);

    points.push({
      time: p.time,
      azimuth: p.azimuth,
      altitude: p.altitude,
      blocked: result.isBlocked,
    });
  }

  return { points };
}

/** Group consecutive unblocked points into visible time windows. */
export function computeSunWindows(map: DayBlockageMap): SunWindow[] {
  const windows: SunWindow[] = [];
  let windowStart: Date | null = null;

  for (const p of map.points) {
    if (!p.blocked) {
      if (!windowStart) windowStart = p.time;
    } else {
      if (windowStart) {
        // End the window at the previous point's time
        // Since we don't have it directly, use this point's time as the boundary
        windows.push({ start: windowStart, end: p.time });
        windowStart = null;
      }
    }
  }

  // Close trailing window
  if (windowStart && map.points.length > 0) {
    windows.push({ start: windowStart, end: map.points[map.points.length - 1].time });
  }

  return windows;
}
