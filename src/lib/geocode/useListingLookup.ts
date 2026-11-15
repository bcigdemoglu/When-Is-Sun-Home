"use client";

import { CancelledError, useQuery } from "@tanstack/react-query";
import type { ListingAddress } from "./listingLink";
import { lookUpListing, type ListingLookup } from "./listingLookup";
import { isAbortError } from "./net";
import { BACKGROUND_GRACE_MS, failedInBackground } from "./photonHealth";
import type { PlaceSuggestion } from "./types";

/** As long as typed searches are kept: pasting the same link again asks nobody. */
export const LISTING_LOOKUP_STALE_TIME_MS = 5 * 60 * 1000;

export interface UseListingLookupResult {
  /** "idle" without a link; "loading" until the lookup has answered. */
  status: "idle" | "loading" | "ready" | "error";
  /** What to list when the person has to choose. */
  suggestions: PlaceSuggestion[];
  /** The result that is clearly the link's house, or null. */
  match: PlaceSuggestion | null;
  /** Run the failed lookup again. */
  retry: () => void;
}

const NOTHING: PlaceSuggestion[] = [];

/**
 * The lookup of a listing link the person pasted or submitted (see
 * `lookUpListing`): one per link, cached like any search, and nothing at all
 * while `link` is null. Not for text that is still being typed.
 */
export function useListingLookup(link: ListingAddress | null): UseListingLookupResult {
  const lookup = useQuery<ListingLookup, Error>({
    queryKey: ["listing-lookup", link?.key ?? null, link?.streetQuery ?? null],
    queryFn: ({ signal }) => {
      if (!link) throw new Error("No listing link to look up");
      return lookUpListing(link, { signal });
    },
    enabled: link !== null,
    staleTime: LISTING_LOOKUP_STALE_TIME_MS,
    // One lookup per link — unless the phone cut it off by going to the
    // background, which says nothing about the services: that is worth one more.
    retry: (failureCount, error) =>
      !(error instanceof CancelledError) &&
      !isAbortError(error) &&
      failedInBackground() &&
      failureCount < 1,
    retryDelay: BACKGROUND_GRACE_MS + 200,
  });

  let status: UseListingLookupResult["status"];
  if (!link) status = "idle";
  else if (lookup.isError) status = "error";
  else if (lookup.isSuccess) status = "ready";
  else status = "loading";

  const ready = status === "ready" && lookup.data !== undefined;
  return {
    status,
    suggestions: ready ? lookup.data.suggestions : NOTHING,
    match: ready ? lookup.data.match : null,
    retry: () => {
      if (link) void lookup.refetch();
    },
  };
}
