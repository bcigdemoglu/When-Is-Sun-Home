/**
 * Canopy windows for the report's Trees section, loaded (browser only): the
 * heights from the state's service, the building tiles the map layer cuts its
 * pictures with, and the measuring done in the Trees layer's worker. The
 * rules of a window are in `canopyWindow.ts`, the arithmetic on the result in
 * `canopySummary.ts`.
 *
 * Trees are NEVER part of a sun-hours number: this is information only.
 */
import { loadTileTemplate, tileUrl } from "@/lib/buildings/vectorTiles";
import { decodeTileInBrowser } from "@/lib/terrain/loadTerrain";
import { canDecodePng } from "@/lib/terrain/png";
import { buildingTilesOfWindow, canopyWindowUrl, type CanopyWindow } from "./canopyWindow";
import { fetchPicture, type ImageryLoadOptions } from "./imagery";
import type { CanopyArea, CanopyGrid } from "./canopyGrid";
import { measureCanopy, nextTreeJobId } from "./treeTiles";
import { TREE_RETRY_WAITS_MS } from "./trees";

export interface CanopyLoadOptions extends ImageryLoadOptions {
  /** Number each building's pixels (needed to find the house on its lot). */
  labels?: boolean;
  /** How long to wait before asking again after a failure (default: as the map layer). */
  waits?: readonly number[];
  /** Measure the cover over this area in the worker too (`CanopyGrid.cover`). */
  area?: CanopyArea;
}

/** Load and measure one canopy window. Rejects when the heights or a building tile cannot be had. */
export async function loadCanopyGrid(
  window: CanopyWindow,
  options: CanopyLoadOptions = {},
): Promise<CanopyGrid> {
  const { signal, fetchImpl, pause, area, labels = false, waits = TREE_RETRY_WAITS_MS } = options;
  const tiles = buildingTilesOfWindow(window);
  const fetchOptions = { signal, fetchImpl, pause };
  const [heights, template] = await Promise.all([
    fetchPicture(canopyWindowUrl(window), waits, false, fetchOptions),
    loadTileTemplate({ signal, fetchImpl }),
  ]);
  // The same addresses the map and the sun computation read the buildings
  // from: where they have, these come from the browser's cache.
  const buildings = await Promise.all(
    tiles.map(async ({ tile, frame }) => ({
      frame,
      data: (await fetchPicture(tileUrl(template, tile), waits, false, fetchOptions)).data,
    })),
  );
  const decoded = canDecodePng() ? undefined : await decodeTileInBrowser(new Blob([heights.data]));
  return measureCanopy({
    kind: "canopy",
    id: nextTreeJobId(),
    window,
    heights: heights.data,
    decoded,
    buildings,
    labels,
    area,
  });
}
