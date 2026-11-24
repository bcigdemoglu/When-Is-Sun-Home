/**
 * The City of Portland's tree and lot data, as the report's Trees section
 * reads it: where to ask, and what the answers mean. Pure: addresses in,
 * strings out; JSON in, plain objects out. No React, DOM or network here
 * (the fetching is in `components/report/useTreeReport.ts`).
 *
 * Every service is the city's own, on www.portlandmaps.com: public, free,
 * no key, open to browsers. Never an Esri / arcgis.com host (their terms
 * need an account; a standing project rule).
 *
 *  - Street trees: Parks & Recreation Urban Forestry's inventory of the
 *    trees in the public right-of-way, 2022–2024 (~252,000 trees). At most
 *    200 records per answer; statistics queries for anything bigger.
 *  - Heritage trees: the city's designated Heritage Trees.
 *  - Neighborhoods: the boundaries of the city's neighborhood associations.
 *  - Taxlots: lot lines (Metro RLIS). PRIVACY: only the site address and the
 *    lot area are ever asked for (`outFields=SITEADDR,A_T_SQFT`). The layer
 *    also carries owners' names and addresses and sale data: those fields are
 *    never requested, stored, logged or shown. Keep it that way.
 *
 * Trees are NEVER part of a sun-hours number: all of this is information.
 */
import { canonicalWords } from "@/lib/geocode/listingMatch";
import { bearingDeg, toLocalMeters } from "@/lib/geo/local";
import type { LatLng, StreetTree, StreetTreeGroup } from "@/lib/types";
import { GENUS_FAMILY, SPECIES_FLAGS } from "./speciesTable";

// ─── Where ─────────────────────────────────────────────────────────────────

/**
 * The City of Portland, generously (west, south, east, north): the street
 * tree, lot and neighborhood records exist only inside the city. Beyond it
 * nothing is asked for.
 */
export const PORTLAND_BOUNDS: [number, number, number, number] = [-122.84, 45.42, -122.46, 45.66];

export function inPortland(spot: LatLng): boolean {
  const [west, south, east, north] = PORTLAND_BOUNDS;
  return spot.lat >= south && spot.lat <= north && spot.lng >= west && spot.lng <= east;
}

const OPEN_DATA = "https://www.portlandmaps.com/od/rest/services";
export const STREET_TREES_SERVICE = `${OPEN_DATA}/COP_OpenData_Environment/MapServer/1415/query`;
export const HERITAGE_TREES_SERVICE = `${OPEN_DATA}/COP_OpenData_Environment/MapServer/26/query`;
export const NEIGHBORHOODS_SERVICE = `${OPEN_DATA}/COP_OpenData_Boundary/MapServer/3/query`;
export const TAXLOTS_SERVICE =
  "https://www.portlandmaps.com/arcgis/rest/services/Public/Taxlots/MapServer/0/query";

/**
 * The only taxlot fields ever asked for. PRIVACY: never add the owner,
 * mailing-address or sale fields the layer also has.
 */
export const TAXLOT_FIELDS = "SITEADDR,A_T_SQFT";

/** Street trees this close to the pin are looked at for "the nearest" one. */
export const NEARBY_RADIUS_M = 40;
/** "Nearest" street trees are only offered within this distance. */
export const NEAREST_MAX_M = 25;
/** "The area": about a quarter of a mile around the pin. */
export const AREA_RADIUS_M = 400;
/** Heritage trees are looked for this far out. */
export const HERITAGE_RADIUS_M = 2500;

const pointParams = (spot: LatLng) => ({
  geometry: `${spot.lng.toFixed(6)},${spot.lat.toFixed(6)}`,
  geometryType: "esriGeometryPoint",
  inSR: "4326",
});

const query = (service: string, params: Record<string, string>) =>
  `${service}?${new URLSearchParams({ ...params, f: "json" })}`;

/** Every street tree within `NEARBY_RADIUS_M` of the spot. */
export function nearbyStreetTreesUrl(spot: LatLng): string {
  return query(STREET_TREES_SERVICE, {
    ...pointParams(spot),
    distance: String(NEARBY_RADIUS_M),
    units: "esriSRUnit_Meter",
    outFields: "*",
    outSR: "4326",
  });
}

