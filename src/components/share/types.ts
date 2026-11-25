import type { ReportSection } from "@/components/report/sections";
import type { Place, PlaceSummary } from "@/lib/types";

export interface ShareButtonProps {
  place: Place;
  /** What to call the place in the shared text (saved name or address). */
  label: string;
  /** Headline numbers, or null while they are being computed (sharing still works). */
  summary: PlaceSummary | null;
  /**
   * "pill": icon + "Share" label. "icon": icon only (44px target).
   * "icon-sm": a quiet 32 px icon for a card's title row (still a 44 px target).
   */
  variant: "pill" | "icon" | "icon-sm";
  /**
   * Share a link to one section of the report (`…#trees`) instead of the
   * report as a whole. Without it the link carries no hash at all.
   */
  section?: ReportSection;
  className?: string;
}
