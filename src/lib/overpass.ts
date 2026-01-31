import type { Feature, Polygon, FeatureCollection } from "geojson";

export interface BuildingProperties {
  id: number;
  height: number; // meters
  levels: number;
  heightSource: "measured" | "estimated" | "unknown";
  name?: string;
}

export type BuildingFeature = Feature<Polygon, BuildingProperties>;
export type BuildingGeoJSON = FeatureCollection<Polygon, BuildingProperties>;

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: (OverpassNode | OverpassWay)[];
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function fetchBuildings(
  lat: number,
  lng: number,
  radiusMeters = 300
): Promise<BuildingGeoJSON> {
  const query = `
    [out:json][timeout:10];
    (
      way["building"](around:${radiusMeters},${lat},${lng});
    );
    out body;
    >;
    out skel qt;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status}`);
  }

  const data: OverpassResponse = await res.json();
  return overpassToGeoJSON(data);
}

function overpassToGeoJSON(data: OverpassResponse): BuildingGeoJSON {
  // Build node lookup
  const nodes = new Map<number, [number, number]>();
  for (const el of data.elements) {
    if (el.type === "node") {
      nodes.set(el.id, [el.lon, el.lat]); // GeoJSON: [lng, lat]
    }
  }

  const features: BuildingFeature[] = [];

  for (const el of data.elements) {
    if (el.type !== "way" || !el.tags?.building) continue;

    // Build polygon ring from node refs
    const ring: [number, number][] = [];
    let valid = true;
    for (const nid of el.nodes) {
      const coord = nodes.get(nid);
      if (!coord) {
        valid = false;
        break;
      }
      ring.push(coord);
    }

    if (!valid || ring.length < 4) continue;

    // Ensure ring is closed
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first] as [number, number]);
    }

    // Parse height
    let height = 0;
    let heightSource: BuildingProperties["heightSource"] = "unknown";
    let levels = 0;

    if (el.tags.height) {
      const parsed = parseFloat(el.tags.height);
      if (!isNaN(parsed)) {
        height = parsed;
        heightSource = "measured";
      }
    }

    if (el.tags["building:levels"]) {
      levels = parseInt(el.tags["building:levels"], 10) || 0;
      if (height === 0 && levels > 0) {
        height = levels * 3;
        heightSource = "estimated";
      }
    }

    if (height === 0 && levels === 0) {
      // Default: assume 1 story for unknown buildings
      levels = 1;
      height = 3;
      heightSource = "unknown";
    }

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        height,
        levels: levels || Math.ceil(height / 3),
        heightSource,
        name: el.tags.name,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  }

  return { type: "FeatureCollection", features };
}
