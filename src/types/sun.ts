export interface Location {
  lat: number;
  lng: number;
  name?: string;
}

export interface SunPosition {
  azimuth: number; // compass degrees (0=N, 90=E, 180=S, 270=W)
  altitude: number; // degrees above horizon
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  nadir: Date;
  goldenHourStart: Date;
  goldenHourEnd: Date;
  civilDawn: Date;
  civilDusk: Date;
  nauticalDawn: Date;
  nauticalDusk: Date;
  astronomicalDawn: Date;
  astronomicalDusk: Date;
  dayLength: number; // minutes
}

export interface ArcPoint {
  azimuth: number;
  altitude: number;
  time: Date;
}

export interface SunData {
  position: SunPosition;
  times: SunTimes;
  arc: ArcPoint[];
}

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export type AnimationMode = "time" | "date";

export interface SunBlockageInfo {
  isBlocked: boolean;
  blockingBuildingHeight?: number;
  blockDistance?: number; // meters from pin to blocking building
}

// ─── Sun visibility state machine ─────────────────────────────────────
// Single source of truth for the sun's visual state.
// Derived once, consumed by map overlay, compass, and data panel.
export type SunVisibility = "visible" | "blocked" | "below";

export function deriveSunVisibility(
  sunData: SunData | null,
  sunBlockage: SunBlockageInfo | null
): SunVisibility {
  if (!sunData || sunData.position.altitude <= 0) return "below";
  if (sunBlockage?.isBlocked) return "blocked";
  return "visible";
}

// ─── Visual config per state (colors, labels, opacity) ────────────────
export interface SunVisualConfig {
  dotColor: string;
  strokeColor: string;
  opacity: number;
  label: string;
  labelColor: string;
  showCross: boolean;
}

const SUN_VISUALS: Record<SunVisibility, SunVisualConfig> = {
  visible: {
    dotColor: "#f59e0b",
    strokeColor: "#fbbf24",
    opacity: 1,
    label: "Visible",
    labelColor: "#22c55e",
    showCross: false,
  },
  blocked: {
    dotColor: "#ef4444",
    strokeColor: "#dc2626",
    opacity: 0.85,
    label: "Blocked",
    labelColor: "#ef4444",
    showCross: true,
  },
  below: {
    dotColor: "#6b7280",
    strokeColor: "#9ca3af",
    opacity: 0.4,
    label: "Below horizon",
    labelColor: "#6b7280",
    showCross: false,
  },
};

export function getSunVisuals(vis: SunVisibility): SunVisualConfig {
  return SUN_VISUALS[vis];
}
