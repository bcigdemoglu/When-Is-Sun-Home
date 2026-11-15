/**
 * The "add this app to your Home Screen" tip in the Places view.
 *
 * Safari on iPhone and iPad deletes a site's script-written storage — our
 * saved places — after seven days of browser use without a visit, unless the
 * site has been added to the Home Screen. So people who have saved a place
 * there are told once, quietly, how to keep it.
 *
 * This module holds the decisions (who sees it, what it says) and the
 * remembered dismissal; `HomeScreenHint.tsx` only draws it.
 */
import { detectLocationPlatform } from "@/hooks/useGeolocation";

/** localStorage key that remembers the tip was dismissed. */
export const HOME_SCREEN_HINT_KEY = "sun-home:home-screen-hint:v1";

export interface HomeScreenHintFacts {
  /** Safari itself on an iPhone or iPad (not another browser, not an in-app one). */
  isIosSafari: boolean;
  /** Already running from the Home Screen. */
  standalone: boolean;
  savedCount: number;
  dismissed: boolean;
}

export function shouldShowHomeScreenHint(facts: HomeScreenHintFacts): boolean {
  return facts.isIosSafari && !facts.standalone && facts.savedCount >= 1 && !facts.dismissed;
}

/** The tip, naming the device in hand. */
export function homeScreenHintText(device: "iPhone" | "iPad"): string {
  return `On ${device}, add this app to your Home Screen (Share › Add to Home Screen) so Safari keeps your saved places.`;
}

interface NavigatorFacts {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

/** iPads introduce themselves as iPads, or (by default) as a Mac with a touch screen. */
export function iosDevice(nav: NavigatorFacts): "iPhone" | "iPad" {
  const ua = nav.userAgent ?? "";
  if (/iPad/.test(ua)) return "iPad";
  if (!/iPhone|iPod/.test(ua) && nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)
    return "iPad";
  return "iPhone";
}

/** Is the page running as an installed app (from the Home Screen)? */
export function isStandalone(
  nav: NavigatorFacts,
  matchMedia?: (query: string) => { matches: boolean },
): boolean {
  if (nav.standalone === true) return true;
  try {
    return matchMedia ? matchMedia("(display-mode: standalone)").matches : false;
  } catch {
    return false;
  }
}

// ── The remembered dismissal (an external store, so React can subscribe) ───

let dismissedThisSession = false;
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return window.localStorage.getItem(HOME_SCREEN_HINT_KEY) !== null;
  } catch {
    // Storage is blocked: nothing was remembered, and nothing can be.
    return false;
  }
}

/**
 * Everything about this browser that decides the tip, as one stable string:
 * "" when it must not be shown, else the device to name. (A string, so that
 * `useSyncExternalStore` sees the same snapshot until something changes.)
 */
export function homeScreenHintSnapshot(): "" | "iPhone" | "iPad" {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & { standalone?: boolean };
  if (detectLocationPlatform(nav) !== "ios-safari") return "";
  const media =
    typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined;
  if (isStandalone(nav, media) || readDismissed()) return "";
  return iosDevice(nav);
}

export function subscribeHomeScreenHint(listener: () => void): () => void {
  listeners.add(listener);
  // Dismissed in another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === HOME_SCREEN_HINT_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Never show the tip again (in this browser; at least for this visit if storage is blocked). */
export function dismissHomeScreenHint(): void {
  dismissedThisSession = true;
  try {
    window.localStorage.setItem(HOME_SCREEN_HINT_KEY, "dismissed");
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of Array.from(listeners)) listener();
}

/** Tests only: forget the in-memory dismissal. */
export function resetHomeScreenHintForTests(): void {
  dismissedThisSession = false;
}
