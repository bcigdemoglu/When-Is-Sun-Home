"use client";

import type { ShareButtonProps } from "./types";

/** Placeholder — replaced by the real share action (native share sheet / copy link / QR). */
export function ShareButton({ variant, className = "" }: ShareButtonProps) {
  return (
    <button type="button" className={className} aria-label="Share this report">
      {variant === "pill" ? "Share" : "↗"}
    </button>
  );
}
