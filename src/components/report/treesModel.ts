/**
 * The report's Trees section, as data: what the city's records and the
 * state's laser survey say about the trees at a pinned address, in four
 * separate parts — in front (on the street), the backyard, this block, the
 * area. Pure: parsed answers and measured canopy windows in, plain objects
 * out (the fetching is in `useTreeReport.ts`, the words in `treesText.ts`).
 *
 * Information only: trees are NEVER part of a sun-hours number.
 */
import {
  canopyCover,
  heightNear,
  lotCanopy,
  polygonsArea,
  type CanopyCover,
  type LotCanopy,
} from "@/components/map/canopySummary";
import type { CanopyGrid } from "@/components/map/treeTileJob";
import { hasTreeHeights } from "@/components/map/trees";
import {
  NEAREST_MAX_M,
  blockOf,
  inBlock,
  inPortland,
  offsetOf,
  parseStreetAddress,
  sameAddress,
  type Block,
  type HeritageTree,
  type Neighborhood,
  type StreetAddress,
  type Taxlot,
} from "@/lib/trees/portland";
import {
  groupsOfTrees,
  plantingSites,
  summarizeStreetTrees,
  wiresCount,
  type StreetTreeSummary,
} from "@/lib/trees/metrics";
import type { LatLng, Place, StreetTree, StreetTreeGroup } from "@/lib/types";

/** Where the tree data is: the street trees and lots are the city's, the heights the state's. */
export type TreeRegion = "portland" | "oregon" | "elsewhere";

export function treeRegion(spot: LatLng): TreeRegion {
  if (inPortland(spot)) return "portland";
  return hasTreeHeights(spot) ? "oregon" : "elsewhere";
}

/** Laser heights are looked for this close to a street tree's trunk, metres. */
export const TRUNK_RADIUS_M = 3;
/** At most this many trees are listed in front of one address (a big lot can have dozens). */
export const FRONT_MAX = 3;
/**
 * A street tree with a thinner trunk than this, inches, gets no laser
 * height: it is young (planted since the survey, or too small for it), and
 * the canopy measured around its trunk is its neighbours'.
 */
export const MEASURED_TRUNK_MIN_IN = 6;

/** Something still on its way, failed, or here. */
export type Loadable<T> =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; value: T }
  /** Not asked for here (outside the city, outside Oregon, or nothing to ask about). */
  | { state: "none" };

export const loading = { state: "loading" } as const;
export const failed = { state: "error" } as const;
export const none = { state: "none" } as const;
export const ready = <T>(value: T): Loadable<T> => ({ state: "ready", value });

/** A street tree as listed: where it is from the pin and how tall the survey saw it. */
export interface ListedTree extends StreetTree {
  distanceM: number;
  bearingDeg: number;
  /**
   * Tallest laser height within `TRUNK_RADIUS_M`, feet: 0 = under 10 ft,
   * null = no survey data, undefined = not measured yet, "small" = a trunk
   * too thin to tell its own crown (see `MEASURED_TRUNK_MIN_IN`).
   */
  heightFt: number | null | undefined | "small";
}

export interface TreeInputs {
  place: Place;
  /** The lot under the pin (Portland). */
  lot: Loadable<Taxlot | null>;
  nearby: Loadable<StreetTree[]>;
  /** The street trees of the block (`block` below), not yet filtered. */
  blockTrees: Loadable<StreetTree[]>;
  blockLots: Loadable<Taxlot[]>;
  area: Loadable<{ species: StreetTreeGroup[]; traits: StreetTreeGroup[] }>;
  heritage: Loadable<HeritageTree[]>;
  neighborhood: Loadable<Neighborhood | null>;
  nearGrid: Loadable<CanopyGrid>;
  areaGrid: Loadable<CanopyGrid>;
  /** "none" for a neighborhood too big to measure here. */
  neighborhoodGrid: Loadable<CanopyGrid>;
}

/**
 * The address the report is about: the lot's own site address (the county's
 * record of the lot under the pin), else the place's name if it reads as a
 * street address. Undefined while the lot is still being looked up.
 */
export function addressFor(
  place: Place,
  lot: Loadable<Taxlot | null>,
): { address: StreetAddress; source: "lot" | "place" } | null | undefined {
  if (lot.state === "loading") return undefined;
  const fromLot = lot.state === "ready" ? (lot.value?.address ?? null) : null;
  if (fromLot) return { address: fromLot, source: "lot" };
  const fromName = parseStreetAddress(place.name);
  return fromName ? { address: fromName, source: "place" } : null;
}

/**
 * The block the report is about: the address's, else (no address) the block
 * of the nearest street tree, so that a pin dropped on a street still has
 * one. Undefined while that is not known yet.
 */
