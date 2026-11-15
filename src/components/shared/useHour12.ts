"use client";

import { useSyncExternalStore } from "react";
import { detectHour12 } from "./format";

const subscribeNever = () => () => {};
const getHour12 = () => detectHour12();
const getServerHour12 = () => true;

/**
 * Whether the user's locale writes times with AM/PM. `true` on the server and
 * during hydration (so the markup always matches), then the real answer.
 * Every clock time in the app goes through this, so a 24-hour reader never
 * sees "3:42 PM" in one corner and "15:42" in another.
 */
export function useHour12(): boolean {
  return useSyncExternalStore(subscribeNever, getHour12, getServerHour12);
}
