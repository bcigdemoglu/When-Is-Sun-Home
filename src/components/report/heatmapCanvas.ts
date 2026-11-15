/**
 * The only code in the report that touches a 2D canvas context. Kept apart so
 * tests (jsdom has no canvas) can stub it.
 *
 * Canvas memory is a hard budget on iOS Safari: once the total backing store
 * of all live canvases passes its cap, `getContext("2d")` returns null and the
 * chart stays blank until the page is reloaded. The heat map can redraw many
 * times a second (dragging a viewpoint slider gives a new analysis each
 * tick), so nothing here may allocate per draw:
 *  - the 1:1 bitmap of the grid REUSES its canvases from one analysis to the
 *    next (`createHeatmapBitmap(pixels, previous)`);
 *  - the out-of-view hatch uses ONE module-level scratch canvas and ONE small
 *    tile, resized or repainted only when their inputs change;
 *  - anything no longer needed is released by shrinking it to 0 × 0, which
 *    frees its backing store at once instead of waiting for garbage collection;
 *  - a null context never throws: the draw is skipped and the canvas keeps the
 *    frame it had.
 */
import type { HeatmapPixels } from "./heatmap";
import type { Rgb } from "./states";

// ─── Canvas allocation ─────────────────────────────────────────────────────

export type CanvasFactory = () => HTMLCanvasElement;

const domCanvasFactory: CanvasFactory = () => document.createElement("canvas");
let canvasFactory: CanvasFactory = domCanvasFactory;

/**
 * Replace how off-screen canvases are made (tests count them with a stub);
 * `null` restores the DOM. Also drops the module's scratch canvases, so the
 * next draw starts from a clean slate.
 */
export function setCanvasFactory(factory: CanvasFactory | null): void {
  releaseHeatmapScratch();
  scratch = null;
  hatchTile = null;
  canvasFactory = factory ?? domCanvasFactory;
}

/** Free a canvas's backing store now (the element itself is tiny). */
function release(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Give a canvas a size; assigning a dimension reallocates, so only when it differs. */
function resize(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

// ─── The 1:1 bitmap ────────────────────────────────────────────────────────

/** A 1:1 bitmap of the year grid (one pixel per day × slot). Build once, scale many times. */
export interface HeatmapBitmap {
  cells: HTMLCanvasElement;
  outMask: HTMLCanvasElement | null;
}

function paintPixels(
  canvas: HTMLCanvasElement,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  resize(canvas, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return true;
}

/**
 * Turn grid pixels into a bitmap. Pass the bitmap it replaces as `previous`:
 * its canvases are repainted in place rather than new ones being allocated
 * (and its mask is released if the new picture has no out-of-view cells).
 *
 * Returns null — with `previous` left untouched — when the pixels are empty
 * or no 2D context can be had.
 */
export function createHeatmapBitmap(
  pixels: HeatmapPixels,
  previous: HeatmapBitmap | null = null,
): HeatmapBitmap | null {
  if (pixels.width === 0 || pixels.height === 0) return null;

  const cells = previous?.cells ?? canvasFactory();
  if (!paintPixels(cells, pixels.data, pixels.width, pixels.height)) {
    if (!previous) release(cells);
    return null;
  }

  let outMask: HTMLCanvasElement | null = null;
  if (pixels.outMask) {
    outMask = previous?.outMask ?? canvasFactory();
    if (!paintPixels(outMask, pixels.outMask, pixels.width, pixels.height)) {
      // Cells without the hatch are better than no picture at all.
      release(outMask);
      outMask = null;
    }
  } else {
    release(previous?.outMask);
  }
  return { cells, outMask };
}

/** Free a bitmap that will not be drawn again (the chart is going away). */
export function releaseHeatmapBitmap(bitmap: HeatmapBitmap | null): void {
  release(bitmap?.cells);
  release(bitmap?.outMask);
}

// ─── The out-of-view hatch ─────────────────────────────────────────────────

/** One scratch layer for compositing the hatch, shared by every draw. */
let scratch: HTMLCanvasElement | null = null;
/** One small tile of 45° lines, repainted only when its ink or scale changes. */
let hatchTile: { canvas: HTMLCanvasElement; key: string } | null = null;

/** Free the hatch scratch canvases (kept between draws while a window is being shown). */
export function releaseHeatmapScratch(): void {
  release(scratch);
  release(hatchTile?.canvas);
  if (hatchTile) hatchTile.key = "";
}

function hatchTileFor(ink: Rgb, scale: number): HTMLCanvasElement | null {
  const size = Math.max(4, Math.round(7 * scale));
  const key = `${ink.join(",")}|${scale}|${size}`;
  if (hatchTile && hatchTile.key === key) return hatchTile.canvas;

  const canvas = hatchTile?.canvas ?? canvasFactory();
  hatchTile = { canvas, key: "" };
  // Assigning the size also clears a reused tile.
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.strokeStyle = `rgb(${ink[0]}, ${ink[1]}, ${ink[2]})`;
  ctx.lineWidth = Math.max(1, scale);
  ctx.lineCap = "square";
  ctx.beginPath();
  // One diagonal plus its wrapped corners so the tile repeats seamlessly.
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  hatchTile.key = key;
  return canvas;
}

/** Lay the hatch over the out-of-view cells. False when it could not be done. */
function drawHatch(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  ratio: number,
  ink: Rgb,
): boolean {
  const tile = hatchTileFor(ink, ratio);
  if (!tile) return false;
  scratch ??= canvasFactory();
  resize(scratch, width, height);
  const layer = scratch.getContext("2d");
  if (!layer) return false;
  const pattern = layer.createPattern(tile, "repeat");
  if (!pattern) return false;
  // The hatch pattern, kept only where the mask is opaque.
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalCompositeOperation = "source-over";
  layer.clearRect(0, 0, width, height);
  layer.imageSmoothingEnabled = false;
  layer.drawImage(mask, 0, 0, width, height);
  layer.globalCompositeOperation = "source-in";
  layer.fillStyle = pattern;
  layer.fillRect(0, 0, width, height);
  layer.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, 0, 0);
  return true;
}

// ─── Drawing ───────────────────────────────────────────────────────────────

/**
 * Paint the heat-map base: the grid bitmap scaled (nearest neighbour, so cells
 * stay crisp) to the canvas, with a fine hatch over out-of-view cells.
 *
 * `cssWidth` × `cssHeight` is the size the canvas is displayed at; the backing
 * store is sized to the device pixel ratio.
 *
 * Returns false, leaving the canvas exactly as it was, when no 2D context is
 * available. Allocates nothing per call.
 */
export function drawHeatmapBase(
  canvas: HTMLCanvasElement,
  bitmap: HeatmapBitmap,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  hatchInk: Rgb,
): boolean {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));

  // A CPU-backed context: this canvas is painted rarely and never animated,
  // so it gains nothing from the GPU, and software canvases are captured
  // reliably by screenshots and print.
  //
  // Asked for BEFORE the canvas is resized: resizing clears it, and without a
  // context the previous frame is the best there is to show.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  resize(canvas, width, height);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap.cells, 0, 0, width, height);

  if (bitmap.outMask) {
    // If the hatch cannot be drawn the cells still stand: out-of-view keeps its own colour.
    drawHatch(ctx, bitmap.outMask, width, height, ratio, hatchInk);
  } else {
    // A yard has no out-of-view cells: hold no scratch memory for it.
    releaseHeatmapScratch();
  }
  return true;
}
