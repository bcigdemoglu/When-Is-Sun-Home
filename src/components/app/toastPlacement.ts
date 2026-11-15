/**
 * Where the toasts sit, as CSS lengths for the `--toast-*` custom properties
 * (set on the document, because the toasts can be rendered inside an open
 * dialog, outside the shell's own tree).
 *
 * A toast must not cover what the user reaches for next:
 *
 *  - Phone, sheet resting at peek or half: just above the sheet's top edge,
 *    over the map, clear of the map buttons on the right.
 *  - Phone, sheet at full (or no room left above it), and inside any modal:
 *    just above the time bar.
 *  - Desktop: bottom-left of the map, above the floating time bar.
 */
import type { Detent } from "./sheetGeometry";

/** Gap between a toast and whatever it sits above, px. */
export const TOAST_GAP = 12;
/** Height of the docked time bar on phones (without the safe area), px. */
export const PHONE_TIMEBAR_HEIGHT = 64;
/** Width kept free on the right for the map buttons: 12 + 48 + 12, px. */
export const FAB_COLUMN_WIDTH = 72;
/** Room a toast needs above the sheet (two lines of text and the gap), px. */
export const TOAST_MIN_ROOM = 96;

const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
const SAFE_RIGHT = "env(safe-area-inset-right, 0px)";

export interface SheetRest {
  /** Visible height of the resting sheet above the time bar, px. */
  height: number;
  detent: Detent;
  /** Free height between the search pill and the sheet's top edge, px. */
  roomAbove: number;
}

export interface ToastPlacementInput {
  isDesktop: boolean;
  hasTimeBar: boolean;
  /** Desktop: height the floating time bar takes from the bottom of the map, px. */
  desktopClearance: number;
  /** Phone: where the sheet last came to rest; null before it has reported. */
  sheet: SheetRest | null;
  /** Phone: are the map buttons shown above the sheet's top-right corner? */
  hasFabs: boolean;
}

export interface ToastPlacement {
  /** `bottom` of the toasts in the page. */
  bottom: string;
  /** `right` of the toasts in the page (phones; desktop toasts hug the left). */
  right: string;
  /** `bottom` of the toasts while they are shown inside a modal dialog. */
  modalBottom: string;
}

export function toastPlacement(input: ToastPlacementInput): ToastPlacement {
  const { isDesktop, hasTimeBar, desktopClearance, sheet, hasFabs } = input;
  if (isDesktop) {
    const bottom = `${(hasTimeBar ? desktopClearance : 0) + 16}px`;
    return { bottom, right: "auto", modalBottom: bottom };
  }

  const timeBar = hasTimeBar ? `${PHONE_TIMEBAR_HEIGHT}px + ${SAFE_BOTTOM}` : SAFE_BOTTOM;
  const aboveTimeBar = `calc(${timeBar} + ${TOAST_GAP}px)`;
  const aboveSheet = sheet !== null && sheet.detent !== "full" && sheet.roomAbove >= TOAST_MIN_ROOM;
  if (!aboveSheet) return { bottom: aboveTimeBar, right: "16px", modalBottom: aboveTimeBar };

  return {
    bottom: `calc(${timeBar} + ${Math.round(sheet.height) + TOAST_GAP}px)`,
    right: hasFabs ? `calc(${FAB_COLUMN_WIDTH}px + ${SAFE_RIGHT})` : "16px",
    modalBottom: aboveTimeBar,
  };
}
