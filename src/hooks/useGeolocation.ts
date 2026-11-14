"use client";

import { useState } from "react";
import type { LatLng } from "@/lib/types";

export type GeolocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "error"; message: string };

/** A sentence for the person, for each way the browser can refuse. */
export function geolocationErrorMessage(code: number | null): string {
  switch (code) {
    case 1: // PERMISSION_DENIED
      return "Location access was denied. Search for an address or tap the map instead.";
    case 2: // POSITION_UNAVAILABLE
      return "Your location isn’t available right now. Search for an address or tap the map instead.";
    case 3: // TIMEOUT
      return "Finding your location took too long. Try again, or search for an address.";
    default:
      return "This browser can’t share its location. Search for an address or tap the map instead.";
  }
}

/** "Use my location": asks once per call and never throws. */
export function useGeolocation(onLocated: (spot: LatLng) => void): {
  state: GeolocationState;
  locate(): void;
} {
  const [state, setState] = useState<GeolocationState>({ status: "idle" });

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", message: geolocationErrorMessage(null) });
      return;
    }
    setState({ status: "locating" });
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            setState({ status: "error", message: geolocationErrorMessage(2) });
            return;
          }
          setState({ status: "idle" });
          onLocated({ lat: latitude, lng: longitude });
        },
        (error) => setState({ status: "error", message: geolocationErrorMessage(error.code) }),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
      );
    } catch {
      setState({ status: "error", message: geolocationErrorMessage(null) });
    }
  };

  return { state, locate };
}
