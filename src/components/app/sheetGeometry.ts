/**
 * The arithmetic of the phone bottom sheet.
 *
 * The map and the sheet are the content of one vertical scroller (see the
 * "Bottom sheet" section of globals.css): the map stays stuck to its top and
 * the sheet scrolls up over it. Scroll position 0 shows only the sheet's
 * header — the "peek" detent; scrolling raises it to "half" and "full", after
 * which the content keeps scrolling under the handle.
 */

export type Detent = "peek" | "half" | "full";

export interface SheetMetrics {
  /** Height of the scroller (the area the sheet lives in), px. */
  viewport: number;
  /** Height of the sheet at peek: its always-visible header, px. */
  peek: number;
  /** Height of the sheet at half, px. Equal to `peek` when there is no half detent. */
  half: number;
  /** Space kept free above the sheet at full (the search pill lives there), px. */
  gap: number;
}

/** Below this much extra height, "half" is not worth being a stop of its own. */
const MIN_HALF_STEP = 72;

/**
 * Resolve the three heights from what was measured. Everything is clamped so
 * that peek ≤ half ≤ full even on a short screen (landscape, keyboard up).
 */
export function sheetMetrics(input: {
  viewport: number;
  /** Measured height of the header block. */
  header: number;
  gap: number;
  /** Half detent as a share of the viewport, or null for none. */
  halfRatio: number | null;
  /** Peek is at least this share of the viewport (the start screen opens taller). */
  minPeekRatio?: number;
}): SheetMetrics {
  const viewport = Math.max(0, Math.round(input.viewport));
  const full = Math.max(0, viewport - Math.max(0, Math.round(input.gap)));
  const wanted = Math.max(input.header, viewport * (input.minPeekRatio ?? 0));
  const peek = Math.round(Math.min(Math.max(0, wanted), full));
  let half = peek;
  if (input.halfRatio !== null) {
    const target = Math.round(viewport * input.halfRatio);
    if (target - peek >= MIN_HALF_STEP && full - target >= MIN_HALF_STEP) half = target;
  }
  return { viewport, peek, half, gap: viewport - full };
}

/** Scroll position of each detent. */
export function detentOffsets(metrics: SheetMetrics): Record<Detent, number> {
  const full = Math.max(0, metrics.viewport - metrics.gap - metrics.peek);
  const half = Math.min(full, Math.max(0, metrics.half - metrics.peek));
  return { peek: 0, half, full };
}

/** Which detents exist (half may coincide with peek, full with either). */
export function availableDetents(metrics: SheetMetrics): Detent[] {
  const offsets = detentOffsets(metrics);
  const detents: Detent[] = ["peek"];
  if (offsets.half > 0 && offsets.half < offsets.full) detents.push("half");
  if (offsets.full > 0) detents.push("full");
  return detents;
}

/**
 * The detent a scroll position belongs to: the nearest one, and "full" for
 * everything at or beyond it (the content scrolling inside the open sheet).
 */
export function detentAt(scrollTop: number, metrics: SheetMetrics): Detent {
  const offsets = detentOffsets(metrics);
  let best: Detent = "peek";
  let bestDistance = Infinity;
  for (const detent of availableDetents(metrics)) {
    if (detent === "full" && scrollTop >= offsets.full - 1) return "full";
    const distance = Math.abs(scrollTop - offsets[detent]);
    if (distance < bestDistance) {
      best = detent;
      bestDistance = distance;
    }
  }
  return best;
}

/** Where a tap on the handle goes next: up one stop, and from the top back down to peek. */
export function nextDetent(current: Detent, metrics: SheetMetrics): Detent {
  const detents = availableDetents(metrics);
  const index = detents.indexOf(current);
  return detents[(index + 1) % detents.length] ?? "peek";
}

/** How much of the sheet is on screen at a scroll position, px. */
export function visibleSheetHeight(scrollTop: number, metrics: SheetMetrics): number {
  const full = Math.max(0, metrics.viewport - metrics.gap);
  return Math.min(full, Math.max(metrics.peek, metrics.peek + scrollTop));
}

/**
 * Is the sheet (about to be) all the way up? True from halfway between the
 * last stop below "full" and "full" itself — early enough that the strip
 * behind the search pill is already solid when the sheet arrives under it.
 */
export function coveringAt(scrollTop: number, metrics: SheetMetrics): boolean {
  const offsets = detentOffsets(metrics);
  if (offsets.full <= 0) return false;
  const below = availableDetents(metrics).includes("half") ? offsets.half : 0;
  return scrollTop >= below + (offsets.full - below) / 2;
}

/** How close to a stop counts as being on it, px. */
const AT_REST_TOLERANCE = 2;

/**
 * Where a sheet that came to rest BETWEEN two stops should go: the nearest
 * one. `null` when it is on a stop, or at / beyond "full" (reading the
 * content). The browser's scroll snapping normally leaves nothing to
 * correct; this is the net under it.
 */
export function restingCorrection(scrollTop: number, metrics: SheetMetrics): number | null {
  if (metrics.viewport <= 0) return null;
  const offsets = detentOffsets(metrics);
  if (scrollTop >= offsets.full - AT_REST_TOLERANCE) return null;
  let best = 0;
  let bestDistance = Infinity;
  for (const detent of availableDetents(metrics)) {
    const distance = Math.abs(scrollTop - offsets[detent]);
    if (distance < bestDistance) {
      best = offsets[detent];
      bestDistance = distance;
    }
  }
  return bestDistance <= AT_REST_TOLERANCE ? null : best;
}
