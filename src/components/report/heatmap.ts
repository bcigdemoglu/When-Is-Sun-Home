/**
 * Geometry and pixel data of the year heat map (x = day of year, y = time of
 * day). Pure functions: the canvas drawing itself lives in `heatmapCanvas.ts`.
 */
import {
  addDays,
  dateFromDayIndex,
  dayIndexFromDate,
  yearOfDate,
  zonedToUtc,
} from "@/lib/analysis";
import { SunState, type YearAnalysis } from "@/lib/types";

import { daysInMonth, MONTHS_SHORT, parseIsoDate } from "./format";
import type { StateColors } from "./states";

// ─── Time-of-day range ─────────────────────────────────────────────────────

/** A span of the wall-clock day, minutes, `[startMinute, endMinute)`. */
export interface TimeRange {
  startMinute: number;
  endMinute: number;
}

export const FULL_DAY: TimeRange = { startMinute: 0, endMinute: 1440 };

type YearCells = Pick<YearAnalysis, "state" | "dayCount" | "slotsPerDay" | "stepMinutes">;

/**
 * The part of the day that ever sees daylight during the year, padded by
 * `padMinutes` and widened to whole hours — so the heat map does not waste
 * half its height on night. Falls back to the whole day when nearly all of it
 * is used anyway (high latitudes) or when there is no daylight at all.
 */
export function daylightTimeRange(year: YearCells, padMinutes = 30): TimeRange {
  const { state, dayCount, slotsPerDay, stepMinutes } = year;
  let first = slotsPerDay;
  let last = -1;
  for (let day = 0; day < dayCount; day++) {
    const row = day * slotsPerDay;
    for (let slot = 0; slot < first; slot++) {
      if (state[row + slot] !== SunState.Night) {
        first = slot;
        break;
      }
    }
    for (let slot = slotsPerDay - 1; slot > last; slot--) {
      if (state[row + slot] !== SunState.Night) {
        last = slot;
        break;
      }
    }
  }
  if (last < 0) return FULL_DAY;

  const start = Math.max(0, Math.floor((first * stepMinutes - padMinutes) / 60) * 60);
  const end = Math.min(1440, Math.ceil(((last + 1) * stepMinutes + padMinutes) / 60) * 60);
  if (end - start >= 22 * 60) return FULL_DAY;
  return { startMinute: start, endMinute: end };
}

/**
 * A calm time axis: at most `maxTicks` whole-hour ticks strictly inside
 * `range`, on the coarsest of the 6 / 4 / 3 / 2 / 1-hour grids that still
 * gives two (so a normal day reads "6 AM · 12 PM · 6 PM").
 */
export function timeAxisTicks(range: TimeRange, maxTicks = 4): number[] {
  for (const step of [6, 4, 3, 2, 1]) {
    const ticks: number[] = [];
    for (
      let hour = Math.ceil(range.startMinute / 60 / step) * step;
      hour * 60 < range.endMinute;
      hour += step
    ) {
      if (hour * 60 > range.startMinute) ticks.push(hour * 60);
    }
    if (ticks.length >= 2 && ticks.length <= maxTicks) return ticks;
  }
  return [];
}

// ─── Pixel ⇄ (day, minute) ─────────────────────────────────────────────────

/** Where the plot sits (CSS pixels) and what it shows. */
export interface HeatmapGeometry extends TimeRange {
  x: number;
  y: number;
  width: number;
  height: number;
  dayCount: number;
  stepMinutes: number;
}

export interface HeatmapCell {
  dayIndex: number;
  /** Slot within the day (0 … slotsPerDay - 1). */
  slot: number;
  /** Wall-clock minute at which that slot starts. */
  minute: number;
}

/** Left edge of a day's column. */
export function dayX(g: HeatmapGeometry, dayIndex: number): number {
  return g.x + (dayIndex / g.dayCount) * g.width;
}

/** Horizontal centre of a day's column. */
export function dayCenterX(g: HeatmapGeometry, dayIndex: number): number {
  return g.x + ((dayIndex + 0.5) / g.dayCount) * g.width;
}

/** Vertical position of a wall-clock minute (earlier is higher up). */
export function minuteY(g: HeatmapGeometry, minute: number): number {
  return g.y + ((minute - g.startMinute) / (g.endMinute - g.startMinute)) * g.height;
}

/**
 * The grid cell under a point. Points outside the plot give `null`, unless
 * `clamp` is set — then the nearest cell is returned (for drags that wander
 * off the edge).
 */
export function cellAtPoint(
  g: HeatmapGeometry,
  px: number,
  py: number,
  clamp = false,
): HeatmapCell | null {
  if (!(g.width > 0 && g.height > 0 && g.dayCount > 0)) return null;
  let fx = (px - g.x) / g.width;
  let fy = (py - g.y) / g.height;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) {
    if (!clamp) return null;
    fx = Math.min(Math.max(fx, 0), 1);
    fy = Math.min(Math.max(fy, 0), 1);
  }
  const dayIndex = Math.min(g.dayCount - 1, Math.floor(fx * g.dayCount));
  const firstSlot = Math.floor(g.startMinute / g.stepMinutes);
  const slotCount = Math.round((g.endMinute - g.startMinute) / g.stepMinutes);
  const slot = firstSlot + Math.min(slotCount - 1, Math.floor(fy * slotCount));
  return { dayIndex, slot, minute: slot * g.stepMinutes };
}

