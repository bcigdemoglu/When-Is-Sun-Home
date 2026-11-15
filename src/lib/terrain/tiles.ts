/**
 * Which elevation tiles to fetch for a place (pure tile maths, no I/O).
 *
 * Elevation comes from the "Terrarium" tile set of the AWS Open Data
 * "Terrain Tiles" (Mapzen) dataset: standard Web-Mercator XYZ tiles, 256 px.
 *
 * For a place we take two blocks of tiles:
 *  - NEAR, 2 × 2: the finest zoom whose tiles are still at least 1.2 km wide
 *    on the ground (z14 at mid latitudes, ~5–10 m per pixel). The block is the
 *    four tiles around the tile CORNER nearest to the place, so the place
 *    always has at least half a tile (≥ 600 m) of data on every side.
 *  - FAR, 3 × 3: the finest zoom whose tiles are at least 8 km wide (z11 at
 *    mid latitudes, ~30–60 m per pixel): the tile containing the near block's
 *    centre and its eight neighbours — at least 6.8 km, and typically 10–25 km,
 *    of data in every direction from the place.
 *
 * Thirteen tiles in all (about 1 MB). Both blocks depend only on which near
 * tile corner is nearest, so moving the pin by a few hundred metres re-uses
 * the same tiles — and the same {@link TerrainCoverage.key}.
 */
import type { LatLng } from "@/lib/types";

export const TERRARIUM_TILE_SIZE = 256;
/** Deepest zoom the Terrarium tile set offers. */
export const TERRARIUM_MAX_ZOOM = 15;
/** `{z}/{x}/{y}` template. Served with `Access-Control-Allow-Origin: *`. */
export const TERRARIUM_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Bump when the tile selection or grid layout changes (it is part of the key). */
export const TERRAIN_SCHEMA_VERSION = 1;
/** Web Mercator cannot represent the poles; no terrain is offered beyond this. */
export const TERRAIN_MAX_LAT = 84;

/** Equatorial circumference of the Web-Mercator sphere, metres. */
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_378_137;
const NEAR_MIN_TILE_M = 1_200;
const FAR_MIN_TILE_M = 8_000;
const DEG_TO_RAD = Math.PI / 180;

/** Fractional tile column of a longitude at `zoom`, in [0, 2^zoom). */
export function lngToTileX(lng: number, zoom: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) / 360;
  return wrapped * 2 ** zoom;
}

/** Fractional tile row (0 = north edge of the map) of a latitude at `zoom`. */
export function latToTileY(lat: number, zoom: number): number {
  const phi = lat * DEG_TO_RAD;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom;
}

/** Longitude of a (fractional) tile column, in [-180, 180]. */
export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

/** Latitude of a (fractional) tile row. */
export function tileYToLat(y: number, zoom: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) / DEG_TO_RAD;
}

/** Width on the ground of one tile at `zoom` and latitude `lat`, metres. */
export function tileGroundWidthM(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG_TO_RAD)) / 2 ** zoom;
}

/** A rectangle of whole tiles at one zoom level. */
export interface TileBlock {
  zoom: number;
  /**
   * Column of the westernmost tiles. NOT wrapped: -1 or 2^zoom can occur for
   * a block straddling the antimeridian (see {@link tilesOf}).
   */
  x0: number;
  /** Row of the northernmost tiles. */
  y0: number;
  cols: number;
  rows: number;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** The tiles of a block, row by row from the north-west, with columns wrapped. */
export function tilesOf(block: TileBlock): TileId[] {
  const n = 2 ** block.zoom;
  const tiles: TileId[] = [];
  for (let row = 0; row < block.rows; row++) {
    for (let col = 0; col < block.cols; col++) {
      tiles.push({ z: block.zoom, x: (((block.x0 + col) % n) + n) % n, y: block.y0 + row });
    }
  }
  return tiles;
}

export function tileUrl(tile: TileId, template: string = TERRARIUM_URL_TEMPLATE): string {
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}

export interface TerrainCoverage {
  /** Stable identifier of this set of tiles, e.g. "v1:14/2621/6332". Also the cache key. */
  key: string;
  /**
   * Origin of the local-metre frame both elevation grids are built in: the
   * centre of the near block (a tile corner).
   */
  origin: LatLng;
  near: TileBlock;
  far: TileBlock;
}

/** Deepest zoom (≤ `maxZoom`) at which a tile is still at least `minTileM` wide. */
function zoomForTileWidth(lat: number, minTileM: number, maxZoom: number): number {
  const exact = Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG_TO_RAD)) / minTileM);
  return Math.max(0, Math.min(maxZoom, Math.floor(exact)));
}

/** The 2 × 2 block around the tile corner nearest to a point. */
function blockAroundCorner(
  lat: number,
  lng: number,
  zoom: number,
): { block: TileBlock; center: LatLng } {
  const n = 2 ** zoom;
  // Nearest corner; keep one whole row of tiles on either side of it.
  const cornerX = Math.round(lngToTileX(lng, zoom));
  const cornerY = Math.max(1, Math.min(n - 1, Math.round(latToTileY(lat, zoom))));
  return {
    block: { zoom, x0: cornerX - 1, y0: cornerY - 1, cols: 2, rows: 2 },
    center: { lat: tileYToLat(cornerY, zoom), lng: tileXToLng(cornerX % n, zoom) },
  };
}

/** The 3 × 3 block centred on the tile containing a point. */
function blockAroundTile(lat: number, lng: number, zoom: number): TileBlock {
  const n = 2 ** zoom;
  const tileX = Math.min(n - 1, Math.floor(lngToTileX(lng, zoom)));
  const tileY = Math.min(n - 1, Math.max(0, Math.floor(latToTileY(lat, zoom))));
  // Columns wrap around the antimeridian; rows stop at the edge of the map.
  const y0 = Math.max(0, Math.min(n - 3, tileY - 1));
  return { zoom, x0: tileX - 1, y0, cols: 3, rows: 3 };
}

/**
 * The tiles covering a place, or `null` where no terrain is offered
 * (non-finite coordinates, or within 6° of a pole).
 */
export function terrainCoverageFor(place: LatLng): TerrainCoverage | null {
  const { lat, lng } = place;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > TERRAIN_MAX_LAT)
    return null;

  const nearZoom = zoomForTileWidth(lat, NEAR_MIN_TILE_M, TERRARIUM_MAX_ZOOM);
  const near = blockAroundCorner(lat, lng, nearZoom);
  // The far block hangs off the near block's centre (not the pin), so the
  // whole coverage is a function of the near corner alone. (Zoom ≥ 2 keeps a
  // 3 × 3 block from wrapping onto itself.)
  const farZoom = Math.max(2, zoomForTileWidth(near.center.lat, FAR_MIN_TILE_M, nearZoom));
  const far = blockAroundTile(near.center.lat, near.center.lng, farZoom);

  const n = 2 ** nearZoom;
  const cornerX = (((near.block.x0 + 1) % n) + n) % n;
  return {
    key: `v${TERRAIN_SCHEMA_VERSION}:${nearZoom}/${cornerX}/${near.block.y0 + 1}`,
    origin: near.center,
    near: near.block,
    far,
  };
}
