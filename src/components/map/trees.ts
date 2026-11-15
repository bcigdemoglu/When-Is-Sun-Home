/**
 * The "Trees" layer: measured tree heights drawn on the map. Its rules.
 *
 * The heights are the Oregon Department of Geology and Mineral Industries'
 * (DOGAMI) airborne laser surveys: public, free, no key and no account, and
 * open to browsers. The state serves them as one mosaic of "canopy" height
 * (the top of whatever stands on the ground, in feet, 3 ft a pixel), cut to
 * order: one picture per map tile, asked for by its bounds.
 *
 * What a person should know, and the app says where it shows the layer:
 *
 *  - It is Oregon only (and a strip of Washington along the Columbia).
 *  - Each area was flown once, in some year between 2002 and 2020 (Portland:
 *    summer 2014). A tree planted or felled since is not as drawn.
 *  - The survey measures tops, not trees: buildings are cut out by the
 *    footprints the sun computation uses (`treeRaster.ts`), but a shed that
 *    is on no map, or a building gone since, is drawn as a tree.
 *  - The trees are NOT part of the sun hours. The layer is a picture.
 *
 * The pictures come through a loader of our own (`treeTiles.ts`; SunMap
 * registers it with MapLibre under the scheme `tree-heights://`), which
 * fetches the heights and the buildings, asks again when the state's server
 * fails, and turns the two into the picture that is drawn.
 */
import type { LatLng } from "@/lib/types";
import { OWN_LAYER_PREFIX } from "./mapData";
import { TREE_CLASS_MIN_FT } from "./treeRaster";

// ─── The source ────────────────────────────────────────────────────────────

export const TREES_SOURCE_ID = `${OWN_LAYER_PREFIX}trees`;
/** The scheme MapLibre asks for tree pictures under, so that they come through our loader. */
export const TREES_PROTOCOL = "tree-heights";

/** Credit shown on the map while the trees are drawn. */
export const TREES_ATTRIBUTION =
  'Tree heights: <a href="https://www.oregon.gov/dogami/lidar/Pages/index.aspx" target="_blank" rel="noopener">Oregon DOGAMI lidar</a>';

/** The state's canopy-height mosaic (an ArcGIS image service). */
export const TREE_HEIGHTS_SERVICE =
  "https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/CANOPY_HEIGHT_MODEL_MOSAIC/ImageServer";

/** One picture per map tile, this many pixels wide and high. */
export const TREE_TILE_SIZE = 512;
/**
 * Trees are drawn from this zoom on: the level of the building tiles, so
 * that each picture needs exactly one of them to cut the buildings out.
 */
export const TREE_MIN_ZOOM = 14;
/**
 * The deepest level asked for: a zoom-16 pixel is 0.84 m on the ground in
 * Oregon, as fine as the survey's own 3 ft. Closer views stretch it.
 */
export const TREE_MAX_ZOOM = 16;

/**
 * How the trees are coloured: over the drawn map (by colour scheme) or over
 * a photo. Part of a picture's address, so that a change of look asks for
 * the pictures anew (the heights then come from the browser's cache).
 */
export type TreeLook = "map-light" | "map-dark" | "photo";

const TREE_LOOKS: readonly TreeLook[] = ["map-light", "map-dark", "photo"];

/** The look for what the map is showing. */
export function treeLook(imagery: boolean, isDark: boolean): TreeLook {
  return imagery ? "photo" : isDark ? "map-dark" : "map-light";
}

/** The tile addresses MapLibre is given: ours, to be read by `parseTreeTileUrl`. */
export function treeTileTemplate(look: TreeLook): string {
  return `${TREES_PROTOCOL}://heights/{z}/{x}/{y}?look=${look}`;
}

export interface TreeTileRequest {
  z: number;
  x: number;
  y: number;
  look: TreeLook;
}

