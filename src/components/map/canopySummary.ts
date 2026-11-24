/**
 * What the report's Trees section measures in a canopy window (see
 * `canopyWindow.ts`, `treeTileJob.ts`): tree canopy cover over a lot, a
 * backyard, a block, an area; the tallest tree; heights near a trunk. Plain
 * arrays in, plain numbers out — no DOM, no network.
 *
 * Tree canopy cover, the same everywhere: the share of the ground (buildings
 * cut out exactly as the map's Trees layer cuts them) where the laser
 * survey's canopy height is 10 ft or more. It is information only: trees are
 * NEVER part of a sun-hours number.
 */
import type { LatLng } from "@/lib/types";
import { metresPerPixel, windowPixel, type CanopyWindow } from "./canopyWindow";
import {
  GROUND_BUILDING,
  GROUND_NO_DATA,
  GROUND_TREE,
  type CanopyArea,
  type CanopyCover,
  type CanopyGrid,
} from "./canopyGrid";
import { rasterizeFootprints } from "./treeRaster";

export type { CanopyCover } from "./canopyGrid";

const SQ_FT_PER_M2 = 10.7639;
/** A lot bigger than an acre is not a house lot (a school, a park, an apartment block). */
export const HOUSE_LOT_MAX_SQ_FT = 43_560;
/** More buildings than this on a lot and it is not a house with a garage and a shed. */
export const HOUSE_LOT_MAX_BUILDINGS = 4;
/** A building smaller than this on the lot is not counted (a corner of the neighbour's). */
const BUILDING_MIN_M2 = 10;
/** Height classes of the canopy, feet: where each begins (a coarser grouping of the legend's). */
export const CANOPY_HEIGHT_GROUPS_FT: readonly number[] = [10, 35, 70];

// ─── Masks ─────────────────────────────────────────────────────────────────

