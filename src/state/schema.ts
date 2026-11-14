/**
 * The persistable, shareable settings of the app — one schema, used by the
 * store, by localStorage persistence and by the URL codec.
 *
 * Two layers live here:
 *
 *  1. STRICT schemas (`settingsSchema` & friends) describe the *canonical*
 *     form. A value that parses is exactly what the store holds.
 *  2. `sanitizeSettings` / `mergeSettings` turn arbitrary input into that
 *     canonical form without ever throwing: every leaf is normalised
 *     (clamped, wrapped, rounded) and, if it is still unusable, replaced by
 *     the corresponding leaf of a fallback — the defaults, or the current
 *     state when applying a patch. One bad field never discards a good one.
 *
 * Canonical form, beyond the obvious ranges:
 *  - `facingDeg` and `fovDeg` are WHOLE degrees. Sub-degree precision means
 *    nothing for a window, it keeps URLs short, and it makes the URL
 *    round-trip exact for angles.
 *  - `minuteOfDay` is a whole minute.
 *  - No number is ever `-0` (it would break equality checks and print as
 *    "-0.00000" in a URL).
 *  - A place name is trimmed, whitespace-collapsed, well-formed UTF-16 and
 *    1..200 chars; an unusable name is dropped, the place is kept.
 *
 * This module is pure and server-safe (no React, no DOM).
 */
import { z } from "zod";
import type { Observer, ObserverMode, Place } from "@/lib/types";

// ─── Limits & defaults ─────────────────────────────────────────────────────

/** Ranges of every bounded setting. The UI should build its sliders from these. */
export const SETTINGS_LIMITS = {
  lat: { min: -90, max: 90 },
  lng: { min: -180, max: 180 },
  heightM: { min: 0, max: 300 },
  /** Whole degrees, 0..359. */
  facingDeg: { min: 0, max: 359 },
  /** Whole degrees. */
  fovDeg: { min: 10, max: 360 },
  minuteOfDay: { min: 0, max: 1439 },
  nameMaxLength: 200,
  /** Years accepted in a `date`. */
  year: { min: 1900, max: 2199 },
} as const;

const L = SETTINGS_LIMITS;

// ─── Normalisers (total on finite numbers) ─────────────────────────────────

/** `-0` → `0`; everything else unchanged. */
const noNegativeZero = (v: number): number => (v === 0 ? 0 : v);

const clamp = (v: number, min: number, max: number): number =>
  noNegativeZero(Math.min(max, Math.max(min, v)));

export function normalizeLat(v: number): number {
  return clamp(v, L.lat.min, L.lat.max);
}

/** Wraps a longitude into [-180, 180]. Values already in range are untouched. */
export function normalizeLng(v: number): number {
  if (v >= L.lng.min && v <= L.lng.max) return noNegativeZero(v);
  return noNegativeZero(((((v + 180) % 360) + 360) % 360) - 180);
}

export function normalizeHeightM(v: number): number {
  return clamp(v, L.heightM.min, L.heightM.max);
}

/** Compass bearing → whole degrees in [0, 360). 370 → 10, -90 → 270, 359.6 → 0. */
export function normalizeFacingDeg(v: number): number {
  return noNegativeZero(((Math.round(v) % 360) + 360) % 360);
}

export function normalizeFovDeg(v: number): number {
  return clamp(Math.round(v), L.fovDeg.min, L.fovDeg.max);
}

export function normalizeMinuteOfDay(v: number): number {
  return clamp(Math.round(v), L.minuteOfDay.min, L.minuteOfDay.max);
}

/** U+FFFD, what a lone surrogate is replaced with. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/**
 * Canonical place name, or null if nothing usable is left: lone surrogates
 * replaced, whitespace/control characters collapsed to single spaces, trimmed,
 * cut to 200 UTF-16 units without splitting a surrogate pair.
 */
export function normalizePlaceName(v: string): string | null {
  let s = v
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) =>
      m.length === 2 ? m : REPLACEMENT_CHARACTER,
    )
    .replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, " ")
    .trim();
  if (s.length > L.nameMaxLength) {
    s = s.slice(0, L.nameMaxLength);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s.length > 0 ? s : null;
}

// ─── Calendar dates ────────────────────────────────────────────────────────

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date written exactly as "YYYY-MM-DD" with a year in
 * `SETTINGS_LIMITS.year`. "2026-02-30" and "2026-2-3" are rejected. No `Date`
 * object is involved, so the answer never depends on a time zone.
 */
