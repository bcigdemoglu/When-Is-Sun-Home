/**
 * A listing link that arrives whole — pasted into the field, read from the
 * clipboard, or handed over from the start screen — as opposed to text that
 * is being typed.
 *
 * Such a link is "armed": the search looks its address up in depth (see
 * `lookUpListing`) and, once, opens the place without a second tap if the
 * answer is clearly that house. Module state, like the toasts: there is one
 * search experience on the page.
 */
import { create } from "zustand";
import { showToast } from "@/components/ui/toast";
import { parseListingLink, type ListingLink } from "@/lib/geocode/listingLink";

interface ListingPasteState {
  /**
   * The link (by its address key) that arrived whole. `go` is true until its
   * lookup has answered: that one answer may open the place by itself.
   */
  armed: { key: string; go: boolean } | null;
  /**
   * Text for the search field from outside the search (the start screen).
   * A new object each time, so the same link can be handed over twice.
   */
  handoff: { text: string } | null;
}

export const useListingPaste = create<ListingPasteState>(() => ({ armed: null, handoff: null }));

/**
 * `text` arrived whole. If it holds a listing link with an address, arm it.
 * Returns what the text holds (null: no listing link).
 */
export function armListingLink(text: string): ListingLink | null {
  const link = parseListingLink(text);
  if (link?.kind === "address") {
    useListingPaste.setState({ armed: { key: link.key, go: true } });
  }
  return link;
}

/**
 * The armed link's lookup has answered. True — once — if that answer may
 * open the place by itself.
 */
export function settleListingLink(key: string): boolean {
  const { armed } = useListingPaste.getState();
  if (!armed || armed.key !== key || !armed.go) return false;
  useListingPaste.setState({ armed: { key, go: false } });
  return true;
}

/** Search was closed: nothing is waiting to open any more. */
export function disarmListingLink(): void {
  const { armed, handoff } = useListingPaste.getState();
  if (armed || handoff) useListingPaste.setState({ armed: null, handoff: null });
}

/** From outside the search: open it on `text`, as if it had been pasted there. */
export function handOffToSearch(text: string): void {
  armListingLink(text);
  useListingPaste.setState({ handoff: { text } });
}

/** The hand-over has been taken into the field. */
export function takeHandoff(): void {
  if (useListingPaste.getState().handoff) useListingPaste.setState({ handoff: null });
}

// ─── The clipboard ─────────────────────────────────────────────────────────

/** How many characters must arrive in one edit for it to count as pasted, not typed. */
const ARRIVED_AT_ONCE = 8;

/**
 * True when the step from `previous` to `next` put a listing link into the
 * field in one go — a paste, a drop, a keyboard's clipboard chip — rather
 * than by typing its last character.
 */
export function arrivedWhole(previous: string, next: string): boolean {
  let start = 0;
  const shorter = Math.min(previous.length, next.length);
  while (start < shorter && previous[start] === next[start]) start++;
  let end = 0;
  while (
    end < shorter - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  if (next.length - start - end < ARRIVED_AT_ONCE) return false;
  const link = parseListingLink(next);
  if (link?.kind !== "address") return false;
  const before = parseListingLink(previous);
  return !(before?.kind === "address" && before.key === link.key);
}

/** Whether this browser lets a page ask for the clipboard's text at all. */
export function canReadClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.readText === "function" &&
    (typeof window === "undefined" || window.isSecureContext !== false)
  );
}

export const CLIPBOARD_REFUSED_MESSAGE =
  "Couldn’t read the clipboard. Paste the link into the search field instead.";
export const NO_LINK_COPIED_MESSAGE =
  "No listing link on the clipboard. Copy a home’s link from Zillow, Redfin, Realtor.com or Trulia first.";

/**
 * Read the clipboard — call it straight from the tap, or the browser refuses
 * (iOS then shows its own "Paste" bubble for the person to confirm). Resolves
 * with the clipboard's text if it holds a listing link; otherwise says why
 * not in a toast and resolves with null. Never rejects.
 */
export async function readListingFromClipboard(): Promise<string | null> {
  let text: string;
  try {
    if (!canReadClipboard()) throw new Error("no clipboard access");
    text = await navigator.clipboard.readText();
  } catch {
    showToast(CLIPBOARD_REFUSED_MESSAGE);
    return null;
  }
  if (parseListingLink(text) === null) {
    showToast(NO_LINK_COPIED_MESSAGE);
    return null;
  }
  return text.trim();
}

/** What to say when the place opened at a worked-out position rather than a mapped house. */
export function approximateMessage(label: string): string {
  return `Near ${label}: this house isn’t on the map yet. Drag the pin onto it.`;
}
