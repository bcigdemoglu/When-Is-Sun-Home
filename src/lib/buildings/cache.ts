/**
 * IndexedDB cache for fetched building areas.
 *
 * Each area is stored as two small-keyed entries in its own object store:
 *
 *   "data:<areaKey>"  the BuildingCollection (structured clone, no JSON)
 *   "meta:<areaKey>"  the time it was saved (a number)
 *
 * Keeping the timestamps apart means expiry and pruning never have to load
 * the footprints themselves.
 *
 * Every function here is safe to call when IndexedDB is missing or broken
 * (server rendering, private browsing, quota exceeded): reads resolve to
 * null and writes become no-ops.
 *
 * Note: idb-keyval can hold only ONE object store per database, so nothing
 * else may call `createStore("sun-home", <other name>)`.
 */
import { clear, createStore, delMany, getMany, keys, setMany, type UseStore } from "idb-keyval";
import type { BuildingCollection } from "@/lib/types";

export const BUILDING_CACHE_DB = "sun-home";
export const BUILDING_CACHE_STORE = "buildings";
export const BUILDING_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const BUILDING_CACHE_MAX_AREAS = 40;

const DATA_PREFIX = "data:";
const META_PREFIX = "meta:";

let store: UseStore | undefined;

function getStore(): UseStore {
  // Created lazily so importing this module never touches IndexedDB.
  store ??= createStore(BUILDING_CACHE_DB, BUILDING_CACHE_STORE);
  return store;
}

function isBuildingCollection(value: unknown): value is BuildingCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((value as { features?: unknown }).features)
  );
}

function isFresh(savedAt: unknown, now: number): savedAt is number {
  return typeof savedAt === "number" && savedAt <= now && now - savedAt < BUILDING_CACHE_TTL_MS;
}

/** The cached buildings for an area, or null if absent, expired or unreadable. */
export async function getCachedBuildings(key: string): Promise<BuildingCollection | null> {
  try {
    const [savedAt, data] = await getMany<unknown>(
      [META_PREFIX + key, DATA_PREFIX + key],
      getStore(),
    );
    if (savedAt === undefined && data === undefined) return null;
    if (isFresh(savedAt, Date.now()) && isBuildingCollection(data)) return data;
    await deleteCachedBuildings(key);
    return null;
  } catch {
    return null;
  }
}

/** Store the buildings for an area and evict the oldest areas beyond the limit. Never throws. */
export async function setCachedBuildings(key: string, data: BuildingCollection): Promise<void> {
  try {
    await setMany(
      [
        [DATA_PREFIX + key, data],
        [META_PREFIX + key, Date.now()],
      ],
      getStore(),
    );
    await pruneBuildingCache();
  } catch {
    // Caching is best effort.
  }
}

/** Remove one area. Never throws. */
export async function deleteCachedBuildings(key: string): Promise<void> {
  try {
    await delMany([META_PREFIX + key, DATA_PREFIX + key], getStore());
  } catch {
    // Best effort.
  }
}

/** Remove every cached area. Never throws. */
export async function clearBuildingCache(): Promise<void> {
  try {
    await clear(getStore());
  } catch {
    // Best effort.
  }
}

/**
 * Drop expired areas, half-written areas, and the oldest areas beyond
 * `BUILDING_CACHE_MAX_AREAS`. Runs after every write. Never throws.
 */
export async function pruneBuildingCache(): Promise<void> {
  try {
    const allKeys = (await keys<IDBValidKey>(getStore())).filter(
      (key): key is string => typeof key === "string",
    );
    const metaKeys = allKeys.filter((key) => key.startsWith(META_PREFIX));
    const savedAts = await getMany<unknown>(metaKeys, getStore());
    const now = Date.now();

    const fresh: { areaKey: string; savedAt: number }[] = [];
    for (let i = 0; i < metaKeys.length; i++) {
      const savedAt = savedAts[i];
      if (isFresh(savedAt, now)) {
        fresh.push({ areaKey: metaKeys[i].slice(META_PREFIX.length), savedAt });
      }
    }
    fresh.sort((a, b) => b.savedAt - a.savedAt);
    const keep = new Set(fresh.slice(0, BUILDING_CACHE_MAX_AREAS).map((entry) => entry.areaKey));

    const doomed = allKeys.filter((key) => {
      if (key.startsWith(META_PREFIX)) return !keep.has(key.slice(META_PREFIX.length));
      if (key.startsWith(DATA_PREFIX)) return !keep.has(key.slice(DATA_PREFIX.length));
      return true;
    });
    if (doomed.length > 0) await delMany(doomed, getStore());
  } catch {
    // Best effort.
  }
}
