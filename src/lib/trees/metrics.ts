/**
 * Standard street-tree metrics, from the city's inventory: counts, species
 * mix, the 10-20-30 diversity rule, trunk-size classes, mature size,
 * condition, deciduous vs evergreen. One summary for a list of trees (a
 * block) and for the grouped counts of a statistics query (an area). Pure.
 *
 * Information only: none of this is ever part of a sun-hours number.
 */
import type { StreetTree, StreetTreeGroup } from "@/lib/types";
import {
  DIAMETER_CLASS_LIMITS_IN,
  familyOf,
  genusOf,
  isDeciduous,
  isEvergreen,
  isGenusOnly,
  splitSpecies,
} from "./portland";

/** The trunk-diameter class (0..3) of a trunk this thick, inches. */
export function diameterClassOf(inches: number): number {
  let index = 0;
  for (const limit of DIAMETER_CLASS_LIMITS_IN) if (inches >= limit) index++;
  return index;
}

/** A list of trees as groups (one per tree), for `summarizeStreetTrees`. */
export function groupsOfTrees(trees: readonly StreetTree[]): StreetTreeGroup[] {
  return trees.map((tree) => {
    const classes: [number, number, number, number] = [0, 0, 0, 0];
    if (tree.diameterIn !== null) classes[diameterClassOf(tree.diameterIn)] = 1;
    return {
      species: tree.scientific ? `${tree.scientific} - ${tree.common}` : "Unknown",
      matureSize: tree.matureSize,
      functionalType: tree.functionalType,
      condition: tree.condition,
      count: 1,
      diameterClasses: classes,
      diameterSumIn: tree.diameterIn ?? 0,
      diameterMaxIn: tree.diameterIn ?? 0,
    };
  });
}

/** A name and how many trees, with its share of the trees counted. */
export interface Ranked {
  name: string;
  /** For a species: its common name. */
  common?: string;
  count: number;
  share: number;
}

/** One level of the 10-20-30 rule. */
export interface DiversityLevel {
  /** The largest species / genus / family, or null when nothing is known at this level. */
  top: Ranked | null;
  /** The limit: 0.1, 0.2 or 0.3. */
  limit: number;
  /** The top one's share is within the limit. */
  pass: boolean;
}

/**
 * Santamour's 10-20-30 rule for a resilient urban forest: no species more
 * than 10% of the trees, no genus more than 20%, no family more than 30%.
 * Shares are of the trees identified at least to their genus; a tree known
 * only by its genus ("Acer spp.") counts for the genus and the family, not
 * as a species.
 */
export interface TenTwentyThirty {
  species: DiversityLevel;
  genus: DiversityLevel;
  family: DiversityLevel;
  /** All three pass. */
  pass: boolean;
  /** Trees the shares are of. */
  basis: number;
}

export interface StreetTreeSummary {
  total: number;
  /** Most common species first (all of them; Unknown included, last among equals). */
  species: Ranked[];
  /** Trees per trunk class, 0–6, 6–12, 12–24, 24+ in; and how many have a trunk recorded. */
  diameterClasses: [number, number, number, number];
  measured: number;
  averageDiameterIn: number | null;
  largestDiameterIn: number | null;
  /** Share of the trees with a known mature size that grow Large. */
  largeShare: number | null;
  /** Trees per condition, best first: Excellent, Good, Fair, Poor, Dead (others under "Other"). */
  condition: { name: string; count: number }[];
  /** Shares of the trees with a known type. */
  deciduousShare: number | null;
  evergreenShare: number | null;
  diversity: TenTwentyThirty;
}

export const CONDITIONS = ["Excellent", "Good", "Fair", "Poor", "Dead"] as const;

