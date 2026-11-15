/**
 * Pure helpers that prepare data for the map's sources.
 *
 * The map draws buildings from two places:
 *
 *  - Every building in view comes straight from OpenFreeMap's vector tiles
 *    (the "city" layers): MapLibre loads and drops those tiles by itself as
 *    the map moves. They are the very tiles the sun computation reads, drawn
 *    by the same rules as far as a style expression can state them.
 *  - What the computation says about single buildings — the one hiding the
 *    sun, the one the pin stands in — is drawn on top from the analysed
 *    collection (the "highlights"), and so are the shadows.
 */
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import { FALLBACK_HEIGHT_M, MAX_HEIGHT_M } from "@/lib/buildings/height";
import { neighbourhoodHeightM } from "@/lib/buildings/overpass";
import { TILE_KEEP_RADIUS_M } from "@/lib/buildings/tiles";
import { TILE_DEFAULT_HEIGHT_M } from "@/lib/buildings/vectorTiles";
import type { BuildingCollection, BuildingFeature, LatLng } from "@/lib/types";

/** Shadows are drawn for buildings within this distance of the pin, metres. */
export const SHADOW_RADIUS_M = 250;

/**
 * The buildings whose footprint comes within `radiusM` of `center` — measured
 * to the bounding box of each outer ring, which is cheap and never drops a
 * building that is really in range.
 */
export function buildingsNear(
  buildings: BuildingCollection,
  center: LatLng,
  radiusM: number,
): BuildingCollection {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1e-6, 111_320 * Math.cos((center.lat * Math.PI) / 180));
  const radiusSq = radiusM * radiusM;

  const features = buildings.features.filter((feature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer || outer.length === 0) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const position of outer) {
        const x = (position[0] - center.lng) * metersPerDegLng;
        const y = (position[1] - center.lat) * metersPerDegLat;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      // Distance from the origin (the pin) to the box; 0 when the pin is inside.
      const dx = minX > 0 ? minX : maxX < 0 ? -maxX : 0;
      const dy = minY > 0 ? minY : maxY < 0 ? -maxY : 0;
      if (dx * dx + dy * dy <= radiusSq) return true;
    }
    return false;
  });

  return { type: "FeatureCollection", features };
}

// ─── Where our layers go in the basemap's stack ────────────────────────────

/** The ids of all the layers this app adds to the map start like this. */
export const OWN_LAYER_PREFIX = "sun-";

/**
 * The basemap layer to put our layers right below: the first of the labels
 * the style ends with (place names, street names). Everything the basemap
 * paints on the ground — roads, and its own flat building footprints — then
 * lies under our shadows and buildings, and its names stay readable on top.
 *
 * Not simply "the first symbol layer": the light basemap has one stray label
 * layer (waterway names) far down, below its roads and footprints, and
 * anything put under it has both painted over it.
 *
 * Undefined when the style does not end with labels: our layers go on top.
 */
export function labelAnchorId(layers: readonly { id: string; type: string }[]): string | undefined {
  let anchor: string | undefined;
  for (let i = layers.length - 1; i >= 0; i--) {
    const { id, type } = layers[i];
    // Ours may sit on top until the anchor is known: look past them.
    if (id.startsWith(OWN_LAYER_PREFIX)) continue;
    if (type !== "symbol") break;
    anchor = id;
  }
  return anchor;
}

// ─── Every building in view: the tile layers ───────────────────────────────

/** The vector source with OpenFreeMap's tiles. */
export const CITY_SOURCE_ID = `${OWN_LAYER_PREFIX}city`;
/**
 * Buildings are drawn from this zoom on. Further out a screen spans many
 * tiles of several thousand buildings each (too much to hold on a phone), and
 * the basemap shows flat footprints of its own there anyway.
 */
export const CITY_MIN_ZOOM = 15;

/** `render_height`, read as "untagged" when a tile should ever lack it. */
const RENDER_HEIGHT: ExpressionSpecification = [
  "number",
  ["get", "render_height"],
  TILE_DEFAULT_HEIGHT_M,
];
/** Nobody tagged a height: the same test as `heightFromRenderHeight`. */
const IS_UNTAGGED: ExpressionSpecification = [
  "any",
  ["<=", RENDER_HEIGHT, 0],
  ["==", RENDER_HEIGHT, TILE_DEFAULT_HEIGHT_M],
];

