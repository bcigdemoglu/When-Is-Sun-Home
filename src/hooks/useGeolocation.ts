"use client";

import { useEffect, useRef, useState } from "react";
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
 * Where the page is running, as far as it matters for explaining how to turn
 * location back on. Detected conservatively: anything uncertain is "desktop",
 * whose wording is true everywhere.
 */
export type LocationPlatform =
  /** Safari on iPhone / iPad. */
  | "ios-safari"
  /** Another browser on iPhone / iPad (Chrome, Firefox, Edge …). */
  | "ios-browser"
  /** A page opened inside another iOS app (a chat or social app's built-in browser). */
  | "ios-in-app"
  | "android"
  | "desktop";

interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
  /** iOS only: true when the page runs from the Home Screen. */
  standalone?: boolean;
}

export function detectLocationPlatform(nav?: NavigatorLike | null): LocationPlatform {
  const source = nav ?? (typeof navigator === "undefined" ? null : (navigator as NavigatorLike));
  if (!source) return "desktop";
  const ua = source.userAgent ?? "";
  // iPadOS introduces itself as a Mac; a Mac with a touch screen does not exist.
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (source.platform === "MacIntel" && (source.maxTouchPoints ?? 0) > 1);
  if (isIos) {
    // From the Home Screen the page is Safari's (same permission, same setting),
    // although its UA leaves "Version/… Safari/…" out like an in-app view does.
    if (source.standalone === true) return "ios-safari";
    if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return "ios-browser";
    // Real Safari says "Version/x … Safari/y"; web views inside apps leave that out
    // or add their own name.
    const inApp =
      !/Safari\//.test(ua) ||
      !/Version\//.test(ua) ||
      /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|Twitter|LinkedInApp|GSA\//.test(
        ua,
      );
    return inApp ? "ios-in-app" : "ios-safari";
  }
  if (source.userAgentData?.platform === "Android" || /Android/.test(ua)) return "android";
  return "desktop";
}

/**
 * What to tell the person. "Denied" can only be undone outside the page, and
 * where exactly depends on the device — so the message says where to look
 * THERE, and always names the way round it (an address).
 */
export function geolocationMessage(
  problem: GeolocationProblem,
  platform: LocationPlatform = "desktop",
): string {
  switch (problem) {
    case "denied":
      switch (platform) {
        case "ios-safari":
          return "Location is off for Safari. Turn it on in Settings › Privacy & Security › Location Services › Safari Websites › While Using the App, then reload — or enter an address.";
        case "ios-browser":
          return "Location is off for this browser. Turn it on in Settings › Privacy & Security › Location Services, then reload — or enter an address.";
        case "ios-in-app":
          return "This in-app browser can’t share your location. Open this page in Safari, or enter an address.";
        case "android":
          return "Location is blocked for this site. Tap the icon left of the address, then Permissions › Location › Allow — or enter an address.";
        default:
          return "Location is blocked for this site. Allow it in your browser’s site settings (the icon next to the address bar), or enter an address instead.";
      }
    case "unavailable":
      return "Your device couldn’t work out where it is right now. Try again in the open, or enter an address.";
    case "timeout":
      return "Finding your location took too long. Try again, or enter an address.";
    default:
      return platform === "ios-in-app"
        ? "This in-app browser can’t share your location. Open this page in Safari, or enter an address."
        : "This browser can’t share its location. Enter an address or tap the map instead.";
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

export interface GeolocationOptions {
  /**
   * What the answer would replace (the pinned place, say). It is read when
   * the request starts and again when the answer arrives: if it changed in
   * between, the person has chosen something else meanwhile and the late
   * answer is dropped.
   */
  getContext?: () => unknown;
}

/**
 * "Use my location": asks only when `locate()` is called (never on load),
 * and never throws. `onLocated` receives the spot and how accurate it is.
 *
 * A fix can take ten seconds. An answer is only delivered if it is still
 * wanted: not after a newer `locate()`, not after the component is gone, and
 * not after `getContext()` changed (see `GeolocationOptions`).
 */
export function useGeolocation(
  onLocated: (spot: LatLng, accuracyM: number | null) => void,
  options: GeolocationOptions = {},
): {
  state: GeolocationState;
  locate(): void;
  /** Forget an error or warning (e.g. once the person has moved on). */
  clear(): void;
} {
  const [state, setState] = useState<GeolocationState>({ status: "idle" });
  /** Counts requests; an answer is only valid for the request that is still current. */
  const request = useRef(0);
  const getContext = options.getContext;
  useEffect(
    () => () => {
      request.current = -1; // unmounted: every pending answer is stale
    },
    [],
  );

  const fail = (problem: GeolocationProblem) =>
    setState({
      status: "error",
      problem,
      message: geolocationMessage(problem, detectLocationPlatform()),
    });

  const locate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fail("unsupported");
      return;
    }
    setState({ status: "locating" });
    const id = (request.current = Math.max(0, request.current) + 1);
    const context = getContext ? getContext() : undefined;
    const current = () => request.current === id;
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!current()) return;
          if (getContext && getContext() !== context) {
            // Something else was chosen while we were looking: leave it alone.
            setState({ status: "idle" });
            return;
          }
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
        (error) => {
          if (current()) fail(geolocationProblem(error.code));
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    } catch {
      fail("unsupported");
    }
  };

  return {
    state,
    locate,
    clear: () => {
      request.current = Math.max(0, request.current) + 1; // also forgets a pending request
      setState({ status: "idle" });
    },
  };
}
