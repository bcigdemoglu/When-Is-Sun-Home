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
import zlib from "node:zlib";
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
/** A region's own aerial photos (so far the City of Portland's), `…/MapServer/tile/<z>/<y>/<x>`. */
export const IMAGERY_REGIONAL_URL =
  /^https:\/\/www\.portlandmaps\.com\/arcgis\/rest\/services\/Public\/Aerial_Photos_Summer_2025\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/;
/** The host of the Trees layer's heights: the Oregon geology department's (DOGAMI) map server. */
export const TREE_HOST = "gis.dogami.oregon.gov";
/** The Trees layer's heights, cut to order: `…/CANOPY_HEIGHT_MODEL_MOSAIC/ImageServer/exportImage?bbox=…`. */
export const TREE_HEIGHTS_URL =
  /^https:\/\/gis\.dogami\.oregon\.gov\/arcgis\/rest\/services\/lidar\/CANOPY_HEIGHT_MODEL_MOSAIC\/ImageServer\/exportImage\?bbox=[-\d.,]+&bboxSR=3857&imageSR=3857&size=512,512&format=png32&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image$/;
/** "Which survey are the heights here from?": `…/CANOPY_HEIGHT_MODEL_MOSAIC/ImageServer/identify?geometry=…`. */
export const TREE_SURVEY_URL =
  /^https:\/\/gis\.dogami\.oregon\.gov\/arcgis\/rest\/services\/lidar\/CANOPY_HEIGHT_MODEL_MOSAIC\/ImageServer\/identify\?geometry=/;

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
 * The Satellite view's picture services (see `src/components/map/imagery.ts`:
 * the two national ones and the regional ones) answer at once with the same
 * tiny picture. Only their exact tile and export addresses are served: any
 * other request to those hosts stays unmocked, and an unmocked request fails
 * the test (see `fixtures.ts`).
 */
export async function mockImagery(page: Page): Promise<void> {
  const picture = (route: Route) =>
    route.fulfill({ body: TINY_IMAGE, contentType: "image/png", headers: CORS });
  await page.route(IMAGERY_BASE_URL, picture);
  await page.route(IMAGERY_DETAIL_URL, picture);
  await page.route(IMAGERY_REGIONAL_URL, picture);
}

/** What the survey lookup answers in tests: the survey on top in Portland, and one beneath it. */
export const TREE_SURVEY_ANSWER = {
  objectId: 0,
  name: "Pixel",
  value: "7.37999",
  catalogItems: {
    objectIdFieldName: "OBJECTID",
    features: [
      { attributes: { OBJECTID: 420, Name: "OLC_METRO_2014_CANOPY_OGIC_2011", ZOrder: 2014 } },
      {
        attributes: { OBJECTID: 376, Name: "OLC_WILLAMETTE_VALLEY_2009_CANOPY_OGIC_HARN" },
      },
    ],
  },
  catalogItemVisibilities: [1, 0],
};

/**
 * The Trees layer's service (see `src/components/map/trees.ts`) answers at
 * once: every heights picture is the same tiny grey one (a height all over,
 * so there is something to draw), and every spot was surveyed by "OLC Metro"
 * in 2014. Only its two exact addresses are served: any other request to
 * that host stays unmocked, and an unmocked request fails the test (see
 * `fixtures.ts`).
 */
export async function mockTrees(page: Page): Promise<void> {
  await page.route(TREE_HEIGHTS_URL, (route) =>
    route.fulfill({ body: TINY_IMAGE, contentType: "image/png", headers: CORS }),
  );
  await page.route(TREE_SURVEY_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify(TREE_SURVEY_ANSWER),
    }),
  );
}

/**
 * Record every request the page sends to the Trees layer's host, whatever
 * its kind. Returns the list (it grows as the test goes on).
 */
export function watchTreeRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    let host = "";
    try {
      host = new URL(request.url()).hostname;
    } catch {
      return;
    }
    if (host === TREE_HOST) requests.push(request.url());
  });
  return requests;
}

/**
 * The listing sites whose links the search reads for an address. The app
 * must never REQUEST anything from them (they forbid automated access, and
 * the address is in the link's text): a request to any of these hosts is a
 * bug.
 */
