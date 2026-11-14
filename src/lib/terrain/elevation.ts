/**
 * Sampling ground elevation from an {@link ElevationGrid}.
 */
import type { ElevationGrid, LatLng, Terrain } from "@/lib/types";

/** Is the local point (x, y) within the area the grid has nodes for? */
export function gridContains(grid: ElevationGrid, x: number, y: number): boolean {
  return (
    x >= grid.minX &&
    y >= grid.minY &&
    x <= grid.minX + (grid.width - 1) * grid.cellSizeM &&
    y <= grid.minY + (grid.height - 1) * grid.cellSizeM
  );
}

/**
 * Ground elevation (metres above sea level) at the local point (x east,
 * y north) of the grid's frame, bilinearly interpolated between the four
 * surrounding nodes. Points outside the grid take the value of the nearest
 * edge (clamped), so the function is defined everywhere.
 */
export function elevationAt(grid: ElevationGrid, x: number, y: number): number {
  const { width, height, data } = grid;
  let gx = (x - grid.minX) / grid.cellSizeM;
  let gy = (y - grid.minY) / grid.cellSizeM;
  const maxX = width - 1;
  const maxY = height - 1;
  gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
  gy = gy < 0 ? 0 : gy > maxY ? maxY : gy;

  // Lower-left node of the cell; on the last row/column step back one cell so
  // the neighbour always exists (a 1-wide grid has no neighbour at all).
  let col = Math.floor(gx);
  let row = Math.floor(gy);
  if (col >= maxX) col = maxX > 0 ? maxX - 1 : 0;
  if (row >= maxY) row = maxY > 0 ? maxY - 1 : 0;
  const fx = gx - col;
  const fy = gy - row;
  const colEast = col < maxX ? col + 1 : col;
  const rowNorth = row < maxY ? row + 1 : row;

  const southWest = data[row * width + col];
  const southEast = data[row * width + colEast];
  const northWest = data[rowNorth * width + col];
  const northEast = data[rowNorth * width + colEast];
  // Written as "a + (b − a)·f" so that a flat grid returns its value exactly.
  const south = southWest + (southEast - southWest) * fx;
  const north = northWest + (northEast - northWest) * fx;
  return south + (north - south) * fy;
}

/**
 * Ground elevation from a two-scale {@link Terrain}: the fine `near` grid
 * where it has data, the coarse `far` grid beyond it, and the nearest edge of
 * whichever grid reaches furthest outside both.
 */
export function terrainElevationAt(terrain: Terrain, x: number, y: number): number {
  const { near, far } = terrain;
  if (far === undefined || gridContains(near, x, y)) return elevationAt(near, x, y);
  return elevationAt(far, x, y);
}

export interface GridLayout {
  /** Local x of column 0 / y of row 0, metres. */
  minX: number;
  minY: number;
  cellSizeM: number;
  width: number;
  height: number;
}

/**
 * Build a grid by evaluating `elevation(x, y)` at every node. Handy for tests
 * and synthetic terrain.
 */
export function elevationGridFrom(
  origin: LatLng,
  layout: GridLayout,
  elevation: (x: number, y: number) => number,
): ElevationGrid {
  const { minX, minY, cellSizeM, width, height } = layout;
  if (
    !(cellSizeM > 0) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError("elevationGridFrom: invalid grid layout");
  }
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data[row * width + col] = elevation(minX + col * cellSizeM, minY + row * cellSizeM);
    }
  }
  return {
    origin: { lat: origin.lat, lng: origin.lng },
    cellSizeM,
    width,
    height,
    minX,
    minY,
    data,
  };
}
