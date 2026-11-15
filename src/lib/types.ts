/**
 * Domain contracts shared by every layer of the app.
 *
 * This file is the single source of truth for the shapes that cross module
 * boundaries (engine ⇄ worker ⇄ state ⇄ UI). Keep it free of runtime code
 * other than small constants.
 *
 * Conventions used everywhere:
 *  - Angles are in DEGREES. Azimuths are compass bearings: 0 = north,
 *    90 = east, clockwise, normalised to [0, 360).
 *  - Lengths are in METRES.
 *  - A calendar date is an ISO string "YYYY-MM-DD" and a time of day is
 *    "minutes since local midnight" (0..1439). Both are WALL-CLOCK values in
 *    the time zone of the pinned place — never the browser's time zone.
 */
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

// ─── Places ────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  /** Human readable label (address / place name), if known. */
  name?: string;
}

// ─── Buildings ─────────────────────────────────────────────────────────────

/**
 * Where a building's height came from:
 *  - "tagged":  an explicit OSM `height` tag
 *  - "levels":  derived from `building:levels`
 *  - "default": no usable tag; estimated from the building type
 */
export type HeightSource = "tagged" | "levels" | "default";

export interface BuildingProperties {
  /** Stable id, e.g. "way/123" or "relation/456". */
  id: string;
  /** Roof height above local ground, metres. Always > 0. */
  heightM: number;
  heightSource: HeightSource;
  /** Above-ground levels if known. */
  levels: number | null;
  /** Value of the OSM `building` tag ("yes", "house", "apartments", …). */
  kind: string;
  name?: string;
}

export type BuildingFeature = Feature<Polygon | MultiPolygon, BuildingProperties>;
export type BuildingCollection = FeatureCollection<Polygon | MultiPolygon, BuildingProperties>;

// ─── Observer ──────────────────────────────────────────────────────────────

/**
 * - "yard":   standing outdoors with an open view in every direction
 *             (a backyard, terrace, rooftop). Field of view is 360°.
 * - "window": looking out of a facade; only the cone `facingDeg ± fovDeg/2`
 *             can ever receive direct sun.
 */
export type ObserverMode = "yard" | "window";

export interface Observer {
  mode: ObserverMode;
  /** Height of the observed point above local ground, metres (>= 0). */
  heightM: number;
  /** Centre of the view cone, compass degrees. Only used in "window" mode. */
  facingDeg: number;
  /** Full width of the view cone, degrees (10..360). Only used in "window" mode. */
  fovDeg: number;
}

// ─── Terrain ───────────────────────────────────────────────────────────────

/**
 * Ground elevations on a regular grid in a local-metre frame.
 *
 * The frame is the flat east/north plane around `origin` (x = metres east,
 * y = metres north; see `lib/geo/local.ts`). Elevations are stored at the grid
 * NODES: node (col, row) is at x = minX + col·cellSizeM, y = minY + row·cellSizeM.
 * `data` is row-major with row 0 the SOUTHERNMOST row:
 * index = row · width + col. Between nodes the surface is bilinear.
 */
export interface ElevationGrid {
  /** Origin of the local-metre frame the grid is laid out in. */
  origin: LatLng;
  /** Spacing of the nodes, metres (same in x and y). */
  cellSizeM: number;
  /** Number of columns (west → east) and rows (south → north). */
  width: number;
  height: number;
  /** Local x of column 0 and local y of row 0, metres. */
  minX: number;
  minY: number;
  /** Ground elevation above sea level, metres. Length = width · height. */
  data: Float32Array;
}

/**
 * The ground around a place at two scales, both in the same local frame
 * (`near.origin` equals `far.origin`):
 *  - `near`: fine cells (5–10 m) out to about a kilometre — the slopes the
 *    observer and the surrounding buildings stand on;
 *  - `far`: coarse cells (30–60 m) out to roughly 7–25 km — hills and
 *    mountains on the horizon. Optional.
 */
export interface Terrain {
  near: ElevationGrid;
  far?: ElevationGrid;
}

