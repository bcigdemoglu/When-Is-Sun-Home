import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HeatmapPixels } from "./heatmap";
import {
  createHeatmapBitmap,
  drawHeatmapBase,
  releaseHeatmapBitmap,
  releaseHeatmapScratch,
  setCanvasFactory,
  type HeatmapBitmap,
} from "./heatmapCanvas";

/** A canvas that only counts: how often it was (re)sized and what was drawn on it. */
class FakeCanvas {
  private w = 300;
  private h = 150;
  resizes = 0;
  draws = 0;
  /** When false, `getContext` returns null — iOS Safari over its canvas-memory cap. */
  hasContext = true;

  get width() {
    return this.w;
  }
  set width(value: number) {
    this.w = value;
    this.resizes++;
  }
  get height() {
    return this.h;
  }
  set height(value: number) {
    this.h = value;
    this.resizes++;
  }

  getContext() {
    if (!this.hasContext) return null;
    const noop = () => {};
    return {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: noop,
      setTransform: noop,
      clearRect: noop,
      drawImage: () => {
        this.draws++;
      },
      createPattern: () => ({}),
      fillRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
    };
  }
}

const asCanvas = (canvas: FakeCanvas) => canvas as unknown as HTMLCanvasElement;
const asFake = (canvas: HTMLCanvasElement | null) => canvas as unknown as FakeCanvas;

/** Grid pixels of a given size, with or without out-of-view cells. */
function pixels(width: number, height: number, withMask: boolean): HeatmapPixels {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    outMask: withMask ? new Uint8ClampedArray(width * height * 4) : null,
  };
}

const INK = [183, 181, 173] as const;

let made: FakeCanvas[] = [];
let nextHasContext = true;

beforeEach(() => {
  made = [];
  nextHasContext = true;
  setCanvasFactory(() => {
    const canvas = new FakeCanvas();
    canvas.hasContext = nextHasContext;
    made.push(canvas);
    return asCanvas(canvas);
  });
});

afterEach(() => {
  setCanvasFactory(null);
});

describe("canvas memory stays bounded", () => {
  it("allocates four canvases for any number of redraws of a window's heat map", () => {
    const target = new FakeCanvas();
    let bitmap: HeatmapBitmap | null = null;
    // Dragging a viewpoint slider: a new analysis and a redraw on every tick.
    for (let i = 0; i < 200; i++) {
      bitmap = createHeatmapBitmap(pixels(365, 192, true), bitmap);
      expect(bitmap).not.toBeNull();
      expect(drawHeatmapBase(asCanvas(target), bitmap!, 280, 230, 2, INK)).toBe(true);
    }
    // The grid, its out-of-view mask, the hatch tile and the hatch scratch layer.
    expect(made).toHaveLength(4);
    expect(target.draws).toBe(400); // cells + hatch layer, every time
  });

  it("allocates one canvas for a yard (no out-of-view cells, so no hatch)", () => {
    const target = new FakeCanvas();
    let bitmap: HeatmapBitmap | null = null;
    for (let i = 0; i < 50; i++) {
      bitmap = createHeatmapBitmap(pixels(365, 192, false), bitmap);
      drawHeatmapBase(asCanvas(target), bitmap!, 280, 230, 2, INK);
    }
    expect(made).toHaveLength(1);
  });

  it("stays bounded through resizes, pixel-ratio changes and colour-scheme redraws", () => {
    const target = new FakeCanvas();
    let bitmap: HeatmapBitmap | null = null;
    const inks = [INK, [94, 94, 88] as const];
    for (let i = 0; i < 120; i++) {
      // Another year length, another cropped range, another colour scheme…
      bitmap = createHeatmapBitmap(pixels(365 + (i % 2), 192 + (i % 3) * 12, true), bitmap);
      // …another size and another device pixel ratio.
      drawHeatmapBase(asCanvas(target), bitmap!, 280 + (i % 5) * 40, 230, 1 + (i % 3), inks[i % 2]);
    }
    expect(made).toHaveLength(4);
  });

  it("resizes its scratch canvases only when the size changes", () => {
    const target = new FakeCanvas();
    const bitmap = createHeatmapBitmap(pixels(365, 192, true))!;
    drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 2, INK);
    const counts = made.map((canvas) => canvas.resizes);
    const targetResizes = target.resizes;
    for (let i = 0; i < 30; i++) drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 2, INK);
    expect(made.map((canvas) => canvas.resizes)).toEqual(counts);
    expect(target.resizes).toBe(targetResizes);
    expect([target.width, target.height]).toEqual([560, 460]);
  });

  it("reuses the previous bitmap's canvases in place", () => {
    const first = createHeatmapBitmap(pixels(365, 192, true))!;
    const second = createHeatmapBitmap(pixels(366, 288, true), first)!;
    expect(second.cells).toBe(first.cells);
    expect(second.outMask).toBe(first.outMask);
    expect([second.cells.width, second.cells.height]).toEqual([366, 288]);
  });
});

