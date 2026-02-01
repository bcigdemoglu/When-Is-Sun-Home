import * as turf from "@turf/turf";
import type { Feature, Polygon, FeatureCollection } from "geojson";

// ─── Public types ───────────────────────────────────────────────────────

export interface BuildingProperties {
  id: number;
  height: number; // meters
  levels: number;
  heightSource: "measured" | "estimated" | "unknown";
  name?: string;
}

export type BuildingFeature = Feature<Polygon, BuildingProperties>;
export type BuildingGeoJSON = FeatureCollection<Polygon, BuildingProperties>;

// ─── Overpass `out body geom` response types ────────────────────────────

interface OverpassGeomWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

interface OverpassGeomResponse {
  elements: OverpassGeomWay[];
}

// ─── Height parsing (pure functions) ────────────────────────────────────

interface ParsedHeight {
  height: number;
  levels: number;
  heightSource: BuildingProperties["heightSource"];
}

/** Parse an OSM `height` tag (e.g. "12", "12.5", "12 m") → meters or null */
export function parseMetricHeight(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? null : parsed;
}

/** Parse an OSM `building:levels` tag → integer or null */
export function parseBuildingLevels(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

/** Resolve height from measured + levels, with 3 m/level default */
export function resolveHeight(
  measured: number | null,
  levels: number | null
): ParsedHeight {
  if (measured !== null && measured > 0) {
    return {
      height: measured,
      levels: levels ?? Math.ceil(measured / 3),
      heightSource: "measured",
    };
  }
  if (levels !== null) {
    return { height: levels * 3, levels, heightSource: "estimated" };
  }
  return { height: 3, levels: 1, heightSource: "unknown" };
}

/** Extract building height from an OSM tags dict */
export function extractBuildingHeight(
  tags: Record<string, string>
): ParsedHeight {
  return resolveHeight(
    parseMetricHeight(tags.height),
    parseBuildingLevels(tags["building:levels"])
  );
}

// ─── Ring construction ──────────────────────────────────────────────────

/** Convert Overpass inline geometry → GeoJSON ring. Returns null if < 4 points. */
export function buildPolygonRing(
  geometry: { lat: number; lon: number }[]
): [number, number][] | null {
  if (geometry.length < 4) return null;

  const ring: [number, number][] = geometry.map((p) => [p.lon, p.lat]);

  // Ensure closure
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  return ring.length >= 4 ? ring : null;
}

// ─── Geometry simplification ────────────────────────────────────────────

/** Check that the outer ring has at least 4 coordinate positions */
export function isValidPolygon(feature: BuildingFeature): boolean {
  const ring = feature.geometry.coordinates[0];
  return ring !== undefined && ring.length >= 4;
}

/** Simplify all building polygons, dropping degenerate results */
export function simplifyBuildingGeometries(
  buildings: BuildingGeoJSON,
  tolerance = 0.00001
): BuildingGeoJSON {
  const simplified: BuildingFeature[] = [];

  for (const feature of buildings.features) {
    try {
      const s = turf.simplify(feature, {
        tolerance,
        highQuality: false,
      }) as BuildingFeature;
      if (isValidPolygon(s)) {
        simplified.push(s);
      }
    } catch {
      // Keep original if simplification fails
      if (isValidPolygon(feature)) {
        simplified.push(feature);
      }
    }
  }

  return { type: "FeatureCollection", features: simplified };
}

// ─── Fetch + convert ────────────────────────────────────────────────────

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function fetchBuildings(
  lat: number,
  lng: number,
  radiusMeters = 300,
  signal?: AbortSignal
): Promise<BuildingGeoJSON> {
  const query = `
    [out:json][timeout:10];
    (way["building"](around:${radiusMeters},${lat},${lng}););
    out body geom;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
  });

  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status}`);
  }

  const data: OverpassGeomResponse = await res.json();
  return overpassToGeoJSON(data);
}

function overpassToGeoJSON(data: OverpassGeomResponse): BuildingGeoJSON {
  const features: BuildingFeature[] = [];

  for (const el of data.elements) {
    if (!el.tags?.building) continue;

    const ring = buildPolygonRing(el.geometry);
    if (!ring) continue;

    const { height, levels, heightSource } = extractBuildingHeight(el.tags);

    features.push({
      type: "Feature",
      properties: { id: el.id, height, levels, heightSource, name: el.tags.name },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return { type: "FeatureCollection", features };
}
