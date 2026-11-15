/**
 * TEST HELPERS ONLY — never import this from application code (it reads from
 * the file system and builds synthetic scenes).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { fromLocalMeters } from "@/lib/geo/local";
import type { BuildingCollection, BuildingFeature, LatLng } from "@/lib/types";

/** A ring in local metres around the observer: `[x east, y north]` vertices. */
export type LocalRing = [number, number][];
/** A polygon in local metres: outer ring first, then holes. */
export type LocalPolygon = LocalRing[];

/** Axis-aligned rectangle ring (closed). */
export function rect(minX: number, minY: number, maxX: number, maxY: number): LocalRing {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
}

/** Rectangle centred on (cx, cy), rotated by `rotationDeg` (closed ring). */
export function rotatedRect(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  rotationDeg: number,
): LocalRing {
  const cos = Math.cos((rotationDeg * Math.PI) / 180);
  const sin = Math.sin((rotationDeg * Math.PI) / 180);
  const corner = (u: number, v: number): [number, number] => [
    cx + u * cos - v * sin,
    cy + u * sin + v * cos,
  ];
  const first = corner(-halfWidth, -halfHeight);
  return [
    first,
    corner(halfWidth, -halfHeight),
    corner(halfWidth, halfHeight),
    corner(-halfWidth, halfHeight),
    [first[0], first[1]],
  ];
}

function toPositions(place: LatLng, ring: LocalRing): number[][] {
  return ring.map(([x, y]) => {
    const p = fromLocalMeters(place, x, y);
    return [p.lng, p.lat];
  });
}

/**
 * A building described in local metres around `place`. Pass one polygon for a
 * GeoJSON Polygon, several for a MultiPolygon.
 */
export function buildingFromLocal(
  place: LatLng,
  polygons: LocalPolygon[],
  heightM: number,
  id = "way/1",
): BuildingFeature {
  const coordinates = polygons.map((polygon) => polygon.map((ring) => toPositions(place, ring)));
  return {
    type: "Feature",
    properties: { id, heightM, heightSource: "tagged", levels: null, kind: "yes" },
    geometry:
      coordinates.length === 1
        ? { type: "Polygon", coordinates: coordinates[0] }
        : { type: "MultiPolygon", coordinates },
  };
}

export function collectionOf(features: BuildingFeature[]): BuildingCollection {
  return { type: "FeatureCollection", features };
}

/** Centre of the Pacific Heights fixture. */
export const PACIFIC_HEIGHTS: LatLng = { lat: 37.7906, lng: -122.4294 };

interface LegacyFeature {
  properties: { id: number; height: number; levels: number | null; name?: string | null };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

/**
 * Real buildings within ~300 m of {@link PACIFIC_HEIGHTS} (San Francisco),
 * mapped from the legacy fixture shape into the current contract.
 */
export function loadPacificHeights(): BuildingCollection {
  const file = path.resolve(process.cwd(), "tests/fixtures/pacific-heights.legacy.geojson");
  const legacy = JSON.parse(readFileSync(file, "utf8")) as { features: LegacyFeature[] };
  return collectionOf(
    legacy.features.map((feature) => ({
      type: "Feature",
      properties: {
        id: `way/${feature.properties.id}`,
        heightM: feature.properties.height,
        heightSource: "tagged",
        levels: feature.properties.levels ?? null,
        kind: "yes",
        ...(feature.properties.name ? { name: feature.properties.name } : {}),
      },
      geometry: feature.geometry,
    })),
  );
}
