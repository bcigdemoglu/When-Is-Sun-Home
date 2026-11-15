/**
 * Network mocks for browser tests: building and terrain data come from
 * fixtures (or fail fast), so results are deterministic and no test depends
 * on a third-party server. `tests/e2e/fixtures.ts` installs them for every
 * test (flat terrain by default).
 *
 * The basemap (basemaps.cartocdn.com) is not touched: only
 * tiles.openfreemap.org, which the app uses for building data alone — the sun
 * computation fetches the tiles around the pin, and the map itself (MapLibre)
 * fetches the zoom-14 tiles of whatever is in view from zoom 15 on.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";

const OPENFREEMAP_FIXTURES = path.join(__dirname, "..", "..", "fixtures", "openfreemap");

/** Mocked cross-origin answers need this, or the browser withholds them from the page. */
const CORS = { "access-control-allow-origin": "*" };

/** `https://tiles.openfreemap.org/planet`, the TileJSON. */
export const TILEJSON_URL = /^https:\/\/tiles\.openfreemap\.org\/planet\/?(\?.*)?$/;
/** `https://tiles.openfreemap.org/planet/<version>/14/<x>/<y>.pbf`, any version (or "latest"). */
export const BUILDING_TILE_URL =
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/14\/(\d+)\/(\d+)\.pbf(\?.*)?$/;
/** The app's own building route, `/api/buildings?area=…`. */
export const BUILDINGS_API_URL = /\/api\/buildings(\?|$)/;
/** Any Overpass server's `/api/interpreter`. */
export const OVERPASS_URL = /\/api\/interpreter(\?|$)/;
/** The elevation tiles (AWS Terrain Tiles). */
export const TERRAIN_TILE_URL = /elevation-tiles-prod/;
/** The cached aerial photos (USGS), `…/USGSImageryOnly/MapServer/tile/<z>/<y>/<x>`. */
export const IMAGERY_BASE_URL =
  /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/;
/** The detailed aerial photos (USGS), cut to order: `…/USGSNAIPPlus/ImageServer/exportImage?bbox=…`. */
export const IMAGERY_DETAIL_URL =
  /^https:\/\/imagery\.nationalmap\.gov\/arcgis\/rest\/services\/USGSNAIPPlus\/ImageServer\/exportImage\?bbox=/;

/**
 * Serve building data from `tests/fixtures/openfreemap`.
 *
 *  - The TileJSON is the real one that was current when the fixtures were
 *    taken.
 *  - A z14 tile is served from `14/<x>/<y>.pbf` if that file exists (the four
 *    tiles around 37.7912, -122.4301, plus 14/2621/6332) and is otherwise an
 *    empty 204: a place with no buildings. (The fixture tiles hold the
 *    `building` layer only, which is all that either reader looks at.)
 *  - The fallback sources, `/api/buildings` and Overpass, fail at once, so a
 *    test can never pass by quietly reaching the real services.
 *
 * With these fixtures the area around 37.7912, -122.4301 has 3632 buildings
 * (2834 with a tagged height, 798 without).
 */
export async function mockBuildingData(page: Page): Promise<void> {
  await page.route(TILEJSON_URL, (route) =>
    route.fulfill({
      path: path.join(OPENFREEMAP_FIXTURES, "planet.json"),
      contentType: "application/json",
      headers: CORS,
    }),
  );

  await page.route(BUILDING_TILE_URL, (route) => {
    const match = BUILDING_TILE_URL.exec(route.request().url());
    const file = match && path.join(OPENFREEMAP_FIXTURES, "14", match[1], `${match[2]}.pbf`);
    if (file && fs.existsSync(file)) {
      return route.fulfill({
        path: file,
        contentType: "application/vnd.mapbox-vector-tile",
        headers: CORS,
      });
    }
    return route.fulfill({ status: 204, headers: CORS });
  });

  await page.route(BUILDINGS_API_URL, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "network", message: "Mocked: not available in tests." }),
    }),
  );

  await page.route(OVERPASS_URL, (route) => route.abort("failed"));
}

/** One Terrarium tile that is 50 m above sea level at every pixel. */
const FLAT_TERRAIN_TILE = path.join(__dirname, "..", "fixtures", "terrain", "flat-50m.png");

/**
 * Serve terrain that loads and is perfectly flat: every elevation tile is the
 * same level tile, so the app has ground heights ("hills around" are part of
 * the estimate) and no hill ever shades anything. The numbers are those of
 * flat ground, without the wait and the wording of a failed terrain load.
 */
export async function mockFlatTerrain(page: Page): Promise<void> {
  await page.route(TERRAIN_TILE_URL, (route) =>
    route.fulfill({ path: FLAT_TERRAIN_TILE, contentType: "image/png", headers: CORS }),
  );
}

/** Terrain that cannot be had: every elevation tile request fails, and the app carries on on flat ground. */
export async function mockTerrain(page: Page): Promise<void> {
  await page.route(TERRAIN_TILE_URL, (route) => route.abort());
}

/** A 4 × 4 px grey PNG: every aerial photo of the Satellite view, in tests. */
const TINY_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGUlEQVR4nGOoaMpLyAqDkAxwVkVTHgNOGQAPchRBAJMKtwAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The Satellite view's two picture services (see `src/components/map/imagery.ts`)
 * answer at once with the same tiny picture. Only their exact tile and export
 * addresses are served: any other request to those hosts stays unmocked, and
 * an unmocked request fails the test (see `fixtures.ts`).
 */
export async function mockImagery(page: Page): Promise<void> {
  const picture = (route: Route) =>
    route.fulfill({ body: TINY_IMAGE, contentType: "image/png", headers: CORS });
  await page.route(IMAGERY_BASE_URL, picture);
  await page.route(IMAGERY_DETAIL_URL, picture);
}
