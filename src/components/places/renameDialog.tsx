"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PLACES_LIMITS, entryAddress, entryLabel, selectEntry, usePlaces } from "@/state/places";

interface RenameDialogProps {
  entryId: string;
  onClose: () => void;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled])";

/** A compact dialog to name a place: one field, Save / Cancel, Enter saves. */
function RenameDialog({ entryId, onClose }: RenameDialogProps) {
  const entry = usePlaces((state) => selectEntry(state, entryId));
  const rename = usePlaces((state) => state.rename);
  const [text, setText] = useState(() => (entry ? entryLabel(entry) : ""));
  const cardRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();
  const gone = entry === null;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  // The place was removed meanwhile (here or in another tab): nothing to name.
  useEffect(() => {
    // Deferred: a root cannot unmount itself in the middle of its own commit.
    if (gone) queueMicrotask(onClose);
  }, [gone, onClose]);

  if (!entry) return null;

  const canSave = text.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    rename(entry.id, text);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !card.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !card.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-start justify-center bg-[var(--backdrop)] px-4 pt-[max(16px,calc(env(safe-area-inset-top)+12dvh))] transition-opacity duration-150 ease-out motion-reduce:transition-none starting:opacity-0"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="w-full max-w-[400px] rounded-card border border-line bg-surface p-4 text-ink shadow-float"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={titleId} className="text-[17px] leading-[22px] font-semibold">
          Name this place
        </h2>
        <p id={hintId} className="mt-0.5 truncate text-[13px] leading-[18px] text-ink-2">
          {entryAddress(entry)}
        </p>
        <input
          ref={inputRef}
          type="text"
          aria-label="Name"
          maxLength={PLACES_LIMITS.labelMaxLength}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
          placeholder="Elm St backyard"
          className="mt-3 h-12 w-full rounded-xl border border-line bg-page px-3.5 text-[16px] leading-[22px] text-ink placeholder:text-ink-3 focus:border-ink-2"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-11 rounded-full px-4 text-[15px] leading-[22px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            aria-disabled={!canSave}
            className={`h-11 rounded-full bg-ink px-5 text-[15px] leading-[22px] font-medium text-surface ${
              canSave ? "" : "opacity-40"
            }`}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

let mounted: { root: Root; container: HTMLElement } | null = null;

/** Close the rename dialog, if one is open. */
export function closeRenameDialog(): void {
  if (!mounted) return;
  const { root, container } = mounted;
  mounted = null;
  root.unmount();
  container.remove();
}

/**
 * Ask for a new name for a saved place. The dialog mounts itself next to the
 * app (its own React root on `document.body`), so it opens no matter which
 * component asked — including from a toast that outlived the button that
 * raised it. Focus returns to `returnFocus` when it closes.
 */
export function openRenameDialog(
  entryId: string,
  options: { returnFocus?: HTMLElement | null } = {},
): void {
  if (typeof document === "undefined") return;
  closeRenameDialog();
  const container = document.createElement("div");
  container.dataset.renameDialog = "";
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const close = () => {
    if (mounted?.root !== root) return;
    closeRenameDialog();
    const target = options.returnFocus;
    if (target && target.isConnected) target.focus({ preventScroll: true });
  };
  root.render(<RenameDialog entryId={entryId} onClose={close} />);
}
