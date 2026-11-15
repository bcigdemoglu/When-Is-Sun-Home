"use client";

import type { SaveButtonProps } from "./types";

/** Placeholder — replaced by the save/unsave toggle. */
export function SaveButton({ variant, className = "" }: SaveButtonProps) {
  return (
    <button type="button" className={className} aria-label="Save this place">
      {variant === "pill" ? "Save" : "♡"}
    </button>
  );
}
