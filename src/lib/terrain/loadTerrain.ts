/**
 * Fetching the terrain around a place.
 *
 * Tile selection, decoding and resampling are pure (see `tiles.ts`,
 * `terrarium.ts`, `resample.ts`). The only impure parts live here: the network
 * and turning a PNG into pixels, both injectable so that tests (and non-browser
 * hosts) can supply their own.
 */
import type { LatLng, Terrain } from "@/lib/types";

import { canDecodePng, decodePng, UnsupportedPngError } from "./png";
import { buildMosaic, resampleMosaic } from "./resample";
import { decodeTerrarium, type DecodedTile } from "./terrarium";
import {
  TERRARIUM_TILE_SIZE,
  TERRARIUM_URL_TEMPLATE,
  terrainCoverageFor,
  tilesOf,
  tileUrl,
  type TerrainCoverage,
  type TileBlock,
} from "./tiles";

export type DecodeTile = (blob: Blob) => Promise<DecodedTile>;

export interface LoadTerrainOptions {
  signal?: AbortSignal;
  /** Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** PNG blob → RGBA pixels. Defaults to {@link decodeTile}. */
  decodeTile?: DecodeTile;
  /** `{z}/{x}/{y}` URL template. Defaults to the AWS Terrarium tiles. */
  urlTemplate?: string;
}

/** Terrain could not be loaded. The app should carry on with flat ground. */
export class TerrainError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TerrainError";
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * The default tile decoder: PNG bytes → RGBA pixels, bit-exact.
 *
 * Uses the built-in PNG decoder (`png.ts`: no canvas, immune to colour
 * management and to browsers' anti-fingerprinting pixel noise) wherever the
 * runtime can inflate data, and only otherwise — or for a PNG flavour that
 * decoder does not handle — falls back to {@link decodeTileInBrowser}.
 */
export async function decodeTile(blob: Blob): Promise<DecodedTile> {
  if (canDecodePng()) {
    try {
      return await decodePng(new Uint8Array(await blob.arrayBuffer()));
    } catch (error) {
      if (!(error instanceof UnsupportedPngError)) {
        throw new TerrainError(
          `Could not decode terrain tile: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
  }
  return decodeTileInBrowser(blob);
}

/**
 * Fallback decoder: the browser's own image decoder plus a canvas read-back.
 *
 * Terrarium packs a number into the colour channels, so the pixels must come
 * back bit-exact: colour-space conversion and alpha premultiplication are
 * switched off, and the tiles are opaque, so a 2D canvas normally round-trips
 * them unchanged — but not in browsers that add anti-fingerprinting noise to
 * canvas read-backs, which is why this is only the fallback. Works on the
 * main thread and in workers (OffscreenCanvas).
 */
export async function decodeTileInBrowser(blob: Blob): Promise<DecodedTile> {
  if (typeof createImageBitmap !== "function") {
    throw new TerrainError("This environment cannot decode images (no createImageBitmap)");
  }
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const { width, height } = bitmap;
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new TerrainError("Could not create a 2D canvas to read terrain tiles");
    context.drawImage(bitmap, 0, 0);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

async function loadBlock(
  block: TileBlock,
  fetchImpl: typeof fetch,
  decode: DecodeTile,
  urlTemplate: string,
  signal: AbortSignal | undefined,
): Promise<Float32Array[]> {
  return Promise.all(
    tilesOf(block).map(async (tile) => {
      const url = tileUrl(tile, urlTemplate);
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        throw new TerrainError(
          `Terrain tile ${tile.z}/${tile.x}/${tile.y} failed: HTTP ${response.status}`,
        );
      }
      const decoded = await decode(await response.blob());
      if (decoded.width !== TERRARIUM_TILE_SIZE || decoded.height !== TERRARIUM_TILE_SIZE) {
        throw new TerrainError(
          `Terrain tile ${tile.z}/${tile.x}/${tile.y} is ${decoded.width}×${decoded.height}, expected ${TERRARIUM_TILE_SIZE}×${TERRARIUM_TILE_SIZE}`,
        );
      }
      return decodeTerrarium(decoded);
    }),
  );
}

/**
 * Load the ground elevation around `place`: a fine grid for the surroundings
 * and a coarse one for the hills on the horizon (thirteen 256 px tiles in all;
 * see `tiles.ts`). The result depends only on `terrainCoverageFor(place).key`.
 *
 * Rejects with a {@link TerrainError} if terrain is not available for the
 * place or any tile fails, and with the abort reason if `signal` fires.
 * Failure is never fatal for the app: without terrain the ground is flat.
 */
export async function loadTerrain(
  place: LatLng,
  options: LoadTerrainOptions = {},
): Promise<Terrain> {
  const coverage = terrainCoverageFor(place);
  if (!coverage) throw new TerrainError("No terrain data is available for this location");
  return loadTerrainForCoverage(coverage, options);
}

/** {@link loadTerrain} for an already-computed tile coverage. */
export async function loadTerrainForCoverage(
  coverage: TerrainCoverage,
  options: LoadTerrainOptions = {},
): Promise<Terrain> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TerrainError("No fetch implementation available");
  const decode = options.decodeTile ?? decodeTile;
  const urlTemplate = options.urlTemplate ?? TERRARIUM_URL_TEMPLATE;

  try {
    const [nearTiles, farTiles] = await Promise.all([
      loadBlock(coverage.near, fetchImpl, decode, urlTemplate, options.signal),
      loadBlock(coverage.far, fetchImpl, decode, urlTemplate, options.signal),
    ]);
    return {
      near: resampleMosaic(
        buildMosaic(coverage.near, nearTiles, TERRARIUM_TILE_SIZE),
        coverage.origin,
      ),
      far: resampleMosaic(
        buildMosaic(coverage.far, farTiles, TERRARIUM_TILE_SIZE),
        coverage.origin,
      ),
    };
  } catch (error) {
    if (isAbort(error) || error instanceof TerrainError) throw error;
    throw new TerrainError(
      `Could not load terrain: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
