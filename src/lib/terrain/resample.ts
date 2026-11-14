/**
 * Turning decoded elevation tiles into an {@link ElevationGrid} in local
 * metres (pure; no I/O).
 */
import { metersPerDegree, wrapLngDelta } from "@/lib/geo/local";
import type { ElevationGrid, LatLng } from "@/lib/types";

import { latToTileY, lngToTileX, tileYToLat, type TileBlock } from "./tiles";

/** The tiles of a block stitched into one raster, row 0 = north. */
export interface TileMosaic {
  block: TileBlock;
  /** Pixels per tile edge. */
  tileSize: number;
  /** Raster size in pixels. */
  width: number;
  height: number;
  /** Elevation of every pixel, metres; index = pixelRow · width + pixelCol. */
  elevations: Float32Array;
}

/**
 * Stitch per-tile elevation rasters (each `tileSize²`, row 0 = north) into one
 * mosaic. `tiles` must be in the order of `tilesOf(block)`: row by row from
 * the north-west.
 */
export function buildMosaic(
  block: TileBlock,
  tiles: ArrayLike<ArrayLike<number>>,
  tileSize: number,
): TileMosaic {
  if (tiles.length !== block.cols * block.rows) {
    throw new RangeError(
      `buildMosaic: expected ${block.cols * block.rows} tiles, got ${tiles.length}`,
    );
  }
  const width = block.cols * tileSize;
  const height = block.rows * tileSize;
  const elevations = new Float32Array(width * height);
  for (let tileRow = 0; tileRow < block.rows; tileRow++) {
    for (let tileCol = 0; tileCol < block.cols; tileCol++) {
      const tile = tiles[tileRow * block.cols + tileCol];
      if (tile.length !== tileSize * tileSize) {
        throw new RangeError(
          `buildMosaic: tile has ${tile.length} pixels, expected ${tileSize * tileSize}`,
        );
      }
      for (let y = 0; y < tileSize; y++) {
        const target = (tileRow * tileSize + y) * width + tileCol * tileSize;
        for (let x = 0; x < tileSize; x++) elevations[target + x] = tile[y * tileSize + x];
      }
    }
  }
  return { block, tileSize, width, height, elevations };
}

/**
 * Resample a mosaic onto a regular grid of local metres around `origin`.
 *
 * The grid covers the whole mosaic (a longitude/latitude rectangle is an
 * exact rectangle in the local frame) with square cells of `cellSizeM`
 * — by default the ground size of one mosaic pixel at the origin's latitude.
 * Each node is interpolated bilinearly between the four nearest pixel CENTRES;
 * Web Mercator's uneven spacing in latitude is handled exactly.
 */
export function resampleMosaic(
  mosaic: TileMosaic,
  origin: LatLng,
  cellSizeM?: number,
): ElevationGrid {
  const { block, tileSize, width: pixelsWide, height: pixelsHigh, elevations } = mosaic;
  const { zoom } = block;
  const scale = metersPerDegree(origin.lat);
  const tilesAround = 2 ** zoom;

  // Mosaic pixel coordinates of a longitude / latitude: 0 at the west / north
  // edge of the mosaic; pixel i has its centre at i + 0.5.
  const pixelsPerDegLng = (tilesAround * tileSize) / 360;
  // The block's first column is not wrapped (it can be -1 for a block that
  // straddles the antimeridian), so bring the origin's pixel x into [0, world).
  const worldPixels = tilesAround * tileSize;
  const rawOriginPixelX = (lngToTileX(origin.lng, zoom) - block.x0) * tileSize;
  const unwrappedOriginPixelX = ((rawOriginPixelX % worldPixels) + worldPixels) % worldPixels;
  const pixelXOf = (lng: number) =>
    unwrappedOriginPixelX + wrapLngDelta(lng - origin.lng) * pixelsPerDegLng;
  const pixelYOf = (lat: number) => (latToTileY(lat, zoom) - block.y0) * tileSize;

  // Bounds of the mosaic in local metres.
  const westX = ((0 - unwrappedOriginPixelX) / pixelsPerDegLng) * scale.lng;
  const eastX = ((pixelsWide - unwrappedOriginPixelX) / pixelsPerDegLng) * scale.lng;
  const northY = (tileYToLat(block.y0, zoom) - origin.lat) * scale.lat;
  const southY = (tileYToLat(block.y0 + block.rows, zoom) - origin.lat) * scale.lat;

  const cell = cellSizeM ?? (eastX - westX) / pixelsWide;
  if (!(cell > 0) || !Number.isFinite(cell)) {
    throw new RangeError(`resampleMosaic: invalid cell size ${cell}`);
  }
  // As many nodes as fit, centred in the mosaic.
  const width = Math.floor((eastX - westX) / cell) + 1;
  const height = Math.floor((northY - southY) / cell) + 1;
  const minX = westX + (eastX - westX - (width - 1) * cell) / 2;
  const minY = southY + (northY - southY - (height - 1) * cell) / 2;

  // The mapping is separable: a column fixes the pixel x, a row the pixel y.
  const colPixel = new Int32Array(width);
  const colFraction = new Float64Array(width);
  for (let col = 0; col < width; col++) {
    const lng = origin.lng + (minX + col * cell) / scale.lng;
    const p = Math.min(pixelsWide - 1, Math.max(0, pixelXOf(lng) - 0.5));
    const i = Math.min(pixelsWide - 2, Math.floor(p));
    colPixel[col] = i;
    colFraction[col] = p - i;
  }

  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = origin.lat + (minY + row * cell) / scale.lat;
    const p = Math.min(pixelsHigh - 1, Math.max(0, pixelYOf(lat) - 0.5));
    const j = Math.min(pixelsHigh - 2, Math.floor(p));
    const fy = p - j;
    const upper = j * pixelsWide;
    const lower = upper + pixelsWide;
    for (let col = 0; col < width; col++) {
      const i = colPixel[col];
      const fx = colFraction[col];
      const top = elevations[upper + i] + (elevations[upper + i + 1] - elevations[upper + i]) * fx;
      const bottom =
        elevations[lower + i] + (elevations[lower + i + 1] - elevations[lower + i]) * fx;
      data[row * width + col] = top + (bottom - top) * fy;
    }
  }

  return {
    origin: { lat: origin.lat, lng: origin.lng },
    cellSizeM: cell,
    width,
    height,
    minX,
    minY,
    data,
  };
}
