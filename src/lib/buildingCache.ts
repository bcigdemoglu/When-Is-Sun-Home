import type { BuildingGeoJSON } from "./overpass";

const CACHE_KEY = "sun-building-cache";
const TTL_MS = 3_600_000; // 1 hour
const MAX_ENTRIES = 50;

interface CacheEntry {
  timestamp: number;
  data: BuildingGeoJSON;
}

type CacheStore = Record<string, CacheEntry>;

/** Round coords to `decimals` decimal places and return a cache key */
export function makeBuildingCacheKey(
  lat: number,
  lng: number,
  decimals = 3
): string {
  const factor = 10 ** decimals;
  const rLat = Math.round(lat * factor) / factor;
  const rLng = Math.round(lng * factor) / factor;
  return `${rLat},${rLng}`;
}

function readStore(): CacheStore {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: CacheStore): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Load cached buildings if present and not expired */
export function loadCachedBuildings(key: string): BuildingGeoJSON | null {
  const store = readStore();
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) return null;
  return entry.data;
}

/** Remove expired entries and enforce max entry count (evict oldest first) */
export function pruneExpiredEntries(): void {
  const store = readStore();
  const now = Date.now();
  const keys = Object.keys(store);

  // Remove expired
  for (const k of keys) {
    if (now - store[k].timestamp > TTL_MS) {
      delete store[k];
    }
  }

  // Evict oldest if over limit
  const remaining = Object.entries(store);
  if (remaining.length > MAX_ENTRIES) {
    remaining.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toEvict = remaining.length - MAX_ENTRIES;
    for (let i = 0; i < toEvict; i++) {
      delete store[remaining[i][0]];
    }
  }

  writeStore(store);
}

/** Save buildings to localStorage cache */
export function saveBuildingsToCache(
  key: string,
  data: BuildingGeoJSON
): void {
  pruneExpiredEntries();
  const store = readStore();
  store[key] = { timestamp: Date.now(), data };
  writeStore(store);
}
