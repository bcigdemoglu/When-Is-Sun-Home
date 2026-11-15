/**
 * GET /api/buildings?area=<key>
 *
 * Building footprints with heights for one fetch area (see
 * `src/lib/buildings/tiles.ts`), fetched from Overpass on the server and
 * cached by the CDN. All the logic lives in `src/lib/buildings/server.ts`;
 * a route file may only export handlers and segment config.
 */
import { handleBuildingsRequest } from "@/lib/buildings/server";

export const runtime = "nodejs";
/** Seconds. The handler's own Overpass budget is 25 s. */
export const maxDuration = 30;

export function GET(request: Request): Promise<Response> {
  return handleBuildingsRequest(request);
}
