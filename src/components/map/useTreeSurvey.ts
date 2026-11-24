"use client";

import { useQuery } from "@tanstack/react-query";
import type { LatLng } from "@/lib/types";
import { surveyFromIdentify, treeSurveyUrl, type TreeSurvey } from "./trees";

/**
 * Which laser survey the heights at the pinned place come from: one small
 * request to the state's service per place (to the nearest hundred metres).
 * Null until it is known, and when it cannot be had — the legend then says
 * that the year varies, which is always true.
 */
export function useTreeSurvey(place: LatLng | null): TreeSurvey | null {
  const lat = place ? Number(place.lat.toFixed(3)) : null;
  const lng = place ? Number(place.lng.toFixed(3)) : null;
  const { data } = useQuery({
    queryKey: ["tree-survey", lat, lng],
    enabled: lat !== null && lng !== null,
    queryFn: async ({ signal }) => {
      if (lat === null || lng === null) return null;
      const response = await fetch(treeSurveyUrl({ lat, lng }), { signal });
      if (!response.ok) throw new Error(`The survey lookup answered HTTP ${response.status}`);
      return surveyFromIdentify(await response.json());
    },
    // A survey does not change; a failed lookup is not worth a second word.
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return data ?? null;
}
