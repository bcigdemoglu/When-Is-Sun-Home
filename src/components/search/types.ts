import type { Observer, Place } from "@/lib/types";

export interface PlaceSelection {
  place: Place;
  /** Present when a saved/recent place is re-opened: restore its observer too. */
  observer?: Observer;
  source: "search" | "saved" | "recent" | "location" | "coordinates";
}

export interface SearchExperienceProps {
  /** The current place; its label fills the idle field. Null on first run. */
  place: Place | null;
  /**
   * - "overlay" (phones): an idle pill; focusing it takes over the whole
   *   screen with the keyboard up.
   * - "panel" (desktop): an inline field whose suggestions drop down in place.
   */
  variant: "overlay" | "panel";
  /** The user picked a place (suggestion, saved, recent, or their location). */
  onSelect: (selection: PlaceSelection) => void;
  /** The user chose "Choose on the map": close search and let them tap the map. */
  onChooseOnMap: () => void;
  /** The ⓧ in the idle field: forget the current place and return to the start state. */
  onClear: () => void;
  className?: string;
}
