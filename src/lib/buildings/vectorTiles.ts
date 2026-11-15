/**
 * Building footprints with heights from OpenFreeMap vector tiles
 * (https://openfreemap.org): free, keyless, CDN-hosted tiles in the
 * OpenMapTiles schema, generated weekly from OpenStreetMap.
 *
 * What the `building` layer of a z14 tile looks like (checked against real
 * tiles, November 2026):
 *
 *  - Every building is there, with the same outline as in OSM, quantised to
 *    the tile's 4096-unit grid (0.3–0.6 m).
 *  - Buildings are NOT separate features. All buildings of a tile that share
 *    the same attributes are merged into one multipolygon feature, so
 *    `feature.id` says nothing about a building. Each polygon of each
 *    feature is one building (or one `building:part`).
 *  - Attributes: `render_height` and `render_min_height` (whole metres),
 *    `colour`, `hide_3d`. No names, types or level counts.
 *  - `render_height` is the OSM `height`, else levels × 3.66 m, else 5 m.
 *    There is no flag for "nobody tagged a height": a 5 is taken to be that
 *    default, and every other value to be real. Level-based and measured
 *    heights cannot be told apart, so both are reported as "tagged".
 *  - `hide_3d` marks outlines whose `building:part`s are in the tile too.
 *  - Tiles overlap by a 64-unit buffer (20–40 m). Geometry is clipped at the
 *    buffer's edge, so a building near a tile edge is in both tiles: complete
 *    in both, or complete in one and cut in the other, or (when it reaches
 *    further than the buffer into both) cut in both.
 */
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { PbfReader } from "pbf";
import { z } from "zod";
import type { BuildingCollection, BuildingFeature, HeightSource, LatLng } from "@/lib/types";
import { FALLBACK_HEIGHT_M } from "./height";
import { abortErrorFrom, isAbortError, normalizeRing, refineDefaultHeights } from "./overpass";

// ─── Constants ─────────────────────────────────────────────────────────────

/** TileJSON of the current planet build. Names the versioned tile URL template. */
export const OPENFREEMAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
/**
 * Documented alias that always serves the latest build. Used only when the
 * TileJSON cannot be loaded and no earlier template is known (it is cached
 * for a day rather than for good).
 */
export const OPENFREEMAP_LATEST_TEMPLATE =
  "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";

/** The deepest zoom of the tile set, and the only one with every building. */
export const BUILDING_TILE_ZOOM = 14;
export const BUILDING_TILE_LAYER = "building";
/** `render_height` of a building with neither `height` nor `building:levels`. */
export const TILE_DEFAULT_HEIGHT_M = 5;

export const TILEJSON_MAX_AGE_MS = 60 * 60 * 1000;
/** After a failed TileJSON request, how long to go on without asking again. */
export const TILEJSON_RETRY_AFTER_MS = 60 * 1000;
export const TILEJSON_TIMEOUT_MS = 4_000;
/** Per tile, including its one retry. */
export const TILE_TIMEOUT_MS = 12_000;

/** Web Mercator stops here; no tiles beyond. */
const MAX_MERCATOR_LAT = 85.0511;
/** Pieces smaller than this (tile units², about 1 m²) are clipping debris. */
const MIN_PIECE_AREA_UNITS2 = 4;

// ─── Errors ────────────────────────────────────────────────────────────────

export type BuildingTilesErrorKind = "network" | "timeout" | "http" | "malformed";

