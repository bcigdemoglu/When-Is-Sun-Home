/**
 * IndexedDB cache for fetched building areas.
 *
 * Each area is stored as two small-keyed entries in its own object store:
 *
 *   "data:<areaKey>"  the BuildingCollection (structured clone, no JSON)
 *   "meta:<areaKey>"  { savedAt, source }: when it was saved and where the
 *                     data came from (older entries: just the time, a number)
 *
 * Keeping the metadata apart means expiry and pruning never have to load the
 * footprints themselves.
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
/**
 * Data from a fallback source is kept for a day only. The primary source
 * (vector tiles) should supply the numbers again as soon as it is back, so
 * that results do not differ between visits for longer than necessary.
 */
export const FALLBACK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Where a set of buildings was fetched from. */
export type BuildingDataSource = "tiles" | "api" | "overpass";
const PRIMARY_SOURCE: BuildingDataSource = "tiles";

export interface CachedBuildings {
  data: BuildingCollection;
  /** Null for entries written before sources were recorded. */
  source: BuildingDataSource | null;
  savedAt: number;
}
/**
 * An area from the tiles is 1–3 MB of footprints in a dense city, so this
 * many areas can come to some 50 MB of storage.
 */
export const BUILDING_CACHE_MAX_AREAS = 20;

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

interface Meta {
  savedAt: number;
  source: BuildingDataSource | null;
}

function readMeta(value: unknown): Meta | null {
  if (typeof value === "number") return { savedAt: value, source: null };
  if (typeof value !== "object" || value === null) return null;
  const { savedAt, source } = value as { savedAt?: unknown; source?: unknown };
  if (typeof savedAt !== "number") return null;
  const known = source === "tiles" || source === "api" || source === "overpass";
  return { savedAt, source: known ? source : null };
}

/** The entry's metadata if it is still within its time to live, else null. */
function freshMeta(value: unknown, now: number): Meta | null {
  const meta = readMeta(value);
  if (!meta) return null;
  const ttl =
    meta.source === null || meta.source === PRIMARY_SOURCE
      ? BUILDING_CACHE_TTL_MS
      : FALLBACK_CACHE_TTL_MS;
  return meta.savedAt <= now && now - meta.savedAt < ttl ? meta : null;
}

/** The cached entry for an area, or null if absent, expired or unreadable. */
export async function getCachedBuildingsEntry(key: string): Promise<CachedBuildings | null> {
  try {
    const [rawMeta, data] = await getMany<unknown>(
      [META_PREFIX + key, DATA_PREFIX + key],
      getStore(),
    );
    if (rawMeta === undefined && data === undefined) return null;
    const meta = freshMeta(rawMeta, Date.now());
    if (meta && isBuildingCollection(data)) return { data, ...meta };
    await deleteCachedBuildings(key);
    return null;
  } catch {
    return null;
  }
}

/** The cached buildings for an area, or null if absent, expired or unreadable. */
export async function getCachedBuildings(key: string): Promise<BuildingCollection | null> {
  return (await getCachedBuildingsEntry(key))?.data ?? null;
}

/**
 * Store the buildings for an area, with the source they came from, and evict
 * the oldest areas beyond the limit. Never throws.
 */
export async function setCachedBuildings(
  key: string,
  data: BuildingCollection,
  source: BuildingDataSource | null = null,
): Promise<void> {
  try {
    const meta: Meta = { savedAt: Date.now(), source };
    await setMany(
      [
        [DATA_PREFIX + key, data],
        [META_PREFIX + key, meta],
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
    const metas = await getMany<unknown>(metaKeys, getStore());
    const now = Date.now();

    const fresh: { areaKey: string; savedAt: number }[] = [];
    for (let i = 0; i < metaKeys.length; i++) {
      const meta = freshMeta(metas[i], now);
      if (meta) {
        fresh.push({ areaKey: metaKeys[i].slice(META_PREFIX.length), savedAt: meta.savedAt });
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