/** What MapLibre is asking for, or null for an address that is not one of ours. */
export function parseTreeTileUrl(url: string): TreeTileRequest | null {
  const match = /^tree-heights:\/\/heights\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\?look=([a-z-]+)$/.exec(
    url,
  );
  if (!match) return null;
  const [z, x, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const look = TREE_LOOKS.find((candidate) => candidate === match[4]);
  if (!look || z > 22 || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y, look };
}

/** Half the width of the web-mercator world, metres. */
const MERCATOR_HALF_WORLD_M = 20037508.342789244;

/** The bounds of a map tile in web-mercator metres: west, south, east, north. */
export function tileBoundsMercator(tile: {
  z: number;
  x: number;
  y: number;
}): [number, number, number, number] {
  const width = (2 * MERCATOR_HALF_WORLD_M) / 2 ** tile.z;
  return [
    tile.x * width - MERCATOR_HALF_WORLD_M,
    MERCATOR_HALF_WORLD_M - (tile.y + 1) * width,
    (tile.x + 1) * width - MERCATOR_HALF_WORLD_M,
    MERCATOR_HALF_WORLD_M - tile.y * width,
  ];
}

/**
 * Where the heights of one map tile are fetched from: a `TREE_TILE_SIZE` px
 * PNG whose red channel is the height in whole feet (255 = that or more) and
 * whose alpha is 0 where the survey has nothing. (`png32`, not the smaller
 * one-channel `png`: it is the flavour the app's own bit-exact decoder
 * reads, off the main thread and without a canvas.) Nearest-neighbour: a
 * height must not be averaged with the ground beside it.
 */
export function treeHeightsUrl(tile: { z: number; x: number; y: number }): string {
  const bbox = tileBoundsMercator(tile)
    .map((value) => value.toFixed(3))
    .join(",");
  return (
    `${TREE_HEIGHTS_SERVICE}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857` +
    `&size=${TREE_TILE_SIZE},${TREE_TILE_SIZE}&format=png32&pixelType=U8` +
    "&interpolation=RSP_NearestNeighbor&f=image"
  );
}

/**
 * How long to wait before asking again for a picture that failed: twice,
 * then the tile is given up without a word (moving the map asks anew). The
 * state's server answers in a second or two when it is well.
 */
export const TREE_RETRY_WAITS_MS: readonly number[] = [2_000, 10_000];

// ─── Where there are tree heights ──────────────────────────────────────────

/**
 * Oregon, generously: west, south, east, north. No place in the state may
 * fall outside, so the box takes in the sea, a strip of its neighbours and
 * the Washington bank of the Columbia (which the surveys do cover).
 * MapLibre asks for no picture beyond it.
 */
export const TREES_BOUNDS: [number, number, number, number] = [-124.8, 41.9, -116.3, 46.4];

/** Are there (or may there be) tree heights for this spot? */
export function hasTreeHeights(spot: LatLng): boolean {
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return false;
  // Longitudes may come unwrapped from a map that was dragged round the world.
  const lng = ((((spot.lng + 180) % 360) + 360) % 360) - 180;
  const [west, south, east, north] = TREES_BOUNDS;
  return spot.lat >= south && spot.lat <= north && lng >= west && lng <= east;
}

/**
 * Should the map draw the trees? Only when the person switched them on AND
 * there can be any where they are looking: at the pinned place, or with no
 * pin, at the middle of the map.
 */
export function showsTrees(wanted: boolean, place: LatLng | null, center: LatLng | null): boolean {
  if (!wanted) return false;
  const spot = place ?? center;
  return spot !== null && hasTreeHeights(spot);
}

// ─── What the switch says ──────────────────────────────────────────────────

export const TREES_SWITCH_LABEL = "Trees";
/** Under the switch, where the layer can be drawn. */
export const TREES_SWITCH_HINT = "Measured tree heights, Oregon only. Not counted in the sun hours";
/** Under the switch, anywhere else. */
export const TREES_ELSEWHERE_HINT =
  "Tree heights are only available in Oregon. Not counted in the sun hours";

/** The line under the Trees switch, for the pinned place. */
export function treesSwitchHint(place: LatLng | null): string {
  return place !== null && !hasTreeHeights(place) ? TREES_ELSEWHERE_HINT : TREES_SWITCH_HINT;
}

// ─── The legend ────────────────────────────────────────────────────────────

export const TREE_LEGEND_TITLE = "Tree height";

/** The height classes as the legend names them, lowest first: where each begins, in feet. */
export const TREE_LEGEND_LABELS: readonly string[] = TREE_CLASS_MIN_FT.map((feet, i) =>
  i === TREE_CLASS_MIN_FT.length - 1 ? `${feet}+` : String(feet),
);

/** The same for a screen reader: "10 to 20 feet", …, "100 feet and more". */
export const TREE_LEGEND_RANGES: readonly string[] = TREE_CLASS_MIN_FT.map((feet, i) => {
  const next = TREE_CLASS_MIN_FT[i + 1];
  return next === undefined ? `${feet} feet and more` : `${feet} to ${next} feet`;
});

/** The laser survey a place's heights come from. */
export interface TreeSurvey {
  /** The year it was flown. */
  year: number;
  /** Its name, e.g. "OLC Metro"; empty when the service gives none. */
  name: string;
}

/**
 * Where to ask which survey the heights at a spot come from: one small
 * request (about 2 kB) to the same service.
 */
export function treeSurveyUrl(spot: LatLng): string {
  const geometry = JSON.stringify({
    x: Number(spot.lng.toFixed(5)),
    y: Number(spot.lat.toFixed(5)),
    spatialReference: { wkid: 4326 },
  });
  return (
    `${TREE_HEIGHTS_SERVICE}/identify?geometry=${encodeURIComponent(geometry)}` +
    "&geometryType=esriGeometryPoint&returnCatalogItems=true&returnGeometry=false&f=json"
  );
}

/** Short words that stay as they are in a survey's name: OLC, ODF, 3DEP. */
const keepsCapitals = (word: string) => word.length <= 3 || /\d/.test(word);
/** The little words of a name ("Hood to Coast"). */
const LITTLE_WORDS = new Set(["TO", "OF", "AND", "THE"]);

function surveyWord(word: string): string {
  const upper = word.toUpperCase();
  if (LITTLE_WORDS.has(upper)) return upper.toLowerCase();
  return keepsCapitals(word) ? upper : upper[0] + upper.slice(1).toLowerCase();
}

/**
 * A survey from the name of its picture in the mosaic, such as
 * "OLC_METRO_2014_CANOPY_OGIC_2011": the words before the year are the
 * project ("OLC Metro"), the first year is when it was flown. Null for a
 * name without a believable year.
 */
export function surveyFromName(
  name: string,
  thisYear = new Date().getFullYear(),
): TreeSurvey | null {
  const words = name.split("_").filter((word) => word.length > 0);
  const at = words.findIndex((word) => /^(19|20)\d\d$/.test(word));
  if (at < 0) return null;
  const year = Number(words[at]);
  if (year < 1995 || year > thisYear) return null;
  const project = words.slice(0, at).map(surveyWord).join(" ");
  return { year, name: project };
}

/**
 * The survey in the service's answer to `treeSurveyUrl`: the one picture of
 * the mosaic that is on top at the spot. Null where it has none, and for an
 * answer that is not what was expected.
 */
export function surveyFromIdentify(answer: unknown, thisYear?: number): TreeSurvey | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { catalogItems, catalogItemVisibilities } = answer as {
    catalogItems?: { features?: unknown };
    catalogItemVisibilities?: unknown;
  };
  const features = catalogItems?.features;
  if (!Array.isArray(features) || !Array.isArray(catalogItemVisibilities)) return null;
  for (let i = 0; i < features.length; i++) {
    if (!(Number(catalogItemVisibilities[i]) > 0)) continue;
    const name = (features[i] as { attributes?: { Name?: unknown } } | null)?.attributes?.Name;
    if (typeof name !== "string") continue;
    const survey = surveyFromName(name, thisYear);
    if (survey) return survey;
  }
  return null;
}

/**
 * The legend's last line, how old the heights are, in the two pieces it may
 * break into in a narrow box: what kind of data and from when, then (if the
 * service names it) the survey.
 */
export function treeSurveyWords(survey: TreeSurvey | null): [string, string | null] {
  if (!survey) return ["Laser surveys; the year varies by area", null];
  return [`Laser survey, ${survey.year}`, survey.name ? `(${survey.name})` : null];
}

/** The same as one line of text. */
export function treeSurveyLine(survey: TreeSurvey | null): string {
  return treeSurveyWords(survey)
    .filter((part) => part !== null)
    .join(" ");
}
