/**
 * Ways a place gets pinned. Plain functions on the settings store, so the map,
 * the search box and the geolocation button all go through the same door.
 */
import type { PlaceSelection } from "@/components/search/types";
import { reverseGeocode } from "@/lib/geocode/photon";
import type { LatLng, Observer, Place } from "@/lib/types";
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

/**
 * Pin a place that already has a name (a search result, a saved or recent
 * place) — and, when it comes with one, put its viewpoint back as well.
 */
export function pinNamedPlace(place: Place, observer?: Observer): void {
  cancelLookup();
  const settings = useSettings.getState();
  if (observer) settings.setObserver(observer);
  settings.setPlace(place.name ? { lat: place.lat, lng: place.lng, name: place.name } : place);
}

/** Whatever the search experience hands over: named places as they are, bare spots looked up. */
export function openSelection(selection: PlaceSelection): void {
  const { place, observer } = selection;
  if (place.name) {
    pinNamedPlace(place, observer);
    return;
  }
  if (observer) useSettings.getState().setObserver(observer);
  pinSpot(place);
}

/** Forget the place: back to the start screen. */
export function clearPlace(): void {
  cancelLookup();
  useSettings.getState().setPlace(null);
}

/** For tests: forget any lookup in flight. */
export function cancelPendingPlaceLookup(): void {
  cancelLookup();
}
