"use client";

/**
 * React Query bindings for the buildings around the pinned place.
 *
 * The query is keyed by the pin's fetch area (see `tiles.ts`), not by the pin
 * itself, so moving the pin inside one grid cell costs nothing.
 */
import { keepPreviousData, queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { BuildingCollection, LatLng } from "@/lib/types";
import { loadBuildings, type BuildingDataSource, type LoadedBuildings } from "./loader";
import type { OverpassError } from "./overpass";
import { areAreasAdjacent, fetchAreaFor, type FetchArea } from "./tiles";

export const BUILDINGS_GC_TIME_MS = 30 * 60 * 1000;

export type BuildingsStatus = "idle" | "loading" | "ready" | "error";
export type BuildingsSource = BuildingDataSource | "cache";
export type { BuildingDataSource } from "./loader";

export interface BuildingStats {
  total: number;
  /** Buildings by where their height came from. */
  tagged: number;
  levels: number;
  default: number;
}

export interface UseBuildingsResult {
  /**
   * Buildings to show. While `status` is "loading" this may be the previous,
   * neighbouring area's data (`isPlaceholder`), which does NOT fully cover
   * the new pin: fine for drawing the map, not for computing sun hours.
   */
  buildings: BuildingCollection | null;
  /** "ready" only when `buildings` is the real data for the current place. */
  status: BuildingsStatus;
  /**
   * Set when the last fetch failed: a `BuildingsUnavailableError` listing
   * what every source answered. Can accompany "ready" after a failed
   * `refetch()`.
   */
  error: OverpassError | Error | null;
  isFetching: boolean;
  /** True while `buildings` is the neighbouring area's data. */
  isPlaceholder: boolean;
  /** Load again from the network (tiles first), bypassing the saved copy. */
  refetch(): void;
  /** Counts for `buildings`, or null when there are none to count. */
  stats: BuildingStats | null;
  /**
   * Where the current buildings were read from, or null unless `status` is
   * "ready". "cache" is the copy saved in this browser; `originalSource`
   * then says where that copy came from. (Optional so that hand-built
   * results elsewhere keep compiling; the hook always sets all three.)
   */
  source?: BuildingsSource | null;
  /** The network source the data originally came from; null if unknown. */
  originalSource?: BuildingDataSource | null;
  /** `source` in words, e.g. "OpenFreeMap vector tiles (saved copy)". */
  sourceLabel?: string | null;
}

function areaFor(place: LatLng | null): FetchArea | null {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  return fetchAreaFor(place);
}

/**
 * Areas the user asked to refresh. They skip the cache until a network fetch
 * succeeds; the cached copy is kept in the meantime in case it does not.
 */
const forcedRefresh = new Set<string>();

/**
 * Where the data of each area was last loaded from. Kept beside the query
 * cache (whose data stays a plain `BuildingCollection`).
 */
const loadedFrom = new Map<string, Pick<LoadedBuildings, "source" | "origin">>();

async function queryBuildings(area: FetchArea, signal: AbortSignal): Promise<BuildingCollection> {
  const { buildings, source, origin } = await loadBuildings(area, {
    signal,
    fresh: forcedRefresh.has(area.key),
  });
  forcedRefresh.delete(area.key);
  loadedFrom.set(area.key, { source, origin });
  return buildings;
}

const SOURCE_NAMES: Record<BuildingDataSource, string> = {
  tiles: "OpenFreeMap vector tiles",
  api: "OpenStreetMap via Overpass (server)",
  overpass: "OpenStreetMap via Overpass",
};

/** A short, human-readable name for where a set of buildings came from. */
export function buildingSourceLabel(
  source: BuildingsSource,
  origin: BuildingDataSource | null,
): string {
  if (source !== "cache") return SOURCE_NAMES[source];
  return origin ? `${SOURCE_NAMES[origin]} (saved copy)` : "Saved copy";
}

export function buildingsQueryKey(area: FetchArea | null) {
  return ["buildings", area ? area.key : "none"] as const;
}

export function buildingsQueryOptions(place: LatLng | null) {
  const area = areaFor(place);
  const queryKey = buildingsQueryKey(area);
  return queryOptions<
    BuildingCollection,
    OverpassError | Error,
    BuildingCollection,
    typeof queryKey
  >({
    queryKey,
    queryFn: area ? ({ signal }) => queryBuildings(area, signal) : skipToken,
    // OSM buildings change slowly; freshness is the cache's job (14 days).
    staleTime: Infinity,
    gcTime: BUILDINGS_GC_TIME_MS,
    // No retry here: one load already goes through every source (with a
    // retry per tile), inside a fixed time budget. A second round would only
    // double the wait before the error shows.
    retry: false,
    // Keep showing the previous buildings while the next cell loads, but
    // only if that cell is a neighbour. After a jump to another part of
    // town (or the world) the old buildings would be plainly wrong.
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey[1];
      return area && previousKey && areAreasAdjacent(previousKey, area.key)
        ? keepPreviousData(previousData)
        : undefined;
    },
  });
}

export function buildingStats(buildings: BuildingCollection): BuildingStats {
  const stats: BuildingStats = {
    total: buildings.features.length,
    tagged: 0,
    levels: 0,
    default: 0,
  };
  for (const feature of buildings.features) stats[feature.properties.heightSource]++;
  return stats;
}

export function useBuildings(place: LatLng | null): UseBuildingsResult {
  const options = buildingsQueryOptions(place);
  const areaKey = options.queryKey[1];
  const hasPlace = areaKey !== "none";
  const query = useQuery(options);
  const queryRefetch = query.refetch;

  const refetch = useCallback(() => {
    if (!hasPlace) return;
    forcedRefresh.add(areaKey);
    void queryRefetch();
  }, [hasPlace, areaKey, queryRefetch]);

  // A failed refresh keeps the data it was meant to replace, so "ready" wins
  // over "error" whenever real data for this area is in hand.
  let status: BuildingsStatus;
  if (!hasPlace) status = "idle";
  else if (query.data !== undefined && !query.isPlaceholderData) status = "ready";
  else if (query.isError) status = "error";
  else status = "loading";

  const buildings = status === "idle" || status === "error" ? null : (query.data ?? null);
  const stats = useMemo(() => (buildings ? buildingStats(buildings) : null), [buildings]);

  // `loadedFrom` is written by the query function, so read it again whenever
  // the query has produced data.
  const { dataUpdatedAt } = query;
  const loaded = useMemo(
    () => (status === "ready" && dataUpdatedAt > 0 ? (loadedFrom.get(areaKey) ?? null) : null),
    [status, dataUpdatedAt, areaKey],
  );

  return {
    source: loaded ? loaded.source : null,
    originalSource: loaded ? loaded.origin : null,
    sourceLabel: loaded ? buildingSourceLabel(loaded.source, loaded.origin) : null,
    buildings,
    status,
    error: hasPlace ? query.error : null,
    isFetching: query.isFetching,
    isPlaceholder: hasPlace && query.isPlaceholderData,
    refetch,
    stats,
  };
}