/** Every street tree recorded at an address of this hundred-block (both sides of the street). */
export function blockStreetTreesUrl(block: Block): string {
  return query(STREET_TREES_SERVICE, {
    where: blockWhere("Address", block, ",%"),
    outFields: "*",
    outSR: "4326",
  });
}

/** Trunk-diameter classes, inches: 0–6, 6–12, 12–24, 24 and more. */
export const DIAMETER_CLASS_LIMITS_IN: readonly number[] = [6, 12, 24];

/**
 * Counts of the street trees within `AREA_RADIUS_M`, in one of two
 * groupings, each a single answer:
 *
 *  - "species": by species, with the trunk sizes of each (trunk classes by
 *    SQL expressions, which the service supports);
 *  - "traits": by mature size, type and condition (at most 4 × 6 × 7 rows).
 *
 * Two answers rather than one grouped by all four: the service returns at
 * most 200 rows, and species × traits can exceed that in a dense area. (No
 * paging: with an offset the service pages the TREES, 200 at a time, and
 * the counts would be of the first 200 only.)
 */
export function areaStreetTreesUrl(spot: LatLng, by: "species" | "traits"): string {
  const [a, b, c] = DIAMETER_CLASS_LIMITS_IN;
  const classes = [
    `DIAMETER < ${a}`,
    `DIAMETER >= ${a} AND DIAMETER < ${b}`,
    `DIAMETER >= ${b} AND DIAMETER < ${c}`,
    `DIAMETER >= ${c}`,
  ];
  const count = {
    statisticType: "count",
    onStatisticField: "OBJECTID",
    outStatisticFieldName: "n",
  };
  const statistics =
    by === "species"
      ? [
          count,
          ...classes.map((test, i) => ({
            statisticType: "sum",
            onStatisticField: `CASE WHEN ${test} THEN 1 ELSE 0 END`,
            outStatisticFieldName: `d${i}`,
          })),
          { statisticType: "sum", onStatisticField: "DIAMETER", outStatisticFieldName: "dsum" },
          { statisticType: "max", onStatisticField: "DIAMETER", outStatisticFieldName: "dmax" },
        ]
      : [count];
  return query(STREET_TREES_SERVICE, {
    ...pointParams(spot),
    distance: String(AREA_RADIUS_M),
    units: "esriSRUnit_Meter",
    outStatistics: JSON.stringify(statistics),
    groupByFieldsForStatistics:
      by === "species" ? "SPECIES" : "MATURE_SIZE,FUNCTIONAL_TYPE,Condition",
  });
}

/** The city's Heritage Trees within `HERITAGE_RADIUS_M`. */
export function heritageTreesUrl(spot: LatLng): string {
  return query(HERITAGE_TREES_SERVICE, {
    ...pointParams(spot),
    distance: String(HERITAGE_RADIUS_M),
    units: "esriSRUnit_Meter",
    where: "STATUS='Heritage'",
    outFields: "COMMON,SCIENTIFIC,HEIGHT,SPREAD,DIAMETER,SITE_ADDRESS,YEAR_Designated",
    outSR: "4326",
  });
}

/** The lot under the spot: its address, area and outline (and nothing else: see `TAXLOT_FIELDS`). */
export function taxlotUrl(spot: LatLng): string {
  return query(TAXLOTS_SERVICE, {
    ...pointParams(spot),
    spatialRel: "esriSpatialRelIntersects",
    outFields: TAXLOT_FIELDS,
    returnGeometry: "true",
    outSR: "4326",
  });
}

/** The lots of a hundred-block, both sides of the street (address and area only). */
export function blockTaxlotsUrl(block: Block): string {
  return query(TAXLOTS_SERVICE, {
    where: blockWhere("SITEADDR", block, "%"),
    outFields: TAXLOT_FIELDS,
    returnGeometry: "true",
    outSR: "4326",
  });
}

