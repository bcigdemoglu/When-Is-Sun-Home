/**
 * Download a RAW Overpass response for use as a test fixture.
 *
 *   pnpm exec tsx scripts/fetch-fixture.ts [lat] [lng] [output file]
 *
 * Defaults to Pacific Heights, San Francisco, and writes
 * tests/fixtures/pacific-heights.overpass.json. The request is exactly the one
 * the app makes for a pin at that position (same grid cell, radius and query),
 * so the fixture can stand in for the network in end-to-end tests.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildOverpassQuery,
  fetchOverpassJson,
  parseOverpassResponse,
} from "../src/lib/buildings/overpass";
import { fetchAreaFor } from "../src/lib/buildings/tiles";

const DEFAULT_PIN = { lat: 37.7906, lng: -122.4294 };
const DEFAULT_OUTPUT = "tests/fixtures/pacific-heights.overpass.json";

/** Public Overpass servers ask scripts to identify themselves. (Browsers cannot set this header.) */
const identifiedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", "when-is-sun-home fixture fetcher");
  return fetch(input, { ...init, headers });
};

async function main(): Promise<void> {
  const [latArg, lngArg, outputArg] = process.argv.slice(2);
  const pin = {
    lat: latArg === undefined ? DEFAULT_PIN.lat : Number(latArg),
    lng: lngArg === undefined ? DEFAULT_PIN.lng : Number(lngArg),
  };
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
    throw new Error("Usage: tsx scripts/fetch-fixture.ts [lat] [lng] [output file]");
  }
  const output = path.resolve(process.cwd(), outputArg ?? DEFAULT_OUTPUT);

  const area = fetchAreaFor(pin);
  const query = buildOverpassQuery(area.center, area.radiusM);
  console.log(`Pin ${pin.lat}, ${pin.lng} → area ${area.key} (radius ${area.radiusM} m)`);
  console.log(query);

  const json = await fetchOverpassJson(query, { fetchImpl: identifiedFetch, timeoutMs: 60_000 });

  const buildings = parseOverpassResponse(json);
  const bySource = { tagged: 0, levels: 0, default: 0 };
  for (const feature of buildings.features) bySource[feature.properties.heightSource]++;
  const elementCount = (json as { elements: unknown[] }).elements.length;

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(json)}\n`);
  console.log(
    `Wrote ${elementCount} elements (${buildings.features.length} buildings: ` +
      `${bySource.tagged} tagged, ${bySource.levels} from levels, ${bySource.default} default) to ${output}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
