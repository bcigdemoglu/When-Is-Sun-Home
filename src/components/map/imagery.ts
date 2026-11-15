/**
 * Aerial photos under the map: the "Satellite" view.
 *
 * The photos are the U.S. Geological Survey's, from The National Map: public,
 * free, no key and no account. Two services are drawn together:
 *
 *  - the cached base (`USGSImageryOnly`): ordinary map tiles, answered in a
 *    fraction of a second, but only down to zoom 16 (about 2 m a pixel) —
 *    enough to show at once, too soft for a yard;
 *  - the detail (`USGSNAIPPlus`): the full photographs (0.3–0.6 m a pixel),
 *    cut to order by the server. A piece nobody has asked for lately takes
 *    anything from a second to half a minute, after which it is cached for
 *    hours. It is drawn over the base and sharpens the picture as it arrives.
 *
 * Both cover the United States only. (The detail service answers a fully
 * transparent picture elsewhere, the base nothing at all.)
 *
 * The detail service has slow spells in which its answers time out. MapLibre
 * never asks twice for a tile, so the detail pictures are fetched by our own
 * loader, which does (`loadImageryDetail`; SunMap registers it with MapLibre
 * under a scheme of its own, `usgs-detail://`).
 *
 * Some regions publish far sharper photos of their own, as ordinary cached
 * map tiles (`REGIONAL_IMAGERY`; so far Portland, Oregon: 5 cm a pixel). They
 * are drawn over the two national layers, and where they have photos all
 * over, the slow national detail is not asked for at all.
 */
import type { LatLng } from "@/lib/types";
import { OWN_LAYER_PREFIX } from "./mapData";
import { PLACE_PITCH } from "./pinMove";

// ─── The two sources ───────────────────────────────────────────────────────

export const IMAGERY_BASE_SOURCE_ID = `${OWN_LAYER_PREFIX}imagery-base`;
export const IMAGERY_DETAIL_SOURCE_ID = `${OWN_LAYER_PREFIX}imagery-detail`;
/** The scheme MapLibre asks for detail pictures under, so that they come through our loader. */
export const IMAGERY_DETAIL_PROTOCOL = "usgs-detail";

/** Credit shown on the map while the photos are (it names both services' publisher). */
export const IMAGERY_ATTRIBUTION =
  'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/**
 * The cached base: 256 px tiles that exist down to zoom 16 and are stretched
 * from there on.
 */
export const IMAGERY_BASE = {
  tiles: [
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
  ],
  tileSize: 256,
  maxzoom: 16,
};

/**
 * The detail: one 512 px picture per map tile, asked for by its bounds. Used
 * from map zoom 16 on, where the base runs out; the zoom-18 pictures are as
 * fine as the photographs themselves and are stretched for closer views.
 * `jpgpng` makes the server answer a transparent picture where it has
 * nothing, so the base (or the map) shows through instead of black.
 */
export const IMAGERY_DETAIL = {
  tiles: [
    `${IMAGERY_DETAIL_PROTOCOL}://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage` +
      "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image",
  ],
  tileSize: 512,
  minzoom: 16,
  maxzoom: 18,
};

// ─── Loading the pictures ourselves ────────────────────────────────────────
//
// MapLibre asks for every tile once and at once: sixteen requests together,
// no second try, and a tile that failed stays blurry until the map moves.
// The national detail times out in its slow spells, and a burst of a
// region's tiles can come back with some of them refused on the way
// ("503"; seen from a network behind a proxy) — so both are fetched by
// loaders of our own, which SunMap registers with MapLibre under schemes of
// their own.

/** The scheme MapLibre asks for a region's photos under (see `loadRegionalImagery`). */
export const IMAGERY_REGIONAL_PROTOCOL = "regional-photo";

/** The address a picture is really fetched from. */
export function imageryRequestUrl(url: string): string {
  for (const protocol of [IMAGERY_DETAIL_PROTOCOL, IMAGERY_REGIONAL_PROTOCOL]) {
    const scheme = `${protocol}://`;
    if (url.startsWith(scheme)) return `https://${url.slice(scheme.length)}`;
  }
  return url;
}

/**
 * How long to wait before asking again for a detail picture that failed:
 * twice, then the tile is given up (the base stays, and moving the map asks
 * anew). A failure is usually the server timing out after half a minute, or
 * a "bad gateway" at once; by the second or third time it has mostly done
 * the work.
 */