/** Outlines whose parts are in the layer as well are left out, as in the analysis. */
export const CITY_BUILDING_FILTER: FilterSpecification = ["!=", ["get", "hide_3d"], true];

/**
 * The height the analysis gave untagged buildings around the pin: the
 * neighbourhood's median where enough heights are tagged, else 7 m.
 */
export function untaggedHeightM(buildings: BuildingCollection | null): number {
  return (buildings ? neighbourhoodHeightM(buildings) : null) ?? FALLBACK_HEIGHT_M;
}

/**
 * How far from the centre of the pin's fetch area the analysed buildings
 * reach: to the corners of the square the loader keeps (`TILE_KEEP_RADIUS_M`
 * each way).
 */
export const ANALYSED_REACH_M = Math.ceil(TILE_KEEP_RADIUS_M * Math.SQRT2);

/** What the map needs to know of the analysis to draw the same heights. */
export interface AnalysedArea {
  /** Centre of the pin's fetch area (`fetchAreaFor`). */
  center: LatLng;
  /** The height untagged buildings were given there (`untaggedHeightM`). */
  untaggedM: number;
}

/**
 * How tall a building of the tiles is drawn.
 *
 *  - Tagged: its height, as in the analysis.
 *  - Untagged (the tiles carry a 5 m stand-in), where buildings were
 *    analysed: the height the analysis gave them, `untaggedM`. Except that
 *    the analysis keeps untagged buildings under 50 m² (sheds, garages:
 *    about 1 in 40 buildings in a city) at 3–7 m, which no expression can
 *    follow: a tile feature is every building with the same attributes at
 *    once, without a footprint of its own.
 *  - Untagged, anywhere else (or with no analysis at all): the tiles' own
 *    5 m. Nothing is computed there, and one neighbourhood's median says
 *    nothing about the next town (40 m in Midtown; row houses across the
 *    river).
 *
 * "Where buildings were analysed" is likewise decided per tile feature: all
 * untagged buildings of a tile follow as soon as one of them is in reach, so
 * the change of height falls on tile edges a kilometre or two from the pin,
 * never inside the analysed area.
 */
export function cityHeightExpression(analysed: AnalysedArea | null): ExpressionSpecification {
  const tagged: ExpressionSpecification = ["min", RENDER_HEIGHT, MAX_HEIGHT_M];
  if (!analysed) return ["case", IS_UNTAGGED, TILE_DEFAULT_HEIGHT_M, tagged];
  const { center, untaggedM } = analysed;
  const isAnalysed: ExpressionSpecification = [
    "<=",
    ["distance", { type: "Point", coordinates: [center.lng, center.lat] }],
    ANALYSED_REACH_M,
  ];
  return ["case", IS_UNTAGGED, ["case", isAnalysed, untaggedM, TILE_DEFAULT_HEIGHT_M], tagged];
}

/** Buildings whose height is an estimate are drawn in the softer colour. */
export function cityColorExpression(tagged: string, untagged: string): ExpressionSpecification {
  return ["case", IS_UNTAGGED, untagged, tagged];
}

// ─── Single buildings: the highlights ──────────────────────────────────────

/**
 * A highlight is drawn over the same building of the tile layer. Two solids
 * with the same walls and roof flicker (both are equally near the eye), so
 * the highlight is made a little larger all round: by less than a pixel at
 * any zoom, and far more than the depth buffer needs.
 */
export const HIGHLIGHT_OUTSET_M = 0.25;
export const HIGHLIGHT_RAISE_M = 0.3;

export interface HighlightProperties {
  /** `properties.id` of the building in the analysed collection. */
  id: string;
  /** It hides the sun right now. */
  blocker: boolean;
  /** The pin stands in it. */
  pin: boolean;
  /** How tall to draw it, metres. */
  heightM: number;
}

export type HighlightCollection = FeatureCollection<Polygon | MultiPolygon, HighlightProperties>;

export const NO_HIGHLIGHTS: HighlightCollection = { type: "FeatureCollection", features: [] };

const METERS_PER_DEG = 111_320;
/** A corner sharper than about 40° is not pushed out to its full (very long) point. */
const MIN_MITER_DIVISOR = 0.25;

