/**
 * Ways a place gets pinned. Plain functions on the settings store, so the map,
 * the search box and the geolocation button all go through the same door.
 */
import { reverseGeocode, type PlaceSuggestion } from "@/lib/geocode/photon";
import type { LatLng } from "@/lib/types";
import { useSettings } from "@/state";

/** Wait this long before looking a spot up, so a flurry of pin moves asks once. */
export const REVERSE_GEOCODE_DELAY_MS = 400;

let pendingLookup: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null =
  null;

function cancelLookup(): void {
  if (!pendingLookup) return;
  clearTimeout(pendingLookup.timer);
  pendingLookup.controller.abort();
  pendingLookup = null;
}

/**
 * Pin a bare coordinate (a map click, a pin drag, the device's location).
 *
 * The old place's name is dropped at once — this is a new spot — and a label
 * is looked up in the background. It is applied only if the pin is still
 * exactly there and still unnamed when the answer arrives; the pin never
 * waits for it and a failed lookup changes nothing.
 */
export function pinSpot(spot: LatLng): void {
  cancelLookup();
  const { setPlace } = useSettings.getState();
  setPlace({ lat: spot.lat, lng: spot.lng });
  const pinned = useSettings.getState().place;
  if (!pinned) return;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    reverseGeocode(pinned, { signal: controller.signal })
      .then((name) => {
        if (!name || controller.signal.aborted) return;
        const current = useSettings.getState().place;
        if (
          current &&
          current.lat === pinned.lat &&
          current.lng === pinned.lng &&
          current.name === undefined
        ) {
          useSettings.getState().setPlace({ lat: current.lat, lng: current.lng, name });
        }
      })
      .catch(() => {
        // The label is a nicety; the coordinates are shown instead.
      });
  }, REVERSE_GEOCODE_DELAY_MS);
  pendingLookup = { controller, timer };
}

/** Pin a search result, with its name. */
export function pinSuggestion(suggestion: PlaceSuggestion): void {
  cancelLookup();
  const name = suggestion.name ?? suggestion.label;
  useSettings.getState().setPlace({ lat: suggestion.lat, lng: suggestion.lng, name });
}

/** For tests: forget any lookup in flight. */
export function cancelPendingPlaceLookup(): void {
  cancelLookup();
}
