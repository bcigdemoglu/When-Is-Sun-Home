/**
 * The words and numbers of the report's Trees section: US units (feet,
 * inches, square feet, miles), as the city records its trees. Pure.
 *
 * Information only: trees are NEVER part of a sun-hours number, and nothing
 * here talks about sun or shade.
 */
import type { BackyardUnavailable, Side } from "@/components/map/canopySummary";
import type { TreeSurvey } from "@/components/map/trees";
import { compassPoint, formatCount, MONTHS_SHORT } from "@/components/shared/format";
import {
  isDeciduous,
  isEvergreen,
  speciesFlags,
  streetLabel,
  type Block,
} from "@/lib/trees/portland";
import type { DiversityLevel } from "@/lib/trees/metrics";

const FEET_PER_M = 3.28084;
const FEET_PER_MILE = 5280;

/** A ground distance: "53 ft", "940 ft", "0.6 mi", "1.4 mi". */
export function formatFeetDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "";
  const feet = metres * FEET_PER_M;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  return `${(feet / FEET_PER_MILE).toFixed(1)} mi`;
}

/** Where something is from the pin: "53 ft W", "0.6 mi NE". */
export function formatOffset(distanceM: number, bearingDeg: number): string {
  if (distanceM < 1.5) return "at the pin";
  return `${formatFeetDistance(distanceM)} ${compassPoint(bearingDeg, 8)}`;
}

/** A height in feet from the survey (255 means that or more): "52 ft", "250+ ft". */
export function formatFeet(feet: number): string {
  return feet >= 255 ? "255+ ft" : `${Math.round(feet)} ft`;
}

/** A trunk diameter: "27.7 in". */
export function formatInches(inches: number): string {
  return `${Math.round(inches * 10) / 10} in`;
}

/** An area of ground: "1,220 sq ft" (to the nearest ten). */
export function formatSquareFeet(squareFeet: number): string {
  return `${formatCount(Math.round(squareFeet / 10) * 10)} sq ft`;
}

