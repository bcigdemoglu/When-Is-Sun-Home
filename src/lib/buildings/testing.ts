/**
 * Test helpers for building data: a minimal Mapbox Vector Tile encoder, so
 * tests can hand-make tiles shaped like OpenFreeMap's. Not used by the app.
 */
import { PbfWriter } from "pbf";
import type { LatLng } from "@/lib/types";
import { BUILDING_TILE_ZOOM, latToTileY, lngToTileX, type TileRef } from "./vectorTiles";

export type XY = [number, number];

export interface FakeTileFeature {
  /** Each polygon: outer ring first, then holes. Rings are open (no repeated first point). */
  polygons: XY[][][];
  /** `render_height`. Default 10. */
  height?: number;
  /** `render_min_height`. Default 0. */
  minHeight?: number;
  hide3d?: boolean;
  /** 3 = polygon (default), 2 = line, 1 = point. */
  type?: number;
}

function area2(ring: XY[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/** Encode a tile with one layer (default "building") the way OpenMapTiles does. */
export function encodeBuildingTile(
  features: FakeTileFeature[],
  layerName = "building",
  extent = 4096,
): Uint8Array {
  const keys = ["render_height", "render_min_height", "hide_3d"];
  const values: (number | boolean)[] = [];
  const valueIndex = (value: number | boolean) => {
    let index = values.indexOf(value);
    if (index === -1) index = values.push(value) - 1;
    return index;
  };

  const pbf = new PbfWriter();
  pbf.writeMessage(
    3,
    (_, layer) => {
      layer.writeVarintField(15, 2);
      layer.writeStringField(1, layerName);
      for (const feature of features) {
        const tags = [0, valueIndex(feature.height ?? 10), 1, valueIndex(feature.minHeight ?? 0)];
        if (feature.hide3d) tags.push(2, valueIndex(true));
        const geometry: number[] = [];
        let cx = 0;
        let cy = 0;
        for (const polygon of feature.polygons) {
          polygon.forEach((ring, r) => {
            // Outer rings one way round, holes the other, as the spec requires.
            const outerSign = area2(ring) > 0;
            const points = outerSign === (r === 0) ? ring : [...ring].reverse();
            geometry.push((1 << 3) | 1, zigzag(points[0][0] - cx), zigzag(points[0][1] - cy));
            [cx, cy] = points[0];
            geometry.push(((points.length - 1) << 3) | 2);
            for (const [x, y] of points.slice(1)) {
              geometry.push(zigzag(x - cx), zigzag(y - cy));
              [cx, cy] = [x, y];
            }
            geometry.push((1 << 3) | 7);
          });
        }
        layer.writeMessage(
          2,
          (__, f) => {
            f.writePackedVarint(2, tags);
            f.writeVarintField(3, feature.type ?? 3);
            f.writePackedVarint(4, geometry);
          },
          null,
        );
      }
      for (const key of keys) layer.writeStringField(3, key);
      for (const value of values) {
        layer.writeMessage(
          4,
          (__, v) => {
            if (typeof value === "boolean") v.writeBooleanField(7, value);
            else v.writeVarintField(5, value);
          },
          null,
        );
      }
      layer.writeVarintField(5, extent);
    },
    null,
  );
  return pbf.finish();
}

export function box(x1: number, y1: number, x2: number, y2: number): XY[] {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/**
 * The z14 tile containing `center`, with one 40-unit square building per
 * given height, in a row starting at the centre. Good for "the network
 * returned these buildings" in loader and hook tests.
 */
export function tileWithBuildings(
  center: LatLng,
  heights: number[],
): { tile: TileRef; data: Uint8Array } {
  const z = BUILDING_TILE_ZOOM;
  const col = Math.floor(lngToTileX(center.lng, z));
  const row = Math.floor(latToTileY(center.lat, z));
  const x = Math.round((lngToTileX(center.lng, z) - col) * 4096);
  const y = Math.round((latToTileY(center.lat, z) - row) * 4096);
  const n = 2 ** z;
  // Keep the row inside the tile whichever corner the centre is near.
  const step = x > 2048 ? -60 : 60;
  return {
    tile: { z, x: ((col % n) + n) % n, y: row, col },
    data: encodeBuildingTile(
      heights.map((height, i) => ({
        polygons: [[box(x + i * step, y, x + i * step + 40, y + (y > 2048 ? -40 : 40))]],
        height,
      })),
    ),
  };
}