export const LISTING_SITE_HOST =
  /(^|\.)(zillow\.com|redfin\.com|redf\.in|realtor\.com|trulia\.com)$/i;

/**
 * Record every request the page sends to a listing site, whatever its type
 * (navigation, fetch, image, prefetch). Returns the list, to be checked when
 * the test ends: it must be empty. Nothing is answered here — such a request
 * is also aborted, and fails the test, as any unmocked one (see `fixtures.ts`).
 */
export function watchListingSites(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    let host = "";
    try {
      host = new URL(request.url()).hostname;
    } catch {
      return;
    }
    if (LISTING_SITE_HOST.test(host)) requests.push(request.url());
  });
  return requests;
}

// ─── The report's Trees section ────────────────────────────────────────────

const TREE_FIXTURES = path.join(__dirname, "..", "fixtures", "trees");
const treeFixture = (name: string) => path.join(TREE_FIXTURES, name);

/** The City of Portland's host: street trees, heritage trees, neighborhoods and lot lines. */
export const CITY_HOST = "www.portlandmaps.com";
/** Street trees (Parks & Recreation's inventory): `…/COP_OpenData_Environment/MapServer/1415/query?…`. */
export const STREET_TREES_URL =
  /^https:\/\/www\.portlandmaps\.com\/od\/rest\/services\/COP_OpenData_Environment\/MapServer\/1415\/query\?/;
/** Heritage trees: `…/COP_OpenData_Environment/MapServer/26/query?…`. */
export const HERITAGE_TREES_URL =
  /^https:\/\/www\.portlandmaps\.com\/od\/rest\/services\/COP_OpenData_Environment\/MapServer\/26\/query\?/;
/** Neighborhood boundaries: `…/COP_OpenData_Boundary/MapServer/3/query?…`. */
export const NEIGHBORHOODS_URL =
  /^https:\/\/www\.portlandmaps\.com\/od\/rest\/services\/COP_OpenData_Boundary\/MapServer\/3\/query\?/;
/** Lot lines (address and area only): `…/Public/Taxlots/MapServer/0/query?…`. */
export const TAXLOTS_URL =
  /^https:\/\/www\.portlandmaps\.com\/arcgis\/rest\/services\/Public\/Taxlots\/MapServer\/0\/query\?/;
/** Every city address the Trees section asks. */
export const CITY_TREE_URLS = [
  STREET_TREES_URL,
  HERITAGE_TREES_URL,
  NEIGHBORHOODS_URL,
  TAXLOTS_URL,
];
/** A canopy window of the report (any square size): `…/CANOPY_HEIGHT_MODEL_MOSAIC/ImageServer/exportImage?…&size=N,N…`. */
export const CANOPY_WINDOW_URL =
  /^https:\/\/gis\.dogami\.oregon\.gov\/arcgis\/rest\/services\/lidar\/CANOPY_HEIGHT_MODEL_MOSAIC\/ImageServer\/exportImage\?bbox=[-\d.,]+&bboxSR=3857&imageSR=3857&size=(\d+),\1&format=png32&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image$/;
/** The fixtures' house: 2124 NE 36th Ave, Portland (its lot, its block, its street trees). */
export const TREES_HOUSE = { lat: 45.5382208, lng: -122.6257477 } as const;
/** The size of the canopy window around a house (`nearWindow`): served from the real survey. */
const NEAR_WINDOW_SIZE = 384;

/** A PNG of RGBA pixels (no filtering): enough for the app's decoder. */
function encodeRgbaPng(size: number, pixel: (x: number, y: number) => [number, number]): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [feet, alpha] = pixel(x, y);
      const at = y * (size * 4 + 1) + 1 + x * 4;
      raw[at] = feet;
      raw[at + 3] = alpha;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Heights for any other window: a quarter of it under square crowns 8 px
 * across, a third of them 30 ft, a third 60 ft, a third 90 ft — so the
 * area's canopy cover is 25% where no building stands, split evenly by height.
 */
function patternHeights(size: number): Buffer {
  return encodeRgbaPng(size, (x, y) => {
    const cx = Math.floor(x / 8);
    const cy = Math.floor(y / 8);
    if (cx % 2 !== 0 || cy % 2 !== 0) return [0, 255];
    return [[30, 60, 90][(cx / 2 + cy / 2) % 3], 255];
  });
}

