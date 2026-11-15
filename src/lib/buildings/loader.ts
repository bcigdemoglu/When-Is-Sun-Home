/**
 * Where building data comes from, and in which order.
 *
 *   1. IndexedDB cache
 *   2. OpenFreeMap vector tiles, straight from the browser (`vectorTiles.ts`)
 *   3. the app's own `/api/buildings` route (Overpass, queried by the server)
 *   4. the public Overpass servers, straight from the browser
 *
 * The tiles are THE source: people compare places and come back on other
 * days, so the numbers must come from the same data every time. 3 and 4 are
 * only there for when the tiles cannot be had at all, and what they return
 * is cached for a day instead of two weeks.
 *
 * All of the network together gets `NETWORK_BUDGET_MS`: the tiles normally
 * answer well within a second, and when everything is down the caller has
 * an error in under half a minute.
 *
 * One exception. A phone suspends a page that goes to the background (the
 * user switches to another app, or locks the screen): iOS cuts its requests
 * off ("Load failed") and stops its clocks, so on return every source has
 * failed and the budget is long gone. That says nothing about the sources. A
 * load that failed with the page in the background is therefore run once
 * more, with a fresh budget, shortly after the page is visible again.
 */
import type { BuildingCollection } from "@/lib/types";
import { fetchBuildingsFromApi } from "./api";
import { getCachedBuildingsEntry, setCachedBuildings, type BuildingDataSource } from "./cache";
import { abortErrorFrom, fetchBuildings, isAbortError } from "./overpass";
import { TILE_COVER_RADIUS_M, TILE_KEEP_RADIUS_M, type FetchArea } from "./tiles";
import { fetchBuildingsFromTiles } from "./vectorTiles";

export type { BuildingDataSource } from "./cache";

/** Everything after the cache, together. */
export const NETWORK_BUDGET_MS = 28_000;
/** The API route is a long shot (its upstream blocks cloud hosts); it does not get long. */
export const API_FALLBACK_TIMEOUT_MS = 8_000;
/** A fallback is not started with less time than this left. */
const MIN_STAGE_MS = 1_500;
/**
 * How long after the page came back to the foreground the load is run again.
 * Not at once: Safari on iOS 18 can lose a request that starts in the very
 * moment the page becomes visible (it fails with "Load failed" half a minute
 * later), and the connections of a phone that just woke up need a moment.
 */
export const RESUME_DELAY_MS = 1_000;

export interface LoadedBuildings {
  buildings: BuildingCollection;
  /** Where this copy was read from just now. */
  source: BuildingDataSource | "cache";
  /** Where the data originally came from; null for old cache entries that did not record it. */
  origin: BuildingDataSource | null;
}

export interface FailedAttempt {
  source: BuildingDataSource;
  error: unknown;
  /** How long the attempt took. */
  ms: number;
}

/** No source could supply the buildings. `attempts` says what each one answered. */
export class BuildingsUnavailableError extends Error {
  readonly attempts: readonly FailedAttempt[];

  constructor(attempts: readonly FailedAttempt[]) {
    const detail = attempts
      .map(({ source, error }) => `${source}: ${error instanceof Error ? error.message : error}`)
      .join("; ");
    super(`Building data could not be loaded (${detail || "no source could be tried"})`, {
      cause: attempts[0]?.error,
    });
    this.name = "BuildingsUnavailableError";
    this.attempts = attempts;
  }
}

export interface LoadBuildingsOptions {
  /** Aborting rejects with an AbortError and stops the chain. */
  signal?: AbortSignal;
  /**
   * The user asked for a refresh: skip the IndexedDB cache and re-read the
   * tile index. The cached copy is left alone unless the refresh succeeds.
   */
  fresh?: boolean;
  fetchImpl?: typeof fetch;
  budgetMs?: number;
  /** See `RESUME_DELAY_MS`. */
  resumeDelayMs?: number;
}

/**
 * Notes whether the page is, or goes, to the background while a load runs,
 * and can wait for it to come back. Without a document (server, workers)
 * the page counts as always visible.
 */
