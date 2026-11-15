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
import { BuildingsApiError, fetchBuildingsFromApi } from "./api";
import { getCachedBuildings, setCachedBuildings } from "./cache";
import { OverpassError, fetchBuildings, isAbortError } from "./overpass";
import { areAreasAdjacent, fetchAreaFor, type FetchArea } from "./tiles";

export const BUILDINGS_GC_TIME_MS = 30 * 60 * 1000;

export type BuildingsStatus = "idle" | "loading" | "ready" | "error";

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
   * Set when the last fetch failed. Can accompany "ready" after a failed
   * `refetch()`. Usually an `OverpassError`; a `BuildingsApiError` (an
   * `Error`) when only the API route could be tried.
   */
  error: OverpassError | Error | null;
  isFetching: boolean;
  /** True while `buildings` is the neighbouring area's data. */
  isPlaceholder: boolean;
  /** Fetch again, bypassing every cache: straight from Overpass if at all possible. */
  refetch(): void;
  /** Counts for `buildings`, or null when there are none to count. */
  stats: BuildingStats | null;
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

/** The app's own API route: one same-origin request, usually answered by the CDN. */
function viaApi(area: FetchArea, signal: AbortSignal, reload: boolean) {
  return fetchBuildingsFromApi(area.key, { signal, reload });
}

/** Straight from the browser to the public Overpass servers. */
function viaOverpass(area: FetchArea, signal: AbortSignal) {
  return fetchBuildings(area.center, area.radiusM, { signal });
}

/** A request the server refused as invalid; asking again or elsewhere cannot help. */
function isBadRequest(error: unknown): boolean {
  return error instanceof BuildingsApiError && error.kind === "bad-request";
}

/**
 * Fetch an area from the network, trying a second route when the first fails.
 *
 * Normally the API route goes first (fast, shared CDN cache) and the direct
 * Overpass path is the fallback. A refresh the user asked for goes the other
 * way round: the CDN may hold a copy that is days old, and only Overpass
 * itself has their latest edits.
 *
 * An abort is never followed by a second attempt, and neither is a 400 from
 * the API. When both routes fail the Overpass error is the one reported: it
 * says what is actually wrong (rate limit, timeout, …).
 */
async function fetchFromNetwork(
  area: FetchArea,
  signal: AbortSignal,
  fresh: boolean,
): Promise<BuildingCollection> {
  const attempts = fresh
    ? [() => viaOverpass(area, signal), () => viaApi(area, signal, true)]
    : [() => viaApi(area, signal, false), () => viaOverpass(area, signal)];

  let firstError: unknown;
  try {
    return await attempts[0]();
  } catch (error) {
    if (signal.aborted || isAbortError(error) || isBadRequest(error)) throw error;
    firstError = error;
  }
  try {
    return await attempts[1]();
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    throw [firstError, error].find((e) => e instanceof OverpassError) ?? error;
  }
}

/**
 * IndexedDB cache → API route → direct Overpass. Whatever the network
 * returned is written back to the cache.
 */
async function loadBuildings(area: FetchArea, signal: AbortSignal): Promise<BuildingCollection> {
  const fresh = forcedRefresh.has(area.key);
  if (!fresh) {
    const cached = await getCachedBuildings(area.key);
    if (cached) return cached;
  }
  const buildings = await fetchFromNetwork(area, signal, fresh);
  forcedRefresh.delete(area.key);
  void setCachedBuildings(area.key, buildings);
  return buildings;
}

/**
 * One more round is plenty: each round has already tried the API route and
 * every Overpass endpoint. Never after an abort, a refused request, or a
 * timeout (the user has waited long enough by then).
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || isAbortError(error) || isBadRequest(error)) return false;
  return !(error instanceof OverpassError && error.kind === "timeout");
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
    queryFn: area ? ({ signal }) => loadBuildings(area, signal) : skipToken,
    // OSM buildings change slowly; freshness is the cache's job (14 days).
    staleTime: Infinity,
    gcTime: BUILDINGS_GC_TIME_MS,
    retry: shouldRetry,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
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

  return {
    buildings,
    status,
    error: hasPlace ? query.error : null,
    isFetching: query.isFetching,
    isPlaceholder: hasPlace && query.isPlaceholderData,
    refetch,
    stats,
  };
}
