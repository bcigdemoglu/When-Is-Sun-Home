/**
 * One tile of the Trees layer as a job: bytes in, pixels out. It runs in a
 * worker (`treeTiles.worker.ts`), or in the page where there can be none;
 * no network here (see `treeTiles.ts`).
 */
import { decodePng } from "@/lib/terrain/png";
import { renderTreePixels, type TreePalette } from "./treeRaster";

export interface TreeTileJob {
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
