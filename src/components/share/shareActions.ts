/**
 * The browser side of sharing: is there a native share sheet worth using,
 * and copying text to the clipboard with a fallback. Nothing here throws.
 */

/**
 * True on devices where one tap should open the system share sheet: the Web
 * Share API exists AND the primary pointer is a finger. Desktop browsers that
 * also implement `navigator.share` (Safari, Edge, Chrome on some systems) get
 * the popover instead — there a copyable link and a QR code are more useful
 * than the operating system's sheet.
 */
export function canShareNatively(data?: ShareData): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    if (typeof window.matchMedia !== "function") return false;
    if (!window.matchMedia("(pointer: coarse)").matches) return false;
    if (data && typeof navigator.canShare === "function" && !navigator.canShare(data)) return false;
    return true;
  } catch {
    return false;
  }
}

/** The user closed the share sheet without choosing anything: not an error. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** The pre-Clipboard-API way: select a hidden textarea and ask the browser to copy it. */
function copyWithSelection(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  // Off screen but still selectable; 16px keeps iOS from zooming the page.
  area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
  document.body.appendChild(area);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
}

/**
 * Copies `text` to the clipboard: the async Clipboard API where it works
 * (secure context, permission, user activation), else the selection fallback.
 * Resolves to whether it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // not allowed / not focused: try the fallback
  }
  try {
    return copyWithSelection(text);
  } catch {
    return false;
  }
}