/** A share: "92%", "<1%" for a sliver, "0%" for none. */
export function formatShare(share: number): string {
  if (!(share > 0)) return "0%";
  if (share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** A share to a tenth where that matters (the 10-20-30 limits): "9.7%". */
export function formatShareFine(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

/** "2024-06-25" → "Jun 2024": the inventory's date, a calendar date (no time zone involved). */
export function formatInventoried(date: string | null): string {
  const match = date ? /^(\d{4})-(\d{2})-\d{2}$/.exec(date) : null;
  if (!match) return "";
  return `${MONTHS_SHORT[Number(match[2]) - 1]} ${match[1]}`;
}

/** "norway maple" → "Norway maple". */
export function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** A tree's leaves: "Deciduous broadleaf", "Evergreen conifer", or "". */
export function leafText(functionalType: string): string {
  const conifer = /conifer/i.test(functionalType);
  if (isDeciduous(functionalType)) return conifer ? "Deciduous conifer" : "Deciduous broadleaf";
  if (isEvergreen(functionalType)) return conifer ? "Evergreen conifer" : "Evergreen broadleaf";
  return "";
}

/** "Native to the Portland area", "Not native · on the city's nuisance list", or "" when unknown. */
export function originText(scientific: string): string {
  const flags = scientific ? speciesFlags(scientific) : null;
  if (!flags) return "";
  const origin = flags.native ? "Native to the Portland area" : "Not native";
  return flags.nuisance ? `${origin} · on the city's nuisance list` : origin;
}

/** Overhead wires above a tree: "None", "High-voltage lines", "Other lines". */
export function wiresText(wires: string): string {
  if (!wires) return "";
  if (/^none$/i.test(wires)) return "None";
  if (/high/i.test(wires)) return "High-voltage lines";
  return "Other lines";
}

/** The planting site: "Strip, 6 ft wide", "Tree well", "Median". */
export function siteText(type: string, widthFt: number | null): string {
  if (!type && widthFt === null) return "";
  const kind = type
    ? type === "Strip"
      ? "Planting strip"
      : type === "Cutout"
        ? "Sidewalk cutout"
        : sentenceCase(type.toLowerCase())
    : "Planting site";
  return widthFt !== null ? `${kind}, ${Math.round(widthFt)} ft wide` : kind;
}

/** The laser height at a street tree's trunk, with the survey: "About 52 ft tall (2014 survey)". */
export function treeHeightText(
  heightFt: number | null | undefined | "small",
  survey: TreeSurvey | null,
): string {
  if (heightFt === undefined) return "";
  if (heightFt === "small") return "Young tree: too small for the laser survey to measure";
  const year = survey ? ` (${survey.year} survey)` : "";
  if (heightFt === null) return "Not in the laser survey";
  if (heightFt === 0) return `Under 10 ft tall${year}`;
  return `About ${formatFeet(heightFt)} tall${year}`;
}

/** "2100 block of NE 36th Ave". */
export function blockTitle(block: Block): string {
  return `${block.hundred}–${block.hundred + 99} ${streetLabel(block.street)}`;
}

/** Where the backyard's canopy is: "Mostly on the north side", "On the north and south sides". */
export function sidesText(sides: readonly { side: Side; share: number }[]): string {
  const [first, second] = sides;
  if (!first || first.share === 0) return "";
  if (first.share >= 0.5) return `Mostly on the ${first.side} side of the yard`;
  if (second && first.share + second.share >= 0.6) {
    return `Mostly on the ${first.side} and ${second.side} sides of the yard`;
  }
  return "Spread around the yard";
}

/** Why there is no backyard summary. */
export function backyardUnavailableText(reason: BackyardUnavailable): string {
  switch (reason) {
    case "large-lot":
      return "Not available for this kind of lot: it is bigger than an acre (a school, a park or an apartment block, not a house lot).";
    case "many-buildings":
      return "Not available for this kind of lot: it has more buildings than a house, a garage and a shed.";
    case "no-house":
      return "Not available: no house is mapped on this lot.";
    case "no-street":
      return "Not available: which side of the house faces the street is not known here.";
    case "no-yard":
      return "Not available: nothing of the lot lies behind the house.";
    case "outside":
      return "Not available: the lot lines did not line up with the survey here.";
  }
}

/** One line of the 10-20-30 rule: "Species: Norway maple 9.7% (limit 10%)". */
export function diversityLine(name: string, level: DiversityLevel): string {
  if (!level.top) return `${name}: not known`;
  const label = level.top.common ? sentenceCase(level.top.common) : level.top.name;
  return `${name}: ${label} ${formatShareFine(level.top.share)}`;
}

/** Trunk-diameter classes, as labelled. */
export const DIAMETER_CLASS_LABELS: readonly string[] = ["0–6 in", "6–12 in", "12–24 in", "24+ in"];
/** Canopy height groups, as labelled. */
export const CANOPY_HEIGHT_LABELS: readonly string[] = ["10–35 ft", "35–70 ft", "70+ ft"];

/** The definition of tree canopy cover, the same in every part. */
export function canopyDefinition(survey: TreeSurvey | null): string {
  const when = survey ? `the ${survey.year} laser survey` : "the laser survey";
  return (
    `Tree canopy cover is the share of the ground (buildings cut out) where ${when} measured ` +
    "something 10 ft or taller. The city's official canopy figures use a different year and " +
    "method, and count buildings as ground, so they will not match exactly."
  );
}

/**
 * Portland's own city-wide figure, for comparison: 32.4% of the city's land
 * area, from the City of Portland's canopy update (Portland Parks &
 * Recreation Urban Forestry, July 2026; canopy steady 2020–2025):
 * https://www.portland.gov/trees/news/2026/7/21/portland-tree-canopy-cover-update
 */
export const PORTLAND_CANOPY = {
  share: 0.324,
  text: "Portland overall: 32.4% of the city's land area (City of Portland, 2025)",
  url: "https://www.portland.gov/trees/news/2026/7/21/portland-tree-canopy-cover-update",
} as const;

/** What the section says where there is no tree data. */
export const OUTSIDE_OREGON_TEXT =
  "Tree data is only available in Oregon (tree heights) and the City of Portland (street trees and lots).";
export const OUTSIDE_PORTLAND_TEXT =
  "Street tree records are only available in the City of Portland.";
/** The one line that keeps trees out of the numbers. */
export const NOT_IN_SUN_HOURS = "Trees are not part of the sun hours in this report.";
