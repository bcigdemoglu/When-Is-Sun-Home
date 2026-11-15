/**
 * TEST HELPERS ONLY — never import this from application code (it reads from
 * the file system).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

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

/** PNG scanline filter types. */
export type PngFilter = 0 | 1 | 2 | 3 | 4;

/**
 * Encode RGBA pixels as a real PNG file (8-bit, non-interlaced), for feeding
 * the decoder. `filter` chooses the scanline filter (one for all rows, or one
 * per row); `alpha` writes RGBA instead of RGB; `idatChunks` splits the image
 * data over several chunks as real encoders do.
 */
export function encodePng(
  width: number,
  height: number,
  rgba: ArrayLike<number>,
  options: {
    filter?: PngFilter | ((row: number) => PngFilter);
    alpha?: boolean;
    idatChunks?: number;
  } = {},
): Uint8Array {
  const channels = options.alpha ? 4 : 3;
  const stride = width * channels;
  const filterOf =
    typeof options.filter === "function"
      ? options.filter
      : () => (options.filter ?? 0) as PngFilter;
  const pixel = (x: number, y: number, c: number) =>
    x < 0 || y < 0 ? 0 : rgba[4 * (y * width + x) + c];
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y);
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const left = pixel(x - 1, y, c);
        const up = pixel(x, y - 1, c);
        const upLeft = pixel(x - 1, y - 1, c);
        let predicted = 0;
        if (filter === 1) predicted = left;
        else if (filter === 2) predicted = up;
        else if (filter === 3) predicted = (left + up) >> 1;
        else if (filter === 4) {
          const estimate = left + up - upLeft;
          const dLeft = Math.abs(estimate - left);
          const dUp = Math.abs(estimate - up);
          const dUpLeft = Math.abs(estimate - upLeft);
          predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
        }
        raw[y * (stride + 1) + 1 + x * channels + c] = (pixel(x, y, c) - predicted) & 0xff;
      }
    }
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = options.alpha ? 6 : 2; // truecolour (+ alpha)
  const compressed = deflateSync(raw);
  const parts = Math.max(1, options.idatChunks ?? 1);
  const size = Math.ceil(compressed.length / parts);
  const idat: Buffer[] = [];
  for (let i = 0; i < compressed.length; i += size) {
    idat.push(chunk("IDAT", compressed.subarray(i, i + size)));
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("tEXt", Buffer.from("Comment\0made for a test")),
      ...idat,
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
