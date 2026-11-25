/**
 * The words that travel with a link to one section of the report. Pure.
 *
 * The sun sections (and About) say what the whole report says — the place's
 * sun hours — since that is what their link opens onto. Trees are never part
 * of the sun hours, so the Trees section has words of its own.
 */
import type { ReportSection } from "@/components/report/sections";
import type { PlaceSummary } from "@/lib/types";
import { normalizePlaceName, shareText } from "@/state";

/** Title and text for a link to the Trees section. `label` "" is an unnamed pin. */
export function treesShareText(label: string): { title: string; text: string } {
  const name = typeof label === "string" ? normalizePlaceName(label) : null;
  return name
    ? {
        title: `Trees at ${name}`,
        text: `Street trees, backyard canopy and the trees around ${name}:`,
      }
    : {
        title: "Trees at this spot",
        text: "Street trees, backyard canopy and the trees around this spot:",
      };
}

/** Title and text for a link to `section` (or to the whole report, without one). */
export function sectionShareText(
  section: ReportSection | null | undefined,
  label: string,
  summary: PlaceSummary | null,
): { title: string; text: string } {
  if (section?.slug === "trees") return treesShareText(label);
  return shareText(label, summary);
}
