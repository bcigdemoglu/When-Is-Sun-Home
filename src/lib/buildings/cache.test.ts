import "fake-indexeddb/auto";
import { createStore, keys, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BuildingCollection } from "@/lib/types";
import {
  BUILDING_CACHE_DB,
  BUILDING_CACHE_MAX_AREAS,
  BUILDING_CACHE_STORE,
  BUILDING_CACHE_TTL_MS,
  FALLBACK_CACHE_TTL_MS,
  clearBuildingCache,
  deleteCachedBuildings,
  getCachedBuildings,
  getCachedBuildingsEntry,
  pruneBuildingCache,
  setCachedBuildings,
} from "./cache";

function collection(id: string, featureCount = 1): BuildingCollection {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: featureCount }, (_, i) => ({
      type: "Feature",
      properties: {
        id: `${id}/${i}`,
        heightM: 7,
        heightSource: "default",
        levels: null,
        kind: "yes",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    })),
  };
}

/** A second handle on the same object store, to look at what is really stored. */
const rawStore = createStore(BUILDING_CACHE_DB, BUILDING_CACHE_STORE);
const storedKeys = async () => (await keys<string>(rawStore)).sort();

const T0 = Date.UTC(2026, 0, 1);
let now = T0;

beforeEach(async () => {
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  await clearBuildingCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("building cache", () => {
  test("a miss is null", async () => {
    expect(await getCachedBuildings("v1:1.001:2.0010")).toBeNull();
  });

  test("round-trips a collection", async () => {
    const data = collection("a", 3);
    await setCachedBuildings("v1:a", data);
    const cached = await getCachedBuildings("v1:a");
    expect(cached).toEqual(data);
    expect(cached).not.toBe(data);
  });

  test("each area is its own pair of entries, never one blob", async () => {
    await setCachedBuildings("v1:a", collection("a"));
    await setCachedBuildings("v1:b", collection("b"));
    await setCachedBuildings("v1:c", collection("c"));
    expect(await storedKeys()).toEqual([
      "data:v1:a",
      "data:v1:b",
      "data:v1:c",
      "meta:v1:a",
      "meta:v1:b",
      "meta:v1:c",
    ]);
    expect((await getCachedBuildings("v1:b"))?.features[0].properties.id).toBe("b/0");
  });

  test("writing again replaces the data and renews the timestamp", async () => {
    await setCachedBuildings("v1:a", collection("old"));
    now = T0 + BUILDING_CACHE_TTL_MS - 1000;
    await setCachedBuildings("v1:a", collection("new"));
    now = T0 + BUILDING_CACHE_TTL_MS + 1000;
    expect((await getCachedBuildings("v1:a"))?.features[0].properties.id).toBe("new/0");
    expect(await storedKeys()).toHaveLength(2);
  });

  test("entries expire after 14 days and are removed when found stale", async () => {
    expect(BUILDING_CACHE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    await setCachedBuildings("v1:a", collection("a"));

    now = T0 + BUILDING_CACHE_TTL_MS - 1;
    expect(await getCachedBuildings("v1:a")).not.toBeNull();

    now = T0 + BUILDING_CACHE_TTL_MS;
    expect(await getCachedBuildings("v1:a")).toBeNull();
    expect(await storedKeys()).toEqual([]);
  });

  test("an entry from the future (clock changed) is not trusted", async () => {
    await setCachedBuildings("v1:a", collection("a"));
    now = T0 - 60_000;
    expect(await getCachedBuildings("v1:a")).toBeNull();
  });

  test("keeps at most 20 areas, evicting the oldest", async () => {
    expect(BUILDING_CACHE_MAX_AREAS).toBe(20);
    for (let i = 0; i < 25; i++) {
      now = T0 + i * 1000;
      await setCachedBuildings(`v1:${i}`, collection(String(i)));
    }
    expect(await storedKeys()).toHaveLength(40);
    for (let i = 0; i < 5; i++) expect(await getCachedBuildings(`v1:${i}`)).toBeNull();
    for (let i = 5; i < 25; i++) expect(await getCachedBuildings(`v1:${i}`)).not.toBeNull();
  });

  test("eviction goes by save time, not by key or insertion order", async () => {
    for (let i = 0; i < BUILDING_CACHE_MAX_AREAS; i++) {
      now = T0 + (i + 10) * 1000;
      await setCachedBuildings(`v1:${i}`, collection(String(i)));
    }
    // Re-saving the oldest makes it the newest; the next write evicts area 1 instead.
    now = T0 + 100_000;
    await setCachedBuildings("v1:0", collection("0"));
    now = T0 + 101_000;
    await setCachedBuildings("v1:extra", collection("extra"));

    expect(await getCachedBuildings("v1:0")).not.toBeNull();
    expect(await getCachedBuildings("v1:1")).toBeNull();
    expect(await getCachedBuildings("v1:2")).not.toBeNull();
    expect(await getCachedBuildings("v1:extra")).not.toBeNull();
  });

  test("pruning removes expired areas, orphans and foreign keys", async () => {
    await setCachedBuildings("v1:old", collection("old"));
    await set("data:v1:orphan", collection("orphan"), rawStore);
    await set("meta:v1:dangling", T0, rawStore);
    await set("something-else", 1, rawStore);

    now = T0 + BUILDING_CACHE_TTL_MS + 1;
    await setCachedBuildings("v1:new", collection("new"));
    expect(await storedKeys()).toEqual(["data:v1:new", "meta:v1:new"]);
  });

  test("corrupt entries read as a miss and are cleaned up", async () => {
    await set("meta:v1:a", T0, rawStore);
    await set("data:v1:a", { type: "Nonsense" }, rawStore);
    expect(await getCachedBuildings("v1:a")).toBeNull();
    expect(await storedKeys()).toEqual([]);

    await set("meta:v1:b", "yesterday", rawStore);
    await set("data:v1:b", collection("b"), rawStore);
    expect(await getCachedBuildings("v1:b")).toBeNull();
  });

  test("remembers where the data came from", async () => {
    await setCachedBuildings("v1:a", collection("a"), "tiles");
    await setCachedBuildings("v1:b", collection("b"), "overpass");
    await setCachedBuildings("v1:c", collection("c"));
    expect(await getCachedBuildingsEntry("v1:a")).toEqual({
      data: collection("a"),
      source: "tiles",
      savedAt: T0,
    });
    expect((await getCachedBuildingsEntry("v1:b"))?.source).toBe("overpass");
    expect((await getCachedBuildingsEntry("v1:c"))?.source).toBeNull();
    expect(await getCachedBuildingsEntry("v1:missing")).toBeNull();
  });

  test("data from a fallback source is kept for a day, from the tiles for two weeks", async () => {
    expect(FALLBACK_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    await setCachedBuildings("v1:tiles", collection("t"), "tiles");
    await setCachedBuildings("v1:api", collection("a"), "api");
    await setCachedBuildings("v1:overpass", collection("o"), "overpass");

    now = T0 + FALLBACK_CACHE_TTL_MS - 1;
    expect(await getCachedBuildings("v1:api")).not.toBeNull();
    expect(await getCachedBuildings("v1:overpass")).not.toBeNull();

    now = T0 + FALLBACK_CACHE_TTL_MS;
    expect(await getCachedBuildings("v1:api")).toBeNull();
    expect(await getCachedBuildings("v1:overpass")).toBeNull();
    expect(await getCachedBuildings("v1:tiles")).not.toBeNull();
    expect(await storedKeys()).toEqual(["data:v1:tiles", "meta:v1:tiles"]);

    now = T0 + BUILDING_CACHE_TTL_MS;
    expect(await getCachedBuildings("v1:tiles")).toBeNull();
  });

  test("pruning drops fallback data that has had its day", async () => {
    await setCachedBuildings("v1:api", collection("a"), "api");
    now = T0 + FALLBACK_CACHE_TTL_MS + 1;
    await setCachedBuildings("v1:tiles", collection("t"), "tiles");
    expect(await storedKeys()).toEqual(["data:v1:tiles", "meta:v1:tiles"]);
  });

  test("entries from before sources were recorded (a bare timestamp) still read", async () => {
    await set("meta:v1:old", T0, rawStore);
    await set("data:v1:old", collection("old"), rawStore);
    expect(await getCachedBuildingsEntry("v1:old")).toEqual({
      data: collection("old"),
      source: null,
      savedAt: T0,
    });
    await set("meta:v1:odd", { savedAt: T0, source: "carrier pigeon" }, rawStore);
    await set("data:v1:odd", collection("odd"), rawStore);
    expect((await getCachedBuildingsEntry("v1:odd"))?.source).toBeNull();
    await set("meta:v1:bad", { savedAt: "noon" }, rawStore);
    await set("data:v1:bad", collection("bad"), rawStore);
    expect(await getCachedBuildingsEntry("v1:bad")).toBeNull();
  });

  test("deleteCachedBuildings removes one area", async () => {
    await setCachedBuildings("v1:a", collection("a"));
    await setCachedBuildings("v1:b", collection("b"));
    await deleteCachedBuildings("v1:a");
    expect(await getCachedBuildings("v1:a")).toBeNull();
    expect(await getCachedBuildings("v1:b")).not.toBeNull();
  });

  test("clearBuildingCache removes everything", async () => {
    await setCachedBuildings("v1:a", collection("a"));
    await setCachedBuildings("v1:b", collection("b"));
    await clearBuildingCache();
    expect(await storedKeys()).toEqual([]);
    expect(await getCachedBuildings("v1:a")).toBeNull();
  });

  test("a large area survives the round trip", async () => {
    const data = collection("big", 3000);
    await setCachedBuildings("v1:big", data);
    expect((await getCachedBuildings("v1:big"))?.features).toHaveLength(3000);
  });
});

describe("building cache without a working IndexedDB", () => {
  /** A fresh copy of the module, so no database connection is already open. */
  async function freshCache() {
    vi.resetModules();
    return import("./cache");
  }

  async function expectHarmless(cache: Awaited<ReturnType<typeof freshCache>>) {
    await expect(cache.getCachedBuildings("v1:a")).resolves.toBeNull();
    await expect(cache.setCachedBuildings("v1:a", collection("a"))).resolves.toBeUndefined();
    await expect(cache.getCachedBuildings("v1:a")).resolves.toBeNull();
    await expect(cache.deleteCachedBuildings("v1:a")).resolves.toBeUndefined();
    await expect(cache.pruneBuildingCache()).resolves.toBeUndefined();
    await expect(cache.clearBuildingCache()).resolves.toBeUndefined();
  }

  test("importing the module does not touch IndexedDB", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    await freshCache();
    expect(open).not.toHaveBeenCalled();
  });

  test("no indexedDB global at all (server rendering)", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expectHarmless(await freshCache());
  });

  test("indexedDB.open throws (blocked storage)", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    await expectHarmless(await freshCache());
  });

  test("the open request fails asynchronously (private browsing)", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        const request: { error?: DOMException; onerror?: () => void } = {};
        queueMicrotask(() => {
          request.error = new DOMException(
            "A mutation operation was attempted",
            "InvalidStateError",
          );
          request.onerror?.();
        });
        return request;
      },
    });
    await expectHarmless(await freshCache());
  });

  test("a write that fails (quota) does not throw, and reads keep working", async () => {
    await setCachedBuildings("v1:a", collection("a"));
    // Functions cannot be structured-cloned, so this write is rejected by IndexedDB.
    const uncloneable = { ...collection("b"), oops: () => {} } as unknown as BuildingCollection;
    await expect(setCachedBuildings("v1:b", uncloneable)).resolves.toBeUndefined();
    expect(await getCachedBuildings("v1:b")).toBeNull();
    expect(await getCachedBuildings("v1:a")).not.toBeNull();
  });
});

test("pruneBuildingCache on an empty store is a no-op", async () => {
  await pruneBuildingCache();
  expect(await storedKeys()).toEqual([]);
});