export class BuildingTilesError extends Error {
  readonly kind: BuildingTilesErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(
    kind: BuildingTilesErrorKind,
    message: string,
    details: { status?: number; url?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "BuildingTilesError";
    this.kind = kind;
    this.status = details.status;
    this.url = details.url;
  }
}

// ─── Tile maths ────────────────────────────────────────────────────────────

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/**
 * A tile to fetch, plus its unwrapped column: `col` continues past the
 * antimeridian (-1, 2^z, …) so that neighbouring tiles stay neighbours.
 */
export interface TileRef extends TileId {
  col: number;
}

const DEG_TO_RAD = Math.PI / 180;

/** Fractional tile column of a longitude at `zoom`. Not wrapped. */
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** Fractional tile row (0 = north edge of the map) of a latitude at `zoom`. */
export function latToTileY(lat: number, zoom: number): number {
  const phi = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * DEG_TO_RAD;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom;
}

/** Longitude of a (fractional) tile column. Not wrapped. */
export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

/** Latitude of a (fractional) tile row. */
export function tileYToLat(y: number, zoom: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) / DEG_TO_RAD;
}

export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The bounding box of a circle on the ground. `west`/`east` are not wrapped. */
export function boundsOfCircle(center: LatLng, radiusM: number): LngLatBounds {
  const dLat = radiusM / 110_574;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos(center.lat * DEG_TO_RAD)));
  return {
    west: center.lng - dLng,
    east: center.lng + dLng,
    south: Math.max(-90, center.lat - dLat),
    north: Math.min(90, center.lat + dLat),
  };
}

/** Every tile at `zoom` that the bounding box of the circle touches, row by row. */
export function tilesForCircle(
  center: LatLng,
  radiusM: number,
  zoom: number = BUILDING_TILE_ZOOM,
): TileRef[] {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !(radiusM > 0)) {
    throw new RangeError("tilesForCircle: invalid centre or radius");
  }
  const n = 2 ** zoom;
  const bounds = boundsOfCircle(center, radiusM);
  const col0 = Math.floor(lngToTileX(bounds.west, zoom));
  const col1 = Math.floor(lngToTileX(bounds.east, zoom));
  const row0 = Math.max(0, Math.min(n - 1, Math.floor(latToTileY(bounds.north, zoom))));
  const row1 = Math.max(0, Math.min(n - 1, Math.floor(latToTileY(bounds.south, zoom))));

  const tiles: TileRef[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      tiles.push({ z: zoom, x: ((col % n) + n) % n, y: row, col });
    }
  }
  return tiles;
}

export function tileUrl(template: string, tile: TileId): string {
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}

// ─── TileJSON ──────────────────────────────────────────────────────────────

const tileJsonSchema = z.object({
  tiles: z.array(z.string()).min(1),
  maxzoom: z.number().optional(),
});

/** The tile URL template of a TileJSON document, or null if it is not usable for us. */
export function templateFromTileJson(json: unknown): string | null {
  const parsed = tileJsonSchema.safeParse(json);
  if (!parsed.success) return null;
  const { tiles, maxzoom } = parsed.data;
  if (maxzoom !== undefined && maxzoom < BUILDING_TILE_ZOOM) return null;
  const template = tiles[0];
  const valid =
    template.startsWith("https://") && ["{z}", "{x}", "{y}"].every((p) => template.includes(p));
  return valid ? template : null;
}

interface TemplateState {
  /** Last template a TileJSON gave us, if any. */
  template: string | null;
  /** When that TileJSON was loaded. */
  loadedAt: number;
  /** When the last TileJSON request failed. */
  failedAt: number;
}

const templateState: TemplateState = { template: null, loadedAt: -Infinity, failedAt: -Infinity };

/** Forget the remembered TileJSON (tests). */
export function resetTileTemplate(): void {
  templateState.template = null;
  templateState.loadedAt = -Infinity;
  templateState.failedAt = -Infinity;
}