// ─── Horizon (skyline) ─────────────────────────────────────────────────────

/** Number of azimuth bins in a horizon profile (0.5° resolution). */
export const HORIZON_BINS = 720;

/**
 * Value of `HorizonProfile.blockerIndex` (and `SunInstant.blocker.buildingIndex`)
 * when the obstruction is the ground itself — a slope, hill or mountain —
 * rather than a building.
 */
export const TERRAIN_BLOCKER = -2;

/**
 * The skyline seen from the observer: for every compass direction, how high
 * above the horizontal the tallest obstruction reaches.
 *
 * Bin `i` covers azimuths `[i, i + 1) * 360 / binCount`.
 */
export interface HorizonProfile {
  binCount: number;
  /** Highest obstruction elevation angle per bin, degrees, >= 0 (0 = clear). */
  elevationDeg: Float32Array;
  /**
   * What that obstruction is: >= 0 is an index into the source
   * `BuildingCollection.features`, -1 means none (open sky), and
   * `TERRAIN_BLOCKER` (-2) means the ground / a hill.
   */
  blockerIndex: Int32Array;
  /** Horizontal distance to that obstruction, metres (0 where there is none). */
  blockerDistanceM: Float32Array;
  /**
   * Height above local ground of the observer this profile was computed for,
   * metres. A profile is only valid for an `Observer` with the same `heightM`.
   * Always set by `computeHorizonProfile` (optional only so hand-made
   * profiles stay valid).
   */
  observerHeightM?: number;
  /**
   * Index of the building whose footprint contains the observer, or -1.
   * That building is EXCLUDED from the profile (the observer is assumed to be
   * on its facade / roof, not buried inside it).
   */
  containingBuildingIndex: number;
}

// ─── Sun state ─────────────────────────────────────────────────────────────

/**
 * What the sun is doing for the observer at one instant.
 * Precedence when classifying: Night → OutOfView → Blocked → Sun.
 */
export const SunState = {
  /** Sun is at or below the astronomical horizon. */
  Night: 0,
  /** Direct sunlight reaches the observer. */
  Sun: 1,
  /** Sun is up and in view, but hidden behind a building. */
  Blocked: 2,
  /** Sun is up but outside the observer's view cone ("window" mode only). */
  OutOfView: 3,
} as const;

export type SunStateCode = (typeof SunState)[keyof typeof SunState];

export interface SunPosition {
  azimuthDeg: number;
  /** Elevation above the horizon, degrees (negative = below). */
  altitudeDeg: number;
}

// ─── Year grid & analysis ──────────────────────────────────────────────────

export interface YearGridSpec {
  year: number;
  /** IANA time zone of the place, e.g. "America/Los_Angeles". */
  timeZone: string;
  /** Sampling step in minutes. Must divide 1440. */
  stepMinutes: number;
}

/**
 * Sun positions for a whole year on a (day × wall-clock slot) grid.
 * Independent of buildings and of the observer, so it can be cached per
 * (place, year) and re-used when only the observer changes.
 *
 * Arrays are row-major: index = dayIndex * slotsPerDay + slot.
 * Slot `s` is sampled at wall-clock minute `(s + 0.5) * stepMinutes`.
 * Wall-clock times that do not exist (DST spring-forward gap) hold NaN.
 */
export interface SunYearGrid extends YearGridSpec, LatLng {
  /** 365 or 366. */
  dayCount: number;
  /** 1440 / stepMinutes. */
  slotsPerDay: number;
  azimuthDeg: Float32Array;
  altitudeDeg: Float32Array;
}

export interface DaySummary {
  /** 0-based day of year (0 = 1 January). */
  dayIndex: number;
  /** "YYYY-MM-DD". */
  date: string;
  /** Minutes of direct sun on the observer. */
  sunMinutes: number;
  /** Minutes with the sun above the horizon (the unobstructed maximum). */
  daylightMinutes: number;
  /** Daylight minutes lost to buildings or terrain. */
  blockedMinutes: number;
  /**
   * The part of `blockedMinutes` during which the ground / a hill was the
   * highest obstruction in the sun's direction. 0 without terrain data.
   */
  terrainBlockedMinutes?: number;
  /** Daylight minutes lost because the sun was outside the view cone. */
  outOfViewMinutes: number;
  /** Wall-clock minute of the first / last direct sun, or null if none. */
  firstSunMinute: number | null;
  lastSunMinute: number | null;
}

