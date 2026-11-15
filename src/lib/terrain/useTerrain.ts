"use client";

/**
 * React Query binding for the terrain around the pinned place.
 *
 * Keyed by the snapped tile coverage (see `tiles.ts`), not by the pin, so
 * moving the pin within the same block of tiles costs nothing. The tiles are
 * static files; the browser's HTTP cache is all the persistence they need.
 *
 * Terrain is an enhancement: when it cannot be loaded the status is "error"
 * and the app carries on with flat ground.
 */
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import type { LatLng, Terrain } from "@/lib/types";
import { loadTerrainForCoverage } from "./loadTerrain";
import { terrainCoverageFor, type TerrainCoverage } from "./tiles";

export const TERRAIN_GC_TIME_MS = 30 * 60 * 1000;

export type TerrainStatus = "idle" | "loading" | "ready" | "error";

export interface UseTerrainResult {
  /** The terrain for the current place; null unless `status` is "ready". */
  terrain: Terrain | null;
  status: TerrainStatus;
  error: Error | null;
}

function coverageFor(place: LatLng | null): TerrainCoverage | null {
  if (!place) return null;
  return terrainCoverageFor(place);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function terrainQueryKey(coverage: TerrainCoverage | null) {
  return ["terrain", coverage ? coverage.key : "none"] as const;
}

export function terrainQueryOptions(place: LatLng | null) {
  const coverage = coverageFor(place);
  const queryKey = terrainQueryKey(coverage);
  return queryOptions<Terrain, Error, Terrain, typeof queryKey>({
    queryKey,
    queryFn: coverage ? ({ signal }) => loadTerrainForCoverage(coverage, { signal }) : skipToken,
    // The ground does not change.
    staleTime: Infinity,
    gcTime: TERRAIN_GC_TIME_MS,
    retry: (failureCount, error) => failureCount < 1 && !isAbortError(error),
    retryDelay: 1000,
  });
}

/**
 * The ground elevation around `place`, or `null` while it is loading, when
 * there is no place, or when it could not be loaded ("error" — not fatal).
 * Places near the poles have no terrain data and stay "idle".
 */
export function useTerrain(place: LatLng | null): UseTerrainResult {
  const options = terrainQueryOptions(place);
  const hasCoverage = options.queryKey[1] !== "none";
  const query = useQuery(options);

  let status: TerrainStatus;
  if (!hasCoverage) status = "idle";
  else if (query.data !== undefined) status = "ready";
  else if (query.isError) status = "error";
  else status = "loading";

  return {
    terrain: status === "ready" ? (query.data ?? null) : null,
    status,
    error: hasCoverage ? query.error : null,
  };
}
