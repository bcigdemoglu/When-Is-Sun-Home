/**
 * The Trees layer, pixel by pixel: from a picture of heights to a picture of
 * tree crowns. Plain arrays in, plain arrays out — no canvas, no network, no
 * DOM — so that it runs in a worker (see `treeTiles.worker.ts`) and in tests.
 *
 * The heights are a laser survey's "canopy" model: the top of whatever
 * stands on the ground, in feet. That is trees, and also every building. So
 * the work is
 *
 *  1. class every pixel by its height (under 10 ft is not a tree);
 *  2. cut the buildings out, by the footprints of the very tiles the sun
 *     computation reads, grown a little (eaves, and footprints that sit a
 *     metre off the survey);
 *  3. drop specks (what is left of a roof's edge, wires, chimneys);
 *  4. paint each class its colour, with an outline around the crowns where
 *     the picture goes over a photo.
 *
 * Nothing here knows where the pictures come from: see `trees.ts`.
 */
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

// ─── Height classes ────────────────────────────────────────────────────────

/**
 * Where each height class begins, feet. Anything lower is not drawn: hedges,
 * fences, cars, and trees too small to shade a yard.
 */
export const TREE_CLASS_MIN_FT: readonly number[] = [10, 20, 35, 50, 70, 100];

/** The class of a pixel that is not a tree. */
export const NO_TREE = -1;

/** The height class (0 = lowest) of something this tall, or `NO_TREE`. */
export function treeClassOfFeet(feet: number): number {
  let found = NO_TREE;
  for (let i = 0; i < TREE_CLASS_MIN_FT.length; i++) {
    if (feet >= TREE_CLASS_MIN_FT[i]) found = i;
  }
  return found;
}

const CLASS_OF_FEET = Int8Array.from({ length: 256 }, (_, feet) => treeClassOfFeet(feet));

/**
 * The height class of every pixel of a heights picture: RGBA, the height in
 * whole feet in the red channel (255 = that or more), alpha 0 where the
 * survey has nothing.
 */
export function classifyHeights(rgba: ArrayLike<number>): Int8Array {
  const count = Math.floor(rgba.length / 4);
  const classes = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    classes[i] = rgba[4 * i + 3] === 0 ? NO_TREE : CLASS_OF_FEET[rgba[4 * i]];
  }
  return classes;
}

// ─── Buildings, to cut out ─────────────────────────────────────────────────

/** A footprint: its outline and then its courtyards, each `x0, y0, x1, y1, …`. */
export type FootprintRings = readonly ArrayLike<number>[];

/**
 * Every building footprint of one building tile, in units of the tile
 * (0..1 across it; parts in the tile's margin lie a little outside). An
 * empty tile (no bytes, or no building layer) has none.
 */
export function footprintsOfTile(
  data: ArrayBuffer | Uint8Array,
  layerName = "building",
): FootprintRings[] {
  if (data.byteLength === 0) return [];
  const layer = new VectorTile(new PbfReader(data)).layers[layerName];
  if (!layer) return [];
  const extent = layer.extent;
  const footprints: FootprintRings[] = [];
  for (let f = 0; f < layer.length; f++) {
    const feature = layer.feature(f);
    if (feature.type !== 3) continue;
    for (const polygon of classifyRings(feature.loadGeometry())) {
      footprints.push(
        polygon.map((ring) => {
          const flat = new Float32Array(ring.length * 2);
          ring.forEach((point, i) => {
            flat[2 * i] = point.x / extent;
            flat[2 * i + 1] = point.y / extent;
          });
          return flat;
        }),
      );
    }
  }
  return footprints;
}

