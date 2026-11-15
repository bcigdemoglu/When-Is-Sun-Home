import { showToast } from "@/components/ui/toast";
import { entryLabel, usePlaces, type PlaceEntry } from "@/state/places";

/**
 * Stop keeping a place, with a toast that can undo it: the place comes back
 * with its name, its note and its position in the list.
 */
export function unsaveWithUndo(entry: PlaceEntry): void {
  const store = usePlaces.getState();
  const order = store.saved.map((saved) => saved.id);
  store.unsave(entry.id);
  showToast(`Removed “${entryLabel(entry)}” from saved places`, {
    label: "Undo",
    onAction: () => {
      const places = usePlaces.getState();
      const restored = places.save(entry.place, entry.observer, entry.summary, entry.label);
      if (restored.savedAt === null) return;
      if (entry.note) places.setNote(entry.id, entry.note);
      places.reorder(order);
    },
  });
}
