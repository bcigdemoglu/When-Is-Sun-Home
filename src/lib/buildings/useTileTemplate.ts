"use client";

/**
 * Where the building tiles are right now, for the map.
 *
 * The map draws the buildings in view straight from OpenFreeMap's tiles, and
 * it must read the SAME weekly build as the sun computation: the same files
 * (so the browser downloads each tile once for both) and the same buildings.
 * Both therefore get the address from `loadTileTemplate`, which reads the
 * tile index at most once an hour and never fails (it falls back to the last
 * address it saw, then to the "latest" alias).
 */
import { useQuery } from "@tanstack/react-query";
import { TILEJSON_MAX_AGE_MS, loadTileTemplate } from "./vectorTiles";

export const TILE_TEMPLATE_QUERY_KEY = ["building-tile-template"] as const;

/**
 * The tile URL template (`…/{z}/{x}/{y}.pbf`), or null until it is known —
 * which takes one small request, or four seconds at most when the tile index
 * does not answer.
 */
export function useTileTemplate(): string | null {
  const { data } = useQuery({
    queryKey: TILE_TEMPLATE_QUERY_KEY,
    queryFn: ({ signal }) => loadTileTemplate({ signal }),
    // A new build appears once a week, and old builds are not kept for ever:
    // a page left open for days has to notice.
    staleTime: TILEJSON_MAX_AGE_MS,
    refetchInterval: TILEJSON_MAX_AGE_MS,
    refetchOnWindowFocus: true,
    gcTime: Infinity,
    retry: false,
  });
  return data ?? null;
}