function rank(counts: Map<string, number>, basis: number, commons?: Map<string, string>): Ranked[] {
  return [...counts]
    .map(([name, count]) => ({
      name,
      count,
      share: basis > 0 ? count / basis : 0,
      ...(commons?.get(name) ? { common: commons.get(name) } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function level(ranked: Ranked[], limit: number): DiversityLevel {
  const top = ranked[0] ?? null;
  // Shares are compared rounded to a tenth of a percent: 10.0% passes the 10% limit.
  return { top, limit, pass: top === null || Math.round(top.share * 1000) <= limit * 1000 };
}

const add = (counts: Map<string, number>, key: string, n: number) =>
  counts.set(key, (counts.get(key) ?? 0) + n);

/** The 10-20-30 rule for these groups (see `TenTwentyThirty`). */
export function tenTwentyThirty(groups: readonly StreetTreeGroup[]): TenTwentyThirty {
  const species = new Map<string, number>();
  const commons = new Map<string, string>();
  const genera = new Map<string, number>();
  const families = new Map<string, number>();
  let basis = 0;
  for (const group of groups) {
    const { scientific, common } = splitSpecies(group.species);
    const genus = genusOf(scientific);
    if (!genus) continue;
    basis += group.count;
    add(genera, genus, group.count);
    const family = familyOf(genus);
    if (family) add(families, family, group.count);
    if (!isGenusOnly(scientific)) {
      add(species, scientific, group.count);
      commons.set(scientific, common);
    }
  }
  const result = {
    species: level(rank(species, basis, commons), 0.1),
    genus: level(rank(genera, basis), 0.2),
    family: level(rank(families, basis), 0.3),
  };
  return {
    ...result,
    pass: basis > 0 && result.species.pass && result.genus.pass && result.family.pass,
    basis,
  };
}

/**
 * Everything the report says about a set of street trees. Counts, species,
 * trunks and diversity come from `groups`; mature size, type and condition
 * from `traits` — the same groups for a list of trees, a second answer for
 * an area (see `areaStreetTreesUrl`).
 */
export function summarizeStreetTrees(
  groups: readonly StreetTreeGroup[],
  traits: readonly StreetTreeGroup[] = groups,
): StreetTreeSummary {
  let total = 0;
  const species = new Map<string, number>();
  const commons = new Map<string, string>();
  const diameterClasses: [number, number, number, number] = [0, 0, 0, 0];
  let diameterSum = 0;
  let largest = 0;
  let sized = 0;
  let large = 0;
  let typed = 0;
  let deciduous = 0;
  let evergreen = 0;
  const condition = new Map<string, number>();
  for (const group of groups) {
    const n = group.count;
    total += n;
    const { scientific, common } = splitSpecies(group.species);
    const key = scientific || "Unknown";
    add(species, key, n);
    commons.set(key, common);
    group.diameterClasses.forEach((count, i) => (diameterClasses[i] += count));
    diameterSum += group.diameterSumIn;
    largest = Math.max(largest, group.diameterMaxIn);
  }
  for (const group of traits) {
    const n = group.count;
    if (group.matureSize) {
      sized += n;
      if (/^large$/i.test(group.matureSize)) large += n;
    }
    if (isDeciduous(group.functionalType) || isEvergreen(group.functionalType)) {
      typed += n;
      if (isDeciduous(group.functionalType)) deciduous += n;
      else evergreen += n;
    }
    const known = CONDITIONS.find((name) => name.toLowerCase() === group.condition.toLowerCase());
    add(condition, known ?? (group.condition ? "Other" : "Not recorded"), n);
  }
  const measured = diameterClasses.reduce((sum, count) => sum + count, 0);
  const order = [...CONDITIONS, "Other", "Not recorded"];
  return {
    total,
    species: rank(species, total, commons).sort(
      (a, b) => Number(a.name === "Unknown") - Number(b.name === "Unknown") || 0,
    ),
    diameterClasses,
    measured,
    averageDiameterIn: measured > 0 ? diameterSum / measured : null,
    largestDiameterIn: largest > 0 ? largest : null,
    largeShare: sized > 0 ? large / sized : null,
    condition: order
      .filter((name) => condition.has(name))
      .map((name) => ({ name, count: condition.get(name) ?? 0 })),
    deciduousShare: typed > 0 ? deciduous / typed : null,
    evergreenShare: typed > 0 ? evergreen / typed : null,
    diversity: tenTwentyThirty(groups),
  };
}

/** How many of these trees grow under overhead wires (any kind), and how many have the wires recorded. */
export function wiresCount(trees: readonly StreetTree[]): { under: number; known: number } {
  let under = 0;
  let known = 0;
  for (const tree of trees) {
    if (!tree.wires) continue;
    known++;
    if (!/^none$/i.test(tree.wires)) under++;
  }
  return { under, known };
}

/** The planting sites of these trees: the commonest type and the typical width, feet. */
export function plantingSites(trees: readonly StreetTree[]): {
  type: string | null;
  widthFt: number | null;
} {
  const types = new Map<string, number>();
  const widths: number[] = [];
  for (const tree of trees) {
    if (tree.siteType) add(types, tree.siteType, 1);
    if (tree.siteWidthFt !== null) widths.push(tree.siteWidthFt);
  }
  widths.sort((a, b) => a - b);
  const type = rank(types, trees.length)[0]?.name ?? null;
  return { type, widthFt: widths.length ? widths[Math.floor(widths.length / 2)] : null };
}
