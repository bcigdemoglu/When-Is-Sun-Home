/**
 * Global keyboard shortcuts, as a pure decision: given a key press and where
 * the focus is, what (if anything) should happen.
 *
 *   ← / →           move the time 5 minutes
 *   Shift + ← / →   move the time 1 hour
 *   /               focus the address search
 *
 * Nothing fires while the focus is somewhere that uses those keys itself: a
 * text field, a slider, a radio group, the map, an open dialog.
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
  ".maplibregl-map",
].join(",");

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
