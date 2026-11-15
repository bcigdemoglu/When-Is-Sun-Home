"use client";

import { useSyncExternalStore } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { selectSavedCount, usePlaces } from "@/state/places";
import {
  dismissHomeScreenHint,
  homeScreenHintSnapshot,
  homeScreenHintText,
  subscribeHomeScreenHint,
} from "./homeScreenHint";

const onServer = () => "" as const;

/**
 * A quiet, dismissible tip at the top of the Places view: on an iPhone or
 * iPad in Safari (not from the Home Screen), with at least one saved place.
 * See `homeScreenHint.ts` for why.
 */
export function HomeScreenHint({ className = "" }: { className?: string }) {
  const savedCount = usePlaces(selectSavedCount);
  const device = useSyncExternalStore(subscribeHomeScreenHint, homeScreenHintSnapshot, onServer);
  if (device === "" || savedCount < 1) return null;
  return (
    <div
      role="note"
      className={`flex items-start gap-1 rounded-xl bg-surface-2 py-0.5 pr-0.5 pl-3 text-ink-2 ${className}`}
    >
      <p className="min-w-0 flex-1 py-2.5 text-[13px] leading-[18px]">
        {homeScreenHintText(device)}
      </p>
      <button
        type="button"
        aria-label="Dismiss this tip"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"
        onClick={dismissHomeScreenHint}
      >
        <CloseIcon width={18} height={18} />
      </button>
    </div>
  );
}