const json = (route: Route, file: string) =>
  route.fulfill({ path: treeFixture(file), contentType: "application/json", headers: CORS });
const noFeatures = (route: Route) =>
  route.fulfill({
    contentType: "application/json",
    headers: CORS,
    body: JSON.stringify({ features: [] }),
  });

/** Is the query's point (`geometry=lng,lat`) at the fixtures' house? */
function atHouse(url: URL): boolean {
  const [lng, lat] = (url.searchParams.get("geometry") ?? "").split(",").map(Number);
  return Math.abs(lat - TREES_HOUSE.lat) < 3e-4 && Math.abs(lng - TREES_HOUSE.lng) < 4e-4;
}

/**
 * The Trees section's services (see `src/lib/trees/portland.ts` and
 * `src/components/map/canopyWindow.ts`) answer from `tests/e2e/fixtures/trees`,
 * real answers taken at 2124 NE 36th Ave, Portland:
 *
 *  - the lot under the pin: that house's (address and area only), anywhere
 *    within a few tens of metres of it; no lot elsewhere;
 *  - its block (2100–2199 NE 36th Ave): two Norway maples recorded at the
 *    address, under wires; any other block has none;
 *  - the area: 967 street trees; the nearest heritage trees; Grant Park;
 *  - canopy heights: the real 2014 survey around the house for the house's
 *    window, and a regular pattern for every other window.
 *
 * The building tiles of the house are served by `mockTreesHouseBuildings`,
 * for the tests that want them.
 */
export async function mockTreeRecords(page: Page): Promise<void> {
  await page.route(STREET_TREES_URL, (route) => {
    const url = new URL(route.request().url());
    const params = url.searchParams;
    const groups = params.get("groupByFieldsForStatistics");
    if (groups === "SPECIES") return json(route, "area-species.json");
    if (groups) return json(route, "area-traits.json");
    const where = params.get("where");
    if (where)
      return where.includes("21__ NE 36TH AVE")
        ? json(route, "block-trees.json")
        : noFeatures(route);
    return atHouse(url) ? json(route, "nearby-trees.json") : noFeatures(route);
  });
  await page.route(HERITAGE_TREES_URL, (route) => json(route, "heritage.json"));
  await page.route(NEIGHBORHOODS_URL, (route) => json(route, "neighborhood.json"));
  await page.route(TAXLOTS_URL, (route) => {
    const url = new URL(route.request().url());
    const where = url.searchParams.get("where");
    if (where)
      return where.includes("21__ NE 36TH AVE")
        ? json(route, "block-lots.json")
        : noFeatures(route);
    return atHouse(url) ? json(route, "taxlot.json") : noFeatures(route);
  });
  await page.route(CANOPY_WINDOW_URL, (route) => {
    const size = Number(CANOPY_WINDOW_URL.exec(route.request().url())?.[1]);
    if (size === NEAR_WINDOW_SIZE) {
      return route.fulfill({
        path: treeFixture("heights-near.png"),
        contentType: "image/png",
        headers: CORS,
      });
    }
    return route.fulfill({ body: patternHeights(size), contentType: "image/png", headers: CORS });
  });
}

/**
 * The two building tiles around the fixtures' house, cut down to the houses
 * near it (real OpenFreeMap footprints): the backyard can then be told from
 * the house. Elsewhere in Portland the tests have no buildings.
 */
export async function mockTreesHouseBuildings(page: Page): Promise<void> {
  await page.route(BUILDING_TILE_URL, (route) => {
    const match = BUILDING_TILE_URL.exec(route.request().url());
    const file = match && treeFixture(`buildings-14-${match[1]}-${match[2]}.pbf`);
    if (file && fs.existsSync(file)) {
      return route.fulfill({
        path: file,
        contentType: "application/vnd.mapbox-vector-tile",
        headers: CORS,
      });
    }
    return route.fallback();
  });
}

/** Record every request the Trees section could send: the city's records and the canopy heights. */
export function watchTreeSectionRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (CITY_TREE_URLS.some((pattern) => pattern.test(url)) || CANOPY_WINDOW_URL.test(url)) {
      requests.push(url);
    }
  });
  return requests;
}
