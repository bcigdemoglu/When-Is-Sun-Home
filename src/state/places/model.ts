/**
 * The saved / recent places lists as plain data, and every operation on them
 * as a pure function. The store (`./index.ts`) only wires these to zustand.
 *
 * Guarantees, for any sequence of operations on canonical data:
 *  - one entry per pin position (`placeEntryId`), in at most one of the lists;
 *  - `saved` holds at most `PLACES_LIMITS.saved` entries, in the user's order;
 *    `recent` at most `PLACES_LIMITS.recent`, newest first;
 *  - a stored summary is never replaced by `null`;
 *  - an operation that changes nothing returns the SAME object (and each list
 *    that did not change keeps its identity), so the store can skip the write.
 *
 * `sanitizePlacesData` turns anything (hand-edited, truncated or foreign
 * storage) into canonical data without throwing: a broken entry is dropped,
 * a broken field of a good entry is repaired or reset.
 *
 * Pure and server-safe.
 */
import { z } from "zod";
import type { LatLng, Observer, Place, PlaceSummary } from "@/lib/types";
import { SETTINGS_LIMITS, normalizePlaceName, sanitizeSettings } from "../schema";
import type { PlaceEntry } from "./types";

export const PLACES_LIMITS = {
  /** Most places that can be kept. */
  saved: 30,
  /** Most recents remembered. */
  recent: 8,
  labelMaxLength: 60,
  noteMaxLength: 280,
} as const;

/**
 * Viewing a place again with nothing changed refreshes its `visitedAt` at
 * most this often — repeating `recordVisit` (an effect re-running, a
 * re-render) must not write to storage every time.
 */
export const VISIT_REFRESH_MS = 60_000;

export interface PlacesData {
  /** Saved places in the user's order. */
  saved: PlaceEntry[];
  /** Recently viewed places that are not saved, newest first. */
  recent: PlaceEntry[];
}

// ─── Ids and labels ────────────────────────────────────────────────────────

function fixed5(value: number): string {
  const text = value.toFixed(5);
  // -0.000001 and 0.000001 are the same spot.
  return text === "-0.00000" ? "0.00000" : text;
}

/** Stable id of the entry for a pin position (coordinates rounded to ~1 m). */
export function placeEntryId(place: LatLng): string {
  return `${fixed5(place.lat)},${fixed5(place.lng)}`;
}

/** "37.7906° N, 122.4294° W". */
export function formatPlaceCoordinates(place: LatLng): string {
  const ns = place.lat >= 0 ? "N" : "S";
  const ew = place.lng >= 0 ? "E" : "W";
  return `${Math.abs(place.lat).toFixed(4)}° ${ns}, ${Math.abs(place.lng).toFixed(4)}° ${ew}`;
}

/** Cut to `max` UTF-16 units without splitting a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/** Whitespace and control characters collapsed to single spaces, trimmed. */
function collapse(text: string): string {
  return text.replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, " ").trim();
}

/** A usable label (trimmed, at most 60 characters), or null if nothing is left. */
export function cleanLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const cleaned = clip(collapse(label), PLACES_LIMITS.labelMaxLength);
  return cleaned.length > 0 ? cleaned : null;
}

/** A usable note (trimmed, at most 280 characters), or null if nothing is left. */
export function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const cleaned = clip(collapse(note), PLACES_LIMITS.noteMaxLength);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * What a place is called until the user names it: the first part of its
 * address ("2550 Pacific Avenue"), or its coordinates.
 */
export function defaultPlaceLabel(place: Place): string {
  const first = place.name?.split(",")[0];
  return cleanLabel(first) ?? formatPlaceCoordinates(place);
}

/** The label to show for an entry. Never empty. */
export function entryLabel(entry: PlaceEntry): string {
  return cleanLabel(entry.label) ?? defaultPlaceLabel(entry.place);
}

/**
 * The second line under an entry's label: the part of the address the label
 * does not already say, or the coordinates when there is no address.
 */