// ─── Calendar furniture ────────────────────────────────────────────────────

/** Day index of `date` within an analysed year; null for another year or a bad date. */
export function dayIndexInYear(
  year: Pick<YearAnalysis, "year" | "dayCount">,
  date: string,
): number | null {
  if (Number(date.slice(0, 4)) !== year.year) return null;
  try {
    const index = dayIndexFromDate(date);
    return index >= 0 && index < year.dayCount ? index : null;
  } catch {
    return null;
  }
}

export interface MonthSpan {
  month: number;
  label: string;
  /** Day index of the 1st of the month. */
  startDay: number;
  dayCount: number;
}

export function monthSpans(year: number): MonthSpan[] {
  const spans: MonthSpan[] = [];
  let startDay = 0;
  for (let month = 0; month < 12; month++) {
    const dayCount = daysInMonth(year, month);
    spans.push({ month, label: MONTHS_SHORT[month], startDay, dayCount });
    startDay += dayCount;
  }
  return spans;
}

/** A day on which the clocks change (daylight saving time starts or ends). */
export interface ClockShift {
  dayIndex: number;
  date: string;
  /** +60 when clocks spring forward, -60 when they fall back. */
  deltaMinutes: number;
}

function noonOffsetMinutes(date: string, timeZone: string): number | null {
  const parts = parseIsoDate(date);
  if (!parts) return null;
  const utc = zonedToUtc(date, 720, timeZone);
  if (!utc) return null;
  return Math.round((Date.UTC(parts.year, parts.month, parts.day, 12) - utc.getTime()) / 60_000);
}

/**
 * Days of `year` whose UTC offset at local noon differs from the day before:
 * the dates on which the daylight band of the heat map jumps.
 */
export function findClockShifts(year: number, timeZone: string, dayCount: number): ClockShift[] {
  const shifts: ClockShift[] = [];
  let previous: number | null = null;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = dateFromDayIndex(year, dayIndex);
    let offset: number | null;
    try {
      offset = noonOffsetMinutes(date, timeZone);
    } catch {
      return [];
    }
    if (offset === null) continue;
    if (previous !== null && offset !== previous) {
      shifts.push({ dayIndex, date, deltaMinutes: offset - previous });
    }
    previous = offset;
  }
  return shifts;
}

// ─── Pixels ────────────────────────────────────────────────────────────────

/** One pixel per (day, slot): `width` = days, `height` = slots in range. */
export interface HeatmapPixels {
  width: number;
  height: number;
  /** RGBA, row-major, row 0 = the first slot of the range. */
  data: Uint8ClampedArray;
  /** Opaque where the state is OutOfView (for the hatch); null if never. */
  outMask: Uint8ClampedArray | null;
}

export function buildHeatmapPixels(
  year: YearCells,
  range: TimeRange,
  colors: Pick<StateColors, "rgb">,
): HeatmapPixels {
  const { state, dayCount, slotsPerDay, stepMinutes } = year;
  const firstSlot = Math.max(0, Math.floor(range.startMinute / stepMinutes));
  const lastSlot = Math.min(slotsPerDay, Math.ceil(range.endMinute / stepMinutes));
  const width = dayCount;
  const height = Math.max(0, lastSlot - firstSlot);
  const data = new Uint8ClampedArray(width * height * 4);
  let outMask: Uint8ClampedArray | null = null;

  const night = colors.rgb[SunState.Night];
  for (let day = 0; day < dayCount; day++) {
    const row = day * slotsPerDay;
    for (let r = 0; r < height; r++) {
      const code = state[row + firstSlot + r];
      const rgb = colors.rgb[code] ?? night;
      const p = (r * width + day) * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
      if (code === SunState.OutOfView) {
        outMask ??= new Uint8ClampedArray(width * height * 4);
        outMask[p + 3] = 255;
      }
    }
  }
  return { width, height, data, outMask };
}

// ─── Keyboard ──────────────────────────────────────────────────────────────

export interface DateTimeSelection {
  date: string;
  minute: number;
}

const MINUTE_STEP = 15;

/**
 * Where a key press moves the selection: left/right by a day, up/down by 15
 * minutes (up = earlier, as drawn), PageUp/PageDown by 30 days, Home/End to
 * the first / last day of the year. `null` for keys that do nothing.
 */
export function moveSelection(date: string, minute: number, key: string): DateTimeSelection | null {
  switch (key) {
    case "ArrowLeft":
      return { date: addDays(date, -1), minute };
    case "ArrowRight":
      return { date: addDays(date, 1), minute };
    case "PageUp":
      return { date: addDays(date, -30), minute };
    case "PageDown":
      return { date: addDays(date, 30), minute };
    case "Home":
      return { date: `${date.slice(0, 4)}-01-01`, minute };
    case "End":
      return { date: `${String(yearOfDate(date)).padStart(4, "0")}-12-31`, minute };
    case "ArrowUp":
      return {
        date,
        minute: Math.max(0, Math.ceil(minute / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP),
      };
    case "ArrowDown":
      return {
        date,
        minute: Math.min(1439, Math.floor(minute / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP),
      };
    default:
      return null;
  }
}
