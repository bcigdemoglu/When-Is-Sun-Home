"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `value`, but changing at most once per `intervalMs`.
 *
 * Unlike a debounce this keeps emitting DURING a stream of changes (a slider
 * drag, the play animation), and unlike `useDeferredValue` it cannot be
 * starved by one: whatever arrives while the timer is pending is delivered
 * when it fires, so the latest value always gets through. A change after a
 * quiet spell is delivered on the next task (not synchronously).
 *
 * Use it to cap how often an expensive consumer re-renders.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitAt = useRef(0);

  useEffect(() => {
    latest.current = value;
    if (timer.current !== null) return; // the pending emit will pick this value up
    const wait = Math.max(0, lastEmitAt.current + intervalMs - performance.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      lastEmitAt.current = performance.now();
      setThrottled(latest.current);
    }, wait);
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return throttled;
}
