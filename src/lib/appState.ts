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

// ─── URL query-param sync ─────────────────────────────────────────────
// Short keys keep shared URLs compact.
const URL_KEY_MAP = {
  lat: "lat",
  lng: "lng",
  n: "n",
  z: "z",
  t: "t",
  d: "d",
  b: "b",
  bl: "bl",
  sh: "sh",
  f: "f",
  dir: "dir",
  fov: "fov",
} as const;

/** Convert full AppState → URLSearchParams (omits default values). */
export function stateToSearchParams(state: AppState): URLSearchParams {
  const p = new URLSearchParams();

  if (state.location) {
    p.set(URL_KEY_MAP.lat, state.location.lat.toFixed(5));
    p.set(URL_KEY_MAP.lng, state.location.lng.toFixed(5));
    if (state.location.name) p.set(URL_KEY_MAP.n, state.location.name);
  }

  if (state.zoom !== DEFAULTS.zoom) p.set(URL_KEY_MAP.z, String(state.zoom));
  if (state.timeMinutes !== DEFAULTS.timeMinutes)
    p.set(URL_KEY_MAP.t, String(state.timeMinutes));
  if (state.dayOfYear !== DEFAULTS.dayOfYear)
    p.set(URL_KEY_MAP.d, String(state.dayOfYear));
  if (state.buildingsEnabled !== DEFAULTS.buildingsEnabled)
    p.set(URL_KEY_MAP.b, state.buildingsEnabled ? "1" : "0");
  if (state.blockageEnabled !== DEFAULTS.blockageEnabled)
    p.set(URL_KEY_MAP.bl, state.blockageEnabled ? "1" : "0");
  if (state.shadowsEnabled !== DEFAULTS.shadowsEnabled)
    p.set(URL_KEY_MAP.sh, state.shadowsEnabled ? "1" : "0");
  if (state.userFloor !== DEFAULTS.userFloor)
    p.set(URL_KEY_MAP.f, String(state.userFloor));
  if (state.pinDirection !== DEFAULTS.pinDirection)
    p.set(URL_KEY_MAP.dir, String(state.pinDirection));
  if (state.pinFov !== DEFAULTS.pinFov)
    p.set(URL_KEY_MAP.fov, String(state.pinFov));

  return p;
}

/** Parse URLSearchParams → partial AppState (validates types). */
export function searchParamsToState(
  params: URLSearchParams
): Partial<AppState> {
  const s: Partial<AppState> = {};

  const lat = parseFloat(params.get(URL_KEY_MAP.lat) ?? "");
  const lng = parseFloat(params.get(URL_KEY_MAP.lng) ?? "");
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    s.location = { lat, lng, name: params.get(URL_KEY_MAP.n) ?? undefined };
  }

  const z = parseFloat(params.get(URL_KEY_MAP.z) ?? "");
  if (Number.isFinite(z)) s.zoom = z;

  const t = parseInt(params.get(URL_KEY_MAP.t) ?? "", 10);
  if (Number.isFinite(t)) s.timeMinutes = t;

  const d = parseInt(params.get(URL_KEY_MAP.d) ?? "", 10);
  if (Number.isFinite(d)) s.dayOfYear = d;

  const b = params.get(URL_KEY_MAP.b);
  if (b === "0" || b === "1") s.buildingsEnabled = b === "1";

  const bl = params.get(URL_KEY_MAP.bl);
  if (bl === "0" || bl === "1") s.blockageEnabled = bl === "1";

  const sh = params.get(URL_KEY_MAP.sh);
  if (sh === "0" || sh === "1") s.shadowsEnabled = sh === "1";

  const f = parseInt(params.get(URL_KEY_MAP.f) ?? "", 10);
  if (Number.isFinite(f)) s.userFloor = f;

  const dir = parseInt(params.get(URL_KEY_MAP.dir) ?? "", 10);
  if (Number.isFinite(dir)) s.pinDirection = dir;

  const fov = parseInt(params.get(URL_KEY_MAP.fov) ?? "", 10);
  if (Number.isFinite(fov)) s.pinFov = fov;

  return s;
}

/** Push current state into the URL bar (replaceState — no back-button spam). */
export function syncUrlParams(state: AppState): void {
  const params = stateToSearchParams(state);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
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
