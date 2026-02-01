import type { Location } from "@/types/sun";

// ─── Persisted app state schema ───────────────────────────────────────
// Every field the app saves to localStorage. When adding a new field:
//   1. Add it here with a default value
//   2. Use `updateAppState("fieldName", value)` wherever the state changes
//   3. Read it via `loadAppState()` on hydration
export interface AppState {
  location: Location | null;
  zoom: number;
  /** Minutes since midnight — we store this instead of a Date to avoid
   *  timezone/serialisation issues. Combines with `dayOfYear`. */
  timeMinutes: number;
  /** 1-based day of year (Jan 1 = 1). */
  dayOfYear: number;
  buildingsEnabled: boolean;
  blockageEnabled: boolean;
  shadowsEnabled: boolean;
  userFloor: number;
  /** Compass direction the observer faces (0=N, 90=E, 180=S, 270=W). */
  pinDirection: number;
  /** Field of view in degrees (how wide the observer can see). */
  pinFov: number;
}

const STORAGE_KEY = "sun-home-state";

const DEFAULTS: AppState = {
  location: null,
  zoom: 13,
  timeMinutes: 720, // noon
  dayOfYear: 1,
  buildingsEnabled: true,
  blockageEnabled: true,
  shadowsEnabled: false,
  userFloor: 1,
  pinDirection: 180, // facing south
  pinFov: 180,
};

// ─── Read ─────────────────────────────────────────────────────────────
export function loadAppState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields added later get their default
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

// ─── Write (full replace) ─────────────────────────────────────────────
function saveAppState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// ─── Patch a single field ─────────────────────────────────────────────
// Usage:  updateAppState("zoom", 15)
//         updateAppState("location", { lat: 40, lng: -74 })
export function updateAppState<K extends keyof AppState>(
  key: K,
  value: AppState[K]
) {
  const current = loadAppState();
  current[key] = value;
  saveAppState(current);
}

// ─── Reset (preserves location only) ─────────────────────────────
export function resetAppState(keepLocation: Location | null) {
  const reset: AppState = { ...DEFAULTS, location: keepLocation };
  saveAppState(reset);
  return reset;
}

// ─── Clear building cache ────────────────────────────────────────
export function clearBuildingCache() {
  try {
    localStorage.removeItem("sun-building-cache");
  } catch {}
}

// ─── Date / time helpers ──────────────────────────────────────────────
export function dateToTimeMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function dateToDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

export function applyTimeAndDay(
  timeMinutes: number,
  dayOfYear: number
): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), 0, 1);
  d.setDate(dayOfYear);
  d.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0);
  return d;
}
