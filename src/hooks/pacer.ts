/**
 * Back-pressure for expensive consumers.
 *
 * A pacer hands the latest value to a consumer, waits until the consumer has
 * finished showing it, measures how long that took, and only then — after a
 * pause proportional to that cost — hands over the next one.
 *
 * Compared with a fixed-rate throttle this adapts by itself: where the work is
 * cheap (a GPU, a fast phone) updates flow at the maximum rate; where it is
 * expensive (software rendering, an old device, a development build) they
 * slow down just enough that the consumer never takes more than a bounded
 * share of the main thread. Input stays responsive either way, and the last
 * value always gets through.
 */

/** Tells the pacer when the consumer has caught up; returns a way to stop waiting. */
export type Settle = (done: () => void) => () => void;

export interface PacerOptions {
  /** Never emit more often than this, ms. */
  minIntervalMs: number;
  /**
   * How long to rest after an emission, as a multiple of what it cost beyond
   * `allowanceMs`. 3 means the consumer gets at most about a quarter of the time.
   */
  loadFactor: number;
  /** Cost that counts as free (a frame or two of unavoidable latency), ms. */
  allowanceMs: number;
  /** Longest rest between two emissions, ms. */
  maxRestMs?: number;
  /** Deliver the latest value to the consumer. */
  onEmit(): void;
  /** Resolves when the consumer has shown what was emitted. */
  settle: Settle;
  /** Clock, ms. Default `performance.now()`. */
  now?: () => number;
}

export interface Pacer {
  /** There is something new to deliver. Cheap; call it on every change. */
  request(): void;
  /** Stop everything. The pacer must not be used afterwards. */
  dispose(): void;
}

export function createPacer(options: PacerOptions): Pacer {
  const { minIntervalMs, loadFactor, allowanceMs, onEmit, settle } = options;
  const maxRestMs = options.maxRestMs ?? 1000;
  const now = options.now ?? (() => performance.now());

  let dirty = false;
  let busy = false;
  let disposed = false;
  let nextAllowedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelSettle: (() => void) | null = null;

  const schedule = () => {
    if (disposed || busy || timer !== null || !dirty) return;
    timer = setTimeout(emit, Math.max(0, nextAllowedAt - now()));
  };

  const emit = () => {
    timer = null;
    if (disposed || !dirty) return;
    dirty = false;
    busy = true;
    const startedAt = now();
    onEmit();
    cancelSettle = settle(() => {
      if (disposed || !busy) return;
      cancelSettle = null;
      const finishedAt = now();
      const excess = Math.max(0, finishedAt - startedAt - allowanceMs);
      nextAllowedAt = Math.max(
        startedAt + minIntervalMs,
        finishedAt + Math.min(maxRestMs, excess * loadFactor),
      );
      busy = false;
      schedule();
    });
  };

  return {
    request() {
      dirty = true;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      cancelSettle?.();
      cancelSettle = null;
    },
  };
}

/**
 * Default `settle`: two animation frames. By the second one, whatever the
 * emission rendered has been laid out, painted and presented, so the elapsed
 * time includes that work.
 */
export const settleAfterTwoFrames: Settle = (done) => {
  if (typeof requestAnimationFrame !== "function") {
    const timer = setTimeout(done, 32);
    return () => clearTimeout(timer);
  }
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(done);
  });
  return () => cancelAnimationFrame(frame);
};
