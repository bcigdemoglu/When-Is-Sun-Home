/**
 * Global keyboard shortcuts, as a pure decision: given a key press and where
 * the focus is, what (if anything) should happen.
 *
 *   ← / →           move the time 5 minutes
 *   Shift + ← / →   move the time 1 hour
 *   /               focus the address search
 *
 * Nothing fires while the focus is somewhere that uses those keys itself (a
 * text field, a slider, a radio group, the map) or while any overlay is open
 * (a dialog, the search takeover, a popover) — see `overlayIsOpen`.
 */

export type ShortcutAction = { type: "time"; deltaMinutes: number } | { type: "focus-search" };

export interface KeyPress {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The event already handled elsewhere. */
  defaultPrevented?: boolean;
}

/** Where arrow keys (or typing) already mean something. */
const OWN_KEYS_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='slider']",
  "[role='radio']",
  "[role='radiogroup']",
  "[role='listbox']",
  "[role='option']",
  "[role='combobox']",
  "[role='menu']",
  "[role='tablist']",
  "dialog[open]",
  "[role='dialog']",
  "[role='alertdialog']",
  "[popover]",
  ".maplibregl-map",
].join(",");

/** Anything that is "in front of" the page while it is open. */
const OVERLAY_SELECTORS = [
  "dialog[open]",
  "[role='dialog']",
  "[role='alertdialog']",
  // Popovers that are showing — except the toasts, which are always there.
  "[popover]:popover-open:not([data-toaster])",
];

/**
 * True while any overlay is open — a native dialog, a custom one (the search
 * takeover, a rename prompt), a popover (the share sheet). Shortcuts wait: the
 * person is busy with what is in front, wherever the focus happens to be.
 */
export function overlayIsOpen(root: ParentNode | null | undefined): boolean {
  if (!root || typeof root.querySelector !== "function") return false;
  for (const selector of OVERLAY_SELECTORS) {
    try {
      if (root.querySelector(selector) !== null) return true;
    } catch {
      // An engine without `:popover-open` has no popovers to find either.
    }
  }
  return false;
}

/** True when the focused element handles arrow keys / typing itself. */
export function usesKeysItself(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest(OWN_KEYS_SELECTOR) !== null;
}

export function shortcutFor(press: KeyPress, focusUsesKeys: boolean): ShortcutAction | null {
  if (press.defaultPrevented || focusUsesKeys) return null;
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  switch (press.key) {
    case "ArrowLeft":
      return { type: "time", deltaMinutes: press.shiftKey ? -60 : -5 };
    case "ArrowRight":
      return { type: "time", deltaMinutes: press.shiftKey ? 60 : 5 };
    case "/":
      return { type: "focus-search" };
    default:
      return null;
  }
}

/** A minute of the day moved by `delta`, kept within the day. */
export function shiftMinute(minuteOfDay: number, deltaMinutes: number): number {
  return Math.min(1439, Math.max(0, Math.round(minuteOfDay + deltaMinutes)));
}