describe("memory is handed back", () => {
  it("releases the mask and the hatch scratch when out-of-view cells go away", () => {
    const target = new FakeCanvas();
    const windowed = createHeatmapBitmap(pixels(365, 192, true))!;
    drawHeatmapBase(asCanvas(target), windowed, 280, 230, 2, INK);
    const [, mask, tile, scratch] = made;
    expect(scratch.width).toBe(560);

    // The observer becomes a yard: same canvases, no mask, no hatch.
    const yard = createHeatmapBitmap(pixels(365, 192, false), windowed)!;
    expect(yard.outMask).toBeNull();
    expect([mask.width, mask.height]).toEqual([0, 0]);
    drawHeatmapBase(asCanvas(target), yard, 280, 230, 2, INK);
    expect([scratch.width, scratch.height]).toEqual([0, 0]);
    expect([tile.width, tile.height]).toEqual([0, 0]);

    // Back to a window: the released scratch canvases are brought back, not replaced.
    const again = createHeatmapBitmap(pixels(365, 192, true), yard)!;
    drawHeatmapBase(asCanvas(target), again, 280, 230, 2, INK);
    expect(scratch.width).toBe(560);
    expect(tile.width).toBeGreaterThan(0);
    expect(made).toHaveLength(5); // only a new mask
  });

  it("releases a bitmap and the scratch on request", () => {
    const target = new FakeCanvas();
    const bitmap = createHeatmapBitmap(pixels(365, 192, true))!;
    drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 1, INK);
    releaseHeatmapBitmap(bitmap);
    releaseHeatmapScratch();
    for (const canvas of made) expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(() => releaseHeatmapBitmap(null)).not.toThrow();
  });
});

describe("a null 2D context never throws", () => {
  it("skips the draw and keeps the canvas as it was", () => {
    const bitmap = createHeatmapBitmap(pixels(365, 192, true))!;
    const target = new FakeCanvas();
    drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 2, INK);
    const before = { resizes: target.resizes, draws: target.draws, width: target.width };

    target.hasContext = false;
    let drawn = true;
    // Even at another size: resizing would wipe the frame that is on screen.
    expect(() => {
      drawn = drawHeatmapBase(asCanvas(target), bitmap, 400, 300, 3, INK);
    }).not.toThrow();
    expect(drawn).toBe(false);
    expect(target).toMatchObject(before);
  });

  it("returns no bitmap, and leaves the previous one alone", () => {
    const previous = createHeatmapBitmap(pixels(365, 192, true))!;
    asFake(previous.cells).hasContext = false;
    const sizeBefore = [previous.cells.width, previous.cells.height];
    let next: HeatmapBitmap | null = previous;
    expect(() => {
      next = createHeatmapBitmap(pixels(366, 288, true), previous);
    }).not.toThrow();
    expect(next).toBeNull();
    expect([previous.cells.width, previous.cells.height]).toEqual(sizeBefore);
  });

  it("does not leak the canvas it could not use", () => {
    nextHasContext = false;
    expect(createHeatmapBitmap(pixels(365, 192, true))).toBeNull();
    expect(made).toHaveLength(1);
    expect([made[0].width, made[0].height]).toEqual([0, 0]);
  });

  it("draws the cells without the hatch when only the hatch layer has no context", () => {
    const bitmap = createHeatmapBitmap(pixels(365, 192, true))!;
    // From here on, new off-screen canvases (the tile, the scratch) get no context.
    nextHasContext = false;
    const target = new FakeCanvas();
    let drawn = false;
    expect(() => {
      drawn = drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 2, INK);
    }).not.toThrow();
    expect(drawn).toBe(true);
    expect(target.draws).toBe(1); // the cells
    // And it keeps trying on later draws without piling up canvases.
    for (let i = 0; i < 20; i++) drawHeatmapBase(asCanvas(target), bitmap, 280, 230, 2, INK);
    expect(made.length).toBeLessThanOrEqual(4);
  });

  it("drops the mask but keeps the picture when the mask has no context", () => {
    const first = createHeatmapBitmap(pixels(365, 192, true))!;
    asFake(first.outMask).hasContext = false;
    const second = createHeatmapBitmap(pixels(365, 192, true), first);
    expect(second).not.toBeNull();
    expect(second!.outMask).toBeNull();
    expect(first.outMask!.width).toBe(0);
  });

  it("ignores empty pixels", () => {
    expect(createHeatmapBitmap(pixels(0, 0, false))).toBeNull();
    expect(made).toHaveLength(0);
  });
});
