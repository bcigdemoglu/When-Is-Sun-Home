/**
 * Deciding when a lost WebGL context is really gone.
 *
 * Browsers take the map's WebGL context away now and then and usually hand it
 * back (`webglcontextrestored`) — MapLibre then simply carries on. Only when
 * it does NOT come back is the map dead. The catch: phones routinely drop the
 * context while the page is in the BACKGROUND and restore it only once the
 * page is looked at again. So the clock that decides "it is not coming back"
 * may only run while the page is visible — otherwise it runs out during the
 * night, and on return the map is replaced by an error a moment before the
 * browser would have restored it.
 */

export interface ContextLossWatchOptions {
  /** How long a lost context may stay lost, with the page visible, before giving up, ms. */
  graceMs: number;
  /** Is the page visible right now? */
  isVisible(): boolean;
  /** The context did not come back: the map cannot be shown. Called at most once per loss. */
  onGone(): void;
}

export interface ContextLossWatch {
  /** `webglcontextlost` */
  lost(): void;
  /** `webglcontextrestored` */
  restored(): void;
  /** The page became visible or hidden (`visibilitychange`). */
  visibilityChanged(): void;
  /** Stop for good (the map was removed). */
  dispose(): void;
}

export function createContextLossWatch(options: ContextLossWatchOptions): ContextLossWatch {
  const { graceMs, isVisible, onGone } = options;
  let isLost = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  /** (Re)start the full grace period — only ever while the page is visible. */
  const start = () => {
    stop();
    if (disposed || !isLost || !isVisible()) return;
    timer = setTimeout(() => {
      timer = null;
      if (disposed || !isLost) return;
      isLost = false;
      onGone();
    }, graceMs);
  };

  return {
    lost() {
      isLost = true;
      start();
    },
    restored() {
      isLost = false;
      stop();
    },
    visibilityChanged() {
      // Hidden: stop the clock. Visible again: the browser gets a fresh grace
      // period to restore the context before we give up.
      if (isLost) start();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}

/**
 * After the map has been given up on: should it be tried again now that the
 * page became visible? Once per failure — a context lost in the background is
 * usually available again on return, and if it is not, the person can still
 * press "Try the map again".
 */
export function shouldAutoRetry(state: {
  failed: boolean;
  visible: boolean;
  alreadyRetried: boolean;
}): boolean {
  return state.failed && state.visible && !state.alreadyRetried;
}