export function blockFor(
  address: StreetAddress | null | undefined,
  nearby: Loadable<StreetTree[]>,
  place: LatLng,
): Block | null | undefined {
  if (address === undefined) return undefined;
  if (address) return blockOf(address);
  if (nearby.state === "loading") return undefined;
  if (nearby.state !== "ready") return null;
  const nearest = listTrees(nearby.value, place, null)[0];
  const parsed = nearest ? parseStreetAddress(nearest.address) : null;
  return parsed ? blockOf(parsed) : null;
}

function listTrees(
  trees: readonly StreetTree[],
  place: LatLng,
  grid: CanopyGrid | null,
  measuring = false,
): ListedTree[] {
  return trees
    .map((tree) => ({
      ...tree,
      ...offsetOf(place, tree),
      heightFt:
        tree.diameterIn !== null && tree.diameterIn < MEASURED_TRUNK_MIN_IN
          ? ("small" as const)
          : grid
            ? heightNear(grid, tree, TRUNK_RADIUS_M)
            : measuring
              ? undefined
              : null,
    }))
    .sort((a, b) => a.distanceM - b.distanceM || a.id - b.id);
}

export interface FrontSection {
  address: StreetAddress | null;
  addressSource: "lot" | "place" | null;
  /** Street trees recorded at this address, nearest first. */
  trees: ListedTree[];
  /** How many there are in all (the list stops at `FRONT_MAX`). */
  count: number;
  /** When none is recorded here: the nearest within `NEAREST_MAX_M`, if any. */
  nearest: ListedTree | null;
}

export interface BackyardSection {
  /** The lot's area, square feet (the county's figure). */
  lotSqFt: number | null;
  canopy: LotCanopy | null;
}

export interface BlockSection {
  block: Block;
  /** The trees, nearest first. */
  trees: ListedTree[];
  summary: StreetTreeSummary;
  wires: { under: number; known: number };
  sites: { type: string | null; widthFt: number | null };
  /** The tallest street tree of the block by the laser survey, feet (those in the window). */
  tallestFt: number | null;
  /** Canopy over the block's lots (both sides of the street); null without lot lines. */
  lotsCanopy: Loadable<CanopyCover | null>;
  lotCount: number;
}

export interface AreaSection {
  streetTrees: Loadable<StreetTreeSummary>;
  canopy: Loadable<CanopyCover>;
  neighborhood: Loadable<{ name: string; canopy: Loadable<CanopyCover> } | null>;
  heritage: Loadable<(HeritageTree & { distanceM: number; bearingDeg: number })[]>;
}

export interface TreeReport {
  region: TreeRegion;
  front: Loadable<FrontSection>;
  backyard: Loadable<BackyardSection>;
  block: Loadable<BlockSection | null>;
  area: AreaSection;
}

/** A cover with nothing measured (a window measured without an area: not expected). */
const emptyCover: CanopyCover = {
  groundM2: 0,
  canopyM2: 0,
  cover: null,
  tallestFt: null,
  heightShares: null,
  surveyed: 0,
};

const map = <T, U>(value: Loadable<T>, fn: (value: T) => U): Loadable<U> =>
  value.state === "ready" ? ready(fn(value.value)) : value;

