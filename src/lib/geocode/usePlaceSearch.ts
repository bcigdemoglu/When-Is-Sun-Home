"use client";

import { CancelledError, keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LatLng } from "@/lib/types";
import { GeocoderTimeoutError, isAbortError } from "./net";
import { NOMINATIM_ENABLED, searchPlacesNominatim } from "./nominatim";
import { parseCoordinates, searchPlaces, type PlaceSuggestion } from "./photon";
import {
  failedInBackground,
  getPhotonHealth,
  probePhotonIfDue,
  reportPhotonFailure,
  reportPhotonSuccess,
  subscribePhotonHealth,
  type PhotonHealth,
} from "./photonHealth";
import { useDebouncedValue } from "./useDebouncedValue";

export const PLACE_SEARCH_MIN_LENGTH = 3;
export const PLACE_SEARCH_DEBOUNCE_MS = 250;
export const PLACE_SEARCH_STALE_TIME_MS = 5 * 60 * 1000;

export interface UsePlaceSearchResult {
  /** Empty while the query is too short. May lag behind the input (`isStale`). */
  suggestions: PlaceSuggestion[];
  /**
   * "idle" below three characters — and, in submit mode, until the typed text
   * has been submitted; "loading" from the first keystroke of a new query
   * (live) or from the submit.
   */
  status: "idle" | "loading" | "ready" | "error";
  error: Error | null;
  isFetching: boolean;
  /** True while `suggestions` belong to an earlier query (debouncing or loading). */
  isStale: boolean;
  /**
   * - "live": suggestions arrive as the user types (Photon).
   * - "submit": Photon cannot be reached. Nothing is requested per keystroke;
   *   `submit()` runs one search for the typed text on the second service.
   */
  mode: "live" | "submit";
  /** Submit mode, and the text in the field has not been searched for yet. */
  awaitingSubmit: boolean;
  /** Search for the typed text now (submit mode; a no-op in live mode and below three characters). */
  submit: () => void;
  /** Run the failed search again. */
  retry: () => void;
}

/**
 * Round the bias point to ~10 km. Close enough to rank nearby places first,
 * coarse enough that moving the pin does not refetch, and a search never
 * tells the geocoder where the pin is. (Reverse geocoding, which has to know
 * the place, sends it rounded to about 11 m; see `reverseGeocode`.)
 */
function coarseBias(bias: LatLng | null | undefined): LatLng | undefined {
  if (!bias || !Number.isFinite(bias.lat) || !Number.isFinite(bias.lng)) return undefined;
  return { lat: Math.round(bias.lat * 10) / 10, lng: Math.round(bias.lng * 10) / 10 };
}

const getServerHealth = (): PhotonHealth => "up";

/** How often a request cut off by the page going to the background is sent again. */
const BACKGROUND_RETRIES = 3;

function isCancellation(error: Error): boolean {
  // Not failures of the service: the request was simply no longer wanted.
  return error instanceof CancelledError || isAbortError(error);
}

/**
 * Place suggestions for `query`, optionally preferring places near `bias`.
 *
 * Normally search-as-you-type, from Photon. When Photon fails it is left
 * alone for a minute and the hook switches to submit mode: the caller shows a
 * "Search" action and `submit()` asks Nominatim — once per submitted text,
 * never per keystroke (its usage policy forbids autocomplete). After the
 * cool-down the next keystroke probes Photon again; if it answers, live
 * suggestions are back without a word.
 */
