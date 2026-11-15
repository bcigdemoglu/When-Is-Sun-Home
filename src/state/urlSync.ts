"use client";

/**
 * Mirrors the settings into the address bar so the page can be shared or
 * reloaded as is.
 *
 * WHY THIS IS CAREFUL. Safari throws a SecurityError once a page has called
 * `history.replaceState` more than 100 times in 30 seconds. The old app called
 * it on every slider tick; the uncaught exception took the whole React tree
 * down on iPhones. Here the call is, by construction:
 *
 *  - debounced: it happens only after the store has been quiet for
 *    `debounceMs` (trailing edge) — a drag or an animation of any length
 *    produces ONE call, after it ends;
 *  - rate limited twice over, independently of the debounce: at least
 *    `minIntervalMs` between two calls, and at most `maxCallsPerWindow` calls
 *    per rolling `windowMs`. An update that arrives too early is not lost,
 *    it is written when the limiter allows;
 *  - skipped when the query string would not change;
 *  - wrapped in try/catch, with a pause (and a bounded number of retries)
 *    after a failure;
 *  - never made before hydration has finished (it would wipe the very URL
 *    hydration is about to read).
 *
 * WHAT THE BUDGET REALLY IS. Every call made here costs TWO of the browser's:
 * Next.js patches `history.replaceState`, passes ours on, syncs its router
 * with the new URL, and that router update writes its own state back with a
 * second `replaceState` (`HistoryUpdater` in next/dist/client/components/
 * app-router.js). That second call is the framework's, in a React effect and
 * outside any try/catch of ours: if IT hit the limit, the page would crash.
 * WebKit counts pushState and replaceState together, per page, in a window
 * that restarts once it is over: 100 per 30 s in the WebKit of Safari 16,
 * 100 per 10 s in recent WebKit (WebCore/page/History.cpp, releases 2.38
 * and 2.48). With the defaults below that makes at most 60 of the 100 in any
 * 30 s, and at most 52 in any 10 s (the minimum interval allows 26 calls).
 * Nothing else in the app navigates or touches the history. Keep
 * `2 × maxCallsPerWindow` well under 100 (there is a test for it).
 *
 * The whole query string belongs to the settings: it is replaced, not merged.
 * `location.pathname` and `location.hash` are preserved.
 */
import { useEffect } from "react";
import { onSettingsHydrated, pickSettings, useSettings } from "./store";
import { buildShareUrl, settingsToSearchParams } from "./urlCodec";

export { buildShareUrl };

export const URL_SYNC_DEBOUNCE_MS = 400;
export const URL_SYNC_MIN_INTERVAL_MS = 400;
export const URL_SYNC_MAX_CALLS_PER_WINDOW = 30;
export const URL_SYNC_WINDOW_MS = 30_000;
/** Pause after `replaceState` threw before trying again. */
export const URL_SYNC_FAILURE_BACKOFF_MS = 10_000;
/** Unprompted retries after a failure; after that, only a new change retries. */
export const URL_SYNC_MAX_RETRIES = 3;

export interface UrlSyncOptions {
  /** Quiet time before the URL is written, ms. Default 400. */
  debounceMs?: number;
  /** Minimum time between two `replaceState` calls, ms. Default 400. */
  minIntervalMs?: number;
  /** Maximum number of `replaceState` calls per rolling window. Default 30. */
  maxCallsPerWindow?: number;
  /** Length of the rolling window, ms. Default 30 000. */
  windowMs?: number;
}

// The limiter's memory is per PAGE, not per `startUrlSync` call: remounting the
// hook (StrictMode, route changes, error-boundary resets) must not refill the
// budget.
/** Times of the `replaceState` calls made within the rolling window. */
const calls: number[] = [];
let blockedUntil = 0;
let consecutiveFailures = 0;

/**
 * Starts mirroring the store into the URL and returns a function that stops
 * it. Does nothing on the server. Waits for `hydrateSettings()` to finish,
 * then writes once (which also rewrites a legacy link into the current
 * format) and after every change.
 */
