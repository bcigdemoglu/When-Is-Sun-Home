/**
 * One tile of the Trees layer as a job: bytes in, pixels out. It runs in a
 * worker (`treeTiles.worker.ts`), or in the page where there can be none;
 * no network here (see `treeTiles.ts`).
 */
import { decodePng } from "@/lib/terrain/png";
import type { CanopyArea, CanopyCover, CanopyGrid } from "./canopyGrid";
import { areaMask, canopyCover } from "./canopySummary";
import { GROUND_BUILDING, GROUND_NO_DATA, GROUND_OPEN, GROUND_TREE } from "./canopyGrid";
import type { CanopyWindow } from "./canopyWindow";
import {
  NO_TREE,
  classifyHeights,
  despeckle,
  footprintMarginPx,
  footprintsOfTile,
  growMask,
  rasterizeFootprints,
  renderTreePixels,
  type PixelFrame,
  type TreePalette,
} from "./treeRaster";

export {
  GROUND_BUILDING,
  GROUND_NO_DATA,
  GROUND_OPEN,
  GROUND_TREE,
  type CanopyArea,
  type CanopyCover,
  type CanopyGrid,
} from "./canopyGrid";

export interface TreeTileJob {
  kind?: "tile";
  id: number;
  tile: { z: number; x: number; y: number };
  /** The heights picture, a PNG (see `treeHeightsUrl`). */
  heights: ArrayBuffer;
  /**
   * The same picture already decoded to RGBA, where the PNG cannot be
   * decoded here (browsers without `DecompressionStream`: iOS before 16.4);
   * `heights` is then not looked at.
   */
  decoded?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  /** The building tile around it (empty: no buildings). */
  buildings: ArrayBuffer;
  buildingZoom: number;
  palette: TreePalette;
}

export type TreeTileResult =
  | { id: number; ok: true; size: number; pixels: ArrayBuffer }
  | { id: number; ok: false; message: string };

/**
 * A canopy window for the report (see `canopyWindow.ts`): its heights and
 * the building tiles it overlaps, to be turned into what the Trees section
 * measures. The same steps as a map tile — class, cut the buildings out as
 * the map does, drop specks — and no colouring.
 */
export interface CanopyJob {
  kind: "canopy";
  id: number;
  window: CanopyWindow;
  heights: ArrayBuffer;
  decoded?: TreeTileJob["decoded"];
  buildings: { frame: PixelFrame; data: ArrayBuffer }[];
  /** Also number each building's own pixels (to tell the house from the garage). */
  labels: boolean;
  /** Measure the cover over this area here, off the main thread. */
  area?: CanopyArea;
}

export type CanopyResult =
  | {
      id: number;
      ok: true;
      ground: ArrayBuffer;
      feet: ArrayBuffer;
      labels: ArrayBuffer | null;
      cover: CanopyCover | null;
    }
  | { id: number; ok: false; message: string };

export async function runCanopyJob(job: CanopyJob): Promise<CanopyGrid> {
  const { window } = job;
  const { size } = window;
  const picture = job.decoded ?? (await decodePng(new Uint8Array(job.heights)));
  if (picture.width !== size || picture.height !== size) {
    throw new Error(`A canopy window must be ${size}×${size} px`);
  }
  const rgba = picture.data;
  const classes = classifyHeights(rgba);

  let built: Uint8Array = new Uint8Array(size * size);
  let labels: Int32Array<ArrayBuffer> | null = null;
  if (job.labels) {
    labels = new Int32Array(size * size);
    let next = 1;
    for (const tile of job.buildings) {
      const footprints = footprintsOfTile(tile.data);
      rasterizeFootprints(footprints, size, tile.frame, labels, next);
      next += footprints.length;
    }
    for (let i = 0; i < built.length; i++) built[i] = labels[i] > 0 ? 1 : 0;
  } else {
    for (const tile of job.buildings) {
      const mask = rasterizeFootprints(footprintsOfTile(tile.data), size, tile.frame);
      for (let i = 0; i < built.length; i++) built[i] |= mask[i];
    }
  }
  // Grown exactly as the map layer grows them for a picture of this zoom.
  built = growMask(built, size, footprintMarginPx(window.z, 512));
  for (let i = 0; i < classes.length; i++) if (built[i]) classes[i] = NO_TREE;
  despeckle(classes, size);

  const ground = new Uint8Array(size * size);
  const feet = new Uint8Array(size * size);
  for (let i = 0; i < classes.length; i++) {
    if (rgba[4 * i + 3] === 0) ground[i] = GROUND_NO_DATA;
    else if (built[i]) ground[i] = GROUND_BUILDING;
    else if (classes[i] >= 0) {
      ground[i] = GROUND_TREE;
      feet[i] = rgba[4 * i];
    } else ground[i] = GROUND_OPEN;
  }
  const grid: CanopyGrid = { window, ground, feet, labels, cover: null };
  if (job.area) {
    const { mask, box } = areaMask(window, job.area);
    grid.cover = canopyCover(grid, mask, box);
  }
  return grid;
}

/** The finished picture of one tile: `size`×`size` RGBA, row by row from the top. */
export interface TreeTilePixels {
  size: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

export async function runTreeTileJob(job: TreeTileJob): Promise<TreeTilePixels> {
  const picture = job.decoded ?? (await decodePng(new Uint8Array(job.heights)));
  if (picture.width !== picture.height) throw new Error("A heights picture must be square");
  const pixels = renderTreePixels({
    tile: job.tile,
    heights: picture.data,
    size: picture.width,
    buildings: job.buildings,
    buildingZoom: job.buildingZoom,
    palette: job.palette,
  });
  return { size: picture.width, pixels };
}