export interface TileRequestOptions {
  /** Aborting rejects with an AbortError. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Run `request` with a time limit and the caller's signal combined into one. */
async function withTimeout<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  if (callerSignal?.aborted) throw abortErrorFrom(callerSignal);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (callerSignal?.aborted) throw abortErrorFrom(callerSignal);
    if (timedOut) throw onTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The tile URL template to use right now.
 *
 * Read from the TileJSON at most once an hour (`refresh` forces it). Never
 * fails for lack of a TileJSON: it falls back to the last template it saw,
 * and failing that to the "latest" alias. Rejects only when aborted.
 */
export async function loadTileTemplate(
  options: TileRequestOptions & { refresh?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const {
    signal,
    fetchImpl = globalThis.fetch,
    refresh = false,
    timeoutMs = TILEJSON_TIMEOUT_MS,
  } = options;
  if (signal?.aborted) throw abortErrorFrom(signal);

  const now = Date.now();
  const fallback = templateState.template ?? OPENFREEMAP_LATEST_TEMPLATE;
  if (!refresh) {
    if (templateState.template && now - templateState.loadedAt < TILEJSON_MAX_AGE_MS) {
      return templateState.template;
    }
    if (now - templateState.failedAt < TILEJSON_RETRY_AFTER_MS) return fallback;
  }

  try {
    const template = await withTimeout(
      timeoutMs,
      signal,
      async (requestSignal) => {
        const response = await fetchImpl(OPENFREEMAP_TILEJSON_URL, { signal: requestSignal });
        if (!response.ok) return null;
        return templateFromTileJson(await response.json());
      },
      () => new BuildingTilesError("timeout", "The tile index did not answer in time"),
    );
    if (!template) throw new BuildingTilesError("malformed", "The tile index is not usable");
    templateState.template = template;
    templateState.loadedAt = Date.now();
    return template;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    templateState.failedAt = Date.now();
    return fallback;
  }
}

// ─── Decoding ──────────────────────────────────────────────────────────────

type Ring = [number, number][];

/**
 * One polygon of one tile feature (one building, or one part of a building
 * that a tile edge cut off), in "world" tile units: `col * extent + x`.
 */
interface Piece {
  /** e.g. "tile/14/2620/6331/17.3": tile, feature index, polygon index. */
  id: string;
  col: number;
  row: number;
  /** The attributes that must agree for two pieces to be the same building. */
  attributes: string;
  renderHeight: number;
  /** Outer ring first, then its holes. */
  rings: Ring[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Midpoints of the edges the tile's clipping left behind, by side (W, N, E, S). */
  cutEdges: [Ring, Ring, Ring, Ring];
}

interface DecodedTile {
  /** Null when the tile has no building layer at all. */
  extent: number | null;
  /** In tile-local units until `placePieces` has run. */
  pieces: Piece[];
  /** How far the layer's geometry reaches beyond the tile's own square, in units. */
  overshoot: number;
}

function ringArea2(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/**
 * Decode the building layer of one tile into pieces.
 *
 * Skipped: `hide_3d` outlines (their parts are in the layer and model the
 * building better), anything that is not a polygon, clipping debris, and
 * polygons lying wholly in the tile's buffer (the neighbouring tile owns
 * those).
 */
function decodeTile(
  data: ArrayBuffer | Uint8Array,
  tile: TileRef,
  /** The area of interest in tile-local units of a 1 × 1 tile (0..1), if any. */
  window: { minX: number; minY: number; maxX: number; maxY: number } | null,
): DecodedTile {
  let layer;
  try {
    layer = new VectorTile(new PbfReader(data)).layers[BUILDING_TILE_LAYER];
  } catch (cause) {
    throw new BuildingTilesError("malformed", `Tile ${tile.z}/${tile.x}/${tile.y} is unreadable`, {
      cause,
    });
  }
  if (!layer) return { extent: null, pieces: [], overshoot: 0 };

  const extent = layer.extent;
  const candidates: Piece[] = [];
  let overshoot = 0;

  try {
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f);
      if (feature.type !== 3) continue;
      const polygons = classifyRings(feature.loadGeometry());
      const hidden = feature.properties.hide_3d === true;
      const renderHeight = Number(feature.properties.render_height);
      const attributes = `${feature.properties.render_height}|${feature.properties.render_min_height}`;

      polygons.forEach((polygon, p) => {
        const outline = polygon[0];
        if (!outline || outline.length < 4) return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const { x, y } of outline) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        overshoot = Math.max(overshoot, -minX, -minY, maxX - extent, maxY - extent);

        if (hidden) return;
        // Wholly inside the buffer: the neighbouring tile has it too, and in full.
        if (!(maxX > 0 && minX < extent && maxY > 0 && minY < extent)) return;
        // Far from the area of interest. (Anything reaching into the buffer
        // is kept regardless: it may be half of a building that is near.)
        const reachesBuffer = minX < 0 || minY < 0 || maxX > extent || maxY > extent;
        if (
          window &&
          !reachesBuffer &&
          !(
            maxX >= window.minX * extent &&
            minX <= window.maxX * extent &&
            maxY >= window.minY * extent &&
            minY <= window.maxY * extent
          )
        ) {
          return;
        }

        const rings: Ring[] = polygon.map((ring) => ring.map((point) => [point.x, point.y]));
        const outer = rings[0];
        if (Math.abs(ringArea2(outer)) < 2 * MIN_PIECE_AREA_UNITS2) return;

        candidates.push({
          id: `tile/${tile.z}/${tile.x}/${tile.y}/${f}.${p}`,
          col: tile.col,
          row: tile.y,
          attributes,
          renderHeight,
          rings,
          // Tile-local for now; `placePieces` shifts them to world units.
          minX,
          minY,
          maxX,
          maxY,
          cutEdges: [[], [], [], []],
        });
      });
    }
  } catch (cause) {
    if (cause instanceof BuildingTilesError) throw cause;
    throw new BuildingTilesError("malformed", `Tile ${tile.z}/${tile.x}/${tile.y} is corrupt`, {
      cause,
    });
  }

  return { extent, pieces: candidates, overshoot };
}

/**
 * Second pass over a decoded tile: find the edges its clipping left behind
 * and move the pieces from tile-local to world units.
 *
 * `buffer` is the width of the tile set's buffer: geometry is clipped
 * exactly that far outside each tile, so an edge lying on that line is
 * where a building was cut off.
 */
function placePieces(decoded: DecodedTile, tile: TileRef, extent: number, buffer: number): void {
  const offsetX = tile.col * extent;
  const offsetY = tile.y * extent;
  const limitW = -buffer;
  const limitN = -buffer;
  const limitE = extent + buffer;
  const limitS = extent + buffer;

  for (const piece of decoded.pieces) {
    const cutW = buffer > 0 && piece.minX === limitW;
    const cutN = buffer > 0 && piece.minY === limitN;
    const cutE = buffer > 0 && piece.maxX === limitE;
    const cutS = buffer > 0 && piece.maxY === limitS;
    if (cutW || cutN || cutE || cutS) {
      for (const ring of piece.rings) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          const mid: [number, number] = [(x1 + x2) / 2 + offsetX, (y1 + y2) / 2 + offsetY];
          if (cutW && x1 === limitW && x2 === limitW) piece.cutEdges[0].push(mid);
          else if (cutE && x1 === limitE && x2 === limitE) piece.cutEdges[2].push(mid);
          else if (cutN && y1 === limitN && y2 === limitN) piece.cutEdges[1].push(mid);
          else if (cutS && y1 === limitS && y2 === limitS) piece.cutEdges[3].push(mid);
        }
      }
    }
    for (const ring of piece.rings) {
      for (const point of ring) {
        point[0] += offsetX;
        point[1] += offsetY;
      }
    }
    piece.minX += offsetX;
    piece.maxX += offsetX;
    piece.minY += offsetY;
    piece.maxY += offsetY;
  }
}

