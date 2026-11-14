/**
 * Geometry of the skyline panorama: compass direction across, elevation angle
 * up, the building silhouette, and the sun's paths over it. Pure functions.
 */
import { classifySun, dayIndexFromDate } from "@/lib/analysis";
import {
  SunState,
  type HorizonProfile,
  type Observer,
  type SunStateCode,
  type SunYearGrid,
} from "@/lib/types";

// ─── Horizontal axis: compass direction ────────────────────────────────────

function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

function angularDistance(a: number, b: number): number {
  const d = normalize360(a - b);
  return d > 180 ? 360 - d : d;
}

/**
 * Compass bearing at the centre of the panorama: the side of the sky the sun
 * crosses — south in the northern hemisphere, north in the southern.
 */
export function panoramaCenter(lat: number): number {
  return lat < 0 ? 0 : 180;
}

/** Horizontal position 0..1 of a bearing on a panorama centred on `centerDeg`. */
export function azimuthToFraction(azimuthDeg: number, centerDeg: number): number {
  return normalize360(azimuthDeg - centerDeg + 180) / 360;
}

export function fractionToAzimuth(fraction: number, centerDeg: number): number {
  return normalize360(centerDeg - 180 + fraction * 360);
}

export interface CompassTick {
  label: string;
  azimuthDeg: number;
  /** 0..1; both edges of the panorama carry the same direction. */
  fraction: number;
}

const COMPASS_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The nine 45° ticks from the left edge to the right edge. */
export function compassTicks(centerDeg: number): CompassTick[] {
  const ticks: CompassTick[] = [];
  for (let i = 0; i <= 8; i++) {
    const azimuthDeg = normalize360(centerDeg - 180 + i * 45);
    ticks.push({
      label: COMPASS_LABELS[Math.round(azimuthDeg / 45) % 8],
      azimuthDeg,
      fraction: i / 8,
    });
  }
  return ticks;
}

// ─── Vertical axis: elevation angle ────────────────────────────────────────

const KNEE_DEG = 40;
const KNEE_SHARE = 0.62;

export interface ElevationScale {
  maxDeg: number;
  /** True when the band above 40° is compressed. */
  compressed: boolean;
  ticks: number[];
  /** 0 at the horizon, 1 at `maxDeg`. */
  fraction(elevationDeg: number): number;
}

/**
 * Vertical scale for elevations 0…`neededDeg`. Buildings live in the lowest
 * 40°, so that band always gets most of the height; anything above it is
 * squeezed into the remainder (a piecewise-linear scale with one knee).
 */
export function createElevationScale(neededDeg: number): ElevationScale {
  const needed = Number.isFinite(neededDeg) ? neededDeg : 90;
  const maxDeg = Math.min(90, Math.max(KNEE_DEG, Math.ceil(needed / 10) * 10));
  const compressed = maxDeg > KNEE_DEG + 10;
  const fraction = (elevationDeg: number): number => {
    const e = Math.min(maxDeg, Math.max(0, elevationDeg));
    if (!compressed) return e / maxDeg;
    return e <= KNEE_DEG
      ? (e / KNEE_DEG) * KNEE_SHARE
      : KNEE_SHARE + ((e - KNEE_DEG) / (maxDeg - KNEE_DEG)) * (1 - KNEE_SHARE);
  };
  const ticks = compressed
    ? [0, 10, 20, 30, 40, 60, 90].filter((t) => t <= maxDeg)
    : [0, 10, 20, 30, 40, 50].filter((t) => t <= maxDeg);
  return { maxDeg, compressed, ticks, fraction };
}

/** Highest the noon sun ever gets at a latitude, degrees. */
export function maxSunAltitude(lat: number): number {
  return Math.min(90, 90 - Math.abs(lat) + 23.44);
}

// ─── Sun paths ─────────────────────────────────────────────────────────────

export interface SunPathPoint {
  /** Wall-clock minute (fractional). */
  minute: number;
  azimuthDeg: number;
  altitudeDeg: number;
  state: SunStateCode;
}

function lerpAzimuth(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return normalize360(a + delta * t);
}

/**
 * The sun's track above the horizon on one day of the grid, classified for
 * the observer. Where the sun rises or sets between two samples, the horizon
 * crossing itself (altitude 0) is added so the track meets the horizon.
 */
