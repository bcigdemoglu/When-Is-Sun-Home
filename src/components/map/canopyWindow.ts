/**
 * A "canopy window": a square of the state's canopy-height mosaic around a
 * place, cut on the same pixel grid as the Trees layer's map tiles (web
 * mercator, 512 px a tile at zoom `z`), but centred where it is needed rather
 * than on a tile. Its building footprints come from the very building tiles
 * the map layer cuts its pictures with, so the report and the map agree.
 *
 * Pure geometry: addresses, frames and pixel positions; no network.
 */
import { BUILDING_TILE_ZOOM } from "@/lib/buildings/vectorTiles";
import type { LatLng } from "@/lib/types";
import type { PixelFrame } from "./treeRaster";
import { TREE_HEIGHTS_SERVICE } from "./trees";

/** Pixels across one map tile, as the Trees layer cuts them. */
const TILE_PX = 512;
const MERCATOR_HALF_WORLD_M = 20037508.342789244;
/** The equator's length, metres (WGS84). */
const EQUATOR_M = 40075016.686;

export interface CanopyWindow {
  /** The zoom whose pixel grid it is on: 16 is 0.84 m a pixel in Oregon. */
  z: number;
  /** Its top-left pixel on that zoom's world grid. */
  x0: number;
  y0: number;
  /** Pixels across (it is square). */
  size: number;
}

const worldPx = (z: number) => TILE_PX * 2 ** z;

/** A position on zoom `z`'s world pixel grid (fractional). */
export function worldPixel(spot: LatLng, z: number): { x: number; y: number } {
  const phi = (spot.lat * Math.PI) / 180;
  const across = worldPx(z);
  return {
    x: ((spot.lng + 180) / 360) * across,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * across,
  };
}

/** The window of `size` px on zoom `z` centred on a spot. */
export function windowAround(spot: LatLng, z: number, size: number): CanopyWindow {
  const { x, y } = worldPixel(spot, z);
  return { z, x0: Math.round(x - size / 2), y0: Math.round(y - size / 2), size };
}

/**
 * The finest window (zoom `maxZoom` down to `minZoom`) that holds a box of
 * positions in at most `maxSize` px; null when even `minZoom` cannot.
 */
export function windowAroundBounds(
  points: readonly LatLng[],
  { maxSize, maxZoom, minZoom }: { maxSize: number; maxZoom: number; minZoom: number },
): CanopyWindow | null {
  if (points.length === 0) return null;
  for (let z = maxZoom; z >= minZoom; z--) {
    const pixels = points.map((point) => worldPixel(point, z));
    const xs = pixels.map((p) => p.x);
    const ys = pixels.map((p) => p.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    const size = Math.ceil(Math.max(right - left, bottom - top)) + 4;
    if (size > maxSize) continue;
    return {
      z,
      x0: Math.floor((left + right) / 2 - size / 2),
      y0: Math.floor((top + bottom) / 2 - size / 2),
      size,
    };
  }
  return null;
}

/** Where a spot falls in the window, in pixels from its top-left corner (fractional). */
export function windowPixel(window: CanopyWindow, spot: LatLng): { x: number; y: number } {
  const { x, y } = worldPixel(spot, window.z);
  return { x: x - window.x0, y: y - window.y0 };
}

/** Metres on the ground of one pixel of the window, at its middle. */
export function metresPerPixel(window: CanopyWindow): number {
  const across = worldPx(window.z);
  const middleY = window.y0 + window.size / 2;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * middleY) / across)));
  return (EQUATOR_M * Math.cos(lat)) / across;
}

/** The window's bounds in web-mercator metres: west, south, east, north. */
export function windowBoundsMercator(window: CanopyWindow): [number, number, number, number] {
  const metres = (2 * MERCATOR_HALF_WORLD_M) / worldPx(window.z);
  return [
    window.x0 * metres - MERCATOR_HALF_WORLD_M,
    MERCATOR_HALF_WORLD_M - (window.y0 + window.size) * metres,
    (window.x0 + window.size) * metres - MERCATOR_HALF_WORLD_M,
    MERCATOR_HALF_WORLD_M - window.y0 * metres,
  ];
}

/**
 * Where the heights of a window are fetched from: the same service and the
 * same kind of picture as the map layer's (`treeHeightsUrl`), its own bounds
 * and size.
 */
export function canopyWindowUrl(window: CanopyWindow): string {
  const bbox = windowBoundsMercator(window)
    .map((value) => value.toFixed(3))
    .join(",");
  return (
    `${TREE_HEIGHTS_SERVICE}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857` +
    `&size=${window.size},${window.size}&format=png32&pixelType=U8` +
    "&interpolation=RSP_NearestNeighbor&f=image"
  );
}

/** A building tile that overlaps a window, and how its footprints land on the window's pixels. */
export interface WindowBuildingTile {
  tile: { z: number; x: number; y: number };
  frame: PixelFrame;
}

/** Every building tile (zoom `BUILDING_TILE_ZOOM`) the window overlaps, with its frame. */
export function buildingTilesOfWindow(
  window: CanopyWindow,
  buildingZoom = BUILDING_TILE_ZOOM,
): WindowBuildingTile[] {
  // One building tile spans this many of the window's pixels.
  const span = TILE_PX * 2 ** (window.z - buildingZoom);
  const tiles: WindowBuildingTile[] = [];
  const last = 2 ** buildingZoom - 1;
  const firstX = Math.max(0, Math.floor(window.x0 / span));
  const lastX = Math.min(last, Math.floor((window.x0 + window.size - 1) / span));
  const firstY = Math.max(0, Math.floor(window.y0 / span));
  const lastY = Math.min(last, Math.floor((window.y0 + window.size - 1) / span));
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      tiles.push({
        tile: { z: buildingZoom, x, y },
        frame: { scale: span, offsetX: window.x0 - x * span, offsetY: window.y0 - y * span },
      });
    }
  }
  return tiles;
}

// ─── The windows the report uses ───────────────────────────────────────────

/** Around the house: 384 px at zoom 16, about 320 m across (the lot, the block, the street trees). */
export function nearWindow(spot: LatLng): CanopyWindow {
  return windowAround(spot, 16, 384);
}

/** The area: 512 px at zoom 15, about 860 m across (a 400 m circle with room). */
export function areaWindow(spot: LatLng): CanopyWindow {
  return windowAround(spot, 15, 512);
}

/**
 * A neighborhood: the finest zoom from 14 down to 13 that holds it in
 * 1024 px; null for one too big to measure here (a handful of building
 * tiles at most, see `NEIGHBORHOOD_MAX_BUILDING_TILES`).
 */
export function neighborhoodWindow(rings: readonly (readonly LatLng[])[]): CanopyWindow | null {
  const window = windowAroundBounds(rings.flat(), { maxSize: 1024, maxZoom: 14, minZoom: 13 });
  if (!window) return null;
  return buildingTilesOfWindow(window).length <= NEIGHBORHOOD_MAX_BUILDING_TILES ? window : null;
}

/** More building tiles than this (each up to a few hundred kB) and a neighborhood is not measured. */
export const NEIGHBORHOOD_MAX_BUILDING_TILES = 6;
