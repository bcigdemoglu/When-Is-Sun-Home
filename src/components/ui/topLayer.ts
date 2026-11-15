"use client";

/**
 * Knowing what is on top.
 *
 * A native modal `<dialog>` (the Places sheet, the rename prompt, the day
 * menu …) lives in the browser's top layer and makes everything OUTSIDE its
 * own subtree inert. Anything that must stay usable while a modal is open —
 * the toasts, above all — therefore has to be rendered INSIDE the top-most
 * open modal. This module tracks which one that is.
 */
import { useSyncExternalStore } from "react";

/** Open modal dialogs, in the order they were opened (the last one is on top). */
let stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function isModal(dialog: HTMLDialogElement): boolean {
  try {
    return dialog.matches(":modal");
  } catch {
    // No `:modal` (old engines, jsdom): an open dialog is as good a guess as any.
    return dialog.open;
  }
}

function refresh(): void {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).filter(
    isModal,
  );
  const next = [
    ...stack.filter((dialog) => open.includes(dialog)),
    ...open.filter((dialog) => !stack.includes(dialog)),
  ];
  const changed = next.length !== stack.length || next.some((dialog, i) => dialog !== stack[i]);
  if (!changed) return;
  stack = next;
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null && typeof MutationObserver === "function") {
    // `showModal()` and `close()` flip the `open` attribute …
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    // … and a dialog can also simply be removed (with the element that hosts it).
    observer.observe(document.body, { childList: true });
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer !== null) {
      observer.disconnect();
      observer = null;
      stack = [];
    }
  };
}

const getTopModal = (): HTMLDialogElement | null => {
  const top = stack[stack.length - 1];
  return top && top.isConnected ? top : null;
};
const getServerTopModal = (): HTMLDialogElement | null => null;

/** The top-most open modal `<dialog>`, or null when none is open. */
export function useTopModal(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribe, getTopModal, getServerTopModal);
}
