/**
 * A measured canopy window (see `canopyWindow.ts`): what the Trees layer's
 * worker hands back for the report's Trees section (`treeTileJob.ts`), and
 * what `canopySummary.ts` measures. Types and constants only.
 */
import type { LatLng } from "@/lib/types";
import type { CanopyWindow } from "./canopyWindow";

/** Codes of `CanopyGrid.ground`. */
export const GROUND_NO_DATA = 0;
export const GROUND_OPEN = 1;
export const GROUND_BUILDING = 2;
export const GROUND_TREE = 3;

/**
 * A measured canopy window: `size`×`size` pixels, row by row from the top
 * (north).
 */
export interface CanopyGrid {
  window: CanopyWindow;
  /** Per pixel: no survey data, open ground, building (cut out, with its margin) or tree. */
  ground: Uint8Array<ArrayBuffer>;
  /** Tree height in whole feet where `ground` is a tree (255 = that or more), else 0. */
  feet: Uint8Array<ArrayBuffer>;
  /** With `labels`: the building each pixel is in (1, 2, …; footprints as drawn, no margin), else 0. */
  labels: Int32Array<ArrayBuffer> | null;
  /** The cover over the job's own area (`CanopyJob.area`), measured in the worker; null without one. */
  cover: CanopyCover | null;
}

/** Where to measure a window's cover in the worker: a circle, or a polygon. */
export type CanopyArea =
  { kind: "circle"; center: LatLng; radiusM: number } | { kind: "polygon"; rings: LatLng[][] };

export interface CanopyCover {
  /** Ground measured (surveyed, not a building), square metres. */
  groundM2: number;
  /** Of it under canopy ≥ 10 ft, square metres. */
  canopyM2: number;
  /** canopy / ground, 0..1; null when there is no measured ground. */
  cover: number | null;
  /** The tallest canopy, feet (255 = that or more); null without any. */
  tallestFt: number | null;
  /** Shares of the canopy 10–35 ft, 35–70 ft and 70 ft and taller; null without any. */
  heightShares: [number, number, number] | null;
  /** Share of the area's pixels inside the window that have survey data. */
  surveyed: number;
}