function isCut(piece: Piece): boolean {
  return piece.cutEdges.some((edges) => edges.length > 0);
}

/** Even-odd test against an outer ring and its holes. */
function pieceContains(piece: Piece, x: number, y: number): boolean {
  if (x < piece.minX || x > piece.maxX || y < piece.minY || y > piece.maxY) return false;
  let inside = false;
  for (const ring of piece.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** A cheap fingerprint: equal for the byte-identical copies two tiles hold of one polygon. */
function fingerprint(piece: Piece): string {
  let checksum = 0;
  for (const ring of piece.rings) {
    for (const [x, y] of ring) checksum = (checksum * 31 + x * 7 + y) % 4_294_967_291;
  }
  return [
    piece.attributes,
    piece.minX,
    piece.minY,
    piece.maxX,
    piece.maxY,
    piece.rings.map((ring) => ring.length).join("."),
    checksum,
  ].join("|");
}

/** Column and row offsets of the neighbour on each side (W, N, E, S). */
const NEIGHBOUR = [
  [-1, 0],
  [0, -1],
  [1, 0],
  [0, 1],
] as const;

/**
 * Sort the pieces of several tiles into buildings: one group per building.
 *
 *  1. A polygon that two tiles hold in full (it lies in their shared buffer)
 *     is kept once.
 *  2. A polygon that a tile holds only in part, because the tile's clipping
 *     cut it, is looked up in the neighbour on that side: the middle of the
 *     cut lies inside the same building there. If the neighbour has the
 *     whole building, the partial copy is dropped. If the neighbour's copy is
 *     cut as well (the building reaches further than the buffer into both
 *     tiles), the two halves become one group; they overlap in the buffer.
 *
 * Pieces only ever join when their height attributes agree.
 */
function groupPieces(tiles: DecodedTile[]): Piece[][] {
  // Step 1. `canonical` maps every copy of a polygon to the one that is kept.
  const firstByFingerprint = new Map<string, Piece>();
  const canonical = new Map<Piece, Piece>();
  const pieces: Piece[] = [];
  // Every tile's own pieces (copies included), for the lookup in step 2.
  const byTile = new Map<string, Piece[]>();
  for (const tile of tiles) {
    for (const piece of tile.pieces) {
      const key = fingerprint(piece);
      const first = firstByFingerprint.get(key);
      if (first) {
        canonical.set(piece, first);
      } else {
        firstByFingerprint.set(key, piece);
        canonical.set(piece, piece);
        pieces.push(piece);
      }
      const tileKey = `${piece.col}/${piece.row}/${piece.attributes}`;
      const list = byTile.get(tileKey);
      if (list) list.push(piece);
      else byTile.set(tileKey, [piece]);
    }
  }

  const parent = new Map<Piece, Piece>();
  const find = (piece: Piece): Piece => {
    let root = piece;
    for (let next = parent.get(root); next; next = parent.get(root)) root = next;
    return root;
  };
  const dropped = new Set<Piece>();

  for (const piece of pieces) {
    if (!isCut(piece)) continue;
    for (let side = 0; side < 4; side++) {
      const cuts = piece.cutEdges[side];
      if (cuts.length === 0) continue;
      const [dCol, dRow] = NEIGHBOUR[side];
      const neighbours = byTile.get(`${piece.col + dCol}/${piece.row + dRow}/${piece.attributes}`);
      if (!neighbours) continue;
      for (const [x, y] of cuts) {
        const other = neighbours.find((candidate) => pieceContains(candidate, x, y));
        if (!other) continue;
        if (!isCut(other)) {
          // The neighbour has the whole building.
          dropped.add(piece);
        } else {
          const a = find(piece);
          const b = find(canonical.get(other) ?? other);
          if (a !== b) parent.set(b, a);
        }
      }
    }
  }

  const groups = new Map<Piece, Piece[]>();
  for (const piece of pieces) {
    if (dropped.has(piece)) continue;
    const root = find(piece);
    const group = groups.get(root);
    if (group) group.push(piece);
    else groups.set(root, [piece]);
  }
  return [...groups.values()];
}

// ─── Conversion ────────────────────────────────────────────────────────────

function roundCoordinate(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** How `render_height` maps onto our height model. See the notes at the top of this file. */
export function heightFromRenderHeight(renderHeight: unknown): {
  heightM: number;
  heightSource: HeightSource;
} {
  if (
    typeof renderHeight !== "number" ||
    !Number.isFinite(renderHeight) ||
    renderHeight <= 0 ||
    renderHeight === TILE_DEFAULT_HEIGHT_M
  ) {
    // Refined afterwards from the buildings around it (`refineDefaultHeights`).
    return { heightM: FALLBACK_HEIGHT_M, heightSource: "default" };
  }
  return { heightM: Math.min(renderHeight, 1000), heightSource: "tagged" };
}

export interface DecodeBuildingTilesOptions {
  /** Keep only buildings whose bounding box touches this one. */
  bounds?: LngLatBounds;
}

/**
 * Turn the raw bytes of one or more z14 tiles into a `BuildingCollection`.
 *
 * Every building becomes one feature, also when a tile edge runs through it:
 * a feature is then a MultiPolygon of the halves the tiles hold (the halves
 * overlap by the width of the tile buffer). All features have
 * `kind: "yes"`, `levels: null` and no name; see the top of this file for
 * what the heights mean. Buildings are treated as solid from the ground up
 * (`render_min_height` is ignored).
 */
export function decodeBuildingTiles(
  tiles: readonly { tile: TileRef; data: ArrayBuffer | Uint8Array }[],
  options: DecodeBuildingTilesOptions = {},
): BuildingCollection {
  const { bounds } = options;
  const decoded = tiles
    // An empty body is an empty tile (open water, or a 204 from the server).
    .filter(({ data }) => data.byteLength > 0)
    .map(({ tile, data }) => {
      const local = bounds && {
        minX: lngToTileX(bounds.west, tile.z) - tile.col,
        maxX: lngToTileX(bounds.east, tile.z) - tile.col,
        minY: latToTileY(bounds.north, tile.z) - tile.y,
        maxY: latToTileY(bounds.south, tile.z) - tile.y,
      };
      return { tile, ...decodeTile(data, tile, local ?? null) };
    })
    .filter((tile): tile is typeof tile & { extent: number } => tile.extent !== null)
    // A fixed order (west to east, north to south), whatever order the tiles
    // arrived in, so that ids and feature order are reproducible.
    .sort((a, b) => a.tile.y - b.tile.y || a.tile.col - b.tile.col);
  if (decoded.length === 0) return { type: "FeatureCollection", features: [] };

  const extent = decoded[0].extent;
  const zoom = decoded[0].tile.z;
  if (decoded.some((tile) => tile.extent !== extent || tile.tile.z !== zoom)) {
    throw new BuildingTilesError(
      "malformed",
      "Tiles of different zooms or extents cannot be mixed",
    );
  }
  // The buffer is a property of the tile set, not of one tile: wherever a
  // building was really cut, it was cut exactly this far outside its tile.
  const buffer = Math.max(...decoded.map((tile) => tile.overshoot));
  for (const tile of decoded) placePieces(tile, tile.tile, extent, buffer);

  const worldSize = extent * 2 ** zoom;
  const toPosition = ([x, y]: [number, number]): Position => [
    roundCoordinate(wrapLng((x / worldSize) * 360 - 180)),
    roundCoordinate(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize))) / DEG_TO_RAD),
  ];

  // The requested bounds in world units, for the "is it near enough" test.
  const window = bounds && {
    minX: lngToTileX(bounds.west, zoom) * extent,
    maxX: lngToTileX(bounds.east, zoom) * extent,
    minY: latToTileY(bounds.north, zoom) * extent,
    maxY: latToTileY(bounds.south, zoom) * extent,
  };

  const features: BuildingFeature[] = [];
  for (const group of groupPieces(decoded)) {
    if (
      window &&
      !group.some(
        (piece) =>
          piece.maxX >= window.minX &&
          piece.minX <= window.maxX &&
          piece.maxY >= window.minY &&
          piece.minY <= window.maxY,
      )
    ) {
      continue;
    }

    const polygons: Position[][][] = [];
    for (const piece of group) {
      const outer = normalizeRing(piece.rings[0].map(toPosition), "ccw");
      if (!outer) continue;
      const holes = piece.rings
        .slice(1)
        .map((ring) => normalizeRing(ring.map(toPosition), "cw"))
        .filter((ring): ring is Position[] => ring !== null);
      polygons.push([outer, ...holes]);
    }
    if (polygons.length === 0) continue;

    const geometry: Polygon | MultiPolygon =
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons };
    features.push({
      type: "Feature",
      properties: {
        id: group[0].id,
        ...heightFromRenderHeight(group[0].renderHeight),
        levels: null,
        kind: "yes",
      },
      geometry,
    });
  }

  return refineDefaultHeights({ type: "FeatureCollection", features });
}