/** How a footprint's units become pixels: `pixel = unit · scale − offset`. */
export interface PixelFrame {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The frame of a picture of tile `z/x/y`, `size` px wide, inside the building
 * tile (of zoom `buildingZoom`, at most `z`) that contains it.
 */
export function frameInBuildingTile(
  tile: { z: number; x: number; y: number },
  size: number,
  buildingZoom: number,
): PixelFrame & { buildingTile: { z: number; x: number; y: number } } {
  const dz = Math.max(0, tile.z - buildingZoom);
  const across = 2 ** dz;
  const x = Math.floor(tile.x / across);
  const y = Math.floor(tile.y / across);
  return {
    buildingTile: { z: tile.z - dz, x, y },
    scale: size * across,
    offsetX: (tile.x - x * across) * size,
    offsetY: (tile.y - y * across) * size,
  };
}

/**
 * Mark (with 1) every pixel whose centre lies inside a footprint: a
 * `size`×`size` picture, row by row from the top. Courtyards stay unmarked.
 *
 * With `labels`, it marks that picture instead, each footprint with its own
 * number: `firstLabel` for the first, then counting up (to tell buildings
 * apart: which one is the house).
 */
export function rasterizeFootprints(
  footprints: readonly FootprintRings[],
  size: number,
  frame: PixelFrame,
): Uint8Array;
export function rasterizeFootprints(
  footprints: readonly FootprintRings[],
  size: number,
  frame: PixelFrame,
  labels: Int32Array,
  firstLabel: number,
): Int32Array;
export function rasterizeFootprints(
  footprints: readonly FootprintRings[],
  size: number,
  frame: PixelFrame,
  labels?: Int32Array,
  firstLabel = 1,
): Uint8Array | Int32Array {
  const mask = labels ?? new Uint8Array(size * size);
  const crossings: number[] = [];
  for (let f = 0; f < footprints.length; f++) {
    const rings = footprints[f];
    const value = labels ? firstLabel + f : 1;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i += 2) {
        const x = ring[i] * frame.scale - frame.offsetX;
        const y = ring[i + 1] * frame.scale - frame.offsetY;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!(maxY >= 0 && minY <= size && maxX >= 0 && minX <= size)) continue;

    const firstRow = Math.max(0, Math.ceil(minY - 0.5));
    const lastRow = Math.min(size - 1, Math.floor(maxY - 0.5));
    for (let row = firstRow; row <= lastRow; row++) {
      const lineY = row + 0.5;
      crossings.length = 0;
      for (const ring of rings) {
        const points = ring.length >> 1;
        for (let i = 0; i < points; i++) {
          const j = (i + 1) % points;
          const ay = ring[2 * i + 1] * frame.scale - frame.offsetY;
          const by = ring[2 * j + 1] * frame.scale - frame.offsetY;
          if (ay <= lineY === by <= lineY) continue;
          const ax = ring[2 * i] * frame.scale - frame.offsetX;
          const bx = ring[2 * j] * frame.scale - frame.offsetX;
          crossings.push(ax + ((lineY - ay) / (by - ay)) * (bx - ax));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
        const to = Math.min(size - 1, Math.ceil(crossings[k + 1] - 0.5) - 1);
        for (let column = from; column <= to; column++) mask[row * size + column] = value;
      }
    }
  }
  return mask;
}

/** Grow every marked area by `radius` pixels in all directions (a square brush). */
export function growMask(mask: Uint8Array, size: number, radius: number): Uint8Array {
  if (radius < 1) return mask;
  const across = new Uint8Array(mask.length);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!mask[row * size + column]) continue;
      const from = Math.max(0, column - radius);
      const to = Math.min(size - 1, column + radius);
      for (let c = from; c <= to; c++) across[row * size + c] = 1;
    }
  }
  const grown = new Uint8Array(mask.length);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!across[row * size + column]) continue;
      const from = Math.max(0, row - radius);
      const to = Math.min(size - 1, row + radius);
      for (let r = from; r <= to; r++) grown[r * size + column] = 1;
    }
  }
  return grown;
}

/**
 * How far the footprints are grown before they are cut out, in pixels of a
 * picture of this zoom: about 2.5 m on the ground at Oregon's latitude (a
 * zoom-16 pixel of a 512 px picture is 0.84 m there), and never less than
 * one pixel.
 */
export function footprintMarginPx(zoom: number, size: number): number {
  return Math.max(1, Math.round(3 * 2 ** (zoom - 16) * (size / 512)));
}

// ─── Specks ────────────────────────────────────────────────────────────────

/**
 * A tree pixel stays only when at least this many of the nine pixels around
 * and including it are trees: single pixels, thin lines (wires) and the
 * ragged rim a cut-out roof leaves behind go.
 */
export const SPECK_MIN_NEIGHBOURS = 6;