/** The neighborhood the spot is in: its name and outline. */
export function neighborhoodUrl(spot: LatLng): string {
  return query(NEIGHBORHOODS_SERVICE, {
    ...pointParams(spot),
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "6",
  });
}

// ─── Addresses and blocks ──────────────────────────────────────────────────

export interface StreetAddress {
  /** The house number, digits only: 2124. */
  number: number;
  /** The street, in the city's spelling: "NE 36TH AVE". */
  street: string;
}

/**
 * A street address in any usual spelling — the city's ("2124 NE 36TH AVE,
 * PORTLAND, OR, 97212"), a lot's ("2124 NE 36TH AVE "), a geocoder's
 * ("2124 Northeast 36th Avenue, Portland") — as number and street. Only the
 * part before the first comma is read. Null when it does not start with a
 * house number followed by a street.
 */
export function parseStreetAddress(text: string | null | undefined): StreetAddress | null {
  if (!text) return null;
  const words = canonicalWords(text.split(",")[0]);
  const match = words.length >= 2 ? /^(\d{1,6})[a-z]?$/.exec(words[0]) : null;
  if (!match) return null;
  return { number: Number(match[1]), street: words.slice(1).join(" ").toUpperCase() };
}

export function sameAddress(a: StreetAddress | null, b: StreetAddress | null): boolean {
  return a !== null && b !== null && a.number === b.number && a.street === b.street;
}

/** One hundred-block of a street: 2100–2199 NE 36TH AVE, both sides. */
export interface Block {
  street: string;
  /** 2100. */
  hundred: number;
}

export function blockOf(address: StreetAddress): Block {
  return { street: address.street, hundred: Math.floor(address.number / 100) * 100 };
}

export function inBlock(address: StreetAddress | null, block: Block): boolean {
  return (
    address !== null &&
    address.street === block.street &&
    Math.floor(address.number / 100) * 100 === block.hundred
  );
}

/**
 * The SQL test for "an address of this block" on a field: `_` is one
 * character, so "21__ NE 36TH AVE" is 2100–2199. The street is cut to plain
 * letters, digits and spaces, so nothing in it can break out of the quotes.
 * The answers are checked again with `inBlock` (a LIKE is only a sieve).
 */
export function blockWhere(field: string, block: Block, tail: string): string {
  const street = block.street.replace(/[^A-Z0-9 ]/g, "").trim();
  const head = block.hundred / 100;
  const patterns = head >= 1 ? [`${head}__`] : ["_", "__"];
  return patterns.map((number) => `${field} LIKE '${number} ${street}${tail}'`).join(" OR ");
}

const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

/** A street as people write it: "NE 36th Ave", "SE Martin Luther King Jr Blvd". */
export function streetLabel(street: string): string {
  return street
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => {
      if (DIRECTIONS.has(word)) return word;
      if (/^\d+(ST|ND|RD|TH)$/.test(word)) return word.toLowerCase();
      return word[0] + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** "2100 block of NE 36th Ave". */
export function blockLabel(block: Block): string {
  return `${block.hundred} block of ${streetLabel(block.street)}`;
}

/** "2124 NE 36th Ave". */
export function addressLabel(address: StreetAddress): string {
  return `${address.number} ${streetLabel(address.street)}`;
}

/** "GRANT PARK" → "Grant Park"; "ST. JOHNS" → "St. Johns". */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-/(])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
}

// ─── Species ───────────────────────────────────────────────────────────────

/** "Acer platanoides - Norway maple" → its two names. "Unknown" has no scientific name. */
export function splitSpecies(text: string): { scientific: string; common: string } {
  const value = text.trim();
  const at = value.indexOf(" - ");
  if (at < 0) {
    return /^unknown$/i.test(value) || value === ""
      ? { scientific: "", common: "Unknown" }
      : { scientific: value, common: value };
  }
  const scientific = value.slice(0, at).trim();
  return {
    scientific: /^unknown$/i.test(scientific) ? "" : scientific,
    common: value.slice(at + 3).trim(),
  };
}