export function usePlaceSearch(query: string, bias?: LatLng | null): UsePlaceSearchResult {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, PLACE_SEARCH_DEBOUNCE_MS);
  const near = coarseBias(bias);
  const health = useSyncExternalStore(subscribePhotonHealth, getPhotonHealth, getServerHealth);
  /** The text last submitted in submit mode. */
  const [submitted, setSubmitted] = useState<string | null>(null);

  // A "lat, lng" pair resolves locally: it needs no service, in any mode.
  const local = parseCoordinates(trimmed) !== null;
  const submitMode = NOMINATIM_ENABLED && health !== "up" && !local;
  // Photon is asked about the debounced text, unless it is resting. A probe
  // waits for the debounce to catch up, so it asks about what is in the field
  // now, not about text typed during the outage.
  const photonAllowed =
    !NOMINATIM_ENABLED || health === "up" || (health === "probing" && debounced === trimmed);
  const liveEnabled =
    debounced.length >= PLACE_SEARCH_MIN_LENGTH &&
    (photonAllowed || parseCoordinates(debounced) !== null);

  // Typing after the cool-down is the moment to find out whether Photon is back.
  useEffect(() => {
    if (trimmed.length >= PLACE_SEARCH_MIN_LENGTH) probePhotonIfDue();
  }, [trimmed]);

  /** Failures of the current live query that happened in the foreground. */
  const failures = useRef({ key: "", count: 0 });

  /**
   * Whether a failed Photon request is worth another try. Reports Photon as
   * down once it is not — which switches the search to submit mode.
   */
  const retryPhoton = (failureCount: number, error: Error): boolean => {
    if (isCancellation(error)) return false;
    // Cut off because the user switched apps: no verdict on Photon. Try again —
    // react-query holds the retry until the page is visible.
    if (failedInBackground()) return failureCount < BACKGROUND_RETRIES;
    if (failures.current.key !== debounced) failures.current = { key: debounced, count: 0 };
    failures.current.count += 1;
    // One quick retry: a typed search should fail fast and visibly, not after
    // the default three attempts with backoff. A timeout was slow enough already.
    if (failures.current.count <= 1 && !(error instanceof GeocoderTimeoutError)) return true;
    reportPhotonFailure();
    return false;
  };

  const search = useQuery<PlaceSuggestion[], Error>({
    queryKey: ["place-search", debounced, near?.lat ?? null, near?.lng ?? null],
    queryFn: async ({ signal }) => {
      const suggestions = await searchPlaces(debounced, { signal, bias: near });
      if (parseCoordinates(debounced) === null) reportPhotonSuccess();
      return suggestions;
    },
    enabled: liveEnabled,
    staleTime: PLACE_SEARCH_STALE_TIME_MS,
    retry: retryPhoton,
    retryDelay: 400,
    placeholderData: keepPreviousData,
  });

  // A cleared or too-short input shows nothing, not the previous results.
  const wanted = trimmed.length >= PLACE_SEARCH_MIN_LENGTH;
  const fallbackActive = submitMode && wanted && submitted === trimmed;

  const fallback = useQuery<PlaceSuggestion[], Error>({
    queryKey: ["place-search-fallback", submitted, near?.lat ?? null, near?.lng ?? null],
    queryFn: ({ signal }) => searchPlacesNominatim(submitted ?? "", { signal, bias: near }),
    enabled: fallbackActive,
    // Cached like live results: submitting the same text again asks nobody.
    staleTime: PLACE_SEARCH_STALE_TIME_MS,
    // Exactly one request per submit — unless it was cut off by the page
    // going to the background, which is worth one more.
    retry: (failureCount, error) =>
      !isCancellation(error) && failedInBackground() && failureCount < 1,
  });

  if (submitMode) {
    let status: UsePlaceSearchResult["status"];
    if (!fallbackActive) status = "idle";
    else if (fallback.isError) status = "error";
    else if (fallback.isSuccess) status = "ready";
    else status = "loading";

    return {
      suggestions: fallbackActive && fallback.isSuccess ? fallback.data : [],
      status,
      error: status === "error" ? fallback.error : null,
      isFetching: fallbackActive && fallback.isFetching,
      isStale: false,
      mode: "submit",
      awaitingSubmit: wanted && !fallbackActive,
      submit: () => {
        if (!wanted) return;
        if (submitted !== trimmed) setSubmitted(trimmed);
        else if (fallback.isError) void fallback.refetch();
      },
      retry: () => {
        if (fallbackActive) void fallback.refetch();
      },
    };
  }

  const enabled = liveEnabled;
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
    mode: "live",
    awaitingSubmit: false,
    submit: () => {},
    retry: () => {
      void search.refetch();
    },
  };
}