/**
 * The rows and columns a mask can be non-zero in (inclusive), so that the
 * loops over it stay small: a lot is a few hundred of a window's 150,000
 * pixels. The whole window when not given.
 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const wholeWindow = (size: number): Box => ({ x0: 0, y0: 0, x1: size - 1, y1: size - 1 });

/** The smallest box holding both (either may be null). */
function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** A polygon's pixels and their box (null when it misses the window). */
function polygonInto(
  window: CanopyWindow,
  rings: readonly (readonly LatLng[])[],
  mask: Uint8Array,
): Box | null {
  const { size } = window;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const flat = rings.map((ring) => {
    const points = new Float32Array(ring.length * 2);
    ring.forEach((spot, i) => {
      const { x, y } = windowPixel(window, spot);
      points[2 * i] = x;
      points[2 * i + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return points;
  });
  const box = {
    x0: Math.max(0, Math.floor(minX)),
    y0: Math.max(0, Math.floor(minY)),
    x1: Math.min(size - 1, Math.ceil(maxX)),
    y1: Math.min(size - 1, Math.ceil(maxY)),
  };
  if (box.x0 > box.x1 || box.y0 > box.y1) return null;
  // Only the box is drawn into: a sub-picture of the window.
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  const side = Math.max(width, height);
  const part = rasterizeFootprints([flat], side, { scale: 1, offsetX: box.x0, offsetY: box.y0 });
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (part[row * side + column]) mask[(box.y0 + row) * size + box.x0 + column] = 1;
    }
  }
  return box;
}

/** A polygon (outer rings and holes, even-odd) as a mask of the window's pixels, with its box. */
export function polygonArea(
  window: CanopyWindow,
  rings: readonly (readonly LatLng[])[],
): { mask: Uint8Array; box: Box | null } {
  const mask = new Uint8Array(window.size * window.size);
  return { mask, box: polygonInto(window, rings, mask) };
}

/** A polygon as a mask of the window's pixels. */
export function polygonMask(
  window: CanopyWindow,
  rings: readonly (readonly LatLng[])[],
): Uint8Array {
  return polygonArea(window, rings).mask;
}

/** Several polygons as one mask, with their box. */
export function polygonsArea(
  window: CanopyWindow,
  polygons: readonly (readonly (readonly LatLng[])[])[],
): { mask: Uint8Array; box: Box | null } {
  const mask = new Uint8Array(window.size * window.size);
  let box: Box | null = null;
  for (const rings of polygons) box = union(box, polygonInto(window, rings, mask));
  return { mask, box };
}

/** Several polygons as one mask. */
export function polygonsMask(
  window: CanopyWindow,
  polygons: readonly (readonly (readonly LatLng[])[])[],
): Uint8Array {
  return polygonsArea(window, polygons).mask;
}

/** Every pixel whose centre lies within `radiusM` of a spot, with their box. */
export function circleArea(
  window: CanopyWindow,
  center: LatLng,
  radiusM: number,
): { mask: Uint8Array; box: Box | null } {
  const { size } = window;
  const mask = new Uint8Array(size * size);
  const { x: cx, y: cy } = windowPixel(window, center);
  const radius = radiusM / metresPerPixel(window);
  const r2 = radius * radius;
  const firstRow = Math.max(0, Math.floor(cy - radius));
  const lastRow = Math.min(size - 1, Math.ceil(cy + radius));
  let box: Box | null = null;
  for (let row = firstRow; row <= lastRow; row++) {
    const dy = row + 0.5 - cy;
    const half = Math.sqrt(Math.max(0, r2 - dy * dy));
    const from = Math.max(0, Math.ceil(cx - half - 0.5));
    const to = Math.min(size - 1, Math.floor(cx + half - 0.5));
    if (from > to) continue;
    for (let column = from; column <= to; column++) mask[row * size + column] = 1;
    box = union(box, { x0: from, y0: row, x1: to, y1: row });
  }
  return { mask, box };
}

export function circleMask(window: CanopyWindow, center: LatLng, radiusM: number): Uint8Array {
  return circleArea(window, center, radiusM).mask;
}

/** The mask of a job's area (see `CanopyArea`). */
export function areaMask(
  window: CanopyWindow,
  area: CanopyArea,
): { mask: Uint8Array; box: Box | null } {
  return area.kind === "circle"
    ? circleArea(window, area.center, area.radiusM)
    : polygonArea(window, area.rings);
}

// ─── Canopy cover ──────────────────────────────────────────────────────────

/** Tree canopy cover over a mask of the window (see the file comment for the definition). */
export function canopyCover(grid: CanopyGrid, mask: Uint8Array, box?: Box | null): CanopyCover {
  const { ground, feet, window } = grid;
  const { size } = window;
  const area = box === undefined ? wholeWindow(size) : box;
  let inside = 0;
  let surveyed = 0;
  let measured = 0;
  let canopy = 0;
  let tallest = 0;
  const groups = [0, 0, 0];
  if (area) {
    for (let row = area.y0; row <= area.y1; row++) {
      for (let i = row * size + area.x0, end = row * size + area.x1; i <= end; i++) {
        if (!mask[i]) continue;
        inside++;
        const kind = ground[i];
        if (kind === GROUND_NO_DATA) continue;
        surveyed++;
        if (kind === GROUND_BUILDING) continue;
        measured++;
        if (kind !== GROUND_TREE) continue;
        canopy++;
        const height = feet[i];
        if (height > tallest) tallest = height;
        groups[
          height >= CANOPY_HEIGHT_GROUPS_FT[2] ? 2 : height >= CANOPY_HEIGHT_GROUPS_FT[1] ? 1 : 0
        ]++;
      }
    }
  }
  const pixelM2 = metresPerPixel(window) ** 2;
  return {
    groundM2: measured * pixelM2,
    canopyM2: canopy * pixelM2,
    cover: measured > 0 ? canopy / measured : null,
    tallestFt: canopy > 0 ? tallest : null,
    heightShares: canopy > 0 ? [groups[0] / canopy, groups[1] / canopy, groups[2] / canopy] : null,
    surveyed: inside > 0 ? surveyed / inside : 0,
  };
}

/**
 * The tallest canopy within `radiusM` of a spot (a street tree's trunk),
 * feet: 0 where the survey saw nothing 10 ft tall there; null where it has
 * no data at all, or the spot is outside the window.
 */
export function heightNear(grid: CanopyGrid, spot: LatLng, radiusM: number): number | null {
  const { window, ground, feet } = grid;
  const { size } = window;
  const { x, y } = windowPixel(window, spot);
  const radius = radiusM / metresPerPixel(window);
  let surveyed = false;
  let tallest = 0;
  for (
    let row = Math.max(0, Math.floor(y - radius));
    row <= Math.min(size - 1, y + radius);
    row++
  ) {
    for (
      let column = Math.max(0, Math.floor(x - radius));
      column <= Math.min(size - 1, x + radius);
      column++
    ) {
      if (Math.hypot(column + 0.5 - x, row + 0.5 - y) > radius) continue;
      const i = row * size + column;
      if (ground[i] === GROUND_NO_DATA) continue;
      surveyed = true;
      if (ground[i] === GROUND_TREE && feet[i] > tallest) tallest = feet[i];
    }
  }
  return surveyed ? tallest : null;
}

/** Every pixel index of a box, row by row. */
function forBox(
  size: number,
  box: Box,
  visit: (i: number, column: number, row: number) => void,
): void {
  for (let row = box.y0; row <= box.y1; row++) {
    for (let column = box.x0; column <= box.x1; column++) visit(row * size + column, column, row);
  }
}

// ─── Crowns ────────────────────────────────────────────────────────────────

/** A crown's top must be at least this tall, feet. */
export const CROWN_MIN_FT = 20;
/** Two tops closer than this, metres, are one crown. */
export const CROWN_SPACING_M = 3;

/**
 * Roughly how many tree crowns have their top inside a mask: the highest
 * points of the canopy, at least `CROWN_MIN_FT` tall, each the highest within
 * `CROWN_SPACING_M` around it (ties go to the first in reading order).
 * A rough count: two trees whose crowns have merged may count as one, and a
 * broad crown with two tops as two.
 */
export function countCrowns(grid: CanopyGrid, mask: Uint8Array, box?: Box | null): number {
  const { window, ground, feet } = grid;
  const { size } = window;
  const area = box === undefined ? wholeWindow(size) : box;
  if (!area) return 0;
  const radius = Math.max(1, Math.round(CROWN_SPACING_M / metresPerPixel(window)));
  let crowns = 0;
  for (let row = area.y0; row <= area.y1; row++) {
    for (let column = area.x0; column <= area.x1; column++) {
      const i = row * size + column;
      if (!mask[i] || ground[i] !== GROUND_TREE || feet[i] < CROWN_MIN_FT) continue;
      const height = feet[i];
      let top = true;
      for (let r = Math.max(0, row - radius); top && r <= Math.min(size - 1, row + radius); r++) {
        for (let c = Math.max(0, column - radius); c <= Math.min(size - 1, column + radius); c++) {
          const j = r * size + c;
          if (j === i || ground[j] !== GROUND_TREE) continue;
          if (feet[j] > height || (feet[j] === height && j < i)) {
            top = false;
            break;
          }
        }
      }
      if (top) crowns++;
    }
  }
  return crowns;
}

// ─── The backyard ──────────────────────────────────────────────────────────

export type Side = "north" | "east" | "south" | "west";
const SIDES: readonly Side[] = ["north", "east", "south", "west"];

/**
 * Which sides of an area its canopy is on, as seen from the area's middle:
 * the share of the canopy in each quarter (north = bearings 315°–45°, …),
 * largest first.
 */
export function canopySides(
  grid: CanopyGrid,
  mask: Uint8Array,
  box?: Box | null,
): { side: Side; share: number }[] {
  const { size } = grid.window;
  const area = box === undefined ? wholeWindow(size) : box;
  if (!area) return [];
  let sx = 0;
  let sy = 0;
  let n = 0;
  forBox(size, area, (i, column, row) => {
    if (!mask[i]) return;
    sx += column + 0.5;
    sy += row + 0.5;
    n++;
  });
  if (n === 0) return [];
  const cx = sx / n;
  const cy = sy / n;
  const counts = [0, 0, 0, 0];
  let trees = 0;
  forBox(size, area, (i, column, row) => {
    if (!mask[i] || grid.ground[i] !== GROUND_TREE) return;
    const bearing = (Math.atan2(column + 0.5 - cx, cy - (row + 0.5)) * 180) / Math.PI;
    counts[Math.round(((bearing + 360) % 360) / 90) % 4]++;
    trees++;
  });
  if (trees === 0) return [];
  return SIDES.map((side, i) => ({ side, share: counts[i] / trees })).sort(
    (a, b) => b.share - a.share || SIDES.indexOf(a.side) - SIDES.indexOf(b.side),
  );
}

export interface LotInput {
  rings: readonly (readonly LatLng[])[];
  areaSqFt: number | null;
}

export type BackyardUnavailable =
  /** The lot is not in the window (or has no area there). */
  | "outside"
  /** Bigger than an acre: a school, a park, an apartment block. */
  | "large-lot"
  /** More buildings than a house, a garage and a shed. */
  | "many-buildings"
  /** No building on the lot. */
  | "no-house"
  /** Which side faces the street is not known. */
  | "no-street"
  /** Nothing of the lot lies behind the house. */
  | "no-yard";

export interface LotCanopy {
  /** The whole lot, its buildings cut out; null when the lot is not in the window. */
  lot: CanopyCover | null;
  backyard:
    | {
        kind: "ok";
        cover: CanopyCover;
        /** Ground of the backyard, square feet. */
        yardSqFt: number;
        crowns: number;
        sides: { side: Side; share: number }[];
      }
    | { kind: "unavailable"; reason: BackyardUnavailable };
}

/**
 * The lot and its backyard. The backyard is the part of the lot behind the
 * house, on the far side of the house from the street: the house is the
 * lot's biggest building, the street is where `front` is (a street tree
 * recorded at this address, which stands in the right-of-way in front of
 * it), and "behind" is every bit of the lot (its buildings cut out) beyond
 * the house's middle, measured along the line from the street to the house.
 */
export function lotCanopy(grid: CanopyGrid, lot: LotInput, front: LatLng | null): LotCanopy {
  const { window, ground, labels } = grid;
  const { size } = window;
  const { mask: lotMask, box } = polygonArea(window, lot.rings);
  let lotPixels = 0;
  if (box) forBox(size, box, (i) => (lotPixels += lotMask[i]));
  if (!box || lotPixels === 0) {
    return { lot: null, backyard: { kind: "unavailable", reason: "outside" } };
  }
  const lotCover = canopyCover(grid, lotMask, box);
  const unavailable = (reason: BackyardUnavailable): LotCanopy => ({
    lot: lotCover,
    backyard: { kind: "unavailable", reason },
  });
  if (lot.areaSqFt !== null && lot.areaSqFt > HOUSE_LOT_MAX_SQ_FT) return unavailable("large-lot");
  if (!labels) return unavailable("no-house");

  // The buildings on the lot, by how much of each is on it.
  const pixelM2 = metresPerPixel(window) ** 2;
  const onLot = new Map<number, number>();
  forBox(size, box, (i) => {
    if (lotMask[i] && labels[i] > 0) onLot.set(labels[i], (onLot.get(labels[i]) ?? 0) + 1);
  });
  const buildings = [...onLot].filter(([, pixels]) => pixels * pixelM2 >= BUILDING_MIN_M2);
  if (buildings.length === 0) return unavailable("no-house");
  if (buildings.length > HOUSE_LOT_MAX_BUILDINGS) return unavailable("many-buildings");
  const house = buildings.sort((a, b) => b[1] - a[1])[0][0];

  // The house's middle: its pixels on and around the lot (a house is on its own lot, mostly).
  const margin = Math.ceil(30 / metresPerPixel(window));
  const around = {
    x0: Math.max(0, box.x0 - margin),
    y0: Math.max(0, box.y0 - margin),
    x1: Math.min(size - 1, box.x1 + margin),
    y1: Math.min(size - 1, box.y1 + margin),
  };
  let hx = 0;
  let hy = 0;
  let hn = 0;
  forBox(size, around, (i, column, row) => {
    if (labels[i] !== house) return;
    hx += column + 0.5;
    hy += row + 0.5;
    hn++;
  });
  hx /= hn;
  hy /= hn;
  if (!front) return unavailable("no-street");
  const street = windowPixel(window, front);
  const ux = street.x - hx;
  const uy = street.y - hy;
  if (Math.hypot(ux, uy) < 1) return unavailable("no-street");

  const yard = new Uint8Array(size * size);
  let yardPixels = 0;
  forBox(size, box, (i, column, row) => {
    if (!lotMask[i] || ground[i] === GROUND_BUILDING || ground[i] === GROUND_NO_DATA) return;
    if ((column + 0.5 - hx) * ux + (row + 0.5 - hy) * uy < 0) {
      yard[i] = 1;
      yardPixels++;
    }
  });
  if (yardPixels === 0) return unavailable("no-yard");
  const cover = canopyCover(grid, yard, box);
  return {
    lot: lotCover,
    backyard: {
      kind: "ok",
      cover,
      yardSqFt: cover.groundM2 * SQ_FT_PER_M2,
      crowns: countCrowns(grid, yard, box),
      sides: canopySides(grid, yard, box),
    },
  };
}

export function squareFeet(m2: number): number {
  return m2 * SQ_FT_PER_M2;
}
