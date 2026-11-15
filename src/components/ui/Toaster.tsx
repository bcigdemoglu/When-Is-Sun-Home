"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useToasts } from "./toast";
import { useTopModal } from "./topLayer";

/**
 * Renders the toasts raised with `showToast` (see `toast.ts`) — always on top
 * and always tappable, whatever else is open:
 *
 *  - While a modal `<dialog>` is open (the Places sheet, the rename prompt…)
 *    everything outside it is inert, so the toasts move INSIDE the top-most
 *    one.
 *  - The container is itself a manual popover, i.e. in the browser's top
 *    layer, and is raised again whenever another popover opens (the share
 *    sheet), so nothing can cover it. Where the Popover API is missing it is
 *    an ordinary fixed element with a high z-index.
 *
 * The parent only says where it sits (a `fixed` position, which may differ
 * inside a modal: `data-in-modal`); announcements are polite so they never
 * interrupt. A toast is a solid surface from its first frame: it slides in,
 * it never fades.
 */
export function Toaster({ className = "" }: { className?: string }) {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);
  const host = useTopModal();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    // Without the Popover API this stays an ordinary fixed element (see the class list).
    if (!element || typeof element.showPopover !== "function") return;
    element.setAttribute("popover", "manual");
    const raise = () => {
      try {
        if (element.matches(":popover-open")) element.hidePopover();
        element.showPopover();
      } catch {
        // Not connected, or the engine disagrees: the fixed fallback still shows.
      }
    };
    raise();
    // Another popover opening goes on top of this one: step back over it.
    const onToggle = (event: Event) => {
      const opened = (event as ToggleEvent).newState === "open";
      if (opened && event.target !== element) raise();
    };
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      try {
        if (element.matches(":popover-open")) element.hidePopover();
      } catch {
        // already gone
      }
    };
    // Moving into (or out of) a dialog re-creates the element: show it again.
  }, [host]);

  const region = (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-toaster=""
      data-in-modal={host ? "" : undefined}
      // Exactly as large as the toasts in it (nothing when there are none), so
      // it never lies over anything else: no `pointer-events` tricks needed.
      className={`toaster z-[2000] mx-auto flex w-fit flex-col items-center gap-2 lg:mx-0 lg:items-start ${className}`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex min-h-12 max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2 rounded-[26px] bg-ink py-0.5 pr-1 pl-4 text-sm text-surface opacity-100 shadow-float motion-safe:animate-[toast-in_0.2s_ease-out]"
        >
          <span className="min-w-0 py-2">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="h-11 min-w-11 shrink-0 rounded-full px-3 text-sm font-semibold text-accent-on-ink hover:bg-surface/10"
              onClick={() => {
                toast.action?.onAction();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <span className="w-3" />
          )}
        </div>
      ))}
    </div>
  );

  // `key` makes the move a clean remount, so the effect above runs for the new element.
  return host ? createPortal(region, host, "toaster") : region;
}