export function isValidIsoDate(v: string): boolean {
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < L.year.min || year > L.year.max) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

// ─── Strict (canonical) schemas ────────────────────────────────────────────

const canonicalNumber = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => !Object.is(v, -0), "must not be -0");

const canonicalInt = (min: number, max: number) => canonicalNumber(min, max).int();

const latSchema = canonicalNumber(L.lat.min, L.lat.max);
const lngSchema = canonicalNumber(L.lng.min, L.lng.max);
const nameSchema = z
  .string()
  .min(1)
  .max(L.nameMaxLength)
  .refine((v) => normalizePlaceName(v) === v, "must be a normalised name");
const dateSchema = z.string().refine(isValidIsoDate, "must be a real YYYY-MM-DD date");
const minuteOfDaySchema = canonicalInt(L.minuteOfDay.min, L.minuteOfDay.max);
const modeSchema = z.enum(["yard", "window"]) satisfies z.ZodType<ObserverMode>;
const heightMSchema = canonicalNumber(L.heightM.min, L.heightM.max);
const facingDegSchema = canonicalInt(L.facingDeg.min, L.facingDeg.max);
const fovDegSchema = canonicalInt(L.fovDeg.min, L.fovDeg.max);

export const placeSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  name: nameSchema.optional(),
}) satisfies z.ZodType<Place>;

export const observerSchema = z.object({
  mode: modeSchema,
  heightM: heightMSchema,
  facingDeg: facingDegSchema,
  fovDeg: fovDegSchema,
}) satisfies z.ZodType<Observer>;

export const layersSchema = z.object({
  buildings3d: z.boolean(),
  shadows: z.boolean(),
});

export const settingsSchema = z.object({
  /** The pinned place, or null before one is chosen. */
  place: placeSchema.nullable(),
  /** "YYYY-MM-DD" wall-clock date AT THE PLACE; null = "today". */
  date: dateSchema.nullable(),
  /** 0..1439 wall-clock minute AT THE PLACE; null = "now". */
  minuteOfDay: minuteOfDaySchema.nullable(),
  observer: observerSchema,
  layers: layersSchema,
});

export type Settings = z.infer<typeof settingsSchema>;
export type Layers = z.infer<typeof layersSchema>;
export type LayerKey = keyof Layers;

/**
 * A partial update of `Settings`. Top-level keys that are absent (or
 * `undefined`) mean "leave as is"; `observer` and `layers` are merged leaf by
 * leaf. This is what the URL codec produces and what `hydrate` accepts.
 */
export interface SettingsPatch {
  place?: Place | null;
  date?: string | null;
  minuteOfDay?: number | null;
  observer?: Partial<Observer>;
  layers?: Partial<Layers>;
}

export const DEFAULT_OBSERVER: Readonly<Observer> = Object.freeze({
  mode: "yard",
  heightM: 1,
  facingDeg: 180,
  fovDeg: 180,
});

export const DEFAULT_LAYERS: Readonly<Layers> = Object.freeze({
  buildings3d: true,
  shadows: true,
});

/** Frozen. Use `defaultSettings()` when you need a copy you can hand out. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  place: null,
  date: null,
  minuteOfDay: null,
  observer: DEFAULT_OBSERVER as Observer,
  layers: DEFAULT_LAYERS as Layers,
});

/** A fresh, mutable copy of the defaults. */
export function defaultSettings(): Settings {
  return cloneSettings(DEFAULT_SETTINGS);
}

function cloneSettings(s: Readonly<Settings>): Settings {
  return {
    place: s.place ? { ...s.place } : null,
    date: s.date,
    minuteOfDay: s.minuteOfDay,
    observer: { ...s.observer },
    layers: { ...s.layers },
  };
}

/** `fn()`, or `undefined` if it throws. */
function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** True if `value` is already canonical `Settings` (strict check, no repair). */
export function isSettings(value: unknown): value is Settings {
  return settingsSchema.safeParse(value).success;
}

// ─── Lenient leaf parsers: normalise, then validate strictly ───────────────

const lenientLat = z.number().transform(normalizeLat).pipe(latSchema);
const lenientLng = z.number().transform(normalizeLng).pipe(lngSchema);
const lenientName = z.string().transform(normalizePlaceName).pipe(nameSchema);
const lenientMinuteOfDay = z.number().transform(normalizeMinuteOfDay).pipe(minuteOfDaySchema);
const lenientHeightM = z.number().transform(normalizeHeightM).pipe(heightMSchema);
const lenientFacingDeg = z.number().transform(normalizeFacingDeg).pipe(facingDegSchema);
const lenientFovDeg = z.number().transform(normalizeFovDeg).pipe(fovDegSchema);

