/**
 * The only code in the report that touches a 2D canvas context. Kept apart so
 * tests (jsdom has no canvas) can stub it.
 */
import type { HeatmapPixels } from "./heatmap";
import type { Rgb } from "./states";

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

/** A 1:1 bitmap of the year grid (one pixel per day × slot). Build once, scale many times. */
export interface HeatmapBitmap {
  cells: HTMLCanvasElement;
  outMask: HTMLCanvasElement | null;
}

export function createHeatmapBitmap(pixels: HeatmapPixels): HeatmapBitmap | null {
  if (pixels.width === 0 || pixels.height === 0) return null;
  const toCanvas = (data: Uint8ClampedArray): HTMLCanvasElement | null => {
    const canvas = createCanvas(pixels.width, pixels.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(pixels.width, pixels.height);
    image.data.set(data);
    ctx.putImageData(image, 0, 0);
    return canvas;
  };
  const cells = toCanvas(pixels.data);
  if (!cells) return null;
  return { cells, outMask: pixels.outMask ? toCanvas(pixels.outMask) : null };
}

/** A small tile of 45° lines, tiled as the out-of-view texture. */
function createHatchTile(ink: Rgb, scale: number): HTMLCanvasElement | null {
  const size = Math.max(4, Math.round(6 * scale));
  const tile = createCanvas(size, size);
  const ctx = tile.getContext("2d");
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
  return tile;
}

/**
 * Paint the heat-map base: the grid bitmap scaled (nearest neighbour, so cells
 * stay crisp) to the canvas, with a fine hatch over out-of-view cells.
 *
 * `cssWidth` × `cssHeight` is the size the canvas is displayed at; the backing
 * store is sized to the device pixel ratio.
 */
export function drawHeatmapBase(
  canvas: HTMLCanvasElement,
  bitmap: HeatmapBitmap,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  hatchInk: Rgb,
): void {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap.cells, 0, 0, width, height);

  if (!bitmap.outMask) return;
  const tile = createHatchTile(hatchInk, ratio);
  const layer = createCanvas(width, height);
  const layerCtx = layer.getContext("2d");
  if (!tile || !layerCtx) return;
  const pattern = layerCtx.createPattern(tile, "repeat");
  if (!pattern) return;
  layerCtx.imageSmoothingEnabled = false;
  layerCtx.drawImage(bitmap.outMask, 0, 0, width, height);
  layerCtx.globalCompositeOperation = "source-in";
  layerCtx.fillStyle = pattern;
  layerCtx.fillRect(0, 0, width, height);
  ctx.drawImage(layer, 0, 0);
}