/** "Acer platanoides" → "Acer"; "" for an unknown species. */
export function genusOf(scientific: string): string {
  const first = scientific.trim().split(/\s+/)[0] ?? "";
  return /^[A-Z][a-z]+$/.test(first) ? first : "";
}

/** The botanical family of a genus ("Sapindaceae" for Acer), or "" when not in the table. */
export function familyOf(genus: string): string {
  return GENUS_FAMILY[genus.toLowerCase()] ?? "";
}

/** Is a species identified only to its genus ("Acer spp.")? */
export function isGenusOnly(scientific: string): boolean {
  return /\bspp?\.?(\s|$)/i.test(scientific) || /\(/.test(scientific);
}

/**
 * The city's native / nuisance flags for a species, from the checked-in
 * table (`speciesTable.ts`); null for a species the table does not know.
 */
export function speciesFlags(scientific: string): { native: boolean; nuisance: boolean } | null {
  const flags = SPECIES_FLAGS[scientific.trim().toLowerCase()];
  if (flags === undefined) return null;
  return { native: (flags & 1) !== 0, nuisance: (flags & 2) !== 0 };
}

/** Deciduous (loses its leaves in winter) — broadleaf or conifer (larch, dawn redwood). */
export function isDeciduous(functionalType: string): boolean {
  return /deciduous/i.test(functionalType);
}

export function isEvergreen(functionalType: string): boolean {
  return /evergreen/i.test(functionalType);
}

// ─── Answers ───────────────────────────────────────────────────────────────

interface Feature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: unknown; y?: unknown; rings?: unknown };
}