// ─── Network ───────────────────────────────────────────────────────────────

export interface FetchBuildingsFromTilesOptions extends TileRequestOptions {
  /**
   * Also keep buildings beyond `radiusM`, up to this far from the centre,
   * where the tiles fetched for `radiusM` happen to contain them.
   */
  keepRadiusM?: number;
  /** Per tile, including its one retry. */
  timeoutMs?: number;
  /** Ask for the TileJSON again even if the remembered one is recent. */
  refresh?: boolean;
}

/** One tile's bytes. An empty buffer for a tile the server says has no content. */
async function fetchTile(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ArrayBuffer> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(
        Math.max(1, deadline - Date.now()),
        signal,
        async (requestSignal) => {
          let response: Response;
          try {
            response = await fetchImpl(url, { signal: requestSignal });
          } catch (cause) {
            throw new BuildingTilesError("network", "Could not reach the building tiles", {
              url,
              cause,
            });
          }
          if (response.status === 204 || response.status === 404) return new ArrayBuffer(0);
          if (!response.ok) {
            throw new BuildingTilesError(
              "http",
              `The building tiles answered HTTP ${response.status}`,
              { status: response.status, url },
            );
          }
          try {
            return await response.arrayBuffer();
          } catch (cause) {
            throw new BuildingTilesError("network", "A building tile did not download fully", {
              url,
              cause,
            });
          }
        },
        () =>
          new BuildingTilesError("timeout", `A building tile took longer than ${timeoutMs} ms`, {
            url,
          }),
      );
    } catch (error) {
      // One more try after a network hiccup, within the same time limit.
      const retry =
        attempt === 0 &&
        error instanceof BuildingTilesError &&
        error.kind === "network" &&
        !signal.aborted &&
        Date.now() < deadline;
      if (!retry) throw error;
    }
  }
}

