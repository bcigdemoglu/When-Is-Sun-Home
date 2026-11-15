"use client";

import { useSyncExternalStore } from "react";
import { SavedPlaces } from "@/components/places/SavedPlaces";
import {
  canReadClipboard,
  handOffToSearch,
  readListingFromClipboard,
} from "@/components/search/listingPaste";
import { Button } from "@/components/ui/Button";
import { LinkIcon, LocateIcon, SearchIcon, SunIcon, WarningIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { pinNamedPlace, pinSpot } from "@/hooks/placeActions";
import { IMPRECISE_ACCURACY_M, impreciseMessage, useGeolocation } from "@/hooks/useGeolocation";
import { useSettings } from "@/state";
import type { PlaceEntry } from "@/state/places";

/** A leafy block with mapped building heights: a good first look at what the app does. */
const EXAMPLE_PLACE = {
  lat: 37.79118,
  lng: -122.43011,
  name: "Example: a backyard in Pacific Heights, San Francisco",
};

/** Where the pin is, as a value: a new name for the same spot is not a new choice. */
const currentSpot = () => {
  const place = useSettings.getState().place;
  return place ? `${place.lat},${place.lng}` : null;
};

/** Whether the clipboard can be read does not change while the page is open. */
const subscribeToNothing = () => () => {};
const cannotPasteOnServer = () => false;

/**
 * "Paste a listing link": read the clipboard (straight from the tap — the
 * browser only allows it then) and hand a listing link over to the search,
 * which finds its address. No link there, or no permission: a toast says so.
 */
function pasteListingLink(): void {
  void readListingFromClipboard().then((text) => {
    if (text !== null) handOffToSearch(text);
  });
}

interface StartIntroProps {
  /** "Enter an address": hand over to the search experience. */
  onEnterAddress(): void;
}

/**
 * The first thing anyone sees: the question, and the ways to answer it — two
 * big buttons, and under them a quiet third for a listing's link.
 * Location is asked for only when the button is tapped, and every way it can
 * fail is explained right here, next to the way round it.
 */
export function StartIntro({ onEnterAddress }: StartIntroProps) {
  const { state, locate } = useGeolocation(
    (spot, accuracyM) => {
      pinSpot(spot);
      if (accuracyM !== null && accuracyM > IMPRECISE_ACCURACY_M) {
        showToast(impreciseMessage(accuracyM));
      }
    },
    // A fix that arrives after the person picked a place some other way is not wanted.
    { getContext: currentSpot },
  );
  const locating = state.status === "locating";
  const canPaste = useSyncExternalStore(subscribeToNothing, canReadClipboard, cannotPasteOnServer);

  return (
    <div>
      <p className="type-eyebrow flex items-center gap-1.5 text-ink-2">
        <SunIcon className="text-accent" width={16} height={16} />
        When is Sun Home?
      </p>
      <h1 className="type-headline mt-2 text-ink">Where do you want sun?</h1>
      <p className="type-body mt-2 text-ink-2">
        Drop a pin on a yard, a terrace or a window and see how many hours of direct sun it gets,
        every day of the year.
      </p>
      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={locate}
          disabled={locating}
          aria-busy={locating}
        >
          {locating ? (
            <span
              aria-hidden="true"
              className="h-5 w-5 rounded-full border-2 border-surface/40 border-t-surface motion-safe:animate-spin"
            />
          ) : (
            <LocateIcon />
          )}
          {locating ? "Finding you…" : "Use my location"}
        </Button>
        <Button variant="tonal" size="lg" className="w-full" onClick={onEnterAddress}>
          <SearchIcon />
          Enter an address
        </Button>
        {/* The third way in, kept quiet: only where the browser can read the clipboard. */}
        {canPaste && (
          <Button variant="ghost" className="-mb-1.5 w-full" onClick={pasteListingLink}>
            <LinkIcon />
            Paste a listing link
          </Button>
        )}
      </div>
      {/* Always present, so nothing below jumps when a message appears. */}
      <div role="alert" className="min-h-0">
        {state.status === "error" && (
          <p className="mt-3 flex gap-2.5 rounded-xl bg-surface-2 p-3 text-[14px] leading-5 text-ink">
            <WarningIcon className="mt-px shrink-0 text-danger" />
            <span>{state.message}</span>
          </p>
        )}
      </div>
    </div>
  );
}

interface StartExtrasProps {
  /** Open a saved or recent place. */
  onOpen(entry: PlaceEntry): void;
}

/** Below the two buttons: places looked at before, and a quiet way to just see what this does. */
export function StartExtras({ onOpen }: StartExtrasProps) {
  return (
    <div>
      <SavedPlaces activeId={null} onOpen={onOpen} />
      <p className="type-body mt-4 text-ink-2">
        Or tap the map where you want the pin.{" "}
        <button
          type="button"
          className="font-medium text-accent underline decoration-1 underline-offset-4 hover:decoration-2"
          onClick={() => pinNamedPlace(EXAMPLE_PLACE)}
        >
          See an example
        </button>
      </p>
    </div>
  );
}
