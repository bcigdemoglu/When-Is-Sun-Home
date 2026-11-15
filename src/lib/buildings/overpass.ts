/**
 * Building footprints from OpenStreetMap via the Overpass API.
 *
 *  - `buildOverpassQuery`     the Overpass QL for "buildings around a point"
 *  - `parseOverpassResponse`  raw Overpass JSON → `BuildingCollection`
 *  - `fetchBuildings`         network fetch with endpoint fallback and timeouts
 *
 * Only `building=*` outlines are used (ways and multipolygon relations);
 * `building:part` is ignored.
 */
import type { MultiPolygon, Polygon, Position } from "geojson";
import { z } from "zod";
import type { BuildingCollection, BuildingFeature, BuildingProperties, LatLng } from "@/lib/types";
import {
  FALLBACK_HEIGHT_M,
  buildingKind,
  estimateHeight,
  isGenericKind,
  type OsmTags,
} from "./height";

// ─── Errors ────────────────────────────────────────────────────────────────

export type OverpassErrorKind = "rate-limited" | "timeout" | "http" | "malformed" | "network";

export class OverpassError extends Error {
  readonly kind: OverpassErrorKind;
  /** HTTP status, when the server answered at all. */
  readonly status?: number;
  /** The endpoint that produced the error. */
  readonly endpoint?: string;
  /** Seconds the server asked us to wait (`Retry-After`), when it said so. */
  readonly retryAfterS?: number;

