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
 * It is also safe when IndexedDB does not answer at all. Safari on iOS (and
 * the in-app browsers built on it) has left requests unanswered for good:
 * an `open` whose events never fire (WebKit bug 226547), operations cut
 * short when the system takes the database connection away from a page in
 * the background (bugs 197050, 273827). Every operation therefore has a time
 * limit, and while a request that ran out of time is still unanswered the
 * cache is skipped altogether (see `guarded`): a load is never held up by
 * its cache.
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

/**
 * How long a read may take before the caller goes on without the cache. A
 * healthy read takes a few milliseconds, tens for a large area on an old phone.
 */
export const BUILDING_CACHE_READ_TIMEOUT_MS = 1_500;
/** The same for writes and clean-up, which nobody waits for. */
export const BUILDING_CACHE_WRITE_TIMEOUT_MS = 10_000;

let store: UseStore | undefined;

function getStore(): UseStore {
  // Created lazily so importing this module never touches IndexedDB.
  store ??= createStore(BUILDING_CACHE_DB, BUILDING_CACHE_STORE);
  return store;
}

/** Operations that ran out of time and have still not been answered by IndexedDB. */
let unanswered = 0;

/**
 * Run one cache operation so that it can neither throw nor hang: resolves
 * to `fallback` when the operation fails, when it takes longer than
 * `timeoutMs`, and (without even starting it) while an earlier operation is
 * still unanswered. Requests queue up behind a connection that has stopped
 * answering, so there is no point in adding to them; once the stuck request
 * settles, the cache is used again.
 */
function guarded<T>(operation: () => Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  if (unanswered > 0) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      unanswered += 1;
      resolve(fallback);
    }, timeoutMs);
    const settle = (value: T) => {
      clearTimeout(timer);
      if (timedOut) unanswered -= 1;
      else resolve(value);
    };
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch {
      settle(fallback);
      return;
    }
    pending.then(settle, () => settle(fallback));
  });
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
export function getCachedBuildingsEntry(key: string): Promise<CachedBuildings | null> {
  return guarded<CachedBuildings | null>(
    async () => {
      const [rawMeta, data] = await getMany<unknown>(
        [META_PREFIX + key, DATA_PREFIX + key],
        getStore(),
      );
      if (rawMeta === undefined && data === undefined) return null;
      const meta = freshMeta(rawMeta, Date.now());
      if (meta && isBuildingCollection(data)) return { data, ...meta };
      await deleteCachedBuildings(key);
      return null;
    },
    null,
    BUILDING_CACHE_READ_TIMEOUT_MS,
  );
}

/** The cached buildings for an area, or null if absent, expired or unreadable. */
export async function getCachedBuildings(key: string): Promise<BuildingCollection | null> {
  return (await getCachedBuildingsEntry(key))?.data ?? null;
}

/**
 * Store the buildings for an area, with the source they came from, and evict
 * the oldest areas beyond the limit. Never throws.
 *
 * Caching is best effort: when the write is refused (the storage quota is
 * used up, which on iOS can be as little as a few areas in private browsing)
 * the area is simply not cached, and the clean-up still runs so that expired
 * areas give their room back for the next one.
 */
export async function setCachedBuildings(
  key: string,
  data: BuildingCollection,
  source: BuildingDataSource | null = null,
): Promise<void> {
  await guarded(
    async () => {
      const meta: Meta = { savedAt: Date.now(), source };
      // One transaction: an area is stored whole or not at all.
      await setMany(
        [
          [DATA_PREFIX + key, data],
          [META_PREFIX + key, meta],
        ],
        getStore(),
      );
    },
    undefined,
    BUILDING_CACHE_WRITE_TIMEOUT_MS,
  );
  await pruneBuildingCache();
}

/** Remove one area. Never throws. */
export function deleteCachedBuildings(key: string): Promise<void> {
  return guarded(
    () => delMany([META_PREFIX + key, DATA_PREFIX + key], getStore()),
    undefined,
    BUILDING_CACHE_WRITE_TIMEOUT_MS,
  );
}

/** Remove every cached area. Never throws. */
export function clearBuildingCache(): Promise<void> {
  return guarded(() => clear(getStore()), undefined, BUILDING_CACHE_WRITE_TIMEOUT_MS);
}

/**
 * Drop expired areas, half-written areas, and the oldest areas beyond
 * `BUILDING_CACHE_MAX_AREAS`. Runs after every write. Never throws.
 */
export function pruneBuildingCache(): Promise<void> {
  return guarded(pruneNow, undefined, BUILDING_CACHE_WRITE_TIMEOUT_MS);
}

async function pruneNow(): Promise<void> {
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
}
