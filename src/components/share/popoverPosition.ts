/** Where to put a floating panel next to the element that opened it. Pure. */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPlacement {
  top: number;
  left: number;
  /** Tallest the panel may be where it is put; it scrolls inside beyond that. */
  maxHeight: number;
  side: "below" | "above";
}

/** A side with at least this much room is used as is (the panel scrolls) rather than covering the anchor. */
const USABLE_SIDE_HEIGHT = 360;

/**
 * Places a panel of `size` by `anchor` inside a `viewport` of the given size.
 *
 * Vertically: below the anchor if it fits, else above if it fits there, else
 * on the roomier side — shortened to that side's room when that still leaves
 * a usable panel, and only as a last resort (a very short viewport)
 * overlapping the anchor. Horizontally: its left edge lines up with the
 * anchor's, its right edge when the anchor sits in the right half; then it is
 * pushed back inside the viewport. `margin` is kept free at every edge, `gap`
 * between anchor and panel.
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 8,
): PopoverPlacement {
  const available = Math.max(0, viewport.height - 2 * margin);
  const below = viewport.height - margin - (anchor.top + anchor.height + gap);
  const above = anchor.top - gap - margin;

  let side: PopoverPlacement["side"];
  if (size.height <= below) side = "below";
  else if (size.height <= above) side = "above";
  else side = below >= above ? "below" : "above";

  const room = side === "below" ? below : above;
  let maxHeight: number;
  let top: number;
  if (size.height <= room || room >= USABLE_SIDE_HEIGHT) {
    maxHeight = Math.max(0, Math.floor(Math.min(room, available)));
    const height = Math.min(size.height, maxHeight);
    top = side === "below" ? anchor.top + anchor.height + gap : anchor.top - gap - height;
  } else {
    // Neither side is usable: stay on screen, over the anchor if need be.
    maxHeight = Math.floor(available);
    const height = Math.min(size.height, maxHeight);
    top = side === "below" ? anchor.top + anchor.height + gap : anchor.top - gap - height;
    top = Math.max(margin, Math.min(top, viewport.height - margin - height));
  }

  const anchorCentre = anchor.left + anchor.width / 2;
  let left =
    anchorCentre > viewport.width / 2 ? anchor.left + anchor.width - size.width : anchor.left;
  left = Math.max(margin, Math.min(left, viewport.width - margin - size.width));

  return { top: Math.round(top), left: Math.round(left), maxHeight, side };
}
