"use client";

import { useEffect } from "react";
import { CrosshairIcon, LocateIcon, MinusIcon, PlusIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { pinSpot } from "@/hooks/placeActions";
import { impreciseMessage, IMPRECISE_ACCURACY_M, useGeolocation } from "@/hooks/useGeolocation";
import { useMapUi } from "./mapUi";

/** A floating map button: 48 px, opaque, hairline and shadow so it reads over any map. */
const FAB =
  "flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-float transition-colors hover:bg-surface-2 disabled:opacity-60";

interface MapControlsProps {
  /** "fabs": locate + 2D/3D (+ north when rotated), for phones. "full": also zoom, for desktop. */
  variant: "fabs" | "full";
  /**
   * Whether a place is pinned. Without one only zooming makes sense here: the
   * start screen has its own, bigger "Use my location".
   */
  hasPlace: boolean;
  className?: string;
}

/**
 * The buttons around the map. They never touch MapLibre themselves: they send
 * commands through `useMapUi`, so they work the same whether the map has
 * loaded yet or not.
 */
export function MapControls({ variant, hasPlace, className = "" }: MapControlsProps) {
  const ready = useMapUi((state) => state.ready);
  const tilted = useMapUi((state) => state.tilted);
  const bearing = useMapUi((state) => state.bearing);
  const send = useMapUi((state) => state.send);

  const { state, locate } = useGeolocation((spot, accuracyM) => {
    pinSpot(spot);
    if (accuracyM !== null && accuracyM > IMPRECISE_ACCURACY_M) {
      showToast(impreciseMessage(accuracyM));
    }
  });
  // Problems are said once, as a toast: there is no room for them next to the button.
  const problem = state.status === "error" ? state.message : null;
  const locating = state.status === "locating";
  useEffect(() => {
    if (problem) showToast(problem);
  }, [problem]);

  return (
    <div className={`flex flex-col items-end gap-2 ${className}`}>
      {variant === "full" && (
        <div className="flex flex-col overflow-hidden rounded-full border border-line bg-surface shadow-float">
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!ready}
            className="flex h-12 w-12 items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-60"
            onClick={() => send({ type: "zoom", delta: 1 })}
          >
            <PlusIcon />
          </button>
          <span aria-hidden="true" className="mx-2.5 h-px bg-line" />
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!ready}
            className="flex h-12 w-12 items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-60"
            onClick={() => send({ type: "zoom", delta: -1 })}
          >
            <MinusIcon />
          </button>
        </div>
      )}
      {bearing !== 0 && (
        <button
          type="button"
          aria-label="Turn the map north up"
          className={FAB}
          onClick={() => send({ type: "north" })}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            aria-hidden="true"
            style={{ transform: `rotate(${-bearing}deg)` }}
          >
            <path d="M12 3.5 15.5 12h-7L12 3.5Z" fill="var(--danger)" />
            <path d="M12 20.5 8.5 12h7L12 20.5Z" fill="var(--ink-3)" />
          </svg>
        </button>
      )}
      {variant === "full" && hasPlace && (
        <button
          type="button"
          aria-label="Centre the map on the pin"
          disabled={!ready}
          className={FAB}
          onClick={() => send({ type: "recenter" })}
        >
          <CrosshairIcon />
        </button>
      )}
      {hasPlace && (
        <button
          type="button"
          aria-label={locating ? "Finding your location" : "Use my location"}
          aria-busy={locating}
          disabled={locating}
          className={FAB}
          onClick={() => {
            locate();
          }}
        >
          {locating ? (
            <span
              aria-hidden="true"
              className="h-5 w-5 rounded-full border-2 border-line border-t-ink motion-safe:animate-spin"
            />
          ) : (
            <LocateIcon />
          )}
        </button>
      )}
      {hasPlace && (
        <button
          type="button"
          aria-pressed={tilted}
          aria-label={
            tilted ? "Tilted 3D view. Switch to flat 2D" : "Flat 2D view. Switch to tilted 3D"
          }
          disabled={!ready}
          className={`${FAB} text-[13px] font-semibold ${tilted ? "border-ink! bg-ink! text-surface!" : ""}`}
          onClick={() => send({ type: "tilt", tilted: !tilted })}
        >
          3D
        </button>
      )}
    </div>
  );
}
