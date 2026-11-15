import type { Observer, Place, PlaceSummary } from "@/lib/types";
import type { PlaceEntry } from "@/state/places";

export interface SavedPlacesProps {
  /** Id of the entry for the place currently on screen, if any (highlighted). */
  activeId: string | null;
  /** Open a saved or recent place (restore its pin and observer). */
  onOpen: (entry: PlaceEntry) => void;
  className?: string;
}

export interface SaveButtonProps {
  place: Place;
  observer: Observer;
  /** Headline numbers for the place, or null while they are being computed. */
  summary: PlaceSummary | null;
  /** "pill": icon + "Save"/"Saved" label. "icon": icon only (44px target). */
  variant: "pill" | "icon";
  className?: string;
}