export function entryAddress(entry: PlaceEntry): string {
  const label = entryLabel(entry);
  const name = entry.place.name;
  const coordinates = formatPlaceCoordinates(entry.place);
  if (!name) return label === coordinates ? "Pinned on the map" : coordinates;
  if (name === label) return coordinates;
  if (name.startsWith(label)) {
    const rest = name
      .slice(label.length)
      .replace(/^[\s,]+/, "")
      .trim();
    return rest.length > 0 ? rest : coordinates;
  }
  return name;
}

// ─── Sanitising ────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

const hours = z.number().min(0).max(24);
const monthIndex = z.number().int().min(0).max(11);

const summarySchema = z.object({
  year: z.number().int().min(SETTINGS_LIMITS.year.min).max(SETTINGS_LIMITS.year.max),
  avgSunHoursPerDay: hours,
  sunFraction: z.number().min(0).max(1),
  totalSunHours: z
    .number()
    .min(0)
    .max(24 * 366),
  monthlySunHours: z.array(hours).length(12),
  monthlyDaylightHours: z.array(hours).length(12),
  bestMonth: monthIndex,
  worstMonth: monthIndex,
}) satisfies z.ZodType<PlaceSummary>;

/** Valid headline numbers (a fresh, plain copy), or null. Never throws. */
export function sanitizeSummary(value: unknown): PlaceSummary | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = summarySchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function coordinate(value: unknown, limit: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value === 0 ? 0 : value;
}

/** A place with coordinates in range and a canonical name, or null. Never throws. */
export function sanitizePlace(value: unknown): Place | null {
  try {
    const bag = asBag(value);
    if (!bag) return null;
    const lat = coordinate(bag.lat, SETTINGS_LIMITS.lat.max);
    const lng = coordinate(bag.lng, SETTINGS_LIMITS.lng.max);
    if (lat === null || lng === null) return null;
    const place: Place = { lat, lng };
    if (typeof bag.name === "string") {
      const name = normalizePlaceName(bag.name);
      if (name !== null) place.name = name;
    }
    return place;
  } catch {
    return null;
  }
}

/** An observer within the app's limits; unusable fields fall back to the defaults. */
export function sanitizeObserver(value: unknown): Observer {
  return sanitizeSettings({ observer: value }).observer;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // Never -0: it would not survive a JSON round trip unchanged.
  return value === 0 ? 0 : value;
}

/** One stored entry made canonical for the list it is in, or null if unusable. */
export function sanitizeEntry(value: unknown, list: "saved" | "recent"): PlaceEntry | null {
  try {
    const bag = asBag(value);
    if (!bag) return null;
    const place = sanitizePlace(bag.place);
    if (!place) return null;
    const visitedAt = timestamp(bag.visitedAt) ?? timestamp(bag.savedAt) ?? 0;
    const entry: PlaceEntry = {
      // Never trusted from storage: the id IS the position.
      id: placeEntryId(place),
      place,
      observer: sanitizeObserver(bag.observer),
      label: cleanLabel(bag.label) ?? defaultPlaceLabel(place),
      summary: sanitizeSummary(bag.summary),
      savedAt: list === "saved" ? (timestamp(bag.savedAt) ?? visitedAt) : null,
      visitedAt,
    };
    const note = cleanNote(bag.note);
    if (note !== null) entry.note = note;
    return entry;
  } catch {
    return null;
  }
}

