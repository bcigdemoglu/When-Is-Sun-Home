"use client";

import { useMemo } from "react";

/** Design tokens as concrete colours, for MapLibre paint properties (which cannot use CSS variables). */
export interface MapTheme {
  /** The colour scheme these values were read under. */
  scheme: "light" | "dark";
  building: string;
  buildingSoft: string;
  /** The building the pin sits in. */
  pinBuilding: string;
  shadow: string;
  shadowOpacity: number;
  blocked: string;
  accent: string;
  line: string;
}

function readTheme(scheme: MapTheme["scheme"]): MapTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const opacity = Number.parseFloat(token("--map-shadow-opacity", "0.3"));
  return {
    scheme,
    building: token("--map-building", "silver"),
    buildingSoft: token("--map-building-soft", "lightgray"),
    pinBuilding: token("--map-pin-building", "sandybrown"),
    shadow: token("--map-shadow", "black"),
    shadowOpacity: Number.isFinite(opacity) ? opacity : 0.3,
    blocked: token("--state-blocked", "slategray"),
    accent: token("--accent", "chocolate"),
    line: token("--line", "gray"),
  };
}

/**
 * The map's colours, re-read from the stylesheet whenever the colour scheme
 * flips. Client only (the map never renders on the server).
 */
export function useMapTheme(isDark: boolean): MapTheme {
  return useMemo(() => readTheme(isDark ? "dark" : "light"), [isDark]);
}
