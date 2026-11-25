/**
 * The Trees layer's pictures, loaded for MapLibre (browser only; the rules
 * are in `trees.ts`, the pixel work in `treeRaster.ts`).
 *
 * For every tile MapLibre asks for, this
 *
 *  1. fetches the heights from the state's server and the building tile
 *     around them from the tiles the app already uses (both asked for again
 *     after a failure, as the aerial photos are);
 *  2. hands the two to a worker, which cuts the buildings out and colours
 *     what is left — in the page itself only where there can be no worker;
 *  3. gives MapLibre the finished picture.
 *
 * A tile that cannot be had fails without a word: the layer is an extra.
 */
import { BUILDING_TILE_ZOOM, loadTileTemplate, tileUrl } from "@/lib/buildings/vectorTiles";
import { decodeTileInBrowser } from "@/lib/terrain/loadTerrain";
import { canDecodePng } from "@/lib/terrain/png";
import { fetchPicture, type ImageryLoadOptions } from "./imagery";
import { frameInBuildingTile, type Rgba, type TreePalette } from "./treeRaster";
import {
  runCanopyJob,
  runTreeTileJob,
  type CanopyGrid,
  type CanopyJob,
  type CanopyResult,
  type TreeTileJob,
  type TreeTilePixels,
  type TreeTileResult,
} from "./treeTileJob";
import {
  TREE_RETRY_WAITS_MS,
  TREE_TILE_SIZE,
  parseTreeTileUrl,
  treeHeightsUrl,
  type TreeLook,
} from "./trees";

// ─── Colours ───────────────────────────────────────────────────────────────

const CLASS_COUNT = 6;
/** Used only should a token be missing or not a plain hex colour: a mid grey, never a crash. */
const FALLBACK: readonly [number, number, number] = [128, 128, 128];

/** "#rgb" or "#rrggbb" as numbers, or null. */
export function parseHexColour(value: string): [number, number, number] | null {
  const hex = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) return [1, 2, 3].map((i) => Number.parseInt(short[i] + short[i], 16)) as never;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (long) return [1, 2, 3].map((i) => Number.parseInt(long[i], 16)) as never;
  return null;
}

/**
 * The colours of a look, read from the design tokens in `globals.css`
 * (`--tree-1` … `--tree-6` and `--tree-alpha` for the map, the `--tree-photo-`
 * ones for over a photo), as they are right now: the dark scheme redefines
 * the map's.
 */
export function readTreePalette(
  look: TreeLook,
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> = getComputedStyle(document.documentElement),
): TreePalette {
  const prefix = look === "photo" ? "--tree-photo-" : "--tree-";
  const token = (name: string) => style.getPropertyValue(`${prefix}${name}`);
  const opacity = Number.parseFloat(token("alpha"));
  const alpha = Math.round(255 * (opacity >= 0 && opacity <= 1 ? opacity : 0.8));
  const fills: Rgba[] = [];
  for (let i = 1; i <= CLASS_COUNT; i++) {
    const [r, g, b] = parseHexColour(token(String(i))) ?? FALLBACK;
    fills.push([r, g, b, alpha]);
  }
  const edgeColour = look === "photo" ? parseHexColour(token("edge")) : null;
  return { fills, edge: edgeColour ? [...edgeColour, 235] : null };
}

// ─── The worker ────────────────────────────────────────────────────────────

interface Waiting {
  /** A successful answer (a failed one rejects). */
  resolve(result: TreeTileResult | CanopyResult): void;
  reject(error: Error): void;
}

/** undefined: not started yet. null: there can be none here (the page does the work). */
let worker: Worker | null | undefined;
const waiting = new Map<number, Waiting>();
let nextJobId = 1;

function giveUpOnWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  const error = new Error(reason);
  for (const job of waiting.values()) job.reject(error);
  waiting.clear();
}

function treeWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const started = new Worker(new URL("./treeTiles.worker.ts", import.meta.url), {
      type: "module",
      name: "tree-tiles",
    });
    started.onmessage = (event: MessageEvent<TreeTileResult | CanopyResult>) => {
      const result = event.data;
      const job = waiting.get(result.id);
      if (!job) return;
      waiting.delete(result.id);
      if (result.ok) job.resolve(result);
      else job.reject(new Error(result.message));
    };
    // It could not start (an old browser, a blocked script): from now on the page does the work.
    started.onerror = () => giveUpOnWorker("The tree tile worker failed");
    worker = started;
  } catch {
    worker = null;
  }
  return worker;
}

