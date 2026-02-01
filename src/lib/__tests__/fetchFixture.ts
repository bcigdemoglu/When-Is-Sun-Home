/**
 * One-time script to fetch building data from Overpass API for test fixtures.
 * Run with: npx tsx src/lib/__tests__/fetchFixture.ts
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface OverpassGeomWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

interface OverpassGeomResponse {
  elements: OverpassGeomWay[];
}

interface BuildingProperties {
  id: number;
  height: number;
  levels: number;
  heightSource: "measured" | "estimated" | "unknown";
  name?: string;
}

function parseMetricHeight(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? null : parsed;
}

function parseBuildingLevels(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

async function fetchAndSave() {
  const lat = 37.7906;
  const lng = -122.4294;
  const radius = 300;

  const query = `
    [out:json][timeout:10];
    (way["building"](around:${radius},${lat},${lng}););
    out body geom;
  `;

  console.log(`Fetching buildings within ${radius}m of (${lat}, ${lng})...`);

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status}`);
  }

  const data: OverpassGeomResponse = await res.json();
  console.log(`Received ${data.elements.length} elements`);

  // Convert to GeoJSON
  const features: Array<{
    type: "Feature";
    properties: BuildingProperties;
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
  }> = [];

  for (const el of data.elements) {
    if (!el.tags?.building) continue;
    if (el.geometry.length < 4) continue;

    const ring: [number, number][] = el.geometry.map((p) => [p.lon, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    if (ring.length < 4) continue;

    const measured = parseMetricHeight(el.tags.height);
    const levels = parseBuildingLevels(el.tags["building:levels"]);

    let height: number;
    let resolvedLevels: number;
    let heightSource: BuildingProperties["heightSource"];

    if (measured !== null && measured > 0) {
      height = measured;
      resolvedLevels = levels ?? Math.ceil(measured / 3);
      heightSource = "measured";
    } else if (levels !== null) {
      height = levels * 3;
      resolvedLevels = levels;
      heightSource = "estimated";
    } else {
      height = 3;
      resolvedLevels = 1;
      heightSource = "unknown";
    }

    features.push({
      type: "Feature",
      properties: {
        id: el.id,
        height,
        levels: resolvedLevels,
        heightSource,
        name: el.tags.name,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  const geojson = { type: "FeatureCollection" as const, features };
  console.log(`Converted to ${features.length} building features`);

  const fs = await import("fs");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(
    __dirname,
    "fixtures",
    "pacific-heights.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2));
  console.log(`Written to ${outPath}`);
}

fetchAndSave().catch(console.error);
