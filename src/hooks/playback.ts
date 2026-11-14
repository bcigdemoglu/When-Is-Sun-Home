/**
 * Time-based stepping for the play animation. Pure: the hook in
 * `usePlayback.ts` feeds it frame times and writes the result to the store.
 */

export type PlayMode = "day" | "year";

export interface PlaySpeed {
  label: string;
  /** Simulated minutes per real second in "day" mode. */
  minutesPerSecond: number;
  /** Simulated days per real second in "year" mode. */
  daysPerSecond: number;
}

/** Slow enough to read, fast enough to watch a whole day / year go by. */
export const PLAY_SPEEDS: readonly PlaySpeed[] = [
  { label: "1×", minutesPerSecond: 30, daysPerSecond: 8 },
  { label: "2×", minutesPerSecond: 90, daysPerSecond: 20 },
  { label: "4×", minutesPerSecond: 240, daysPerSecond: 50 },
];
export const DEFAULT_SPEED_INDEX = 1;

/**
 * A frame never advances the animation by more than this much real time, so a
 * stalled tab (or a long task) resumes where it was instead of jumping ahead.
 */
export const MAX_FRAME_MS = 100;

/** Margin shown before sunrise and after sunset in "day" mode, minutes. */
export const DAY_LOOP_MARGIN_MIN = 30;

export interface DayLoop {
  /** First and last minute of the loop, inclusive, whole minutes in 0..1439. */
  startMinute: number;
  endMinute: number;
}

const FULL_DAY: DayLoop = { startMinute: 0, endMinute: 1439 };

/**
 * The part of the day worth animating: from 30 min before sunrise to 30 min
 * after sunset, clamped to the calendar day. Falls back to the whole day when
 * there is no ordinary sunrise-then-sunset (polar day / night, or a day that
 * starts in daylight).
 */
export function dayLoopRange(sunriseMinute: number | null, sunsetMinute: number | null): DayLoop {
  if (
    sunriseMinute === null ||
    sunsetMinute === null ||
    !Number.isFinite(sunriseMinute) ||
    !Number.isFinite(sunsetMinute) ||
    sunsetMinute <= sunriseMinute
  ) {
    return FULL_DAY;
  }
  const startMinute = Math.max(0, Math.floor(sunriseMinute - DAY_LOOP_MARGIN_MIN));
  const endMinute = Math.min(1439, Math.ceil(sunsetMinute + DAY_LOOP_MARGIN_MIN));
  return endMinute > startMinute ? { startMinute, endMinute } : FULL_DAY;
}

/** Real time to credit a frame with: never negative, never more than `MAX_FRAME_MS`. */
export function frameElapsedMs(previousMs: number, nowMs: number): number {
  const elapsed = nowMs - previousMs;
  if (!(elapsed > 0)) return 0;
  return Math.min(elapsed, MAX_FRAME_MS);
}

/** Wrap `value` into the half-open interval [start, start + length). */
function wrap(value: number, start: number, length: number): number {
  if (!(length > 0)) return start;
  const offset = (value - start) % length;
  return start + (offset < 0 ? offset + length : offset);
}

/**
 * Advance a (fractional) minute of day by `elapsedMs` of real time and wrap it
 * inside `loop`. A position outside the loop first jumps to the loop's start.
 */
export function advanceMinute(
  minute: number,
  elapsedMs: number,
  minutesPerSecond: number,
  loop: DayLoop,
): number {
  const length = loop.endMinute - loop.startMinute + 1;
  const from =
    Number.isFinite(minute) && minute >= loop.startMinute && minute < loop.startMinute + length
      ? minute
      : loop.startMinute;
  const step = (Math.max(0, elapsedMs) / 1000) * minutesPerSecond;
  return wrap(from + step, loop.startMinute, length);
}

/**
 * Advance a (fractional) 0-based day of year by `elapsedMs` of real time,
 * wrapping from 31 December back to 1 January of the same year.
 */
export function advanceDayIndex(
  dayIndex: number,
  elapsedMs: number,
  daysPerSecond: number,
  dayCount: number,
): number {
  const from = Number.isFinite(dayIndex) ? dayIndex : 0;
  const step = (Math.max(0, elapsedMs) / 1000) * daysPerSecond;
  return wrap(from + step, 0, dayCount);
}
