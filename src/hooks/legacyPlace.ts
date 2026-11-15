/**
 * One-time carry-over from the previous version of the app, which kept
 * `{"location": {"lat", "lng", "name"}}` under the localStorage key
 * "sun-home-state". The new settings store deletes that key when it hydrates,
 * so it has to be read BEFORE `useHydrateSettings()` runs its effect.
 */
import type { Place } from "@/lib/types";

export const LEGACY_STATE_KEY = "sun-home-state";

/** The place stored by the old app, or null if there is none worth keeping. */
export function parseLegacyPlace(raw: string | null | undefined): Place | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const location = (parsed as { location?: unknown }).location;
    if (typeof location !== "object" || location === null) return null;
    const { lat, lng, name } = location as { lat?: unknown; lng?: unknown; name?: unknown };
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const place: Place = { lat, lng };
    if (typeof name === "string" && name.trim() !== "") place.name = name.trim();
    return place;
  } catch {
    return null;
  }
}

/** Reads the old app's place. Safe on the server and with storage blocked. */
export function readLegacyPlace(): Place | null {
  if (typeof window === "undefined") return null;
  try {
    return parseLegacyPlace(window.localStorage.getItem(LEGACY_STATE_KEY));
  } catch {
    return null;
  }
}
