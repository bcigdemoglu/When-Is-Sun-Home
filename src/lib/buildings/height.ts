/**
 * Building height estimation from OpenStreetMap tags. Pure functions only.
 *
 * Precedence (see `estimateHeight`):
 *   1. an explicit height tag            → "tagged"
 *   2. `building:levels` × storey height → "levels"
 *   3. a typical height for the building type → "default"
 *
 * `min_height` / `building:min_level` are deliberately ignored: buildings are
 * treated as solid from the ground up.
 */
import type { HeightSource } from "@/lib/types";

export type OsmTags = Record<string, string>;

export interface HeightEstimate {
  /** Roof height above ground, metres. Always > 0. */
  heightM: number;
  heightSource: HeightSource;
  /** Above-ground levels (`building:levels`) if tagged, whatever the height source. */
  levels: number | null;
}

/** Anything taller than this is a tagging mistake (the tallest building is ~830 m). */
export const MAX_HEIGHT_M = 1000;
export const MAX_LEVELS = 200;

/** Floor-to-floor height assumed per storey. */
export const METERS_PER_LEVEL = 3.0;
/** Added on top of the storeys when the roof is probably pitched. */
export const PITCHED_ROOF_ALLOWANCE_M = 1.5;
/** Added on top of the storeys otherwise (parapet, roof build-up). */
export const FLAT_ROOF_ALLOWANCE_M = 0.5;
/** Used for `building=yes` and for values missing from the table below. */
export const FALLBACK_HEIGHT_M = 7;

const FOOT_M = 0.3048;
const INCH_M = 0.0254;

/**
 * Typical roof heights (metres) by `building=*` value, used only when a
 * building has neither a usable height tag nor `building:levels`.
 *
 * The numbers lean towards the common case in the mapped world: a detached
 * house is two storeys plus a pitched roof (~7 m), not a 3 m box.
 */
export const DEFAULT_HEIGHT_BY_KIND: Readonly<Record<string, number>> = {
  // Single-family housing: 2 storeys + pitched roof.
  house: 7,
  detached: 7,
  semidetached_house: 7,
  duplex: 7,
  farm: 7,
  bungalow: 5,
  cabin: 4,
  static_caravan: 3,
  houseboat: 3,
  // Row houses / generic residential: 2–3 storeys.
  terrace: 8,
  residential: 8,
  // Multi-family and lodging: 4–5 storeys.
  apartments: 14,
  dormitory: 12,
  hotel: 15,

  // Outbuildings and other single-storey structures.
  garage: 3,
  garages: 3,
  carport: 3,
  shed: 3,
  hut: 3,
  roof: 3,
  greenhouse: 3,
  kiosk: 3,
  toilets: 3,
  service: 3,
  container: 3,
  tent: 3,
  allotment_house: 3,
  bunker: 3,
  ruins: 3,
  boathouse: 4,
  stable: 4,
  sty: 4,
  cowshed: 5,
  farm_auxiliary: 5,
  barn: 6,

  // Commercial.
  retail: 8,
  supermarket: 8,
  commercial: 10,
  office: 14,

  // Industrial: one tall storey.
  industrial: 9,
  warehouse: 9,
  manufacture: 9,
  hangar: 10,

  // Education, health, civic.
  kindergarten: 6,
  school: 10,
  college: 12,
  university: 14,
  hospital: 15,
  public: 10,
  civic: 10,
  government: 12,
  fire_station: 8,
  museum: 12,

  // Religious. Naves are tall; towers and spires are not modelled.
  chapel: 8,
  church: 12,
  mosque: 12,
  synagogue: 12,
  temple: 12,
  religious: 12,
  monastery: 12,
  cathedral: 20,

  // Transport and sport.
  transportation: 8,
  train_station: 10,
  parking: 9,
  pavilion: 5,
  sports_hall: 9,
  sports_centre: 9,
  grandstand: 12,
  stadium: 20,
};

/** Building types whose roof is normally pitched, for the levels-based estimate. */
const PITCHED_ROOF_KINDS: ReadonlySet<string> = new Set([
  "house",
  "detached",
  "semidetached_house",
  "duplex",
  "bungalow",
  "terrace",
  "residential",
  "farm",
  "cabin",
]);

const NUMBER = String.raw`(\d+(?:[.,]\d*)?|[.,]\d+)`;
const METRES_RE = new RegExp(`^${NUMBER}\\s*(?:m|meters?|metres?)?$`);
const FEET_RE = new RegExp(`^${NUMBER}\\s*(?:ft|feet|foot|'|′)$`);
const FEET_INCHES_RE = new RegExp(
  `^(\\d+)\\s*(?:'|′|ft|feet|foot)\\s*${NUMBER}\\s*(?:"|″|''|in|inch|inches)?$`,
);

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

function validHeight(meters: number): number | null {
  return Number.isFinite(meters) && meters > 0 && meters <= MAX_HEIGHT_M ? meters : null;
}

/**
 * Parse an OSM length value into metres.
 *
 * Accepts `12`, `12.5`, `12,5`, `12 m`, `40 ft`, `40 feet`, `35'` and
 * `12'6"`. A bare number is metres. Returns null for anything else, and for
 * values that are zero, negative or implausibly large.
 */
export function parseLengthMeters(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "") return null;

  let match = METRES_RE.exec(value);
  if (match) return validHeight(toNumber(match[1]));

  match = FEET_RE.exec(value);
  if (match) return validHeight(toNumber(match[1]) * FOOT_M);

  match = FEET_INCHES_RE.exec(value);
  if (match) return validHeight(Number(match[1]) * FOOT_M + toNumber(match[2]) * INCH_M);

  return null;
}

/** Parse a level count such as `2` or `2.5`. Null for junk, values ≤ 0 or > 200. */
export function parseLevels(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^(\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return null;
  const levels = toNumber(value);
  return Number.isFinite(levels) && levels > 0 && levels <= MAX_LEVELS ? levels : null;
}

/** Normalised `building=*` value: trimmed, lower-case; "yes" when absent. */
export function buildingKind(tags: OsmTags): string {
  const kind = tags.building?.trim().toLowerCase();
  return kind ? kind : "yes";
}

/** Typical height for a `building=*` value; the generic fallback when unknown. */
export function defaultHeightForKind(kind: string): number {
  return Object.hasOwn(DEFAULT_HEIGHT_BY_KIND, kind)
    ? DEFAULT_HEIGHT_BY_KIND[kind]
    : FALLBACK_HEIGHT_M;
}

function roofAllowance(tags: OsmTags, kind: string): number {
  const roofLevels = parseLevels(tags["roof:levels"]);
  if (roofLevels !== null) return roofLevels * METERS_PER_LEVEL;
  return PITCHED_ROOF_KINDS.has(kind) ? PITCHED_ROOF_ALLOWANCE_M : FLAT_ROOF_ALLOWANCE_M;
}

/** Height tags in order of preference. All of them count as "tagged". */
const HEIGHT_TAGS = ["height", "building:height", "est_height"] as const;

export function estimateHeight(tags: OsmTags): HeightEstimate {
  const levels = parseLevels(tags["building:levels"]);

  for (const key of HEIGHT_TAGS) {
    const heightM = parseLengthMeters(tags[key]);
    if (heightM !== null) return { heightM, heightSource: "tagged", levels };
  }

  const kind = buildingKind(tags);

  if (levels !== null) {
    const heightM = Math.min(levels * METERS_PER_LEVEL + roofAllowance(tags, kind), MAX_HEIGHT_M);
    return { heightM, heightSource: "levels", levels };
  }

  return { heightM: defaultHeightForKind(kind), heightSource: "default", levels: null };
}