  constructor(
    kind: OverpassErrorKind,
    message: string,
    details: { status?: number; endpoint?: string; retryAfterS?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "OverpassError";
    this.kind = kind;
    this.status = details.status;
    this.endpoint = details.endpoint;
    this.retryAfterS = details.retryAfterS;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

// ─── Query ─────────────────────────────────────────────────────────────────

export const OVERPASS_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Server-side limit sent in the query (`[timeout:…]`), seconds. */
export const OVERPASS_QUERY_TIMEOUT_S = 25;
/** Client-side limit per endpoint, covering connect + download. */
export const OVERPASS_FETCH_TIMEOUT_MS = 12_000;

/**
 * Overpass QL for every building outline within `radiusM` of `center`.
 *
 * `out body geom` makes ways carry an inline `geometry` array and relations
 * carry `members[]` with `role` and inline `geometry`, so no node lookups are
 * needed.
 */
export function buildOverpassQuery(center: LatLng, radiusM: number): string {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !(radiusM > 0)) {
    throw new RangeError("buildOverpassQuery: invalid centre or radius");
  }
  const around = `(around:${Math.round(radiusM)},${center.lat.toFixed(6)},${center.lng.toFixed(6)})`;
  return [
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];`,
    "(",
    `  way["building"]${around};`,
    `  relation["building"]["type"="multipolygon"]${around};`,
    ");",
    "out body geom;",
  ].join("\n");
}

// ─── Response schema ───────────────────────────────────────────────────────

const latLonSchema = z.object({ lat: z.number(), lon: z.number() });
const tagsSchema = z.record(z.string(), z.string());

const waySchema = z.object({
  type: z.literal("way"),
  id: z.number(),
  geometry: z.array(latLonSchema),
  tags: tagsSchema.optional(),
});

const memberSchema = z.object({
  type: z.string(),
  ref: z.number(),
  role: z.string().optional(),
  geometry: z.array(latLonSchema).optional(),
});

const relationSchema = z.object({
  type: z.literal("relation"),
  id: z.number(),
  // Members are validated one by one so a single bad member cannot sink the relation.
  members: z.array(z.unknown()),
  tags: tagsSchema.optional(),
});

/** The envelope. Elements are validated individually (leniently) later. */
export const overpassResponseSchema = z.object({
  elements: z.array(z.unknown()),
  remark: z.string().optional(),
});

export type OverpassWay = z.infer<typeof waySchema>;
export type OverpassRelation = z.infer<typeof relationSchema>;

// ─── Soft errors ───────────────────────────────────────────────────────────

/**
 * Overpass reports many failures with HTTP 200: a JSON `remark`, or an
 * HTML/XML error page. Classify such text, or return null when it is benign.
 */
function classifyErrorText(text: string): OverpassErrorKind | null {
  const t = text.toLowerCase();
  if (t.includes("rate_limited") || t.includes("too many requests")) return "rate-limited";
  if (
    t.includes("timed out") ||
    t.includes("too busy") ||
    t.includes("out of memory") ||
    t.includes("runtime error")
  ) {
    // Out-of-memory is reported as "timeout" too: for the caller both mean
    // "the server could not finish this query right now".
    return "timeout";
  }
  return null;
}

/** Strip markup from an HTML/XML error page and keep a short excerpt. */
function excerpt(text: string): string {
  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
}

function parseEnvelope(json: unknown): z.infer<typeof overpassResponseSchema> {
  const envelope = overpassResponseSchema.safeParse(json);
  if (!envelope.success) {
    throw new OverpassError("malformed", "Overpass response is not a valid result document");
  }
  const { remark } = envelope.data;
  if (remark !== undefined) {
    // A remark means the result set may be truncated, so it must not be used.
    const kind = classifyErrorText(remark);
    if (kind) throw new OverpassError(kind, `Overpass: ${remark.trim()}`);
  }
  return envelope.data;
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

/**
 * Signed area of a ring in coordinate units² (shoelace formula).
 * Positive = counter-clockwise with x = lng (east) and y = lat (north).
 */
export function signedRingArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Rings smaller than this (deg², roughly 0.01 m²) are treated as degenerate. */
const MIN_RING_AREA_DEG2 = 1e-12;

/**
 * Turn a list of points into a valid closed GeoJSON linear ring with the
 * requested winding, or null if it is degenerate.
 */
function normalizeRing(points: readonly Position[], winding: "ccw" | "cw"): Position[] | null {
  const ring: Position[] = [];
  for (const p of points) {
    if (ring.length === 0 || !samePosition(ring[ring.length - 1], p)) ring.push([p[0], p[1]]);
  }
  if (ring.length < 3) return null;
  if (!samePosition(ring[0], ring[ring.length - 1])) ring.push([ring[0][0], ring[0][1]]);
  if (ring.length < 4) return null;

  const area = signedRingArea(ring);
  if (!(Math.abs(area) > MIN_RING_AREA_DEG2)) return null;
  if (area > 0 !== (winding === "ccw")) ring.reverse();
  return ring;
}

/**
 * OSM stores coordinates with 7 decimal places (about 1 cm). Rounding to that
 * is a no-op for real data and strips floating-point noise from anything else,
 * which keeps the serialised collection compact.
 */
function roundCoordinate(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

function toPositions(geometry: readonly { lat: number; lon: number }[]): Position[] {
  return geometry.map((p) => [roundCoordinate(p.lon), roundCoordinate(p.lat)]);
}

function positionKey(p: Position): string {
  return `${p[0]},${p[1]}`;
}

/**
 * Join way segments end-to-end into closed rings.
 *
 * Multipolygon members may be split into any number of ways, listed in any
 * order and drawn in either direction. Segments are matched on identical end
 * coordinates (members sharing a node get identical coordinates from
 * Overpass). Chains that never close are dropped.
 *
 * The returned rings are closed (first position equals last) but not yet
 * normalised for winding.
 */
export function stitchRings(segments: readonly (readonly Position[])[]): Position[][] {
  const rings: Position[][] = [];
  const open: Position[][] = [];

  for (const segment of segments) {
    if (segment.length < 2) continue;
    if (segment.length >= 4 && samePosition(segment[0], segment[segment.length - 1])) {
      rings.push(segment.map((p) => [p[0], p[1]]));
    } else {
      open.push(segment.map((p) => [p[0], p[1]]));
    }
  }

  // Endpoint → indices of open segments touching it.
  const byEndpoint = new Map<string, number[]>();
  const addEndpoint = (p: Position, index: number) => {
    const key = positionKey(p);
    const list = byEndpoint.get(key);
    if (list) list.push(index);
    else byEndpoint.set(key, [index]);
  };
  open.forEach((segment, index) => {
    addEndpoint(segment[0], index);
    addEndpoint(segment[segment.length - 1], index);
  });

  const used = new Array<boolean>(open.length).fill(false);
  const takeSegmentAt = (p: Position): Position[] | null => {
    for (const index of byEndpoint.get(positionKey(p)) ?? []) {
      if (!used[index]) {
        used[index] = true;
        return open[index];
      }
    }
    return null;
  };

  for (let start = 0; start < open.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const chain = open[start].slice();

    while (!samePosition(chain[0], chain[chain.length - 1])) {
      const tail = chain[chain.length - 1];
      const next = takeSegmentAt(tail);
      if (!next) break;
      const oriented = samePosition(next[0], tail) ? next : next.slice().reverse();
      for (let i = 1; i < oriented.length; i++) chain.push(oriented[i]);
    }

    if (chain.length >= 4 && samePosition(chain[0], chain[chain.length - 1])) rings.push(chain);
  }

  return rings;
}

/** Even-odd ray cast. Points exactly on the boundary may land on either side. */
function pointInRing(point: Position, ring: readonly Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * True when most of `inner`'s vertices lie inside `outer`. Voting over all
 * vertices keeps this stable when a hole touches the outline at a vertex.
 */
function ringContainsRing(outer: readonly Position[], inner: readonly Position[]): boolean {
  let inside = 0;
  const count = inner.length - 1; // the closing position repeats the first
  for (let i = 0; i < count; i++) if (pointInRing(inner[i], outer)) inside++;
  return inside * 2 > count;
}

/** Combine outer rings and holes into a Polygon / MultiPolygon. Null without outers. */
export function assemblePolygons(
  outerRings: readonly (readonly Position[])[],
  innerRings: readonly (readonly Position[])[],
): Polygon | MultiPolygon | null {
  const polygons = outerRings
    .map((points) => normalizeRing(points, "ccw"))
    .filter((ring): ring is Position[] => ring !== null)
    .map((outer) => ({ outer, area: Math.abs(signedRingArea(outer)), holes: [] as Position[][] }));
  if (polygons.length === 0) return null;

  for (const points of innerRings) {
    const hole = normalizeRing(points, "cw");
    if (!hole) continue;
    // The smallest containing outer wins, which is right for nested outlines
    // (a building standing in the courtyard of another part of the relation).
    let owner: (typeof polygons)[number] | null = null;
    for (const polygon of polygons) {
      if ((!owner || polygon.area < owner.area) && ringContainsRing(polygon.outer, hole)) {
        owner = polygon;
      }
    }
    owner?.holes.push(hole);
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: [polygons[0].outer, ...polygons[0].holes] };
  }
  return { type: "MultiPolygon", coordinates: polygons.map((p) => [p.outer, ...p.holes]) };
}

// ─── Parsing ───────────────────────────────────────────────────────────────

/** A mappable, above-ground `building=*` outline. */
function isUsableBuilding(tags: OsmTags | undefined): tags is OsmTags {
  if (!tags) return false;
  const building = tags.building?.trim().toLowerCase();
  if (!building || building === "no") return false;
  if (tags.location?.trim().toLowerCase() === "underground") return false;
  const tunnel = tags.tunnel?.trim().toLowerCase();
  if (tunnel && tunnel !== "no" && Number(tags.layer) < 0) return false;
  return true;
}

function buildingProperties(id: string, tags: OsmTags): BuildingProperties {
  const { heightM, heightSource, levels } = estimateHeight(tags);
  const properties: BuildingProperties = {
    id,
    heightM,
    heightSource,
    levels,
    kind: buildingKind(tags),
  };
  const name = tags.name?.trim();
  if (name) properties.name = name;
  return properties;
}

function relationGeometry(relation: OverpassRelation): {
  geometry: Polygon | MultiPolygon | null;
  outerWayIds: number[];
} {
  const outerSegments: Position[][] = [];
  const innerSegments: Position[][] = [];
  const outerWayIds: number[] = [];

  for (const rawMember of relation.members) {
    const member = memberSchema.safeParse(rawMember);
    if (!member.success) continue;
    const { type, ref, geometry } = member.data;
    if (type !== "way" || !geometry) continue;
    const role = (member.data.role ?? "").trim().toLowerCase();
    if (role === "inner") {
      innerSegments.push(toPositions(geometry));
    } else if (role === "outer" || role === "") {
      outerSegments.push(toPositions(geometry));
      outerWayIds.push(ref);
    }
  }

  return {
    geometry: assemblePolygons(stitchRings(outerSegments), stitchRings(innerSegments)),
    outerWayIds,
  };
}

/**
 * Convert a raw Overpass JSON document (as produced by `buildOverpassQuery`)
 * into building footprints with estimated heights.
 *
 * Individual elements that are invalid, degenerate, underground or not
 * buildings are skipped. Throws `OverpassError` only when the document as a
 * whole is unusable ("malformed") or carries a server-side error remark.
 */
export function parseOverpassResponse(json: unknown): BuildingCollection {
  const { elements } = parseEnvelope(json);

  const ways: OverpassWay[] = [];
  const relations: OverpassRelation[] = [];
  for (const element of elements) {
    const way = waySchema.safeParse(element);
    if (way.success) {
      ways.push(way.data);
      continue;
    }
    const relation = relationSchema.safeParse(element);
    if (relation.success) relations.push(relation.data);
  }

  const features: BuildingFeature[] = [];
  const seen = new Set<string>();
  /** Ways whose outline is already covered by an emitted relation. */
  const coveredWayIds = new Set<number>();
  const wayTags = new Map(ways.map((way) => [way.id, way.tags]));

  for (const relation of relations) {
    const id = `relation/${relation.id}`;
    if (seen.has(id) || !isUsableBuilding(relation.tags)) continue;
    if (relation.tags.type !== undefined && relation.tags.type !== "multipolygon") continue;
    const { geometry, outerWayIds } = relationGeometry(relation);
    if (!geometry) continue;
    seen.add(id);
    for (const wayId of outerWayIds) coveredWayIds.add(wayId);

    // Mappers sometimes tag the outline way as well as (or instead of) the
    // relation. The way is dropped below as a duplicate, so keep what it
    // knows: its tags fill the gaps in the relation's.
    let tags = relation.tags;
    const outlineTags = outerWayIds.length === 1 ? wayTags.get(outerWayIds[0]) : undefined;
    if (isUsableBuilding(outlineTags)) {
      tags = { ...outlineTags, ...relation.tags };
      if (buildingKind(relation.tags) === "yes") tags.building = outlineTags.building;
    }
    features.push({ type: "Feature", properties: buildingProperties(id, tags), geometry });
  }

  for (const way of ways) {
    const id = `way/${way.id}`;
    // An outer member that is also tagged as a building duplicates the
    // relation's footprint, and would fill in its courtyards.
    if (seen.has(id) || coveredWayIds.has(way.id) || !isUsableBuilding(way.tags)) continue;
    const ring = normalizeRing(toPositions(way.geometry), "ccw");
    if (!ring) continue;
    seen.add(id);
    features.push({
      type: "Feature",
      properties: buildingProperties(id, way.tags),
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return refineDefaultHeights({ type: "FeatureCollection", features });
}

// ─── Neighbourhood-aware default heights ───────────────────────────────────

/** Reference buildings (with a tagged or level-based height) needed to trust their median. */
export const MIN_REFERENCE_BUILDINGS = 10;
/** The neighbourhood median is only believed within this range, metres. */
export const NEIGHBOURHOOD_HEIGHT_RANGE_M: readonly [number, number] = [4, 40];
/** A generic building with a smaller footprint is taken to be a shed or garage. */
export const OUTBUILDING_MAX_AREA_M2 = 25;
export const OUTBUILDING_HEIGHT_M = 3;
/** Below this footprint a generic building is never raised above the global fallback. */
export const SMALL_FOOTPRINT_MAX_AREA_M2 = 50;

const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LNG_AT_EQUATOR = 111_320;

/** Footprint area in m² (outer rings minus holes), accurate to a percent or so. */
export function footprintAreaM2(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;
  for (const rings of polygons) {
    const lat = rings[0]?.[0]?.[1] ?? 0;
    const scale =
      METERS_PER_DEG_LAT * METERS_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat * Math.PI) / 180);
    rings.forEach((ring, index) => {
      const ringArea = Math.abs(signedRingArea(ring)) * scale;
      area += index === 0 ? ringArea : -ringArea;
    });
  }
  return Math.max(0, area);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Replace the global 7 m guess for buildings that are tagged only as "a
 * building" (`building=yes` or an unknown value, no height, no levels) with
 * something informed by their surroundings and their size:
 *
 *  - footprint under 25 m²: an outbuilding, 3 m;
 *  - otherwise, when at least 10 buildings in the same response have a tagged
 *    or level-based height: the median of those heights, clamped to 4–40 m
 *    (footprints under 50 m² are never raised above 7 m by this);
 *  - otherwise unchanged (7 m).
 *
 * `heightSource` stays "default". Buildings with a specific kind (garage,
 * house, church, …) keep their table value. Returns a new collection.
 */
export function refineDefaultHeights(collection: BuildingCollection): BuildingCollection {
  const reference: number[] = [];
  for (const { properties } of collection.features) {
    if (properties.heightSource !== "default") reference.push(properties.heightM);
  }
  const [minM, maxM] = NEIGHBOURHOOD_HEIGHT_RANGE_M;
  const neighbourhoodM =
    reference.length >= MIN_REFERENCE_BUILDINGS
      ? Math.round(Math.min(maxM, Math.max(minM, median(reference))) * 10) / 10
      : null;

  const features = collection.features.map((feature) => {
    const { properties } = feature;
    if (properties.heightSource !== "default" || !isGenericKind(properties.kind)) return feature;

    const areaM2 = footprintAreaM2(feature.geometry);
    let heightM = properties.heightM;
    if (areaM2 < OUTBUILDING_MAX_AREA_M2) heightM = OUTBUILDING_HEIGHT_M;
    else if (neighbourhoodM === null) return feature;
    else if (areaM2 < SMALL_FOOTPRINT_MAX_AREA_M2) {
      heightM = Math.min(FALLBACK_HEIGHT_M, neighbourhoodM);
    } else heightM = neighbourhoodM;

    return heightM === properties.heightM
      ? feature
      : { ...feature, properties: { ...properties, heightM } };
  });
  return { ...collection, features };
}

// ─── Network ───────────────────────────────────────────────────────────────

export interface FetchBuildingsOptions {
  /** Aborting rejects with an AbortError and stops the endpoint fallback. */
  signal?: AbortSignal;
  /** Interpreter URLs, tried in order. */
  endpoints?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Per-endpoint limit, milliseconds. */
  timeoutMs?: number;
}

function abortErrorFrom(signal: AbortSignal): unknown {
  return isAbortError(signal.reason)
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/** `Retry-After` as whole seconds (it may be a number or an HTTP date), if usable. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const seconds = /^\d+$/.test(text)
    ? Number(text)
    : Math.ceil((Date.parse(text) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400 ? seconds : undefined;
}

function errorForStatus(response: Response, body: string, endpoint: string): OverpassError {
  const { status } = response;
  const detail = excerpt(body);
  const message = `Overpass answered HTTP ${status}${detail ? `: ${detail}` : ""}`;
  if (status === 429) {
    const retryAfterS = parseRetryAfter(response.headers.get("retry-after"));
    return new OverpassError("rate-limited", message, { status, endpoint, retryAfterS });
  }
  if (status === 504 || status === 408) {
    return new OverpassError("timeout", message, { status, endpoint });
  }
  return new OverpassError("http", message, { status, endpoint });
}

/** Run one query against one endpoint. Resolves with the validated envelope's raw JSON. */
async function queryEndpoint(
  endpoint: string,
  query: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<unknown> {
  if (callerSignal?.aborted) throw abortErrorFrom(callerSignal);

  const controller = new AbortController();
  let timedOut = false;
  let rejectOnAbort: (reason: unknown) => void = () => {};
  // Settles the moment either signal fires, even if `fetchImpl` ignores it.
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = reject;
  });
  aborted.catch(() => {});

  const onCallerAbort = () => {
    controller.abort();
    if (callerSignal) rejectOnAbort(abortErrorFrom(callerSignal));
  };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectOnAbort(
      new OverpassError("timeout", `Overpass did not answer within ${timeoutMs} ms`, { endpoint }),
    );
  }, timeoutMs);

  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const request = async (): Promise<unknown> => {
    let response: Response;
    let body: string;
    try {
      // A URLSearchParams body makes this a CORS "simple request": form
      // encoding, no preflight, no custom headers.
      response = await fetchImpl(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      body = await response.text();
    } catch (cause) {
      if (cause instanceof OverpassError) throw cause;
      throw new OverpassError("network", `Could not reach Overpass at ${endpoint}`, {
        endpoint,
        cause,
      });
    }

    if (!response.ok) throw errorForStatus(response, body, endpoint);

    const trimmed = body.trimStart();
    if (trimmed.startsWith("<")) {
      // HTTP 200 with an HTML/XML error page.
      throw new OverpassError(
        classifyErrorText(trimmed) ?? "malformed",
        `Overpass returned an error page: ${excerpt(trimmed)}`,
        { status: response.status, endpoint },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (cause) {
      throw new OverpassError("malformed", "Overpass response is not valid JSON", {
        status: response.status,
        endpoint,
        cause,
      });
    }

    try {
      parseEnvelope(json);
    } catch (error) {
      if (error instanceof OverpassError) {
        throw new OverpassError(error.kind, error.message, { status: response.status, endpoint });
      }
      throw error;
    }
    return json;
  };

  try {
    return await Promise.race([request(), aborted]);
  } catch (error) {
    // Abort and timeout surface from `fetch` as a generic failure; report what really happened.
    if (callerSignal?.aborted) throw abortErrorFrom(callerSignal);
    if (timedOut && !(error instanceof OverpassError && error.kind === "timeout")) {
      throw new OverpassError("timeout", `Overpass did not answer within ${timeoutMs} ms`, {
        endpoint,
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * POST a query to the Overpass interpreter and return the raw JSON document.
 *
 * Endpoints are tried in order; any failure moves on to the next one, and the
 * last `OverpassError` is thrown when all of them fail. Aborting through
 * `options.signal` rejects with an AbortError straight away instead.
 */
export async function fetchOverpassJson(
  query: string,
  options: FetchBuildingsOptions = {},
): Promise<unknown> {
  const {
    signal,
    endpoints = OVERPASS_ENDPOINTS,
    fetchImpl = globalThis.fetch,
    timeoutMs = OVERPASS_FETCH_TIMEOUT_MS,
  } = options;

  let lastError = new OverpassError("network", "No Overpass endpoint configured");
  for (const endpoint of endpoints) {
    if (signal?.aborted) throw abortErrorFrom(signal);
    try {
      return await queryEndpoint(endpoint, query, fetchImpl, timeoutMs, signal);
    } catch (error) {
      if (!(error instanceof OverpassError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Fetch and parse the buildings within `radiusM` of `center`. */
export async function fetchBuildings(
  center: LatLng,
  radiusM: number,
  options: FetchBuildingsOptions = {},
): Promise<BuildingCollection> {
  const json = await fetchOverpassJson(buildOverpassQuery(center, radiusM), options);
  return parseOverpassResponse(json);
}