/** The features of an ArcGIS answer; throws on an error answer (the query then fails, quietly). */
function featuresOf(answer: unknown): Feature[] {
  if (typeof answer !== "object" || answer === null) throw new Error("Not a JSON answer");
  const { error, features } = answer as { error?: { message?: string }; features?: unknown };
  if (error) throw new Error(`The city's server answered: ${error.message ?? "an error"}`);
  if (!Array.isArray(features)) throw new Error("The answer has no features");
  return features as Feature[];
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** An epoch-millisecond date as the calendar date it names (the city stores midnight UTC). */
export function isoDateOfEpoch(ms: unknown): string | null {
  const value = number(ms);
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The street trees of an answer to `nearbyStreetTreesUrl` / `blockStreetTreesUrl`. */
export function parseStreetTrees(answer: unknown): StreetTree[] {
  const trees: StreetTree[] = [];
  for (const feature of featuresOf(answer)) {
    const a = feature.attributes ?? {};
    const lng = number(feature.geometry?.x);
    const lat = number(feature.geometry?.y);
    if (lat === null || lng === null) continue;
    const { scientific, common } = splitSpecies(text(a.SPECIES));
    const diameter = number(a.DIAMETER);
    const width = number(a.Site_Width);
    trees.push({
      id: number(a.OBJECTID) ?? trees.length,
      lat,
      lng,
      address: text(a.Address).split(",")[0].trim(),
      scientific,
      common,
      diameterIn: diameter !== null && diameter > 0 ? Math.round(diameter * 10) / 10 : null,
      condition: text(a.Condition),
      matureSize: text(a.MATURE_SIZE).replace(/^unknown$/i, ""),
      functionalType: text(a.FUNCTIONAL_TYPE),
      wires: text(a.Wires),
      siteType: text(a.Site_Type),
      siteWidthFt: width !== null && width > 0 ? Math.round(width * 10) / 10 : null,
      neighborhood: text(a.Neighborhood),
      inventoried: isoDateOfEpoch(a.Date_Inventoried),
    });
  }
  return trees;
}

/**
 * The groups of an answer to `areaStreetTreesUrl` (fields a grouping does
 * not have are empty). Throws for an answer that may have been cut short at
 * the service's 200 rows, rather than show counts that are too low.
 */
export function parseStreetTreeGroups(answer: unknown): StreetTreeGroup[] {
  const features = featuresOf(answer);
  if (
    features.length >= 200 ||
    (answer as { exceededTransferLimit?: unknown }).exceededTransferLimit
  ) {
    throw new Error("Too many groups for one answer");
  }
  return features
    .map((feature): StreetTreeGroup => {
      const a = feature.attributes ?? {};
      const count = (key: string) => Math.max(0, Math.round(number(a[key]) ?? 0));
      return {
        species: text(a.SPECIES),
        matureSize: text(a.MATURE_SIZE).replace(/^unknown$/i, ""),
        functionalType: text(a.FUNCTIONAL_TYPE),
        condition: text(a.Condition),
        count: count("n"),
        diameterClasses: [count("d0"), count("d1"), count("d2"), count("d3")],
        diameterSumIn: Math.max(0, number(a.dsum) ?? 0),
        diameterMaxIn: Math.max(0, number(a.dmax) ?? 0),
      };
    })
    .filter((group) => group.count > 0);
}

export interface HeritageTree extends LatLng {
  common: string;
  scientific: string;
  heightFt: number | null;
  spreadFt: number | null;
  diameterIn: number | null;
  address: string;
  yearDesignated: number | null;
}

export function parseHeritageTrees(answer: unknown): HeritageTree[] {
  const trees: HeritageTree[] = [];
  for (const feature of featuresOf(answer)) {
    const a = feature.attributes ?? {};
    const lng = number(feature.geometry?.x);
    const lat = number(feature.geometry?.y);
    if (lat === null || lng === null) continue;
    const positive = (value: unknown) => {
      const n = number(value);
      return n !== null && n > 0 ? n : null;
    };
    trees.push({
      lat,
      lng,
      common: text(a.COMMON),
      scientific: text(a.SCIENTIFIC),
      heightFt: positive(a.HEIGHT),
      spreadFt: positive(a.SPREAD),
      diameterIn: positive(a.DIAMETER),
      address: text(a.SITE_ADDRESS),
      yearDesignated: positive(a.YEAR_Designated),
    });
  }
  return trees;
}

/** A polygon as rings of positions (outer rings and holes, as the service gives them). */
export type LatLngRings = LatLng[][];

function ringsOf(feature: Feature): LatLngRings {
  const rings = feature.geometry?.rings;
  if (!Array.isArray(rings)) return [];
  return rings
    .filter((ring): ring is unknown[] => Array.isArray(ring))
    .map((ring) =>
      ring
        .filter(
          (point): point is [number, number] =>
            Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
        )
        .map(([lng, lat]) => ({ lat, lng })),
    )
    .filter((ring) => ring.length >= 3);
}

export interface Taxlot {
  /** As the county records it, or null where the lot has no site address. */
  address: StreetAddress | null;
  /** Lot area, square feet, or null. */
  areaSqFt: number | null;
  rings: LatLngRings;
}

/** The lots of an answer to `taxlotUrl` / `blockTaxlotsUrl` (only the fields asked for are read). */
export function parseTaxlots(answer: unknown): Taxlot[] {
  return featuresOf(answer)
    .map((feature) => {
      const a = feature.attributes ?? {};
      const area = number(a.A_T_SQFT);
      return {
        address: parseStreetAddress(text(a.SITEADDR)),
        areaSqFt: area !== null && area > 0 ? area : null,
        rings: ringsOf(feature),
      };
    })
    .filter((lot) => lot.rings.length > 0);
}

export interface Neighborhood {
  /** "Grant Park". */
  name: string;
  rings: LatLngRings;
}

export function parseNeighborhood(answer: unknown): Neighborhood | null {
  const feature = featuresOf(answer)[0];
  if (!feature) return null;
  const name = text(feature.attributes?.NAME);
  const rings = ringsOf(feature);
  return name && rings.length > 0 ? { name: titleCase(name), rings } : null;
}

// ─── Where a tree is ───────────────────────────────────────────────────────

/** Distance (metres) and compass bearing (degrees) from `from` to `to`. */
export function offsetOf(from: LatLng, to: LatLng): { distanceM: number; bearingDeg: number } {
  const { x, y } = toLocalMeters(from, to);
  return { distanceM: Math.hypot(x, y), bearingDeg: bearingDeg(x, y) };
}
