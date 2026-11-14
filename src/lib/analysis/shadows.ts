/**
 * Ground shadows of buildings, for drawing on the map. Purely illustrative:
 * the sun-hours numbers come from the horizon profile, not from these polygons.
 */
import type { Feature, FeatureCollection, Polygon, Position } from "geojson";

import { metersPerDegree } from "@/lib/geo/local";
import type { BuildingCollection, LatLng } from "@/lib/types";

const DEG_TO_RAD = Math.PI / 180;

export interface ShadowOptions {
  /** Shadows are cut off at this length, metres. Default 300. */
  maxLengthM?: number;
}

export interface ShadowProperties {
  /** `properties.id` of the building casting this piece of shadow. */
  id: string;
  /** Index of that building in the source collection. */
  buildingIndex: number;
}

/** Below this sun altitude (degrees) shadows are effectively endless: draw none. */
const MIN_ALTITUDE_DEG = 0.5;

/**
 * Shadows cast on flat ground by every building for a sun at
 * (`azimuthDeg`, `altitudeDeg`).
 *
 * A building of height h throws a shadow of length `L = h / tan(altitude)`
 * (capped at `maxLengthM`) directly away from the sun, i.e. towards compass
 * bearing `azimuthDeg + 180`. The shadow is the footprint swept along that
 * vector; it is emitted as overlapping pieces meant for ONE flat-opacity layer:
 * the outer ring translated by L (the roof's shadow) plus one quad per
 * outer-ring edge joining the edge to its translated copy (the walls' shadows).
 * Holes are ignored, so courtyards are drawn as shaded.
 *
 * Returns an empty collection when the sun is at or below 0.5°.
 */
export function computeShadowPolygons(
  place: LatLng,
  buildings: BuildingCollection,
  azimuthDeg: number,
  altitudeDeg: number,
  options: ShadowOptions = {},
): FeatureCollection<Polygon, ShadowProperties> {
  const features: Feature<Polygon, ShadowProperties>[] = [];
  const collection: FeatureCollection<Polygon, ShadowProperties> = {
    type: "FeatureCollection",
    features,
  };
  if (!(altitudeDeg > MIN_ALTITUDE_DEG) || !Number.isFinite(azimuthDeg)) return collection;

  const maxLengthM = options.maxLengthM ?? 300;
  // At 90° the tangent is huge (or negative just past it): the shadow has no length.
  const tanAltitude = altitudeDeg >= 90 ? Infinity : Math.tan(altitudeDeg * DEG_TO_RAD);

  // Metres → degrees in the local tangent plane around `place`.
  const scale = metersPerDegree(place.lat);
  const awayRad = (azimuthDeg + 180) * DEG_TO_RAD;
  const lngPerMetre = Math.sin(awayRad) / scale.lng;
  const latPerMetre = Math.cos(awayRad) / scale.lat;

  buildings.features.forEach((building, buildingIndex) => {
    const heightM = building.properties.heightM;
    if (!(heightM > 0) || !Number.isFinite(heightM)) return;
    const lengthM = Math.min(heightM / tanAltitude, maxLengthM);
    if (!(lengthM > 0)) return;

    const dLng = lengthM * lngPerMetre;
    const dLat = lengthM * latPerMetre;
    const properties: ShadowProperties = { id: building.properties.id, buildingIndex };
    const push = (ring: Position[]): void => {
      features.push({
        type: "Feature",
        properties,
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    };

    const polygons =
      building.geometry.type === "Polygon"
        ? [building.geometry.coordinates]
        : building.geometry.coordinates;

    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer || outer.length < 3) continue;

      const moved: Position[] = outer.map((p) => [p[0] + dLng, p[1] + dLat]);
      const first = moved[0];
      const last = moved[moved.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) moved.push([first[0], first[1]]);
      push(moved);

      // Walk the outer ring as a closed loop; zero-length edges are skipped.
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        push([
          [a[0], a[1]],
          [b[0], b[1]],
          [b[0] + dLng, b[1] + dLat],
          [a[0] + dLng, a[1] + dLat],
          [a[0], a[1]],
        ]);
      }
    }
  });

  return collection;
}
