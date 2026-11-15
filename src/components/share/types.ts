import type { Place, PlaceSummary } from "@/lib/types";

export interface ShareButtonProps {
  place: Place;
  /** What to call the place in the shared text (saved name or address). */
  label: string;
  /** Headline numbers, or null while they are being computed (sharing still works). */
  summary: PlaceSummary | null;
  /** "pill": icon + "Share" label. "icon": icon only (44px target). */
  variant: "pill" | "icon";
  className?: string;
}
