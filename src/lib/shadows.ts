import * as turf from "@turf/turf";
import type { Feature, Polygon, FeatureCollection } from "geojson";
import type { BuildingGeoJSON, BuildingProperties } from "./overpass";

export function computeShadows(
  buildings: BuildingGeoJSON,
  sunAzimuth: number, // compass degrees (0=N, 90=E, etc.)
  sunAltitude: number // degrees above horizon
): FeatureCollection<Polygon> {
  if (sunAltitude <= 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: Feature<Polygon>[] = [];
  const altitudeRad = (sunAltitude * Math.PI) / 180;

  for (const building of buildings.features) {
    const height = building.properties.height;
    if (height <= 0) continue;

    const shadowLength = height / Math.tan(altitudeRad);
    if (shadowLength <= 0 || shadowLength > 2000) continue; // cap at 2km

    // Shadow direction is opposite to sun azimuth
    const shadowBearing = (sunAzimuth + 180) % 360;

    // Translate the building footprint in the shadow direction
    const shadowDistanceKm = shadowLength / 1000;

    try {
      const translated = turf.transformTranslate(
        building as Feature<Polygon, BuildingProperties>,
        shadowDistanceKm,
        shadowBearing
      );

      // Combine original footprint + translated footprint into shadow polygon
      // For simplicity, use the translated footprint as the shadow
      features.push({
        type: "Feature",
        properties: {
          buildingId: building.properties.id,
          shadowLength,
        },
        geometry: translated.geometry,
      });
    } catch {
      // Skip invalid geometries
    }
  }

  return { type: "FeatureCollection", features };
}
