/**
 * Download building data for use as a test fixture.
 *
 *   pnpm fetch-fixture [lat] [lng] [output file]
 *       Straight from Overpass. Saves the RAW Overpass response
 *       (default: tests/fixtures/pacific-heights.overpass.json).
 *
 *   pnpm fetch-fixture --via https://<deployment> [lat] [lng] [output file]
 *       Through a deployed instance of this app's /api/buildings route, for
 *       when Overpass cannot be reached from here. Saves the PARSED collection
 *       the route returns (default: tests/fixtures/pacific-heights.buildings.json)
 *       and prints the response headers that show where it came from.
 *       Use a preview deployment. If it is behind Vercel's deployment
 *       protection, set VERCEL_AUTOMATION_BYPASS_SECRET.
 *
 * Defaults to Pacific Heights, San Francisco. Either way the request is
 * exactly the one the app makes for a pin at that position (same grid cell,
 * radius and query), so the fixture can stand in for the network in tests.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildingsApiUrl, parseBuildingCollection } from "../src/lib/buildings/api";
import {
  buildOverpassQuery,
  fetchOverpassJson,
  parseOverpassResponse,
} from "../src/lib/buildings/overpass";
import { fetchAreaFor, type FetchArea } from "../src/lib/buildings/tiles";
import type { BuildingCollection } from "../src/lib/types";

const DEFAULT_PIN = { lat: 37.7906, lng: -122.4294 };
const DEFAULT_RAW_OUTPUT = "tests/fixtures/pacific-heights.overpass.json";
const DEFAULT_PARSED_OUTPUT = "tests/fixtures/pacific-heights.buildings.json";
const USER_AGENT = "when-is-sun-home fixture fetcher";
const USAGE =
  "Usage: tsx scripts/fetch-fixture.ts [--via https://<host>] [lat] [lng] [output file]";

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
  if (args.some((arg) => arg.startsWith("--"))) throw new Error(USAGE);

  const [latArg, lngArg, outputArg] = args;
  const pin = {
    lat: latArg === undefined ? DEFAULT_PIN.lat : Number(latArg),
    lng: lngArg === undefined ? DEFAULT_PIN.lng : Number(lngArg),
  };
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) throw new Error(USAGE);

  const area = fetchAreaFor(pin);
  const output = path.resolve(
    process.cwd(),
    outputArg ?? (via ? DEFAULT_PARSED_OUTPUT : DEFAULT_RAW_OUTPUT),
  );
  console.log(`Pin ${pin.lat}, ${pin.lng} → area ${area.key} (radius ${area.radiusM} m)`);

  if (via) await fetchVia(via, area, output);
  else await fetchRaw(area, output);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