export const IMAGERY_RETRY_WAITS_MS: readonly number[] = [2_000, 10_000];

/** The wait before the next try after `failedAttempts` failures, or null to give up. */
export function imageryRetryWaitMs(failedAttempts: number): number | null {
  return IMAGERY_RETRY_WAITS_MS[failedAttempts - 1] ?? null;
}

/**
 * The same for a region's photo that was turned away. A good answer takes a
 * tenth of a second and a refusal comes at once, so the waits are short at
 * first; a refusal has meant "too many at a time", and waiting is the cure.
 */
export const REGIONAL_RETRY_WAITS_MS: readonly number[] = [300, 700, 1_500, 3_000, 6_000];

/** How many of a region's photos are asked for at the same time (what a browser allows one server). */
export const REGIONAL_PARALLEL_REQUESTS = 6;

export interface ImageryLoadOptions {
  /** Aborting (MapLibre does when the tile is no longer wanted) rejects at once. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Resolves after `ms`, or rejects as soon as `signal` aborts. */
  pause?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function pauseFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** "The server has no such picture": final, and nothing to tell anyone. */
export class NoSuchPictureError extends Error {
  /** MapLibre reads this: a 404 is an empty tile, not an error. */
  readonly status = 404;

  constructor() {
    super("There is no aerial photo of this tile");
    this.name = "NoSuchPictureError";
  }
}

/**
 * Fetch one picture, asking again after a failure for as long as `waits`
 * has another wait. A 404 is an answer, not a failure, where `missingIsFinal`.
 */
async function fetchPicture(
  address: string,
  waits: readonly number[],
  missingIsFinal: boolean,
  options: ImageryLoadOptions,
): Promise<{ data: ArrayBuffer }> {
  const { signal, fetchImpl = globalThis.fetch, pause = pauseFor } = options;
  for (let failedAttempts = 0; ;) {
    let problem: unknown;
    try {
      const response = await fetchImpl(address, { signal });
      if (response.ok) return { data: await response.arrayBuffer() };
      if (response.status === 404 && missingIsFinal) throw new NoSuchPictureError();
      problem = new Error(`The aerial photo service answered HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof NoSuchPictureError) throw error;
      problem = error;
    }
    if (signal?.aborted) throw abortError();
    failedAttempts++;
    const wait = waits[failedAttempts - 1];
    if (wait === undefined) throw problem;
    await pause(wait, signal);
  }
}

/**
 * Fetch one detail picture (`url` as MapLibre asks for it), trying again
 * after a failure as `imageryRetryWaitMs` says. Resolves with the picture's
 * bytes; rejects when every try failed, or with an AbortError when aborted.
 */
export function loadImageryDetail(
  url: string,
  options: ImageryLoadOptions = {},
): Promise<{ data: ArrayBuffer }> {
  return fetchPicture(imageryRequestUrl(url), IMAGERY_RETRY_WAITS_MS, false, options);
}

/**
 * Lets at most `limit` tasks run at a time; the rest wait their turn, first
 * come first served (MapLibre asks for the middle of the map first). A task
 * whose `signal` aborts while it waits is dropped with an AbortError.
 */
export function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  /** A finished task hands its place straight to the next in line, if any. */
  const release = () => {
    const start = waiting.shift();
    if (start) start();
    else running--;
  };
  return async function run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw abortError();
    if (running < limit) {
      running++;
    } else {
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const at = waiting.indexOf(start);
          if (at >= 0) waiting.splice(at, 1);
          reject(abortError());
        };
        waiting.push(start);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const regionalTurn = createLimiter(REGIONAL_PARALLEL_REQUESTS);

/**
 * Fetch one of a region's photos (`url` as MapLibre asks for it): a few at
 * a time, and again after being turned away. Rejects with a
 * `NoSuchPictureError` where the region has no photo (the national ones
 * then show), with the last problem when every try failed, or with an
 * AbortError when aborted.
 */
export function loadRegionalImagery(
  url: string,
  options: ImageryLoadOptions & { turn?: ReturnType<typeof createLimiter> } = {},
): Promise<{ data: ArrayBuffer }> {
  const { turn = regionalTurn, ...rest } = options;
  return turn(
    () => fetchPicture(imageryRequestUrl(url), REGIONAL_RETRY_WAITS_MS, true, rest),
    options.signal,
  );
}

// ─── Sharper photos of some regions ────────────────────────────────────────

/**
 * Where a regional service has photos ALL over: the fully covered tiles of
 * one coarse zoom level, as runs of columns (first to last, inclusive) per
 * tile row. Made by `scripts/imagery-coverage.mjs`.
 */
export interface ImageryCoverage {
  zoom: number;
  rows: Readonly<Record<number, readonly (readonly [number, number])[]>>;
}

/** A region's own aerial photos: cached map tiles, drawn over the national ones. */
export interface RegionalImagery {
  id: string;
  /** The map source (and layer) of these photos. */
  sourceId: string;
  /**
   * Ordinary `{z}/{x}/{y}` tile addresses: free, no key, no account. Under
   * the `regional-photo://` scheme, so that they come through our loader.
   */
  tiles: string[];
  tileSize: number;
  minzoom: number;
  /** The deepest level the service really has; closer views stretch it. */
  maxzoom: number;
  /** West, south, east, north: MapLibre asks for nothing outside. */
  bounds: [number, number, number, number];
  /** Credit shown on the map while these photos are drawn. */
  attribution: string;
  coverage: ImageryCoverage;
}

/**
 * City of Portland, Oregon: the summer 2025 flight, 7.5 cm web-mercator
 * pixels (about 5 cm on the ground) at zoom 21, the deepest level there is.
 * Portland, Beaverton, Hillsboro, Lake Oswego, Gresham; not Vancouver, WA.
 * Open data under the city's open-data ordinance (188356, 2017).
 *
 * The service answers a JPEG where a tile is all photo, a PNG with
 * transparent parts along the edge of the flight, and 404 beyond: wherever
 * it has nothing, the national photos underneath show.
 *
 * The coverage table: regenerate it when the flight changes, with
 *
 *   node scripts/imagery-coverage.mjs \
 *     "https://www.portlandmaps.com/arcgis/rest/services/Public/Aerial_Photos_Summer_2025/MapServer/tile/{z}/{y}/{x}" \
 *     -123.19,45.26,-122.32,45.67 14 --check 19,21
 */
const PORTLAND: RegionalImagery = {
  id: "portland",
  sourceId: `${OWN_LAYER_PREFIX}imagery-portland`,
  tiles: [
    `${IMAGERY_REGIONAL_PROTOCOL}://www.portlandmaps.com/arcgis/rest/services/Public/Aerial_Photos_Summer_2025/MapServer/tile/{z}/{y}/{x}`,
  ],
  tileSize: 256,
  minzoom: 13,
  maxzoom: 21,
  bounds: [-123.178, 45.272, -122.331, 45.665],
  attribution:
    'Aerial photos: <a href="https://www.portlandmaps.com" target="_blank" rel="noopener">City of Portland, summer 2025</a>',
  coverage: {
    zoom: 14,
    rows: {
      5851: [[2604, 2604]],
      5852: [[2604, 2606]],
      5853: [[2603, 2607]],
      5854: [[2602, 2614]],
      5855: [[2593, 2617]],
      5856: [[2593, 2620]],
      5857: [[2593, 2622]],
      5858: [[2587, 2622]],
      5859: [[2587, 2623]],
      5860: [[2587, 2623]],
      5861: [[2589, 2623]],
      5862: [[2593, 2623]],
      5863: [[2593, 2623]],
      5864: [[2594, 2623]],
      5865: [[2599, 2623]],
      5866: [[2599, 2621]],
      5867: [[2599, 2621]],
      5868: [[2599, 2614]],
      5869: [[2599, 2614]],
      5870: [[2599, 2614]],
      5871: [[2599, 2614]],
      5872: [
        [2599, 2600],
        [2603, 2605],
        [2609, 2614],
      ],
      5873: [
        [2603, 2605],
        [2610, 2615],
      ],
      5874: [
        [2603, 2605],
        [2613, 2615],
      ],
      5875: [
        [2604, 2604],
        [2614, 2615],
      ],
    },
  },
};

/** Every region with photos of its own. Adding one is an entry here (and its coverage table). */
export const REGIONAL_IMAGERY: readonly RegionalImagery[] = [PORTLAND];

/** How far outside a region's bounds the middle of the map may be for its photos still to be drawn, degrees. */
const REGION_REACH_DEG = 0.1;

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The column and row of the tile a spot lies in, at `zoom`. */
function tileOf(spot: LatLng, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const phi = (Math.max(-85.0511, Math.min(85.0511, spot.lat)) * Math.PI) / 180;
  return {
    x: Math.floor(((wrapLng(spot.lng) + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n),
  };
}

/** Is this tile of the coverage table's zoom level all photo? */
export function isFullyCoveredTile(coverage: ImageryCoverage, x: number, y: number): boolean {
  return (coverage.rows[y] ?? []).some(([from, to]) => x >= from && x <= to);
}

/**
 * Does the region have photos all around this spot: in the coarse tile it
 * lies in AND in the eight around that one? Then whatever the map shows
 * with this spot in the middle is covered (a coarse tile is wider than the
 * map is at any zoom the national detail is drawn at).
 */
export function regionCoversAround(region: RegionalImagery, spot: LatLng): boolean {
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return false;
  const { coverage } = region;
  const { x, y } = tileOf(spot, coverage.zoom);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isFullyCoveredTile(coverage, x + dx, y + dy)) return false;
    }
  }
  return true;
}

/**
 * The region whose photos to draw with the map centred here: the one whose
 * bounds the spot is in, or just outside of. (MapLibre asks for no tile
 * beyond the bounds anyway; this keeps a region's credit off the map of
 * another city.)
 */
export function regionalImageryAt(center: LatLng): RegionalImagery | null {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  const lng = wrapLng(center.lng);
  return (
    REGIONAL_IMAGERY.find(
      ({ bounds: [west, south, east, north] }) =>
        lng >= west - REGION_REACH_DEG &&
        lng <= east + REGION_REACH_DEG &&
        center.lat >= south - REGION_REACH_DEG &&
        center.lat <= north + REGION_REACH_DEG,
    ) ?? null
  );
}

/**
 * Must the slow national detail be asked for, with the map centred here?
 * Not where a region's own photos cover everything in view.
 */
export function needsImageryDetail(center: LatLng): boolean {
  return !REGIONAL_IMAGERY.some((region) => regionCoversAround(region, center));
}

// ─── Where there are photos ────────────────────────────────────────────────

interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

/**
 * Where the photos reach, as generous boxes: no place in the United States
 * may fall outside, so the boxes take in some of Canada, Mexico and the sea.
 * (The detail service was checked to answer real pictures in each of them.)
 */
const AERIAL_PHOTO_BOXES: readonly Box[] = [
  // The lower 48 states, in two pieces: east of Florida the coast only begins
  // at the Carolinas (south of there lie the Bahamas).
  { south: 24.4, north: 49.4, west: -125, east: -79.9 },
  { south: 33, north: 49.4, west: -79.9, east: -66.9 },
  // Alaska, to the end of the Aleutians this side of the date line.
  { south: 51, north: 71.5, west: -180, east: -129.9 },
  // Hawaii.
  { south: 18.8, north: 22.4, west: -160.4, east: -154.7 },
  // Puerto Rico and the U.S. Virgin Islands.
  { south: 17.6, north: 18.6, west: -67.4, east: -64.5 },
  // Guam.
  { south: 13.2, north: 13.7, west: 144.6, east: 145 },
];

/** Are there aerial photos of this spot? */
export function hasAerialPhotos(spot: LatLng): boolean {
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return false;
  // Longitudes may come unwrapped from a map that was dragged round the world.
  const lng = wrapLng(spot.lng);
  return AERIAL_PHOTO_BOXES.some(
    (box) => spot.lat >= box.south && spot.lat <= box.north && lng >= box.west && lng <= box.east,
  );
}

/** What a person is told when they ask for photos where there are none. */
export const NO_AERIAL_PHOTOS_MESSAGE = "Aerial photos are only available in the United States.";

/**
 * Should the map draw the photos? Only when the person chose them AND there
 * are any where they are looking: at the pinned place, or with no pin, at
 * the middle of the map. A choice remembered from another day never turns a
 * place outside the United States into a blank map.
 */
export function showsImagery(
  satellite: boolean,
  place: LatLng | null,
  center: LatLng | null,
): boolean {
  if (!satellite) return false;
  const spot = place ?? center;
  return spot !== null && hasAerialPhotos(spot);
}

/**
 * The tilt the camera should rest at: flat over the photos (they are taken
 * from straight above), else the person's own 2D / 3D choice.
 */
export function cameraPitch(wantsTilt: boolean, imagery: boolean): number {
  return wantsTilt && !imagery ? PLACE_PITCH : 0;
}