/** Remove specks, in place. Beyond the picture's edge the edge repeats. */
export function despeckle(classes: Int8Array, size: number): Int8Array {
  const isTree = new Uint8Array(classes.length);
  for (let i = 0; i < classes.length; i++) isTree[i] = classes[i] >= 0 ? 1 : 0;
  for (let row = 0; row < size; row++) {
    const above = Math.max(0, row - 1) * size;
    const here = row * size;
    const below = Math.min(size - 1, row + 1) * size;
    for (let column = 0; column < size; column++) {
      if (!isTree[here + column]) continue;
      const left = Math.max(0, column - 1);
      const right = Math.min(size - 1, column + 1);
      const around =
        isTree[above + left] +
        isTree[above + column] +
        isTree[above + right] +
        isTree[here + left] +
        1 +
        isTree[here + right] +
        isTree[below + left] +
        isTree[below + column] +
        isTree[below + right];
      if (around < SPECK_MIN_NEIGHBOURS) classes[here + column] = NO_TREE;
    }
  }
  return classes;
}

// ─── Colour ────────────────────────────────────────────────────────────────

/** One colour: red, green, blue, alpha, each 0..255. */
export type Rgba = readonly [number, number, number, number];

export interface TreePalette {
  /** The colour of each height class, lowest first. */
  fills: readonly Rgba[];
  /** The outline around a group of crowns (over a photo), or null for none. */
  edge: Rgba | null;
}

/**
 * Paint the classes: RGBA, row by row from the top; what is not a tree is
 * fully transparent. With an `edge`, tree pixels next to (above, below,
 * left or right of) a pixel that is not a tree take its colour; the
 * picture's own rim never counts as an edge, or every tile would be framed.
 */
export function paintTrees(
  classes: Int8Array,
  size: number,
  palette: TreePalette,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(classes.length * 4);
  const { fills, edge } = palette;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const i = row * size + column;
      const treeClass = classes[i];
      if (treeClass < 0) continue;
      const onEdge =
        edge !== null &&
        ((column > 0 && classes[i - 1] < 0) ||
          (column < size - 1 && classes[i + 1] < 0) ||
          (row > 0 && classes[i - size] < 0) ||
          (row < size - 1 && classes[i + size] < 0));
      const colour = onEdge ? edge : (fills[Math.min(treeClass, fills.length - 1)] ?? null);
      if (!colour) continue;
      pixels[4 * i] = colour[0];
      pixels[4 * i + 1] = colour[1];
      pixels[4 * i + 2] = colour[2];
      pixels[4 * i + 3] = colour[3];
    }
  }
  return pixels;
}

// ─── All of it ─────────────────────────────────────────────────────────────

export interface TreeTileInput {
  /** The tile the picture is of. */
  tile: { z: number; x: number; y: number };
  /** The heights: `size`×`size` RGBA (see `classifyHeights`). */
  heights: ArrayLike<number>;
  size: number;
  /** The building tile around it, as bytes (empty: no buildings there). */
  buildings: ArrayBuffer | Uint8Array;
  /** The zoom level of that building tile. */
  buildingZoom: number;
  palette: TreePalette;
}

/** A heights picture and the buildings around it, as the picture the map draws. */
export function renderTreePixels(input: TreeTileInput): Uint8ClampedArray<ArrayBuffer> {
  const { tile, heights, size, buildings, buildingZoom, palette } = input;
  if (heights.length !== size * size * 4) {
    throw new RangeError(`renderTreePixels: expected ${size}×${size} RGBA pixels`);
  }
  const classes = classifyHeights(heights);
  // Nothing tall enough anywhere (open water, fields, beyond the survey):
  // there is nothing to cut out or tidy.
  if (classes.every((treeClass) => treeClass < 0)) return new Uint8ClampedArray(heights.length);

  const footprints = footprintsOfTile(buildings);
  if (footprints.length > 0) {
    const frame = frameInBuildingTile(tile, size, buildingZoom);
    const cut = growMask(
      rasterizeFootprints(footprints, size, frame),
      size,
      footprintMarginPx(tile.z, size),
    );
    for (let i = 0; i < classes.length; i++) if (cut[i]) classes[i] = NO_TREE;
  }
  return paintTrees(despeckle(classes, size), size, palette);
}