function leaf<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null ? (value as Bag) : null;
}

function sanitizePlace(value: unknown, fallback: Place | null): Place | null {
  if (value === null) return null;
  const bag = asBag(value);
  if (!bag) return fallback;
  const lat = lenientLat.safeParse(bag.lat);
  const lng = lenientLng.safeParse(bag.lng);
  if (!lat.success || !lng.success) return fallback;
  const place: Place = { lat: lat.data, lng: lng.data };
  // A name belongs to its coordinates: a bad one is dropped, never inherited.
  const name = lenientName.safeParse(bag.name);
  if (name.success) place.name = name.data;
  return place;
}

function sanitizeObserver(value: unknown, fallback: Observer): Observer {
  const bag = asBag(value) ?? {};
  return {
    mode: leaf(modeSchema, bag.mode, fallback.mode),
    heightM: leaf(lenientHeightM, bag.heightM, fallback.heightM),
    facingDeg: leaf(lenientFacingDeg, bag.facingDeg, fallback.facingDeg),
    fovDeg: leaf(lenientFovDeg, bag.fovDeg, fallback.fovDeg),
  };
}

function sanitizeLayers(value: unknown, fallback: Layers): Layers {
  const bag = asBag(value) ?? {};
  return {
    buildings3d: typeof bag.buildings3d === "boolean" ? bag.buildings3d : fallback.buildings3d,
    shadows: typeof bag.shadows === "boolean" ? bag.shadows : fallback.shadows,
  };
}

/**
 * Turns anything into canonical `Settings`. Never throws.
 *
 * Each field is repaired independently: numbers are clamped / wrapped /
 * rounded into range, and whatever is missing or still invalid is taken from
 * `fallback` (the defaults unless stated otherwise). Unknown keys are dropped.
 * Canonical input comes back deep-equal.
 */
export function sanitizeSettings(
  input: unknown,
  fallback: Readonly<Settings> = DEFAULT_SETTINGS,
): Settings {
  const bag = asBag(input) ?? {};
  // Each field is isolated, so that even hostile input (throwing getters,
  // revoked proxies) in one field cannot take a good field down with it.
  const field = <T>(key: keyof Settings, repair: (value: unknown) => T, otherwise: () => T): T => {
    try {
      return repair(bag[key]);
    } catch {
      return otherwise();
    }
  };
  const fallbackPlace = () => (fallback.place ? { ...fallback.place } : null);
  return {
    place: field("place", (v) => sanitizePlace(v, fallbackPlace()), fallbackPlace),
    date: field(
      "date",
      (v) => (v === null ? null : leaf(dateSchema, v, fallback.date)),
      () => fallback.date,
    ),
    minuteOfDay: field(
      "minuteOfDay",
      (v) => (v === null ? null : leaf(lenientMinuteOfDay, v, fallback.minuteOfDay)),
      () => fallback.minuteOfDay,
    ),
    observer: field(
      "observer",
      (v) => sanitizeObserver(v, fallback.observer),
      () => ({ ...fallback.observer }),
    ),
    layers: field(
      "layers",
      (v) => sanitizeLayers(v, fallback.layers),
      () => ({ ...fallback.layers }),
    ),
  };
}

/**
 * Applies `patch` on top of `base` and returns canonical `Settings`. Never
 * throws. Patch values are normalised like everything else; a value that
 * cannot be used leaves the corresponding field of `base` untouched.
 */
export function mergeSettings(base: Readonly<Settings>, patch: SettingsPatch): Settings {
  const p = asBag(patch) ?? {};
  // Reads are guarded one by one for the same reason as in `sanitizeSettings`;
  // a field that cannot be read counts as "not in the patch".
  const top = <K extends "place" | "date" | "minuteOfDay">(key: K): unknown => {
    const value = attempt(() => p[key]);
    return value !== undefined ? value : base[key];
  };
  const nested = <T extends object>(key: "observer" | "layers", current: T): T =>
    attempt(() => ({ ...current, ...asBag(p[key]) })) ?? current;
  return sanitizeSettings(
    {
      place: top("place"),
      date: top("date"),
      minuteOfDay: top("minuteOfDay"),
      observer: nested("observer", base.observer),
      layers: nested("layers", base.layers),
    },
    base,
  );
}
