"use client";

import { useState } from "react";
import type { LatLng } from "@/lib/types";

/** A fix worse than this is worth a warning: it may be the wrong building. */
export const IMPRECISE_ACCURACY_M = 75;

export type GeolocationProblem = "denied" | "unavailable" | "timeout" | "unsupported";

export type GeolocationState =
  | { status: "idle" }
  | { status: "locating" }
  /** Found, but only roughly: the pin was dropped and needs adjusting by hand. */
  | { status: "imprecise"; accuracyM: number; message: string }
  | { status: "error"; problem: GeolocationProblem; message: string };

/** Which problem a `GeolocationPositionError.code` stands for. */
export function geolocationProblem(code: number | null): GeolocationProblem {
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unsupported";
}

/**
 * What to tell the person. On the web "denied" can only be undone in the
 * browser's own site settings, so the message says where to look.
 */
export function geolocationMessage(problem: GeolocationProblem): string {
  switch (problem) {
    case "denied":
      return "Location is blocked for this site. Allow it in your browser’s site settings (the icon next to the address bar), or enter an address instead.";
    case "unavailable":
      return "Your device couldn’t work out where it is right now. Try again in the open, or enter an address.";
    case "timeout":
      return "Finding your location took too long. Try again, or enter an address.";
    default:
      return "This browser can’t share its location. Enter an address or tap the map instead.";
  }
}

/** "±350 m" style: two significant figures are all a fix deserves. */
export function formatAccuracy(accuracyM: number): string {
  if (!Number.isFinite(accuracyM)) return "unknown";
  if (accuracyM >= 1000) return `${(accuracyM / 1000).toFixed(accuracyM >= 10_000 ? 0 : 1)} km`;
  const rounded = accuracyM >= 100 ? Math.round(accuracyM / 10) * 10 : Math.round(accuracyM);
  return `${rounded} m`;
}

export function impreciseMessage(accuracyM: number): string {
  return `Your location is only accurate to about ${formatAccuracy(accuracyM)}. Drag the pin onto the exact spot.`;
}

/**
 * "Use my location": asks only when `locate()` is called (never on load),
 * and never throws. `onLocated` receives the spot and how accurate it is.
 */
export function useGeolocation(onLocated: (spot: LatLng, accuracyM: number | null) => void): {
  state: GeolocationState;
  locate(): void;
  /** Forget an error or warning (e.g. once the person has moved on). */
  clear(): void;
} {
  const [state, setState] = useState<GeolocationState>({ status: "idle" });

  const fail = (problem: GeolocationProblem) =>
    setState({ status: "error", problem, message: geolocationMessage(problem) });

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fail("unsupported");
      return;
    }
    setState({ status: "locating" });
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            fail("unavailable");
            return;
          }
          const accuracyM = Number.isFinite(accuracy) ? accuracy : null;
          setState(
            accuracyM !== null && accuracyM > IMPRECISE_ACCURACY_M
              ? { status: "imprecise", accuracyM, message: impreciseMessage(accuracyM) }
              : { status: "idle" },
          );
          onLocated({ lat: latitude, lng: longitude }, accuracyM);
        },
        (error) => fail(geolocationProblem(error.code)),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    } catch {
      fail("unsupported");
    }
  };

  return { state, locate, clear: () => setState({ status: "idle" }) };
}
