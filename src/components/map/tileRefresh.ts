/**
 * Asking for the map's building tiles again after they failed to load.
 *
 * MapLibre does not retry a tile that failed: it stays missing until the map
 * moves away and back. Mostly that is fine — the buildings away from the pin
 * are decoration, and a hole in them needs no message. But one failure is
 * routine on phones: a page sent to the background has its requests cut off
 * ("Load failed" on iOS), so on return whatever was still loading is missing
 * for good. The same goes for a connection that dropped and came back.
 *
 * So every time there is reason to think it would work now ("woke": the
 * page is looked at again, the connection is back, or the sun computation
 * just got its buildings from the same host), failed tiles get ONE more try —
 * a moment later, because Safari can lose a request that starts in the very
 * instant the page becomes visible. A source that keeps failing while the
 * page is in view is left alone after that: no loop, no error, the basemap's
 * flat footprints remain.
 */

/** Should the tiles be asked for again now? */
export function shouldRefreshTiles(state: {
  /** A tile has failed since the last refresh. */
  failed: boolean;
  /** No refresh has been spent yet since the page last woke (or the map loaded). */
  allowed: boolean;
  visible: boolean;
  online: boolean;
}): boolean {
  return state.failed && state.allowed && state.visible && state.online;
}

export interface TileRefreshWatchOptions {
  /** How long after the reason to refresh arose the refresh happens, ms. */
  delayMs: number;
  isVisible(): boolean;
  isOnline(): boolean;
  /** Load the source's tiles again. */
  refresh(): void;
}

export interface TileRefreshWatch {
  /** A tile of the source failed to load. */
  failed(): void;
  /** The page became visible, the connection came back, or building data just loaded. */
  woke(): void;
  /** Stop for good (the map was removed). */
  dispose(): void;
}

export function createTileRefreshWatch(options: TileRefreshWatchOptions): TileRefreshWatch {
  const { delayMs, isVisible, isOnline, refresh } = options;
  let hasFailed = false;
  // A map that has just loaded counts as having just woken.
  let allowed = true;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const due = () =>
    shouldRefreshTiles({ failed: hasFailed, allowed, visible: isVisible(), online: isOnline() });
  /** Failures and wake-ups arrive in either order: both end up here. */
  const consider = () => {
    if (disposed || timer !== null || !due()) return;
    timer = setTimeout(() => {
      timer = null;
      // The page may have gone again in the meantime: then the next wake-up decides.
      if (disposed || !due()) return;
      hasFailed = false;
      allowed = false;
      refresh();
    }, delayMs);
  };

  return {
    failed() {
      hasFailed = true;
      consider();
    },
    woke() {
      allowed = true;
      consider();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
