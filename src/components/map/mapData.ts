/** Pure helpers that prepare data for the map's sources. */
import type { BuildingCollection, LatLng } from "@/lib/types";

export const EMPTY_BUILDINGS: BuildingCollection = { type: "FeatureCollection", features: [] };

/** Shadows are drawn for buildings within this distance of the pin, metres. */
export const SHADOW_RADIUS_M = 250;

/**
 * The buildings whose footprint comes within `radiusM` of `center` — measured
 * to the bounding box of each outer ring, which is cheap and never drops a
 * building that is really in range.
 */
export function buildingsNear(
  buildings: BuildingCollection,
  center: LatLng,
  radiusM: number,
): BuildingCollection {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1e-6, 111_320 * Math.cos((center.lat * Math.PI) / 180));
  const radiusSq = radiusM * radiusM;

  const features = buildings.features.filter((feature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer || outer.length === 0) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const position of outer) {
        const x = (position[0] - center.lng) * metersPerDegLng;
        const y = (position[1] - center.lat) * metersPerDegLat;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      // Distance from the origin (the pin) to the box; 0 when the pin is inside.
      const dx = minX > 0 ? minX : maxX < 0 ? -maxX : 0;
      const dy = minY > 0 ? minY : maxY < 0 ? -maxY : 0;
      if (dx * dx + dy * dy <= radiusSq) return true;
    }
    return false;
  });

  return { type: "FeatureCollection", features };
}