function sanitizeList(
  value: unknown,
  list: "saved" | "recent",
  taken: Set<string>,
  limit: number,
): PlaceEntry[] {
  const entries: PlaceEntry[] = [];
  if (!Array.isArray(value)) return entries;
  for (let i = 0; i < value.length && entries.length < limit; i++) {
    let raw: unknown;
    try {
      raw = value[i];
    } catch {
      continue;
    }
    const entry = sanitizeEntry(raw, list);
    if (!entry || taken.has(entry.id)) continue;
    taken.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

/**
 * Turns anything into canonical places data. Never throws. Entries are
 * repaired one by one; an unusable or duplicate one is dropped (a place that
 * is both saved and recent stays saved), and the lists are cut to their caps.
 */
export function sanitizePlacesData(input: unknown): PlacesData {
  let saved: unknown;
  let recent: unknown;
  try {
    const bag = asBag(input);
    saved = bag?.saved;
    recent = bag?.recent;
  } catch {
    // unreadable: both stay undefined
  }
  const taken = new Set<string>();
  let savedList: PlaceEntry[] = [];
  let recentList: PlaceEntry[] = [];
  try {
    savedList = sanitizeList(saved, "saved", taken, PLACES_LIMITS.saved);
  } catch {
    // keep what we have
  }
  try {
    recentList = sanitizeList(recent, "recent", taken, PLACES_LIMITS.recent);
  } catch {
    // keep what we have
  }
  return { saved: savedList, recent: recentList };
}

// ─── Equality (for structural sharing and skipped writes) ──────────────────

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function sameSummary(a: PlaceSummary | null, b: PlaceSummary | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.year === b.year &&
    a.avgSunHoursPerDay === b.avgSunHoursPerDay &&
    a.sunFraction === b.sunFraction &&
    a.totalSunHours === b.totalSunHours &&
    a.bestMonth === b.bestMonth &&
    a.worstMonth === b.worstMonth &&
    sameNumbers(a.monthlySunHours, b.monthlySunHours) &&
    sameNumbers(a.monthlyDaylightHours, b.monthlyDaylightHours)
  );
}

function sameObserver(a: Observer, b: Observer): boolean {
  return (
    a.mode === b.mode &&
    a.heightM === b.heightM &&
    a.facingDeg === b.facingDeg &&
    a.fovDeg === b.fovDeg
  );
}

function samePlace(a: Place, b: Place): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.name === b.name;
}

/** Everything but the visit time. */
function sameContent(a: PlaceEntry, b: PlaceEntry): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.note === b.note &&
    a.savedAt === b.savedAt &&
    samePlace(a.place, b.place) &&
    sameObserver(a.observer, b.observer) &&
    sameSummary(a.summary, b.summary)
  );
}

export function sameEntry(a: PlaceEntry, b: PlaceEntry): boolean {
  return a === b || (a.visitedAt === b.visitedAt && sameContent(a, b));
}

/**
 * `next`, re-using from `prev` every entry (and the whole list) whose content
 * is unchanged, so subscribers of an unchanged slice are not notified.
 */
export function shareList(prev: PlaceEntry[], next: PlaceEntry[]): PlaceEntry[] {
  if (prev === next) return prev;
  const byId = new Map(prev.map((entry) => [entry.id, entry]));
  let identical = prev.length === next.length;
  const shared = next.map((entry, index) => {
    const before = byId.get(entry.id);
    const kept = before && sameEntry(before, entry) ? before : entry;
    if (kept !== prev[index]) identical = false;
    return kept;
  });
  return identical ? prev : shared;
}

// ─── Operations ────────────────────────────────────────────────────────────

function findIndex(list: PlaceEntry[], id: string): number {
  return list.findIndex((entry) => entry.id === id);
}

function replaceAt(list: PlaceEntry[], index: number, entry: PlaceEntry): PlaceEntry[] {
  const next = list.slice();
  next[index] = entry;
  return next;
}

