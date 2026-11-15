/**
 * Settings ⇄ URL query string.
 *
 * CURRENT FORMAT — compact keys, anything equal to its default is omitted so
 * a fresh URL stays clean:
 *
 *   lat, lng  place, 5 decimals (≈ 1 m)
 *   n         place name
 *   d         date at the place, "YYYY-MM-DD"       (absent = today)
 *   t         time at the place, "HHMM", e.g. 0930  (absent = now)
 *   m         observer mode: "w" = window           (absent = yard, "y")
 *   h         observer height in metres, at most 1 decimal
 *   dir       facing, whole degrees
 *   fov       field of view, whole degrees
 *   b         3D buildings layer, "0" = off
 *   sh        shadows layer, "0" = off
 *
 * Rounding: `lat`/`lng` to 5 decimals and `h` to 1 decimal. Everything else
 * round-trips exactly (see `roundSettingsForUrl`).
 *
 * LEGACY FORMAT — links shared from the old app used the same keys with
 * different meanings: `t` = minutes since midnight as a plain integer ("720"),
 * `d` = day of year 1..366 as a plain integer, plus `f` (floor, 1-based),
 * `z` (map zoom) and `bl` (blockage flag). They always described a window.
 *
 * DETECTION RULE (`isLegacySearchParams`). A query string is legacy if and only
 * if it carries at least one value that the old app could have written and the
 * current writer never writes:
 *
 *   1. `f` present as a whole number,            or
 *   2. `z` present as a number,                  or
 *   3. `bl` present as "0" / "1",                or
 *   4. `d` is a bare integer 1..366 (no dashes), or
 *   5. `t` is a bare integer 0..1439 without zero padding that is NOT a valid
 *      4-digit "HHMM" — i.e. 1 to 3 digits ("0", "45", "720"), or 4 digits with
 *      "minutes" ≥ 60 ("1075" = 17:55).
 *
 * The current writer always zero-pads `t` to a valid HHMM, always writes `d`
 * with dashes and never writes `f`, `z` or `bl`, so its own output can never be
 * mistaken for a legacy link. Malformed values (`d=999`, `t=9999`, `f=abc`) are
 * not markers; they are simply ignored.
 *
 * The one ambiguity that cannot be resolved: a 4-digit `t` in 1000..1439 whose
 * last two digits are < 60 (e.g. "1230") is 12:30 today but meant 20:30 in the
 * old app. It is read the old way only when another marker makes the link
 * legacy. An old link is misread only if it had no `d` (viewing 1 January),
 * no `z` (zoom exactly 13) and no `f` (ground floor) — vanishingly rare.
 *
 * CONVERSION of a legacy link:
 *   - `d` day of year → that day in the CURRENT year (`options.now`); day 366
 *     in a non-leap year → 31 December. `d` absent → 1 January, because the
 *     old writer omitted its default (day 1).
 *   - `t` minutes → `minuteOfDay`. `t` absent → 720 (old default: noon).
 *   - `f` floor → `heightM = (floor − 1) × 3 + 1.5`. `f` absent → floor 1.
 *   - observer mode → "window".
 *   - `dir`, `fov`, `b`, `sh`, `lat`, `lng`, `n` mean the same in both formats.
 *   - `z` and `bl` have no equivalent and are dropped. The old default
 *     "shadows off" is NOT carried over: a layer the link does not mention
 *     keeps today's default.
 *   - Current-format-only keys still win if someone mixes both: `m` beats the
 *     implied window, `h` beats `f`, a dashed `d` is read as a date.
 *
 * This module is pure and server-safe (no React, no DOM).
 */
import type { Observer, ObserverMode, Place } from "@/lib/types";
import {
  DEFAULT_LAYERS,
  DEFAULT_OBSERVER,
  DEFAULT_SETTINGS,
  daysInMonth,
  isLeapYear,
  isValidIsoDate,
  mergeSettings,
  normalizeFacingDeg,
  normalizeFovDeg,
  normalizeHeightM,
  normalizeLat,
  normalizeLng,
  normalizePlaceName,
  type Layers,
  type Settings,
  type SettingsPatch,
} from "./schema";
import { floorToHeightM } from "./selectors";

