"use client";

/**
 * Everything the report's Trees section asks for, fetched only once the
 * section has been opened (`enabled`), each answer cached per place by
 * TanStack Query, and every failure quiet: a section says it could not load
 * and offers to try again — no toast, no crash.
 *
 * Hosts: the City of Portland's www.portlandmaps.com (street trees, heritage
 * trees, neighborhoods, lot lines — see `lib/trees/portland.ts`, including
 * the taxlot privacy rule) and the state's DOGAMI canopy heights (see
 * `components/map/treeCanopy.ts`). Nothing else, and never an Esri host.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  areaWindow,
  nearWindow,
  neighborhoodWindow,
  type CanopyWindow,
} from "@/components/map/canopyWindow";
import { createLimiter, fetchPicture } from "@/components/map/imagery";
import { loadCanopyGrid } from "@/components/map/treeCanopy";
import { useTreeSurvey } from "@/components/map/useTreeSurvey";
import type { TreeSurvey } from "@/components/map/trees";
import {
  AREA_RADIUS_M,
  areaStreetTreesUrl,
  blockStreetTreesUrl,
  blockTaxlotsUrl,
  heritageTreesUrl,
  nearbyStreetTreesUrl,
  neighborhoodUrl,
  parseHeritageTrees,
  parseNeighborhood,
  parseStreetTreeGroups,
  parseStreetTrees,
  parseTaxlots,
  taxlotUrl,
  type Block,
} from "@/lib/trees/portland";
import type { Place } from "@/lib/types";
import {
  addressFor,
  blockFor,
  buildTreeReport,
  none,
  treeRegion,
  type Loadable,
  type TreeReport,
} from "./treesModel";

/**
 * The city's server turns a burst away (without the headers a browser needs
 * to read the refusal): its questions go two at a time, and one that is
 * turned away is asked again after a short wait, as the regional photos are.
 */
const CITY_PARALLEL_REQUESTS = 2;
const CITY_RETRY_WAITS_MS: readonly number[] = [400, 1_200];
/** The canopy heights: asked again sooner than the map layer's (someone is reading, waiting). */
const CANOPY_RETRY_WAITS_MS: readonly number[] = [500, 1_500];
const cityTurn = createLimiter(CITY_PARALLEL_REQUESTS);

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const { data } = await cityTurn(
    () => fetchPicture(url, CITY_RETRY_WAITS_MS, false, { signal }),
    signal,
  );
  return JSON.parse(new TextDecoder().decode(data));
}

