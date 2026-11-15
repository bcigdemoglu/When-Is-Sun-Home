/**
 * Download building data for use as test fixtures.
 *
 *   pnpm fetch-fixture [lat] [lng]
 *       OpenFreeMap vector tiles (the app's primary source). Saves, under
 *       tests/fixtures/openfreemap/: the TileJSON as planet.json and every z14
 *       tile the app would fetch for a pin at that position as 14/<x>/<y>.pbf,
 *       plus one neighbouring tile that shares a building with them (for the
 *       tile-edge tests). Only the `building` layer of each tile is kept, byte
 *       for byte; the other layers (roads, POIs, …) would triple the size.
 *       Then regenerates tests/fixtures/pacific-heights.buildings.json: the
 *       tiles parsed into our own format, for the 350 m around the centre of
 *       that pin's fetch area (the app itself keeps 800 m).
 *
 *   pnpm fetch-fixture --overpass [lat] [lng] [output file]
 *       Straight from Overpass. Saves the RAW Overpass response
 *       (default: tests/fixtures/pacific-heights.overpass.json).
 *
 *   pnpm fetch-fixture --via https://<deployment> [lat] [lng] [output file]
 *       Through a deployed instance of this app's /api/buildings route. Saves
 *       the PARSED collection the route returns (default:
 *       tests/fixtures/pacific-heights.api.json) and prints the response
 *       headers that show where it came from. Use a preview deployment. If it
 *       is behind Vercel's deployment protection, set
 *       VERCEL_AUTOMATION_BYPASS_SECRET.
 *
 * Defaults to Pacific Heights, San Francisco. In every mode the request is
 * exactly the one the app makes for a pin at that position (same grid cell
 * and radius), so the fixtures can stand in for the network in tests.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildingsApiUrl, parseBuildingCollection } from "../src/lib/buildings/api";
import {
  buildOverpassQuery,
  fetchOverpassJson,
  parseOverpassResponse,
} from "../src/lib/buildings/overpass";
import {
  TILE_COVER_RADIUS_M,
  TILE_KEEP_RADIUS_M,
  fetchAreaFor,
  type FetchArea,
} from "../src/lib/buildings/tiles";
import {
  BUILDING_TILE_LAYER,
  OPENFREEMAP_TILEJSON_URL,
  boundsOfCircle,
  decodeBuildingTiles,
  templateFromTileJson,
  tileUrl,
  tilesForCircle,
  type TileRef,
} from "../src/lib/buildings/vectorTiles";
import type { BuildingCollection } from "../src/lib/types";

const DEFAULT_PIN = { lat: 37.7912, lng: -122.4301 };
const DEFAULT_RAW_OUTPUT = "tests/fixtures/pacific-heights.overpass.json";
const DEFAULT_VIA_OUTPUT = "tests/fixtures/pacific-heights.api.json";
const TILE_FIXTURE_DIR = "tests/fixtures/openfreemap";
const PARSED_TILES_OUTPUT = "tests/fixtures/pacific-heights.buildings.json";
/** The parsed fixture covers the bounding box of this radius around the area's centre. */
const PARSED_FIXTURE_RADIUS_M = 350;
/**
 * Not needed for the default pin's area, but it shares two large buildings
 * with its western neighbour 14/2620/6332, each cut by both tiles: the real
 * case for the tile-edge merging tests.
 */
const EXTRA_TILES: TileRef[] = [{ z: 14, x: 2621, y: 6332, col: 2621 }];
const USER_AGENT = "when-is-sun-home fixture fetcher";
const USAGE =
  "Usage: tsx scripts/fetch-fixture.ts [--overpass | --via https://<host>] [lat] [lng] [output file]";

/** Public Overpass servers ask scripts to identify themselves. (Browsers cannot set this header.) */
const identifiedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", USER_AGENT);
  return fetch(input, { ...init, headers });
};

function summary(buildings: BuildingCollection): string {
  const bySource = { tagged: 0, levels: 0, default: 0 };
  for (const feature of buildings.features) bySource[feature.properties.heightSource]++;
  return (
    `${buildings.features.length} buildings: ${bySource.tagged} tagged, ` +
    `${bySource.levels} from levels, ${bySource.default} default`
  );
}

