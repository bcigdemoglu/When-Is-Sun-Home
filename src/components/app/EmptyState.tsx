"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LocateIcon } from "@/components/ui/icons";
import { pinSpot } from "@/hooks/placeActions";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useSettings } from "@/state";
import { Brand } from "./Brand";

/** A leafy block with mapped building heights: a good first look at what the app does. */
const EXAMPLE_PLACE = {
  lat: 37.79118,
  lng: -122.43011,
  name: "Example: a backyard in Pacific Heights, San Francisco",
};

/** Shown until a place is pinned: what this is, and three ways to begin. */
export function EmptyState() {
  const { state, locate } = useGeolocation(pinSpot);

  return (
    <Card>
      <Brand />
      <h2 className="mt-3 text-2xl leading-tight font-semibold text-ink">
        How much sun does that backyard really get?
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Drop a pin on a yard, a terrace or a window and see how many hours of direct sunlight it
        gets on every day of the year, and at what time of day. Nearby buildings are taken from
        OpenStreetMap to work out when they put the spot in shade.
      </p>
      <p className="mt-3 text-sm font-medium text-ink">
        Search for an address above the map, or tap the map where you want the pin.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={locate} disabled={state.status === "locating"}>
          <LocateIcon width={18} height={18} />
          {state.status === "locating" ? "Finding you…" : "Use my location"}
        </Button>
        <Button onClick={() => useSettings.getState().setPlace(EXAMPLE_PLACE)}>
          See an example
        </Button>
      </div>
      <p role="alert" className="mt-3 min-h-5 text-sm text-danger">
        {state.status === "error" ? state.message : ""}
      </p>
    </Card>
  );
}