export function sunPathForDay(
  grid: SunYearGrid,
  dayIndex: number,
  horizon: HorizonProfile | null,
  observer: Observer,
): SunPathPoint[] {
  const { slotsPerDay, stepMinutes, azimuthDeg, altitudeDeg } = grid;
  if (dayIndex < 0 || dayIndex >= grid.dayCount) return [];
  const row = dayIndex * slotsPerDay;
  const points: SunPathPoint[] = [];

  const crossing = (slotBelow: number, slotAbove: number): SunPathPoint | null => {
    const altBelow = altitudeDeg[row + slotBelow];
    const altAbove = altitudeDeg[row + slotAbove];
    if (!(altBelow <= 0) || !(altAbove > 0)) return null;
    const t = altBelow / (altBelow - altAbove); // from below → above
    const az = lerpAzimuth(azimuthDeg[row + slotBelow], azimuthDeg[row + slotAbove], t);
    const minute = (slotBelow + 0.5 + (slotAbove - slotBelow) * t) * stepMinutes;
    return { minute, azimuthDeg: az, altitudeDeg: 0, state: SunState.Night };
  };

  for (let slot = 0; slot < slotsPerDay; slot++) {
    const altitude = altitudeDeg[row + slot];
    if (!(altitude > 0)) continue;
    const azimuth = azimuthDeg[row + slot];
    const state = classifySun(azimuth, altitude, horizon, observer);

    if (slot > 0) {
      const rise = crossing(slot - 1, slot);
      if (rise) points.push({ ...rise, state });
    }
    points.push({
      minute: (slot + 0.5) * stepMinutes,
      azimuthDeg: azimuth,
      altitudeDeg: altitude,
      state,
    });
    if (slot + 1 < slotsPerDay) {
      const set = crossing(slot + 1, slot);
      if (set) points.push({ ...set, state });
    }
  }
  return points;
}

export interface PathVertex {
  /** 0..1 across the panorama. */
  x: number;
  altitudeDeg: number;
}

/** A piece of a sun path that is drawn as one polyline in one style. */
export interface PathSegment {
  state: SunStateCode;
  vertices: PathVertex[];
}

/**
 * Cut a sun path into drawable polylines: a new line starts where the state
 * changes (the two lines meet halfway between the samples), where samples are
 * not consecutive in time, and where the path leaves one edge of the panorama
 * and re-enters at the other (both lines are extended to the edges).
 */
export function buildPathSegments(
  points: readonly SunPathPoint[],
  centerDeg: number,
  stepMinutes: number,
): PathSegment[] {
  const segments: PathSegment[] = [];
  let current: PathSegment | null = null;
  let previous: SunPathPoint | null = null;
  let previousX = 0;

  const start = (state: SunStateCode, vertex?: PathVertex): PathSegment => {
    const segment: PathSegment = { state, vertices: vertex ? [vertex] : [] };
    segments.push(segment);
    return segment;
  };

  for (const point of points) {
    const x = azimuthToFraction(point.azimuthDeg, centerDeg);
    const vertex: PathVertex = { x, altitudeDeg: point.altitudeDeg };

    if (!current || !previous) {
      current = start(point.state, vertex);
    } else if (point.minute - previous.minute > stepMinutes * 1.5) {
      current = start(point.state, vertex);
    } else if (Math.abs(x - previousX) > 0.5) {
      // Wrap-around: finish at one edge, restart at the other.
      const unwrapped = x < previousX ? x + 1 : x - 1;
      const edge = x < previousX ? 1 : 0;
      const t = (edge - previousX) / (unwrapped - previousX);
      const altitudeAtEdge = previous.altitudeDeg + (point.altitudeDeg - previous.altitudeDeg) * t;
      current.vertices.push({ x: edge, altitudeDeg: altitudeAtEdge });
      current = start(point.state, { x: 1 - edge, altitudeDeg: altitudeAtEdge });
      current.vertices.push(vertex);
    } else if (point.state !== current.state) {
      const mid: PathVertex = {
        x: (previousX + x) / 2,
        altitudeDeg: (previous.altitudeDeg + point.altitudeDeg) / 2,
      };
      current.vertices.push(mid);
      current = start(point.state, mid);
      current.vertices.push(vertex);
    } else {
      current.vertices.push(vertex);
    }
    previous = point;
    previousX = x;
  }
  return segments.filter((segment) => segment.vertices.length >= 2);
}

export interface HourMark {
  hour: number;
  azimuthDeg: number;
  altitudeDeg: number;
}

/**
 * Where the sun is at each whole wall-clock hour of a day (only while it is
 * up). Grid samples sit half a step either side of the hour, so the mark is
 * their midpoint.
 */
export function hourMarks(grid: SunYearGrid, dayIndex: number): HourMark[] {
  const { slotsPerDay, stepMinutes, azimuthDeg, altitudeDeg } = grid;
  if (dayIndex < 0 || dayIndex >= grid.dayCount) return [];
  const row = dayIndex * slotsPerDay;
  const marks: HourMark[] = [];
  for (let hour = 1; hour < 24; hour++) {
    const after = Math.round((hour * 60) / stepMinutes);
    const before = after - 1;
    if (before < 0 || after >= slotsPerDay) continue;
    const altitude = (altitudeDeg[row + before] + altitudeDeg[row + after]) / 2;
    if (!(altitude > 0)) continue;
    marks.push({
      hour,
      azimuthDeg: lerpAzimuth(azimuthDeg[row + before], azimuthDeg[row + after], 0.5),
      altitudeDeg: altitude,
    });
  }
  return marks;
}