/** Put the parts together. */
export function buildTreeReport(inputs: TreeInputs): TreeReport {
  const { place } = inputs;
  const region = treeRegion(place);
  const grid = inputs.nearGrid.state === "ready" ? inputs.nearGrid.value : null;
  const measuring = inputs.nearGrid.state === "loading";

  const resolved = region === "portland" ? addressFor(place, inputs.lot) : null;
  const address = resolved === undefined ? undefined : (resolved?.address ?? null);

  // ── In front ──
  let front: Loadable<FrontSection> = none;
  if (region === "portland") {
    if (resolved === undefined) front = loading;
    else if (address && inputs.blockTrees.state !== "ready") {
      front = inputs.blockTrees.state === "error" ? failed : loading;
    } else if (!address && inputs.nearby.state !== "ready") {
      front = inputs.nearby.state === "error" ? failed : loading;
    } else {
      const recorded =
        address && inputs.blockTrees.state === "ready"
          ? inputs.blockTrees.value.filter((tree) =>
              sameAddress(parseStreetAddress(tree.address), address),
            )
          : [];
      const listed = listTrees(recorded, place, grid, measuring);
      const near =
        listed.length === 0 && inputs.nearby.state === "ready"
          ? (listTrees(inputs.nearby.value, place, grid, measuring).find(
              (tree) => tree.distanceM <= NEAREST_MAX_M,
            ) ?? null)
          : null;
      front = ready({
        address: address ?? null,
        addressSource: resolved?.source ?? null,
        trees: listed.slice(0, FRONT_MAX),
        count: listed.length,
        nearest: near,
      });
    }
  }

  // ── Backyard ──
  let backyard: Loadable<BackyardSection> = none;
  if (region === "portland") {
    if (inputs.lot.state === "loading") backyard = loading;
    else if (inputs.lot.state === "error") backyard = failed;
    else if (inputs.lot.state === "ready") {
      const lot = inputs.lot.value;
      if (!lot) backyard = ready({ lotSqFt: null, canopy: null });
      else if (inputs.nearGrid.state === "loading") backyard = loading;
      else if (inputs.nearGrid.state === "error") backyard = failed;
      else if (grid) {
        const frontTrees = front.state === "ready" ? front.value.trees : [];
        // Which side faces the street comes from the street trees: while they are
        // on their way the backyard waits, rather than say the side is unknown.
        const streetPending =
          front.state === "loading" ||
          (frontTrees.length === 0 && !!address && inputs.blockTrees.state === "loading");
        if (streetPending) backyard = loading;
        else {
          backyard = ready({
            lotSqFt: lot.areaSqFt,
            canopy: lotCanopy(grid, lot, streetSide(frontTrees, inputs.blockTrees, address, place)),
          });
        }
      } else backyard = ready({ lotSqFt: lot.areaSqFt, canopy: null });
    }
  }

  // ── This block ──
  let block: Loadable<BlockSection | null> = none;
  if (region === "portland") {
    const which = blockFor(address, inputs.nearby, place);
    if (which === undefined) block = inputs.lot.state === "error" ? failed : loading;
    else if (which === null) block = ready(null);
    else if (inputs.blockTrees.state !== "ready") {
      block = inputs.blockTrees.state === "error" ? failed : loading;
    } else {
      const trees = listTrees(
        inputs.blockTrees.value.filter((tree) => inBlock(parseStreetAddress(tree.address), which)),
        place,
        grid,
        measuring,
      );
      const heights = trees
        .map((tree) => tree.heightFt)
        .filter((height): height is number => typeof height === "number" && height > 0);
      const lots =
        inputs.blockLots.state === "ready"
          ? inputs.blockLots.value.filter((lot) => inBlock(lot.address, which))
          : [];
      const lotsCanopy: Loadable<CanopyCover | null> =
        inputs.blockLots.state !== "ready"
          ? inputs.blockLots.state === "error"
            ? failed
            : loading
          : lots.length === 0
            ? ready(null)
            : map(inputs.nearGrid, (near) => {
                const { mask, box } = polygonsArea(
                  near.window,
                  lots.map((lot) => lot.rings),
                );
                return canopyCover(near, mask, box);
              });
      block = ready({
        block: which,
        trees,
        summary: summarizeStreetTrees(groupsOfTrees(trees)),
        wires: wiresCount(trees),
        sites: plantingSites(trees),
        tallestFt: heights.length ? Math.max(...heights) : null,
        lotsCanopy,
        lotCount: lots.length,
      });
    }
  }

  // ── The area ──
  const area: AreaSection = {
    streetTrees:
      region === "portland"
        ? map(inputs.area, ({ species, traits }) => summarizeStreetTrees(species, traits))
        : none,
    canopy:
      region === "elsewhere"
        ? none
        : // Measured in the worker, over the circle it was asked for (see `useTreeReport`).
          map(inputs.areaGrid, (wide) => wide.cover ?? emptyCover),
    neighborhood:
      region === "portland"
        ? map(inputs.neighborhood, (hood) =>
            hood
              ? {
                  name: hood.name,
                  canopy: map(inputs.neighborhoodGrid, (hoodGrid) => hoodGrid.cover ?? emptyCover),
                }
              : null,
          )
        : none,
    heritage:
      region === "portland"
        ? map(inputs.heritage, (trees) =>
            trees
              .map((tree) => ({ ...tree, ...offsetOf(place, tree) }))
              .sort((a, b) => a.distanceM - b.distanceM)
              .slice(0, 2),
          )
        : none,
  };

  return { region, front, backyard, block, area };
}

/**
 * Where the street is, for "behind the house": the middle of the street
 * trees recorded at this address (they stand in the right-of-way in front of
 * it), else the nearest street tree on the address's street, else unknown.
 */
export function streetSide(
  frontTrees: readonly StreetTree[],
  blockTrees: Loadable<StreetTree[]>,
  address: StreetAddress | null | undefined,
  place: LatLng,
): LatLng | null {
  if (frontTrees.length > 0) {
    return {
      lat: frontTrees.reduce((sum, tree) => sum + tree.lat, 0) / frontTrees.length,
      lng: frontTrees.reduce((sum, tree) => sum + tree.lng, 0) / frontTrees.length,
    };
  }
  if (!address || blockTrees.state !== "ready") return null;
  const sameStreet = blockTrees.value.filter(
    (tree) => parseStreetAddress(tree.address)?.street === address.street,
  );
  return listTrees(sameStreet, place, null)[0] ?? null;
}