async function save(output: string, json: unknown): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(json)}\n`);
}

/** Raw Overpass JSON, straight from the public servers. */
async function fetchRaw(area: FetchArea, output: string): Promise<void> {
  const query = buildOverpassQuery(area.center, area.radiusM);
  console.log(query);
  const json = await fetchOverpassJson(query, { fetchImpl: identifiedFetch, timeoutMs: 60_000 });
  const elementCount = (json as { elements: unknown[] }).elements.length;
  await save(output, json);
  console.log(
    `Wrote ${elementCount} elements (${summary(parseOverpassResponse(json))}) to ${output}`,
  );
}

function readVarint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  for (let i = at; ; i++) {
    const byte = bytes[i];
    if (byte === undefined) throw new Error("Truncated tile");
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(byte & 0x80)) return [value, i + 1];
  }
}

/**
 * A vector tile with only the named layer left. A tile is a sequence of
 * length-delimited layer messages (field 3), each starting with its name
 * (field 1), so the wanted one can be copied out without re-encoding it.
 */
function keepLayer(tile: Uint8Array, layerName: string): Uint8Array {
  const kept: Uint8Array[] = [];
  for (let at = 0; at < tile.length;) {
    const start = at;
    const [key, afterKey] = readVarint(tile, at);
    if (key !== ((3 << 3) | 2)) throw new Error(`Unexpected field ${key >> 3} in tile`);
    const [length, body] = readVarint(tile, afterKey);
    at = body + length;
    // The layer's fields: find `name` (field 1, a string).
    let name = "";
    for (let p = body; p < at;) {
      const [fieldKey, afterFieldKey] = readVarint(tile, p);
      if ((fieldKey & 7) !== 2) break;
      const [fieldLength, fieldBody] = readVarint(tile, afterFieldKey);
      if (fieldKey >> 3 === 1) {
        name = new TextDecoder().decode(tile.subarray(fieldBody, fieldBody + fieldLength));
        break;
      }
      p = fieldBody + fieldLength;
    }
    if (name === layerName) kept.push(tile.subarray(start, at));
  }
  return Buffer.concat(kept);
}

/** Real OpenFreeMap tiles for the area, reduced to their building layer. */
async function fetchTiles(area: FetchArea): Promise<void> {
  const dir = path.resolve(process.cwd(), TILE_FIXTURE_DIR);
  const get = async (url: string) => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

  const tileJsonBytes = await get(OPENFREEMAP_TILEJSON_URL);
  const template = templateFromTileJson(JSON.parse(new TextDecoder().decode(tileJsonBytes)));
  if (!template) throw new Error("The TileJSON has no usable tile template");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "planet.json"), tileJsonBytes);
  console.log(`TileJSON → ${template}`);

  const areaTiles = tilesForCircle(area.center, TILE_COVER_RADIUS_M);
  const loaded: { tile: TileRef; data: Uint8Array }[] = [];
  for (const tile of [...areaTiles, ...EXTRA_TILES]) {
    const full = await get(tileUrl(template, tile));
    const data = keepLayer(full, BUILDING_TILE_LAYER);
    const file = path.join(dir, String(tile.z), String(tile.x), `${tile.y}.pbf`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    console.log(
      `  ${tile.z}/${tile.x}/${tile.y}: ${full.length} bytes, building layer ${data.length} bytes`,
    );
    if (areaTiles.includes(tile)) loaded.push({ tile, data });
  }

  const all = decodeBuildingTiles(loaded, {
    bounds: boundsOfCircle(area.center, TILE_KEEP_RADIUS_M),
  });
  console.log(`The app would load ${summary(all)} for this area`);

  // The parsed fixture holds the middle of the area only: the whole of it
  // would be a file of nearly 2 MB.
  const buildings = decodeBuildingTiles(loaded, {
    bounds: boundsOfCircle(area.center, PARSED_FIXTURE_RADIUS_M),
  });
  const output = path.resolve(process.cwd(), PARSED_TILES_OUTPUT);
  await save(output, buildings);
  console.log(`Wrote ${summary(buildings)} (within ${PARSED_FIXTURE_RADIUS_M} m) to ${output}`);
}

/** The parsed collection, as served by a deployment's /api/buildings route. */
async function fetchVia(origin: string, area: FetchArea, output: string): Promise<void> {
  const url = buildingsApiUrl(area.key, new URL(origin).origin);
  console.log(`GET ${url}`);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  const started = Date.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(40_000) });
  const text = await response.text();
  console.log(`HTTP ${response.status} in ${Date.now() - started} ms, ${text.length} bytes`);
  for (const name of [
    "x-buildings-source",
    "x-buildings-count",
    "x-buildings-osm-base",
    "cache-control",
    "x-vercel-cache",
    "age",
    "retry-after",
  ]) {
    const value = response.headers.get(name);
    if (value !== null) console.log(`  ${name}: ${value}`);
  }
  if (!response.ok) {
    throw new Error(`The route answered HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const buildings = parseBuildingCollection(JSON.parse(text));
  await save(output, buildings);
  console.log(`Wrote ${summary(buildings)} to ${output}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let via: string | undefined;
  const viaIndex = args.indexOf("--via");
  if (viaIndex !== -1) {
    via = args[viaIndex + 1];
    if (!via || !/^https?:\/\//.test(via)) throw new Error(USAGE);
    args.splice(viaIndex, 2);
  }
  const overpassIndex = args.indexOf("--overpass");
  const overpass = overpassIndex !== -1;
  if (overpass) args.splice(overpassIndex, 1);
  if ((via && overpass) || args.some((arg) => arg.startsWith("--"))) throw new Error(USAGE);

  const [latArg, lngArg, outputArg] = args;
  const pin = {
    lat: latArg === undefined ? DEFAULT_PIN.lat : Number(latArg),
    lng: lngArg === undefined ? DEFAULT_PIN.lng : Number(lngArg),
  };
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) throw new Error(USAGE);

  const area = fetchAreaFor(pin);
  console.log(`Pin ${pin.lat}, ${pin.lng} → area ${area.key} (radius ${area.radiusM} m)`);

  if (via) {
    await fetchVia(via, area, path.resolve(process.cwd(), outputArg ?? DEFAULT_VIA_OUTPUT));
  } else if (overpass) {
    await fetchRaw(area, path.resolve(process.cwd(), outputArg ?? DEFAULT_RAW_OUTPUT));
  } else {
    if (outputArg !== undefined) throw new Error(USAGE);
    await fetchTiles(area);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