/** The sample of a path closest in direction to `azimuthDeg`, if within `toleranceDeg`. */
export function sunPassageAt(
  points: readonly SunPathPoint[],
  azimuthDeg: number,
  toleranceDeg = 3,
): SunPathPoint | null {
  let best: SunPathPoint | null = null;
  let bestDistance = toleranceDeg;
  for (const point of points) {
    const distance = angularDistance(point.azimuthDeg, azimuthDeg);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ReferenceDay {
  key: "june" | "equinox" | "december";
  label: string;
  dayIndex: number;
}

/** The solstices and the March equinox of a year, as grid day indices. */
export function referenceDays(year: number): ReferenceDay[] {
  const y = String(year).padStart(4, "0");
  return [
    { key: "june", label: "Jun 21", dayIndex: dayIndexFromDate(`${y}-06-21`) },
    { key: "equinox", label: "Mar 20", dayIndex: dayIndexFromDate(`${y}-03-20`) },
    { key: "december", label: "Dec 21", dayIndex: dayIndexFromDate(`${y}-12-21`) },
  ];
}

// ─── Skyline silhouette ────────────────────────────────────────────────────

export type ObstructionKind = "building" | "terrain";

/** `blockerIndex` >= 0 is a building, < -1 terrain, -1 nothing. */
export function obstructionKind(blockerIndex: number): ObstructionKind {
  return blockerIndex < -1 ? "terrain" : "building";
}

/** A stretch of consecutive directions obstructed by the same kind of thing. */
export interface SkylineRun {
  kind: ObstructionKind;
  /** Left edge of the run, 0..1. */
  startX: number;
  /** Width of one bin, as a fraction of the panorama. */
  binWidth: number;
  /** Elevation angle per bin, left to right. */
  elevationsDeg: number[];
}

export function skylineRuns(horizon: HorizonProfile, centerDeg: number): SkylineRun[] {
  const { binCount, elevationDeg, blockerIndex } = horizon;
  const firstBin = Math.round((normalize360(centerDeg - 180) / 360) * binCount) % binCount;
  const runs: SkylineRun[] = [];
  let current: SkylineRun | null = null;
  for (let i = 0; i < binCount; i++) {
    const bin = (firstBin + i) % binCount;
    const elevation = elevationDeg[bin];
    if (!(elevation > 0)) {
      current = null;
      continue;
    }
    const kind = obstructionKind(blockerIndex[bin]);
    if (!current || current.kind !== kind) {
      current = { kind, startX: i / binCount, binWidth: 1 / binCount, elevationsDeg: [] };
      runs.push(current);
    }
    current.elevationsDeg.push(elevation);
  }
  return runs;
}

/** Parts of the panorama (0..1 spans) that a window's view cone does NOT cover. */
export function outsideViewSpans(
  observer: Pick<Observer, "mode" | "facingDeg" | "fovDeg">,
  centerDeg: number,
): { x0: number; x1: number }[] {
  if (observer.mode !== "window" || observer.fovDeg >= 360) return [];
  const width = Math.max(0, observer.fovDeg) / 360;
  const start = azimuthToFraction(observer.facingDeg - observer.fovDeg / 2, centerDeg);
  const end = start + width;
  const spans =
    end <= 1
      ? [
          { x0: 0, x1: start },
          { x0: end, x1: 1 },
        ]
      : [{ x0: end - 1, x1: start }];
  return spans.filter((span) => span.x1 - span.x0 > 1e-9);
}

export interface SectorSummary {
  label: string;
  /** Highest obstruction within ±22.5° of the compass point (0 = open). */
  maxElevationDeg: number;
  distanceM: number;
  kind: ObstructionKind | null;
}

/** The skyline condensed to the eight compass points (for the table view). */
export function sectorSummary(horizon: HorizonProfile): SectorSummary[] {
  const { binCount, elevationDeg, blockerDistanceM, blockerIndex } = horizon;
  return COMPASS_LABELS.map((label, sector) => {
    const centre = sector * 45;
    let best = -1;
    for (let bin = 0; bin < binCount; bin++) {
      const azimuth = ((bin + 0.5) * 360) / binCount;
      if (angularDistance(azimuth, centre) > 22.5) continue;
      if (elevationDeg[bin] > 0 && (best < 0 || elevationDeg[bin] > elevationDeg[best])) best = bin;
    }
    return best < 0
      ? { label, maxElevationDeg: 0, distanceM: 0, kind: null }
      : {
          label,
          maxElevationDeg: elevationDeg[best],
          distanceM: blockerDistanceM[best],
          kind: obstructionKind(blockerIndex[best]),
        };
  });
}