function watchPage() {
  const page = typeof document === "undefined" ? null : document;
  const isHidden = () => page !== null && page.visibilityState === "hidden";
  let wasHidden = isHidden();
  const note = () => {
    if (isHidden()) wasHidden = true;
  };
  page?.addEventListener("visibilitychange", note);

  return {
    isHidden,
    wasHidden: () => wasHidden,
    stop: () => page?.removeEventListener("visibilitychange", note),
    /** Resolves once the page is visible; rejects with an AbortError if `signal` fires first. */
    visible(signal: AbortSignal | undefined): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortErrorFrom(signal));
          return;
        }
        if (page === null || !isHidden()) {
          resolve();
          return;
        }
        const onChange = () => {
          if (isHidden()) return;
          cleanUp();
          resolve();
        };
        const onAbort = () => {
          cleanUp();
          reject(abortErrorFrom(signal as AbortSignal));
        };
        const cleanUp = () => {
          page.removeEventListener("visibilitychange", onChange);
          signal?.removeEventListener("abort", onAbort);
        };
        page.addEventListener("visibilitychange", onChange);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

/** Resolves after `ms`; rejects with an AbortError as soon as `signal` fires. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErrorFrom(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortErrorFrom(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The buildings for one fetch area, from the first source that has them.
 *
 * Rejects with `BuildingsUnavailableError` when every source failed, and
 * with an AbortError when aborted (no further source is tried then).
 */
export async function loadBuildings(
  area: FetchArea,
  options: LoadBuildingsOptions = {},
): Promise<LoadedBuildings> {
  const { signal, fresh = false, resumeDelayMs = RESUME_DELAY_MS } = options;

  if (!fresh) {
    const cached = await getCachedBuildingsEntry(area.key);
    if (cached) return { buildings: cached.data, source: "cache", origin: cached.source };
  }

  const page = watchPage();
  try {
    try {
      return await loadFromNetwork(area, options);
    } catch (error) {
      // Only a failure of the sources is worth another round, and only when
      // the page being suspended may be what made them fail.
      if (!(error instanceof BuildingsUnavailableError) || !page.wasHidden()) throw error;
    }
    do {
      await page.visible(signal);
      await pause(resumeDelayMs, signal);
    } while (page.isHidden());
    return await loadFromNetwork(area, options);
  } finally {
    page.stop();
  }
}

/** Every network source in turn, within one time budget. */
async function loadFromNetwork(
  area: FetchArea,
  options: LoadBuildingsOptions,
): Promise<LoadedBuildings> {
  const { signal, fresh = false, fetchImpl, budgetMs = NETWORK_BUDGET_MS } = options;

  const deadline = Date.now() + budgetMs;
  const remaining = () => deadline - Date.now();
  const common = { signal, ...(fetchImpl ? { fetchImpl } : {}) };

  const stages: { source: BuildingDataSource; run: () => Promise<BuildingCollection> }[] = [
    {
      source: "tiles",
      run: () =>
        fetchBuildingsFromTiles(area.center, TILE_COVER_RADIUS_M, {
          ...common,
          keepRadiusM: TILE_KEEP_RADIUS_M,
          refresh: fresh,
        }),
    },
    {
      source: "api",
      run: () =>
        fetchBuildingsFromApi(area.key, {
          ...common,
          timeoutMs: Math.min(API_FALLBACK_TIMEOUT_MS, remaining()),
        }),
    },
    {
      source: "overpass",
      // Every endpoint in turn, for as long as the budget lasts.
      run: () => fetchBuildings(area.center, area.radiusM, { ...common, budgetMs: remaining() }),
    },
  ];

  const attempts: FailedAttempt[] = [];
  for (const { source, run } of stages) {
    if (signal?.aborted) throw abortErrorFrom(signal);
    // The primary source is always tried; a fallback only with time to spare.
    if (attempts.length > 0 && remaining() < MIN_STAGE_MS) break;

    const startedAt = Date.now();
    try {
      const buildings = await run();
      void setCachedBuildings(area.key, buildings, source);
      return { buildings, source, origin: source };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      attempts.push({ source, error, ms: Date.now() - startedAt });
    }
  }
  throw new BuildingsUnavailableError(attempts);
}
