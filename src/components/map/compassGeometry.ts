/**
 * Geometry of the sun compass: a polar sun-path diagram centred on the pin.
 *
 * North is up, azimuths run clockwise, and the distance from the centre is
 * `90° − altitude`: the zenith is at the pin and the horizon on the rim.
 * SVG coordinates: x to the right, y DOWN.
 */
import { SunState, type DayAnalysis, type DaySample, type SunStateCode } from "@/lib/types";

const DEG = Math.PI / 180;

export interface Point {
  x: number;
  y: number;
}

/** Point on the circle of `radius` in compass direction `azimuthDeg`. */
export function rimPoint(azimuthDeg: number, radius: number): Point {
  const a = azimuthDeg * DEG;
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) };
}

/** Where a sun at (azimuth, altitude) sits in a diagram whose horizon has `radius`. */
export function polarPoint(azimuthDeg: number, altitudeDeg: number, radius: number): Point {
  const altitude = Math.min(90, Math.max(0, altitudeDeg));
  return rimPoint(azimuthDeg, (radius * (90 - altitude)) / 90);
}

function fmt(n: number): string {
  // One decimal is a tenth of a pixel at most; "-0" would be noise.
  const rounded = Math.round(n * 10) / 10;
  return String(rounded === 0 ? 0 : rounded);
}

export function pointString(p: Point): string {
  return `${fmt(p.x)},${fmt(p.y)}`;
}

export interface SunPathRun {
  state: SunStateCode;
  /** SVG path data ("M…L…") for this stretch of the sun's path. */
  d: string;
}

/**
 * Today's sun path above the horizon as coloured stretches, one per run of
 * equal state (sun / blocked / out of view). Consecutive runs share their
 * boundary point so the path has no gaps; a break in time (DST, or the sun
 * dipping below the horizon) starts a new, unconnected run.
 *
 * `stride` thins the samples: a point is kept every `stride` samples, and
 * always where a run starts or ends.
 */
export function sunPathRuns(samples: readonly DaySample[], radius: number, stride = 4): SunPathRun[] {
  const runs: SunPathRun[] = [];
  let state: SunStateCode | null = null;
  let points: string[] = [];
  let previous: DaySample | null = null;
  let previousPoint = "";
  let sinceKept = 0;

  const flush = () => {
    if (state !== null && points.length >= 2) runs.push({ state, d: `M${points.join("L")}` });
    points = [];
    state = null;
  };

  for (const sample of samples) {
    const up = sample.state !== SunState.Night && sample.altitudeDeg > 0;
    if (!up) {
      if (previous !== null) {
        if (points[points.length - 1] !== previousPoint) points.push(previousPoint);
        flush();
      }
      previous = null;
      continue;
    }
    const point = pointString(polarPoint(sample.azimuthDeg, sample.altitudeDeg, radius));
    const contiguous = previous !== null && sample.minute - previous.minute <= 30;
    if (!contiguous) {
      if (previous !== null) {
        if (points[points.length - 1] !== previousPoint) points.push(previousPoint);
        flush();
      }
      state = sample.state;
      points = [point];
      sinceKept = 0;
    } else if (sample.state !== state) {
      // Close the old run on this sample and start the new one from it.
      points.push(point);
      flush();
      state = sample.state;
      points = [point];
      sinceKept = 0;
    } else if (++sinceKept >= stride) {
      points.push(point);
      sinceKept = 0;
    }
    previous = sample;
    previousPoint = point;
  }
  if (previous !== null) {
    if (points[points.length - 1] !== previousPoint) points.push(previousPoint);
    flush();
  }
  return runs;
}

/** The first and last samples of the day with the sun above the horizon. */
export function daylightEnds(samples: readonly DaySample[]): {
  first: DaySample | null;
  last: DaySample | null;
} {
  let first: DaySample | null = null;
  let last: DaySample | null = null;
  for (const sample of samples) {
    if (sample.state === SunState.Night || !(sample.altitudeDeg > 0)) continue;
    if (first === null) first = sample;
    last = sample;
  }
  return { first, last };
}

/**
 * SVG path of the view cone `facingDeg ± fovDeg / 2` as a pie slice of
 * `radius`; a full circle for 360° and more.
 */
export function wedgePath(facingDeg: number, fovDeg: number, radius: number): string {
  const r = fmt(radius);
  if (fovDeg >= 360) {
    return `M0,${fmt(-radius)}A${r},${r} 0 1 1 0,${r}A${r},${r} 0 1 1 0,${fmt(-radius)}Z`;
  }
  const half = Math.max(0, fovDeg) / 2;
  const start = rimPoint(facingDeg - half, radius);
  const end = rimPoint(facingDeg + half, radius);
  const largeArc = fovDeg > 180 ? 1 : 0;
  return `M0,0L${pointString(start)}A${r},${r} 0 ${largeArc} 1 ${pointString(end)}Z`;
}

/** A time label on the rim of the compass. */
export interface RimMark {
  azimuthDeg: number;
  /** Wall-clock minute to print. */
  minute: number;
}

/** Everything the compass draws for one day — small, so it is cheap to pass around. */
export interface SunPathModel {
  runs: SunPathRun[];
  /** Where and when the sun comes up / goes down; null when it does neither. */
  rise: RimMark | null;
  set: RimMark | null;
}

/** Boil a day's analysis down to what the compass draws. */
export function sunPathModel(
  day: Pick<DayAnalysis, "samples" | "sunriseMinute" | "sunsetMinute">,
  radius: number,
): SunPathModel {
  const { first, last } = daylightEnds(day.samples);
  return {
    runs: sunPathRuns(day.samples, radius),
    rise: first ? { azimuthDeg: first.azimuthDeg, minute: day.sunriseMinute ?? first.minute } : null,
    set:
      last && last !== first
        ? { azimuthDeg: last.azimuthDeg, minute: day.sunsetMinute ?? last.minute }
        : null,
  };
}

/** Radius of the compass's horizon circle, in its SVG units. */
export const COMPASS_RADIUS = 100;