/**
 * Move every edge of a ring `meters` outwards (inwards when negative),
 * keeping the corners sharp. Works for either winding, closed or open rings.
 */
export function outsetRing(ring: readonly Position[], meters: number): Position[] {
  const unchanged = () => ring.map((position): Position => [position[0], position[1]]);
  if (ring.length < 3 || meters === 0) return unchanged();
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  // Local metres around the first point; repeated points would have no direction.
  const kx = METERS_PER_DEG * Math.max(1e-6, Math.cos((first[1] * Math.PI) / 180));
  const points: [number, number][] = [];
  for (const position of closed ? ring.slice(0, -1) : ring) {
    const x = (position[0] - first[0]) * kx;
    const y = (position[1] - first[1]) * METERS_PER_DEG;
    const previous = points[points.length - 1];
    if (!previous || previous[0] !== x || previous[1] !== y) points.push([x, y]);
  }
  const count = points.length;
  if (count < 3) return unchanged();

  let doubleArea = 0;
  for (let i = 0; i < count; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % count];
    doubleArea += x1 * y2 - x2 * y1;
  }
  // Outside is to the right of the direction of travel on a counter-clockwise ring.
  const side = doubleArea >= 0 ? 1 : -1;
  const normals = points.map(([x1, y1], i): [number, number] => {
    const [x2, y2] = points[(i + 1) % count];
    const length = Math.hypot(x2 - x1, y2 - y1);
    return [(side * (y2 - y1)) / length, (-side * (x2 - x1)) / length];
  });

  const moved = points.map(([x, y], i): Position => {
    const before = normals[(i + count - 1) % count];
    const after = normals[i];
    // Where the two moved edges meet: along the sum of their normals.
    const divisor = Math.max(MIN_MITER_DIVISOR, 1 + before[0] * after[0] + before[1] * after[1]);
    const dx = ((before[0] + after[0]) / divisor) * meters;
    const dy = ((before[1] + after[1]) / divisor) * meters;
    return [first[0] + (x + dx) / kx, first[1] + (y + dy) / METERS_PER_DEG];
  });
  if (closed) moved.push([moved[0][0], moved[0][1]]);
  return moved;
}

/** A footprint grown by `meters` all round: outlines move out, courtyards shrink. */
function outsetFootprint(geometry: Polygon | MultiPolygon, meters: number): Polygon | MultiPolygon {
  const grow = (rings: Position[][]) =>
    rings.map((ring, index) => outsetRing(ring, index === 0 ? meters : -meters));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: grow(geometry.coordinates) }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map(grow) };
}

/**
 * How tall a highlight is drawn: just above the building under it. That is
 * the analysed height — unless the tile layer draws the building taller (a
 * small untagged one, see `cityHeightExpression`): a highlight lower than
 * the solid it marks would be hidden inside it.
 */
export function highlightHeightM(building: BuildingFeature, untaggedM: number): number {
  const { heightM, heightSource } = building.properties;
  const drawnM = heightSource === "default" ? Math.max(heightM, untaggedM) : heightM;
  return drawnM + HIGHLIGHT_RAISE_M;
}

/**
 * The buildings to mark on the map, ready to draw: at most two (one, when
 * the building the pin stands in is also the one hiding the sun).
 */
export function highlightFeatures(
  buildings: BuildingCollection | null,
  ids: { blockerId: string | null; pinId: string | null },
  untaggedM: number,
): HighlightCollection {
  const { blockerId, pinId } = ids;
  if (!buildings || (blockerId === null && pinId === null)) return NO_HIGHLIGHTS;

  const wanted = blockerId !== null && pinId !== null && blockerId !== pinId ? 2 : 1;
  const features: HighlightCollection["features"] = [];
  for (const building of buildings.features) {
    const { id } = building.properties;
    const blocker = id === blockerId;
    const pin = id === pinId;
    if (!blocker && !pin) continue;
    features.push({
      type: "Feature",
      properties: { id, blocker, pin, heightM: highlightHeightM(building, untaggedM) },
      geometry: outsetFootprint(building.geometry, HIGHLIGHT_OUTSET_M),
    });
    if (features.length === wanted) break;
  }
  return features.length > 0 ? { type: "FeatureCollection", features } : NO_HIGHLIGHTS;
}
