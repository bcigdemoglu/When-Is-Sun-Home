/**
 * The arithmetic of the phone bottom sheet.
 *
 * The sheet is the content of a vertical scroller laid over the map (see the
 * "Bottom sheet" section of globals.css). Scroll position 0 shows only its
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
