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

// ─── Loading the detail ────────────────────────────────────────────────────

/** The address a detail picture is really fetched from. */
export function imageryDetailUrl(url: string): string {
  const scheme = `${IMAGERY_DETAIL_PROTOCOL}://`;
  return url.startsWith(scheme) ? `https://${url.slice(scheme.length)}` : url;
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

/**
 * Fetch one detail picture (`url` as MapLibre asks for it), trying again
 * after a failure as `imageryRetryWaitMs` says. Resolves with the picture's
 * bytes; rejects when every try failed, or with an AbortError when aborted.
 */
export async function loadImageryDetail(
  url: string,
  options: ImageryLoadOptions = {},
): Promise<{ data: ArrayBuffer }> {
  const { signal, fetchImpl = globalThis.fetch, pause = pauseFor } = options;
  const address = imageryDetailUrl(url);
  for (let failedAttempts = 0; ;) {
    let problem: unknown;
    try {
      const response = await fetchImpl(address, { signal });
      if (response.ok) return { data: await response.arrayBuffer() };
      problem = new Error(`The aerial photo service answered HTTP ${response.status}`);
    } catch (error) {
      problem = error;
    }
    if (signal?.aborted) throw abortError();
    failedAttempts++;
    const wait = imageryRetryWaitMs(failedAttempts);
    if (wait === null) throw problem;
    await pause(wait, signal);
  }
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
  const lng = ((((spot.lng + 180) % 360) + 360) % 360) - 180;
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
