import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Development only: serves the recorded Overpass response used by the tests
 * (real buildings around Pacific Heights, San Francisco) to the report harness.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  try {
    const file = path.join(process.cwd(), "tests", "fixtures", "pacific-heights.overpass.json");
    const body = await readFile(file, "utf8");
    return new Response(body, { headers: { "content-type": "application/json" } });
  } catch {
    return new Response("Fixture not found", { status: 404 });
  }
}