/** Query keys written by `settingsToSearchParams`, in output order. */
export const URL_KEYS = {
  lat: "lat",
  lng: "lng",
  name: "n",
  date: "d",
  time: "t",
  mode: "m",
  heightM: "h",
  facingDeg: "dir",
  fovDeg: "fov",
  buildings3d: "b",
  shadows: "sh",
} as const;

/** Keys only the old app wrote. Reserved: never reuse them for something else. */
export const LEGACY_URL_KEYS = { floor: "f", zoom: "z", blockage: "bl" } as const;

const K = URL_KEYS;

const MODE_CODE: Record<ObserverMode, string> = { yard: "y", window: "w" };
// A Map, not an object literal: `?m=toString` must not find Object.prototype.
const MODE_FROM_PARAM = new Map<string, ObserverMode>([
  ["y", "yard"],
  ["yard", "yard"],
  ["w", "window"],
  ["window", "window"],
]);

const COORD_DECIMALS = 5;
const HEIGHT_DECIMALS = 1;

/** Old-app defaults that its writer omitted from the URL. */
const LEGACY_DEFAULT_MINUTE = 720;
const LEGACY_DEFAULT_DAY_OF_YEAR = 1;
const LEGACY_DEFAULT_FLOOR = 1;

// ─── Small pure helpers ────────────────────────────────────────────────────

function roundTo(v: number, decimals: number): number {
  const rounded = Number(v.toFixed(decimals));
  return rounded === 0 ? 0 : rounded; // no -0
}

function formatCoord(v: number): string {
  return roundTo(v, COORD_DECIMALS).toFixed(COORD_DECIMALS);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** 570 → "0930". */
export function minuteOfDayToHHMM(minute: number): string {
  return pad2(Math.floor(minute / 60)) + pad2(minute % 60);
}

/** "0930" → 570. Exactly four digits, 00..23 then 00..59; otherwise null. */
export function hhmmToMinuteOfDay(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2));
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/**
 * 1-based day of year → "YYYY-MM-DD" in `year`. Days past the end of the year
 * (366 in a non-leap year) give 31 December; days below 1 give 1 January.
 */
