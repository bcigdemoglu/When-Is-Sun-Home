"use client";

import { useState } from "react";

/** Same keys, and every value identical (`Object.is`). */
export function shallowEqual(a: object, b: object): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * `value`, but with the SAME object returned for as long as its fields have
 * not changed — for hooks that build a fresh result object on every render.
 * It knows nothing about which fields there are, so new ones pass through.
 */
export function useShallowStable<T extends object>(value: T): T {
  const [stable, setStable] = useState(value);
  if (shallowEqual(stable, value)) return stable;
  // Adjusting state while rendering: React re-renders at once with the new object.
  setStable(value);
  return value;
}