/** Records and heights do not change while the page is open; one quiet second try. */
const QUERY_DEFAULTS = {
  staleTime: Infinity,
  retry: 1,
  retryDelay: 1_500,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

function loadable<T>(query: UseQueryResult<T>, asked: boolean): Loadable<T> {
  if (!asked) return none;
  if (query.isSuccess) return { state: "ready", value: query.data };
  if (query.isError) return { state: "error" };
  return { state: "loading" };
}

const windowKey = (window: CanopyWindow | null) =>
  window ? `${window.z}/${window.x0}/${window.y0}/${window.size}` : null;

export interface TreeReportState {
  report: TreeReport;
  survey: TreeSurvey | null;
  /** Ask again for whatever failed. */
  retry(): void;
}

export function useTreeReport(place: Place, enabled: boolean): TreeReportState {
  const region = treeRegion(place);
  const portland = enabled && region === "portland";
  const oregon = enabled && region !== "elsewhere";
  // To the nearest metre or so: the same spot is one cache entry.
  const lat = Number(place.lat.toFixed(5));
  const lng = Number(place.lng.toFixed(5));
  const spot = useMemo(() => ({ lat, lng }), [lat, lng]);

  const lot = useQuery({
    queryKey: ["trees", "lot", lat, lng],
    enabled: portland,
    queryFn: async ({ signal }) => {
      const lots = parseTaxlots(await fetchJson(taxlotUrl(spot), signal));
      // Stacked lots (condominiums) share an outline: the first with an address.
      return lots.find((candidate) => candidate.address) ?? lots[0] ?? null;
    },
    ...QUERY_DEFAULTS,
  });
  const nearby = useQuery({
    queryKey: ["trees", "nearby", lat, lng],
    enabled: portland,
    queryFn: async ({ signal }) =>
      parseStreetTrees(await fetchJson(nearbyStreetTreesUrl(spot), signal)),
    ...QUERY_DEFAULTS,
  });

  const lotState = loadable(lot, portland);
  const nearbyState = loadable(nearby, portland);
  const resolved = portland ? addressFor(place, lotState) : null;
  const block: Block | null | undefined = portland
    ? blockFor(resolved === undefined ? undefined : (resolved?.address ?? null), nearbyState, spot)
    : null;

  const blockTrees = useQuery({
    queryKey: ["trees", "block-trees", block?.street, block?.hundred],
    enabled: portland && !!block,
    queryFn: async ({ signal }) =>
      parseStreetTrees(await fetchJson(blockStreetTreesUrl(block as Block), signal)),
    ...QUERY_DEFAULTS,
  });
  const blockLots = useQuery({
    queryKey: ["trees", "block-lots", block?.street, block?.hundred],
    enabled: portland && !!block,
    queryFn: async ({ signal }) =>
      parseTaxlots(await fetchJson(blockTaxlotsUrl(block as Block), signal)),
    ...QUERY_DEFAULTS,
  });
  const area = useQuery({
    queryKey: ["trees", "area", lat, lng],
    enabled: portland,
    queryFn: async ({ signal }) => {
      const [species, traits] = await Promise.all([
        fetchJson(areaStreetTreesUrl(spot, "species"), signal),
        fetchJson(areaStreetTreesUrl(spot, "traits"), signal),
      ]);
      return { species: parseStreetTreeGroups(species), traits: parseStreetTreeGroups(traits) };
    },
    ...QUERY_DEFAULTS,
  });
  const heritage = useQuery({
    queryKey: ["trees", "heritage", lat, lng],
    enabled: portland,
    queryFn: async ({ signal }) =>
      parseHeritageTrees(await fetchJson(heritageTreesUrl(spot), signal)),
    ...QUERY_DEFAULTS,
  });
  const neighborhood = useQuery({
    queryKey: ["trees", "neighborhood", lat, lng],
    enabled: portland,
    queryFn: async ({ signal }) =>
      parseNeighborhood(await fetchJson(neighborhoodUrl(spot), signal)),
    ...QUERY_DEFAULTS,
  });

  const near = nearWindow(spot);
  const wide = areaWindow(spot);
  const hoodWindow = neighborhood.data ? neighborhoodWindow(neighborhood.data.rings) : null;
  const nearGrid = useQuery({
    queryKey: ["trees", "canopy", windowKey(near), "labels"],
    enabled: oregon,
    queryFn: ({ signal }) =>
      loadCanopyGrid(near, { signal, labels: true, waits: CANOPY_RETRY_WAITS_MS }),
    ...QUERY_DEFAULTS,
  });
  const areaGrid = useQuery({
    queryKey: ["trees", "canopy", windowKey(wide)],
    enabled: oregon,
    queryFn: ({ signal }) =>
      loadCanopyGrid(wide, {
        signal,
        waits: CANOPY_RETRY_WAITS_MS,
        area: { kind: "circle", center: spot, radiusM: AREA_RADIUS_M },
      }),
    ...QUERY_DEFAULTS,
  });
  const hoodGrid = useQuery({
    queryKey: ["trees", "canopy", windowKey(hoodWindow)],
    enabled: portland && hoodWindow !== null,
    queryFn: ({ signal }) =>
      loadCanopyGrid(hoodWindow as CanopyWindow, {
        signal,
        waits: CANOPY_RETRY_WAITS_MS,
        area: { kind: "polygon", rings: neighborhood.data?.rings ?? [] },
      }),
    ...QUERY_DEFAULTS,
  });
  const survey = useTreeSurvey(oregon ? spot : null);

  const inputs = {
    place,
    lot: lotState,
    nearby: nearbyState,
    blockTrees: loadable(blockTrees, portland && !!block),
    blockLots: loadable(blockLots, portland && !!block),
    area: loadable(area, portland),
    heritage: loadable(heritage, portland),
    neighborhood: loadable(neighborhood, portland),
    nearGrid: loadable(nearGrid, oregon),
    areaGrid: loadable(areaGrid, oregon),
    neighborhoodGrid: loadable(hoodGrid, portland && hoodWindow !== null),
  };
  // Rebuilt only when an answer arrives (each query's data is a stable object).
  const report = useMemo(
    () => buildTreeReport(inputs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      place,
      lot.status,
      lot.data,
      nearby.status,
      nearby.data,
      blockTrees.status,
      blockTrees.data,
      blockLots.status,
      blockLots.data,
      area.status,
      area.data,
      heritage.status,
      heritage.data,
      neighborhood.status,
      neighborhood.data,
      nearGrid.status,
      nearGrid.data,
      areaGrid.status,
      areaGrid.data,
      hoodGrid.status,
      hoodGrid.data,
      enabled,
    ],
  );

  const queries = [
    lot,
    nearby,
    blockTrees,
    blockLots,
    area,
    heritage,
    neighborhood,
    nearGrid,
    areaGrid,
    hoodGrid,
  ];
  const retry = () => {
    for (const query of queries) if (query.isError) void query.refetch();
  };
  return { report, survey, retry };
}
