"use client";

import { useRef } from "react";
import { showToast } from "@/components/ui/toast";
import {
  PLACES_LIMITS,
  selectCanSave,
  selectSavedEntry,
  useHydratePlaces,
  usePlaces,
} from "@/state/places";
import { unsaveWithUndo } from "./actions";
import { HeartIcon } from "./icons";
import { openRenameDialog } from "./renameDialog";
import type { SaveButtonProps } from "./types";

/**
 * Keep this place — or stop keeping it. One tap either way; saving offers to
 * rename, removing offers to undo. Works before the sun numbers are in: they
 * are filled in on the next `recordVisit`.
 */
export function SaveButton({ place, observer, summary, variant, className = "" }: SaveButtonProps) {
  useHydratePlaces();
  const savedEntry = usePlaces((state) => selectSavedEntry(state, place));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const saved = savedEntry !== null;

  const toggle = () => {
    if (savedEntry) {
      unsaveWithUndo(savedEntry);
      return;
    }
    const places = usePlaces.getState();
    if (!selectCanSave(places)) {
      showToast(
        `You’ve saved ${PLACES_LIMITS.saved} places, the most this list holds. Remove one to save another.`,
      );
      return;
    }
    const entry = places.save(place, observer, summary);
    if (entry.savedAt === null) return;
    showToast(`Saved as “${entry.label}”`, {
      label: "Rename",
      onAction: () => openRenameDialog(entry.id, { returnFocus: buttonRef.current }),
    });
  };

  const heart = (
    <HeartIcon
      filled={saved}
      className={`shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${
        saved ? "scale-110 text-accent" : ""
      }`}
    />
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={saved}
      aria-label="Save this place"
      title={saved ? "Saved — tap to remove" : "Save this place"}
      className={
        variant === "pill"
          ? `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-surface-2 pr-4 pl-3.5 text-[15px] leading-[22px] font-medium text-ink select-none ${className}`
          : `grid size-11 shrink-0 place-items-center rounded-full text-ink select-none hover:bg-surface-2 ${className}`
      }
      onClick={toggle}
    >
      {heart}
      {variant === "pill" && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