function without(list: PlaceEntry[], index: number): PlaceEntry[] {
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

/**
 * `prev` as it is after being viewed again: newer coordinates, a name if it
 * gained one, the observer, the summary if one is given. A label that was
 * never chosen by the user follows the name.
 */
function revisit(
  prev: PlaceEntry,
  place: Place,
  observer: Observer,
  summary: PlaceSummary | null,
): PlaceEntry {
  const name = place.name ?? prev.place.name;
  const nextPlace: Place =
    name === undefined
      ? { lat: place.lat, lng: place.lng }
      : { lat: place.lat, lng: place.lng, name };
  const automatic = prev.label === defaultPlaceLabel(prev.place);
  const next: PlaceEntry = {
    ...prev,
    place: samePlace(prev.place, nextPlace) ? prev.place : nextPlace,
    observer: sameObserver(prev.observer, observer) ? prev.observer : observer,
    label: automatic ? defaultPlaceLabel(nextPlace) : prev.label,
    summary: summary === null || sameSummary(prev.summary, summary) ? prev.summary : summary,
  };
  return sameContent(prev, next) ? prev : next;
}

function newEntry(
  place: Place,
  observer: Observer,
  summary: PlaceSummary | null,
  now: number,
): PlaceEntry {
  return {
    id: placeEntryId(place),
    place,
    observer,
    label: defaultPlaceLabel(place),
    summary,
    savedAt: null,
    visitedAt: now,
  };
}

/** Whether a visit at `now` is worth recording when nothing else changed. */
function visitIsFresh(entry: PlaceEntry, now: number): boolean {
  return now >= entry.visitedAt && now - entry.visitedAt < VISIT_REFRESH_MS;
}

/**
 * A place is being viewed. A saved place is refreshed where it is; any other
 * goes to the front of the recents. Invalid coordinates are ignored.
 */
export function recordVisit(
  data: PlacesData,
  rawPlace: Place,
  rawObserver: Observer,
  rawSummary: PlaceSummary | null,
  now: number,
): PlacesData {
  const place = sanitizePlace(rawPlace);
  if (!place) return data;
  const observer = sanitizeObserver(rawObserver);
  const summary = sanitizeSummary(rawSummary);
  const id = placeEntryId(place);

  const savedIndex = findIndex(data.saved, id);
  if (savedIndex >= 0) {
    const prev = data.saved[savedIndex];
    const next = revisit(prev, place, observer, summary);
    if (next === prev && visitIsFresh(prev, now)) return data;
    return { ...data, saved: replaceAt(data.saved, savedIndex, { ...next, visitedAt: now }) };
  }

  const recentIndex = findIndex(data.recent, id);
  if (recentIndex >= 0) {
    const prev = data.recent[recentIndex];
    const next = revisit(prev, place, observer, summary);
    if (recentIndex === 0 && next === prev && visitIsFresh(prev, now)) return data;
    return {
      ...data,
      recent: [{ ...next, visitedAt: now }, ...without(data.recent, recentIndex)],
    };
  }

  return {
    ...data,
    recent: [newEntry(place, observer, summary, now), ...data.recent].slice(
      0,
      PLACES_LIMITS.recent,
    ),
  };
}

export function canSave(data: PlacesData): boolean {
  return data.saved.length < PLACES_LIMITS.saved;
}

/**
 * Keep a place: it leaves the recents and joins the END of the saved list.
 * Returns the entry — check `entry.savedAt !== null` to know whether it was
 * kept: when the list is full (or the coordinates are unusable) nothing
 * changes and the unsaved entry is returned.
 */
export function save(
  data: PlacesData,
  rawPlace: Place,
  rawObserver: Observer,
  rawSummary: PlaceSummary | null,
  rawLabel: string | undefined,
  now: number,
): { data: PlacesData; entry: PlaceEntry } {
  const observer = sanitizeObserver(rawObserver);
  const summary = sanitizeSummary(rawSummary);
  const label = cleanLabel(rawLabel);
  const place = sanitizePlace(rawPlace);
  if (!place) {
    // Nothing that could be stored; hand back something displayable.
    const fallback: Place = { lat: 0, lng: 0 };
    return { data, entry: { ...newEntry(fallback, observer, summary, now), id: "invalid" } };
  }
  const id = placeEntryId(place);

  const savedIndex = findIndex(data.saved, id);
  if (savedIndex >= 0) {
    const prev = data.saved[savedIndex];
    const revisited = revisit(prev, place, observer, summary);
    const next = label !== null && label !== revisited.label ? { ...revisited, label } : revisited;
    if (next === prev) return { data, entry: prev };
    return { data: { ...data, saved: replaceAt(data.saved, savedIndex, next) }, entry: next };
  }

  const recentIndex = findIndex(data.recent, id);
  const known = recentIndex >= 0 ? data.recent[recentIndex] : null;
  const base = known
    ? revisit(known, place, observer, summary)
    : newEntry(place, observer, summary, now);
  if (!canSave(data)) return { data, entry: base };

  const entry: PlaceEntry = {
    ...base,
    label: label ?? base.label,
    savedAt: now,
    visitedAt: Math.max(base.visitedAt, now),
  };
  return {
    data: {
      saved: [...data.saved, entry],
      recent: known ? without(data.recent, recentIndex) : data.recent,
    },
    entry,
  };
}

/** Stop keeping a place: it becomes the newest recent (label and note stay with it). */
export function unsave(data: PlacesData, id: string): PlacesData {
  const index = findIndex(data.saved, id);
  if (index < 0) return data;
  const entry: PlaceEntry = { ...data.saved[index], savedAt: null };
  return {
    saved: without(data.saved, index),
    recent: [entry, ...data.recent.filter((other) => other.id !== id)].slice(
      0,
      PLACES_LIMITS.recent,
    ),
  };
}

function patchEntry(
  data: PlacesData,
  id: string,
  patch: (entry: PlaceEntry) => PlaceEntry,
): PlacesData {
  for (const key of ["saved", "recent"] as const) {
    const index = findIndex(data[key], id);
    if (index < 0) continue;
    const prev = data[key][index];
    const next = patch(prev);
    return next === prev ? data : { ...data, [key]: replaceAt(data[key], index, next) };
  }
  return data;
}

/** Trimmed, at most 60 characters; an empty label is ignored. */
export function rename(data: PlacesData, id: string, rawLabel: string): PlacesData {
  const label = cleanLabel(rawLabel);
  if (label === null) return data;
  return patchEntry(data, id, (entry) => (entry.label === label ? entry : { ...entry, label }));
}

/** Trimmed, at most 280 characters; an empty note removes it. */
export function setNote(data: PlacesData, id: string, rawNote: string): PlacesData {
  const note = cleanNote(rawNote);
  return patchEntry(data, id, (entry) => {
    if ((entry.note ?? null) === note) return entry;
    const next: PlaceEntry = { ...entry };
    if (note === null) delete next.note;
    else next.note = note;
    return next;
  });
}

/**
 * New order of the saved list. Unknown and repeated ids are ignored; saved
 * places the caller left out keep their relative order at the end.
 */
export function reorder(data: PlacesData, ids: readonly string[]): PlacesData {
  if (!Array.isArray(ids)) return data;
  const byId = new Map(data.saved.map((entry) => [entry.id, entry]));
  const next: PlaceEntry[] = [];
  for (const id of ids) {
    const entry = typeof id === "string" ? byId.get(id) : undefined;
    if (!entry) continue;
    byId.delete(id);
    next.push(entry);
  }
  for (const entry of data.saved) if (byId.has(entry.id)) next.push(entry);
  return next.every((entry, index) => entry === data.saved[index])
    ? data
    : { ...data, saved: next };
}

export function removeRecent(data: PlacesData, id: string): PlacesData {
  const index = findIndex(data.recent, id);
  return index < 0 ? data : { ...data, recent: without(data.recent, index) };
}

export function clearRecents(data: PlacesData): PlacesData {
  return data.recent.length === 0 ? data : { ...data, recent: [] };
}

/**
 * What was done before storage was read (`early`) folded into what storage
 * held (`stored`): nothing the user kept in either is lost, short of the caps.
 */
export function unionPlaces(stored: PlacesData, early: PlacesData): PlacesData {
  if (early.saved.length === 0 && early.recent.length === 0) return stored;
  const earlySaved = new Map(early.saved.map((entry) => [entry.id, entry]));
  const saved = stored.saved.map((entry) => earlySaved.get(entry.id) ?? entry);
  const savedIds = new Set(saved.map((entry) => entry.id));
  for (const entry of early.saved) {
    if (savedIds.has(entry.id) || saved.length >= PLACES_LIMITS.saved) continue;
    savedIds.add(entry.id);
    saved.push(entry);
  }
  const recent: PlaceEntry[] = [];
  const seen = new Set(savedIds);
  for (const entry of [...early.recent, ...stored.recent]) {
    if (seen.has(entry.id) || recent.length >= PLACES_LIMITS.recent) continue;
    seen.add(entry.id);
    recent.push(entry.savedAt === null ? entry : { ...entry, savedAt: null });
  }
  return { saved, recent };
}
