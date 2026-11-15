/**
 * Finding the house of a pasted listing link: one deliberate lookup, made
 * when the person pastes the link (or presses Enter on it) — never per
 * keystroke.
 *
 * The link's address is asked of the geocoders in turn until one answers
 * with a result that is clearly that house (`findListingMatch`):
 *
 *   1. Photon, the whole address.
 *   2. Photon, street + state + ZIP (`streetQuery`): a listing's city is the
 *      postal one, and a geocoder that files the street under another town
 *      finds nothing for the whole address.
 *   3. Nominatim, the whole address.
 *   4. Nominatim, street + state + ZIP.
 *
 * Nominatim is asked even though Photon answered, because it knows what
 * Photon does not: house numbers that nobody has mapped, worked out from the
 * US census bureau's street ranges. In much of suburban America that is the
 * only way to get nearer than "somewhere on this street". This stays inside
 * its usage policy (see `./nominatim`): at most two requests for a link the
 * person submitted, through the shared one-per-second limiter, cached.
 *
 * Usually the first question settles it; a house that is on no map costs all
 * four. Pure TypeScript: no React, no DOM beyond `fetch`.
 */
import type { ListingAddress } from "./listingLink";
import { findListingMatch } from "./listingMatch";
import { isAbortError } from "./net";
import { NOMINATIM_ENABLED, searchPlacesNominatim } from "./nominatim";
import { searchPlaces } from "./photon";
import { isPhotonResting, reportPhotonFailure, reportPhotonSuccess } from "./photonHealth";
import type { PlaceSuggestion } from "./types";

export interface ListingLookup {
  /**
   * What to list: the answers to the question that found the house (the
   * house first), or else to the first question that found anything.
   */
  suggestions: PlaceSuggestion[];
  /** The result that is clearly the link's house; null when the person has to choose. */
  match: PlaceSuggestion | null;
}

export interface ListingLookupOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** For tests: whether each service may be asked (default: as the app is configured). */
  services?: { photon: boolean; nominatim: boolean };
}

type Search = (query: string) => Promise<PlaceSuggestion[]>;

/**
 * Look the link's address up. Resolves with what was found — possibly
 * nothing. Rejects only when no service could be asked at all (each one
 * asked failed), and when aborted.
 */
export async function lookUpListing(
  link: ListingAddress,
  options: ListingLookupOptions = {},
): Promise<ListingLookup> {
  const { signal, fetchImpl } = options;
  const services = options.services ?? {
    // Without the second service Photon is all there is: ask it even if it just failed.
    photon: !NOMINATIM_ENABLED || !isPhotonResting(),
    nominatim: NOMINATIM_ENABLED,
  };
  const questions = link.streetQuery ? [link.query, link.streetQuery] : [link.query];

  let fallback: PlaceSuggestion[] = [];
  let answered = false;
  let failure: unknown = null;

  /** Ask one service its questions; the lookup's result if one found the house. */
  const ask = async (search: Search): Promise<ListingLookup | null> => {
    for (const question of questions) {
      const found = await search(question);
      answered = true;
      const match = findListingMatch(link, found);
      if (match) {
        return { match, suggestions: [match, ...found.filter((other) => other !== match)] };
      }
      if (fallback.length === 0) fallback = found;
    }
    return null;
  };

  if (services.photon) {
    try {
      const result = await ask(async (question) => {
        const found = await searchPlaces(question, { signal, fetchImpl });
        reportPhotonSuccess();
        return found;
      });
      if (result) return result;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      reportPhotonFailure();
      failure = error;
    }
  }

  if (services.nominatim) {
    try {
      const result = await ask((question) =>
        searchPlacesNominatim(question, { signal, fetchImpl }),
      );
      if (result) return result;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      failure = error;
    }
  }

  if (!answered) throw failure ?? new Error("Place search is unavailable");
  return { match: null, suggestions: fallback };
}