export function dayOfYearToIsoDate(year: number, dayOfYear: number): string {
  let remaining = Math.min(Math.max(1, Math.floor(dayOfYear)), isLeapYear(year) ? 366 : 365);
  let month = 1;
  while (remaining > daysInMonth(year, month)) {
    remaining -= daysInMonth(year, month);
    month += 1;
  }
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(remaining)}`;
}

/** A plain decimal number ("12", "-3.5", ".5"); no exponents, hex or junk. */
function parseDecimal(value: string | null): number | null {
  if (value === null || value.length > 32 || !/^-?(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A whole number the way `String(int)` prints it: no sign, no zero padding. */
function parseBareInt(value: string | null): number | null {
  return value !== null && /^(0|[1-9]\d{0,3})$/.test(value) ? Number(value) : null;
}

function parseFlag(value: string | null): boolean | null {
  return value === "1" ? true : value === "0" ? false : null;
}

function legacyMinute(value: string | null): number | null {
  const n = parseBareInt(value);
  return n !== null && n <= 1439 ? n : null;
}

function legacyDayOfYear(value: string | null): number | null {
  const n = parseBareInt(value);
  return n !== null && n >= 1 && n <= 366 ? n : null;
}

// ─── Legacy detection ──────────────────────────────────────────────────────

/** True if the query string was written by the old app. See the rule above. */
export function isLegacySearchParams(params: URLSearchParams): boolean {
  if (parseBareInt(params.get(LEGACY_URL_KEYS.floor)) !== null) return true;
  if (parseDecimal(params.get(LEGACY_URL_KEYS.zoom)) !== null) return true;
  if (parseFlag(params.get(LEGACY_URL_KEYS.blockage)) !== null) return true;
  if (legacyDayOfYear(params.get(K.date)) !== null) return true;
  const t = params.get(K.time);
  return t !== null && legacyMinute(t) !== null && hhmmToMinuteOfDay(t) === null;
}

// ─── Encode ────────────────────────────────────────────────────────────────

/**
 * The settings as they come back after a trip through the URL: `lat`/`lng`
 * rounded to 5 decimals, `heightM` to 1 decimal, everything else untouched.
 */
export function roundSettingsForUrl(s: Settings): Settings {
  return {
    ...s,
    place: s.place
      ? {
          ...s.place,
          lat: roundTo(s.place.lat, COORD_DECIMALS),
          lng: roundTo(s.place.lng, COORD_DECIMALS),
        }
      : null,
    observer: { ...s.observer, heightM: roundTo(s.observer.heightM, HEIGHT_DECIMALS) },
    layers: { ...s.layers },
  };
}

export function settingsToSearchParams(s: Settings): URLSearchParams {
  const p = new URLSearchParams();

  if (s.place) {
    p.set(K.lat, formatCoord(s.place.lat));
    p.set(K.lng, formatCoord(s.place.lng));
    if (s.place.name) p.set(K.name, s.place.name);
  }
  if (s.date !== null) p.set(K.date, s.date);
  if (s.minuteOfDay !== null) p.set(K.time, minuteOfDayToHHMM(s.minuteOfDay));

  const o = s.observer;
  if (o.mode !== DEFAULT_OBSERVER.mode) p.set(K.mode, MODE_CODE[o.mode]);
  const heightM = roundTo(o.heightM, HEIGHT_DECIMALS);
  if (heightM !== DEFAULT_OBSERVER.heightM) p.set(K.heightM, String(heightM));
  if (o.facingDeg !== DEFAULT_OBSERVER.facingDeg) p.set(K.facingDeg, String(o.facingDeg));
  if (o.fovDeg !== DEFAULT_OBSERVER.fovDeg) p.set(K.fovDeg, String(o.fovDeg));

  if (s.layers.buildings3d !== DEFAULT_LAYERS.buildings3d) {
    p.set(K.buildings3d, s.layers.buildings3d ? "1" : "0");
  }
  if (s.layers.shadows !== DEFAULT_LAYERS.shadows) p.set(K.shadows, s.layers.shadows ? "1" : "0");

  return p;
}

/**
 * `base` with its query string replaced by the settings. The path and the
 * `#hash` of `base` are kept, any existing query is dropped. `base` may be
 * absolute ("https://example.com/") or relative ("/"). Never throws.
 */
export function buildShareUrl(settings: Settings, base: string): string {
  const hashAt = base.indexOf("#");
  const hash = hashAt >= 0 ? base.slice(hashAt) : "";
  let path = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const queryAt = path.indexOf("?");
  if (queryAt >= 0) path = path.slice(0, queryAt);
  const query = settingsToSearchParams(settings).toString();
  return path + (query ? `?${query}` : "") + hash;
}

// ─── Decode ────────────────────────────────────────────────────────────────

export interface SearchParamsToSettingsOptions {
  /** "Now", used only to pick the year of a legacy day-of-year. Default: `new Date()`. */
  now?: Date;
}

/**
 * Reads the fields that are present AND valid; everything else is left out of
 * the result, so the caller decides what an absent field means (see
 * `overlayUrlSettings`). Numbers are normalised exactly like in
 * `sanitizeSettings` (clamped / wrapped / rounded). Legacy links are detected
 * and converted as described at the top of this file. Never throws.
 */
export function searchParamsToSettings(
  params: URLSearchParams,
  options: SearchParamsToSettingsOptions = {},
): SettingsPatch {
  try {
    return decode(params, options);
  } catch {
    return {};
  }
}

