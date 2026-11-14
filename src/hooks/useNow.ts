"use client";

import { useMemo, useSyncExternalStore } from "react";
import { nowInZone } from "@/lib/analysis";

const MS_PER_MINUTE = 60_000;

/** Calls `onTick` just after every minute boundary, and when the tab is shown again. */
function subscribeToMinutes(onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    // A few ms past the boundary, so the snapshot has certainly rolled over.
    const delay = MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE) + 25;
    timer = setTimeout(() => {
      onTick();
      arm();
    }, delay);
  };
  arm();

  // Timers are throttled (or frozen) in background tabs: catch up on return.
  const onVisibility = () => {
    if (document.visibilityState === "visible") onTick();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Whole minutes since the epoch: stable for the length of a minute. */
const getMinuteSnapshot = (): number | null => Math.floor(Date.now() / MS_PER_MINUTE);
const getServerSnapshot = (): number | null => null;

/**
 * The current minute as "whole minutes since the epoch", ticking on the
 * minute. `null` on the server and during hydration, so the server markup and
 * the first client render always agree.
 */
export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribeToMinutes, getMinuteSnapshot, getServerSnapshot);
}

export interface ZonedNow {
  /** "YYYY-MM-DD" on the wall clock of the zone. */
  date: string;
  /** 0..1439 on the wall clock of the zone. */
  minuteOfDay: number;
}

/**
 * Today's date and the current minute on the wall clock of `timeZone` (never
 * the browser's zone), updated every minute. `null` without a zone, on the
 * server and during hydration.
 */
export function useNow(timeZone: string | null): ZonedNow | null {
  const minuteEpoch = useMinuteClock();
  return useMemo(() => {
    if (timeZone === null || minuteEpoch === null) return null;
    try {
      return nowInZone(timeZone, new Date(minuteEpoch * MS_PER_MINUTE));
    } catch {
      return null;
    }
  }, [timeZone, minuteEpoch]);
}