/**
 * Fetch and decode the buildings within `radiusM` of `center` (strictly: in
 * the bounding box of that circle) from OpenFreeMap's z14 tiles.
 *
 * The tiles involved (1–4 below 50° latitude for a radius under 800 m, up to
 * 9 further north where tiles are smaller) are fetched in parallel. If any of them fails the
 * whole call fails with a `BuildingTilesError`: half the neighbourhood would
 * be worse than an error the caller can react to. Aborting rejects with an
 * AbortError.
 */
export async function fetchBuildingsFromTiles(
  center: LatLng,
  radiusM: number,
  options: FetchBuildingsFromTilesOptions = {},
): Promise<BuildingCollection> {
  const {
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = TILE_TIMEOUT_MS,
    refresh = false,
    keepRadiusM = radiusM,
  } = options;
  if (signal?.aborted) throw abortErrorFrom(signal);

  const tiles = tilesForCircle(center, radiusM);
  const template = await loadTileTemplate({ signal, fetchImpl, refresh });

  // Stops the other downloads as soon as one tile has failed.
  const group = new AbortController();
  const onAbort = () => group.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const data = await Promise.all(
      tiles.map((tile) =>
        fetchTile(tileUrl(template, tile), group.signal, fetchImpl, timeoutMs).catch((error) => {
          group.abort();
          throw error;
        }),
      ),
    );
    return decodeBuildingTiles(
      tiles.map((tile, i) => ({ tile, data: data[i] })),
      { bounds: boundsOfCircle(center, Math.max(radiusM, keepRadiusM)) },
    );
  } catch (error) {
    if (signal?.aborted) throw abortErrorFrom(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
