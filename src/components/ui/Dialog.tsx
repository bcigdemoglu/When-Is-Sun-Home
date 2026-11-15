"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { CloseIcon } from "./icons";

interface DialogProps {
  open: boolean;
  /** Asked to close: Escape, a tap on the backdrop, or the close button. */
  onClose(): void;
  title: string;
  /**
   * - "sheet": a bottom sheet on phones, a centred card on desktop.
   * - "menu":  a bottom sheet on phones; on desktop a small card anchored
   *            above the element in `anchorRef` (what opened it).
   */
  variant?: "sheet" | "menu";
  anchorRef?: RefObject<HTMLElement | null>;
  /** Hide the title visually (it still names the dialog). */
  hideTitle?: boolean;
  children: ReactNode;
}

/**
 * A modal on the native `<dialog>` element: the browser provides the top
 * layer, the focus trap, Escape and the inert background. Its content is
 * only mounted while it is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  variant = "sheet",
  anchorRef,
  hideTitle = false,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const anchor = anchorRef ? anchorRef.current : null;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        dialog.style.setProperty("--anchor-top", `${rect.top}px`);
        dialog.style.setProperty(
          "--anchor-left",
          `${Math.max(16, Math.min(rect.left, window.innerWidth - 336))}px`,
        );
      }
      // Older engines (and jsdom) lack showModal: fall back to a plain open dialog.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open, anchorRef]);

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      data-variant={variant}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Let React own the open state (the effect above closes it).
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself is on its backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="px-4 pt-2 pb-4 lg:px-5 lg:pt-4 lg:pb-5">
          <div
            aria-hidden="true"
            className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-line lg:hidden"
          />
          <div
            className={`flex items-center gap-3 ${hideTitle ? "justify-end" : "mb-2 justify-between"}`}
          >
            <h2 id={titleId} className={hideTitle ? "sr-only" : "type-title text-ink"}>
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              className={`-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink ${
                hideTitle ? "-mb-9 relative z-10" : ""
              }`}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