export function startUrlSync(options: UrlSyncOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};

  const debounceMs = options.debounceMs ?? URL_SYNC_DEBOUNCE_MS;
  const minIntervalMs = options.minIntervalMs ?? URL_SYNC_MIN_INTERVAL_MS;
  const maxCalls = Math.max(1, options.maxCallsPerWindow ?? URL_SYNC_MAX_CALLS_PER_WINDOW);
  const windowMs = options.windowMs ?? URL_SYNC_WINDOW_MS;

  let stopped = false;
  let dirty = false;
  let lastChangeAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (delayMs: number) => {
    if (timer === null && !stopped) timer = setTimeout(onTimer, Math.max(0, delayMs));
  };

  /** How long the limiter wants us to wait before the next call; 0 = go. */
  const limiterDelay = (now: number): number => {
    // A clock that jumped backwards must not freeze the sync.
    if (calls.length > 0 && now < calls[calls.length - 1]) calls.length = 0;
    while (calls.length > 0 && now - calls[0] >= windowMs) calls.shift();
    let wait = blockedUntil - now;
    if (calls.length > 0) wait = Math.max(wait, calls[calls.length - 1] + minIntervalMs - now);
    if (calls.length >= maxCalls) wait = Math.max(wait, calls[0] + windowMs - now);
    return Math.max(0, wait);
  };

  const write = () => {
    if (stopped || !dirty) return;
    const now = Date.now();
    try {
      const query = settingsToSearchParams(pickSettings(useSettings.getState())).toString();
      const { pathname, search, hash } = window.location;
      if (query === search.replace(/^\?/, "")) {
        dirty = false;
        return;
      }
      const wait = limiterDelay(now);
      if (wait > 0) {
        arm(wait); // still dirty: written as soon as the limiter allows
        return;
      }
      dirty = false;
      calls.push(now);
      // `null` state on purpose: Next.js patches replaceState, copies its own
      // router state into a null/plain state object and syncs its router with
      // the new URL. Passing `history.state` back would skip that sync.
      window.history.replaceState(null, "", pathname + (query ? `?${query}` : "") + hash);
      consecutiveFailures = 0;
    } catch {
      // SecurityError (rate limit hit by other code, sandboxed document) or
      // anything else. Pause, then try again a few times on our own; where it
      // can never work, stop until the settings change again.
      consecutiveFailures += 1;
      blockedUntil = now + URL_SYNC_FAILURE_BACKOFF_MS;
      dirty = consecutiveFailures <= URL_SYNC_MAX_RETRIES;
      if (dirty) arm(URL_SYNC_FAILURE_BACKOFF_MS);
    }
  };

  function onTimer() {
    timer = null;
    if (stopped || !dirty) return;
    const quietFor = Date.now() - lastChangeAt;
    // Changes kept coming while we waited: wait out the rest of the quiet
    // period. One timer serves any number of updates.
    if (quietFor >= 0 && quietFor < debounceMs) arm(debounceMs - quietFor);
    else write();
  }

  const onChange = () => {
    dirty = true;
    lastChangeAt = Date.now();
    arm(debounceMs);
  };

  // Going to the background is the last chance before iOS may discard the
  // tab; write now instead of waiting out the debounce (limiter still applies).
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") write();
  };

  let unsubscribeStore: (() => void) | null = null;
  const unsubscribeHydration = onSettingsHydrated(() => {
    if (stopped) return;
    unsubscribeStore = useSettings.subscribe(onChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    onChange();
  });

  return () => {
    stopped = true;
    unsubscribeHydration();
    unsubscribeStore?.();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Mount once near the root of the client tree (next to `useHydrateSettings`).
 * Safe under StrictMode: the effect's cleanup stops the sync completely.
 */
export function useUrlSync(): void {
  useEffect(() => startUrlSync(), []);
}
