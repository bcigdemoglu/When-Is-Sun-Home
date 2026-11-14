/**
 * TEST HELPERS ONLY — never import this from application code (it reads from
 * the file system).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ElevationGrid, LatLng, Terrain } from "@/lib/types";

import { tilesOf, tileXToLng, tileYToLat, type TileBlock } from "./tiles";

interface EncodedGrid {
  origin: LatLng;
  cellSizeM: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  /** base64 of little-endian Int16 decimetres. */
  data: string;
}

function decodeGrid(encoded: EncodedGrid): ElevationGrid {
  const bytes = Buffer.from(encoded.data, "base64");
  const count = encoded.width * encoded.height;
  if (bytes.length !== count * 2) throw new Error("terrain fixture: data length mismatch");
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = bytes.readInt16LE(2 * i) / 10;
  return {
    origin: encoded.origin,
    cellSizeM: encoded.cellSizeM,
    width: encoded.width,
    height: encoded.height,
    minX: encoded.minX,
    minY: encoded.minY,
    data,
  };
}

/**
 * Real ground elevation around the Pacific Heights fixture (San Francisco,
 * 37.7906, -122.4294): a crop of what `loadTerrain` builds for that place
 * (fine grid ±700 m, coarse grid ±6.5 km), from AWS Terrarium tiles.
 */
export function loadPacificHeightsTerrain(): Terrain {
  const file = path.resolve(process.cwd(), "tests/fixtures/terrain-pacific-heights.json");
  const fixture = JSON.parse(readFileSync(file, "utf8")) as { near: EncodedGrid; far: EncodedGrid };
  return { near: decodeGrid(fixture.near), far: decodeGrid(fixture.far) };
}

/** Tiles of a block filled with `elevation(lat, lng)` evaluated at every pixel CENTRE. */
export function syntheticTiles(
  block: TileBlock,
  elevation: (lat: number, lng: number) => number,
  tileSize = 256,
): Float32Array[] {
  return tilesOf(block).map((tile, index) => {
    // Use the block's own (unwrapped) column so longitudes stay continuous.
    const column = block.x0 + (index % block.cols);
    const pixels = new Float32Array(tileSize * tileSize);
    for (let j = 0; j < tileSize; j++) {
      const lat = tileYToLat(tile.y + (j + 0.5) / tileSize, tile.z);
      for (let i = 0; i < tileSize; i++) {
        const lng = tileXToLng(column + (i + 0.5) / tileSize, tile.z);
        pixels[j * tileSize + i] = elevation(lat, lng);
      }
    }
    return pixels;
  });
}
