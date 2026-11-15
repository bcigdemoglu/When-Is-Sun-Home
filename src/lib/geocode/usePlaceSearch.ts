"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LatLng } from "@/lib/types";
import { searchPlaces, type PlaceSuggestion } from "./photon";
import { useDebouncedValue } from "./useDebouncedValue";

export const PLACE_SEARCH_MIN_LENGTH = 3;
export const PLACE_SEARCH_DEBOUNCE_MS = 250;
export const PLACE_SEARCH_STALE_TIME_MS = 5 * 60 * 1000;

export interface UsePlaceSearchResult {
  /** Empty while the query is too short. May lag behind the input (`isStale`). */
  suggestions: PlaceSuggestion[];
  /** "idle" below three characters; "loading" from the first keystroke of a new query. */
  status: "idle" | "loading" | "ready" | "error";
  error: Error | null;
  isFetching: boolean;
  /** True while `suggestions` belong to an earlier query (debouncing or loading). */
  isStale: boolean;
}

/**
 * Round the bias point to ~10 km. Close enough to rank nearby places first,
 * coarse enough that moving the pin does not refetch, and the exact pin is
 * never sent to the geocoder.
 */
function coarseBias(bias: LatLng | null | undefined): LatLng | undefined {
  if (!bias || !Number.isFinite(bias.lat) || !Number.isFinite(bias.lng)) return undefined;
  return { lat: Math.round(bias.lat * 10) / 10, lng: Math.round(bias.lng * 10) / 10 };
}

/** Search-as-you-type place suggestions for `query`, optionally preferring places near `bias`. */
export function usePlaceSearch(query: string, bias?: LatLng | null): UsePlaceSearchResult {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, PLACE_SEARCH_DEBOUNCE_MS);
  const enabled = debounced.length >= PLACE_SEARCH_MIN_LENGTH;
  const near = coarseBias(bias);

  const search = useQuery<PlaceSuggestion[], Error>({
    queryKey: ["place-search", debounced, near?.lat ?? null, near?.lng ?? null],
    queryFn: ({ signal }) => searchPlaces(debounced, { signal, bias: near }),
    enabled,
    staleTime: PLACE_SEARCH_STALE_TIME_MS,
    // One quick retry: a typed search should fail fast and visibly, not after
    // the default three attempts with backoff (~7 s of skeleton rows).
    retry: 1,
    retryDelay: 400,
    placeholderData: keepPreviousData,
  });

  // A cleared or too-short input shows nothing, not the previous results.
  const wanted = trimmed.length >= PLACE_SEARCH_MIN_LENGTH;
  // The input has moved on and the debounce has not caught up yet.
  const debouncing = wanted && debounced !== trimmed;
  const settled = wanted && enabled && !debouncing;

  let status: UsePlaceSearchResult["status"];
  if (!wanted) status = "idle";
  else if (settled && search.isError) status = "error";
  else if (settled && search.isSuccess && !search.isPlaceholderData) status = "ready";
  else status = "loading";

  return {
    suggestions: wanted && enabled && !search.isError ? (search.data ?? []) : [],
    status,
    error: status === "error" ? search.error : null,
    isFetching: wanted && search.isFetching,
    isStale: debouncing || (settled && search.isPlaceholderData),
  };
}