function decode(params: URLSearchParams, options: SearchParamsToSettingsOptions): SettingsPatch {
  const patch: SettingsPatch = {};
  const legacy = isLegacySearchParams(params);

  // Place: both coordinates or nothing.
  const lat = parseDecimal(params.get(K.lat));
  const lng = parseDecimal(params.get(K.lng));
  if (lat !== null && lng !== null) {
    const place: Place = { lat: normalizeLat(lat), lng: normalizeLng(lng) };
    const rawName = params.get(K.name);
    const name = rawName === null ? null : normalizePlaceName(rawName);
    if (name !== null) place.name = name;
    patch.place = place;
  }

  // Date.
  const d = params.get(K.date);
  if (d !== null && isValidIsoDate(d)) {
    patch.date = d;
  } else if (legacy) {
    const dayOfYear = d === null ? LEGACY_DEFAULT_DAY_OF_YEAR : legacyDayOfYear(d);
    if (dayOfYear !== null) {
      const date = dayOfYearToIsoDate((options.now ?? new Date()).getFullYear(), dayOfYear);
      if (isValidIsoDate(date)) patch.date = date;
    }
  }

  // Time of day.
  const t = params.get(K.time);
  if (t === null) {
    if (legacy) patch.minuteOfDay = LEGACY_DEFAULT_MINUTE;
  } else {
    // In a legacy link a zero-padded "0930" cannot be old-style minutes, so it
    // still falls through to HHMM.
    const minute = (legacy ? legacyMinute(t) : null) ?? hhmmToMinuteOfDay(t);
    if (minute !== null) patch.minuteOfDay = minute;
  }

  // Observer.
  const observer: Partial<Observer> = {};
  const mode = MODE_FROM_PARAM.get(params.get(K.mode) ?? "");
  if (mode !== undefined) observer.mode = mode;
  else if (legacy) observer.mode = "window";

  const heightM = parseDecimal(params.get(K.heightM));
  if (heightM !== null) {
    observer.heightM = normalizeHeightM(heightM);
  } else if (legacy) {
    const floor = parseBareInt(params.get(LEGACY_URL_KEYS.floor)) ?? LEGACY_DEFAULT_FLOOR;
    observer.heightM = floorToHeightM(floor);
  }

  const facingDeg = parseDecimal(params.get(K.facingDeg));
  if (facingDeg !== null) observer.facingDeg = normalizeFacingDeg(facingDeg);
  const fovDeg = parseDecimal(params.get(K.fovDeg));
  if (fovDeg !== null) observer.fovDeg = normalizeFovDeg(fovDeg);
  if (Object.keys(observer).length > 0) patch.observer = observer;

  // Layers.
  const layers: Partial<Layers> = {};
  const buildings3d = parseFlag(params.get(K.buildings3d));
  if (buildings3d !== null) layers.buildings3d = buildings3d;
  const shadows = parseFlag(params.get(K.shadows));
  if (shadows !== null) layers.shadows = shadows;
  if (Object.keys(layers).length > 0) patch.layers = layers;

  return patch;
}

/** True if the patch would not change anything (no usable field in the URL). */
export function isEmptyPatch(patch: SettingsPatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * What the app should show given the settings restored from storage and the
 * patch decoded from the URL. The URL wins field by field. Never throws.
 *
 * One refinement: a URL that pins a PLACE is a complete snapshot — it is what
 * `settingsToSearchParams` wrote for somebody's whole view, with defaults left
 * out. Fields it does not mention therefore mean "the default", not "whatever
 * this browser had stored"; otherwise a shared link would show the recipient a
 * different observer (and a different sun report) than the sender saw. A URL
 * without a place (`?fov=90`) is a plain field-by-field override of the stored
 * settings.
 */
export function overlayUrlSettings(stored: Readonly<Settings>, urlPatch: SettingsPatch): Settings {
  const base = urlPatch.place ? DEFAULT_SETTINGS : stored;
  return mergeSettings(base, urlPatch);
}