/** Hand a job to the worker; resolves with its (successful) answer. */
function inWorker(
  target: Worker,
  job: TreeTileJob | CanopyJob,
  transfer: Transferable[],
): Promise<TreeTileResult | CanopyResult> {
  return new Promise((resolve, reject) => {
    waiting.set(job.id, { resolve, reject });
    target.postMessage(job, transfer);
  });
}

async function render(job: TreeTileJob): Promise<TreeTilePixels> {
  const target = treeWorker();
  if (!target) return runTreeTileJob(job);
  const result = await inWorker(target, job, [job.heights, job.buildings]);
  if (!result.ok || !("pixels" in result)) throw new Error("The tree tile worker gave no picture");
  return { size: result.size, pixels: new Uint8ClampedArray(result.pixels) };
}

/** A fresh job number, shared by every kind of job the worker runs. */
export function nextTreeJobId(): number {
  return nextJobId++;
}

/**
 * Measure a canopy window (see `treeCanopy.ts`) off the main thread — in the
 * page itself only where there can be no worker.
 */
export async function measureCanopy(job: CanopyJob): Promise<CanopyGrid> {
  const target = treeWorker();
  if (!target) return runCanopyJob(job);
  const transfer = [job.heights, ...job.buildings.map((tile) => tile.data)];
  const result = await inWorker(target, job, transfer);
  if (!result.ok || !("ground" in result)) throw new Error("The tree worker gave no canopy");
  return {
    window: job.window,
    ground: new Uint8Array(result.ground),
    feet: new Uint8Array(result.feet),
    labels: result.labels ? new Int32Array(result.labels) : null,
    cover: result.cover,
  };
}

// ─── One tile ──────────────────────────────────────────────────────────────

/** The picture as something MapLibre draws: a bitmap, or (old browsers) an encoded PNG. */
async function asMapImage({ size, pixels }: TreeTilePixels): Promise<ImageBitmap | ArrayBuffer> {
  const image = new ImageData(pixels, size, size);
  if (typeof createImageBitmap === "function") return createImageBitmap(image);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode a tree tile");
  return blob.arrayBuffer();
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Load one tile of the Trees layer (`url` as MapLibre asks for it). Rejects
 * when the heights or the buildings could not be had after the retries, and
 * with an AbortError when MapLibre no longer wants the tile.
 */
export async function loadTreeTile(
  url: string,
  options: ImageryLoadOptions = {},
): Promise<{ data: ImageBitmap | ArrayBuffer }> {
  const request = parseTreeTileUrl(url);
  if (!request) throw new Error(`Not a tree tile address: ${url}`);
  const { signal } = options;

  const frame = frameInBuildingTile(request, TREE_TILE_SIZE, BUILDING_TILE_ZOOM);
  const [heights, buildings] = await Promise.all([
    fetchPicture(treeHeightsUrl(request), TREE_RETRY_WAITS_MS, false, options),
    // The same address the map and the sun computation read the buildings
    // from: where they have, this comes from the browser's cache.
    loadTileTemplate({ signal, fetchImpl: options.fetchImpl }).then((template) =>
      fetchPicture(tileUrl(template, frame.buildingTile), TREE_RETRY_WAITS_MS, false, options),
    ),
  ]);
  if (signal?.aborted) throw abortError();

  // Old browsers (iOS before 16.4) cannot inflate a PNG by themselves: there
  // the browser's own image decoder reads the heights, here in the page (a
  // canvas read-back; a foot of anti-fingerprinting noise would not matter).
  const decoded = canDecodePng() ? undefined : await decodeTileInBrowser(new Blob([heights.data]));
  if (signal?.aborted) throw abortError();

  const pixels = await render({
    id: nextJobId++,
    tile: { z: request.z, x: request.x, y: request.y },
    heights: heights.data,
    decoded,
    buildings: buildings.data,
    buildingZoom: frame.buildingTile.z,
    palette: readTreePalette(request.look),
  });
  if (signal?.aborted) throw abortError();
  return { data: await asMapImage(pixels) };
}