export interface MonthSummary {
  /** 0 = January … 11 = December. */
  month: number;
  dayCount: number;
  /** Mean direct sun per day, hours. */
  avgSunHours: number;
  /** Mean daylight per day, hours. */
  avgDaylightHours: number;
  minSunHours: number;
  maxSunHours: number;
  totalSunHours: number;
}

export interface AnnualSummary {
  totalSunHours: number;
  totalDaylightHours: number;
  avgSunHoursPerDay: number;
  /** totalSunHours / totalDaylightHours, 0..1 (0 when there is no daylight). */
  sunFraction: number;
  /** Day with the most / least direct sun. */
  bestDayIndex: number;
  worstDayIndex: number;
}

export interface YearAnalysis extends YearGridSpec {
  dayCount: number;
  slotsPerDay: number;
  /** SunStateCode per grid cell, row-major like SunYearGrid. */
  state: Uint8Array;
  days: DaySummary[];
  /** Always 12 entries. */
  months: MonthSummary[];
  annual: AnnualSummary;
}

// ─── Single-day analysis (1-minute resolution) ─────────────────────────────

/** A stretch of uninterrupted direct sun, wall-clock minutes, [start, end). */
export interface SunWindow {
  startMinute: number;
  endMinute: number;
}

export interface DaySample extends SunPosition {
  /** Wall-clock minute of day this sample represents. */
  minute: number;
  state: SunStateCode;
}

export interface DayAnalysis {
  /** "YYYY-MM-DD". */
  date: string;
  timeZone: string;
  stepMinutes: number;
  /** One sample per step across the whole wall-clock day (DST gaps omitted). */
  samples: DaySample[];
  windows: SunWindow[];
  sunMinutes: number;
  daylightMinutes: number;
  /**
   * Wall-clock minute (fractional) of sunrise / sunset / highest sun on this
   * date; null when the event does not happen on it (polar day / night).
   * Sunrise and sunset are where the geometric altitude of the sun's centre
   * crosses 0° — the same boundary the samples use between Night and day.
   */
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  solarNoonMinute: number | null;
}

/** Everything known about the sun at the currently selected instant. */
export interface SunInstant extends SunPosition {
  state: SunStateCode;
  /** Present when state is Blocked. */
  blocker?: {
    /**
     * "terrain" when the sun is behind the ground / a hill, else "building".
     * Always set by the engine (optional only so hand-made values stay valid).
     */
    kind?: "building" | "terrain";
    /** Index of the building, or `TERRAIN_BLOCKER` (-2) for terrain. */
    buildingIndex: number;
    distanceM: number;
    /** Elevation angle of the obstruction in the sun's direction, degrees. */
    elevationDeg: number;
  };
}

// ─── Place summary ─────────────────────────────────────────────────────────

/**
 * The headline numbers of a year analysis — what is shown for a place
 * outside its full report (saved-place rows, compare, share text, link
 * previews). Hours are rounded to one decimal.
 */
export interface PlaceSummary {
  year: number;
  /** Mean direct sun per day over the year, hours. */
  avgSunHoursPerDay: number;
  /** Share of daylight that is direct sun, 0..1 (two decimals). */
  sunFraction: number;
  /** Direct sun over the whole year, hours (integer). */
  totalSunHours: number;
  /** Mean direct sun per day for each month, hours. 12 entries, January first. */
  monthlySunHours: number[];
  /** Mean daylight per day for each month, hours. 12 entries. */
  monthlyDaylightHours: number[];
  /** Month (0..11) with the most / least direct sun per day. */
  bestMonth: number;
  worstMonth: number;
}
