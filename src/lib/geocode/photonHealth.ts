/**
 * Whether Photon, the search-as-you-type geocoder, can be reached right now.
 *
 * A public service can cut a client off (throttling, an outage, a CORS
 * failure in front of it). After a failed request it is "down" for a
 * cool-down, during which nothing is sent to it; after that the next attempt
 * is a "probing" one, and its outcome decides: back "up", or "down" again.
 *
 * Module state: one health for the page, shared by search and reverse
 * geocoding. No React; safe to import on the server (where it stays "up").
 */

export type PhotonHealth = "up" | "down" | "probing";

/** How long Photon is left alone after a failure. */
export const PHOTON_COOL_DOWN_MS = 60_000;

let health: PhotonHealth = "up";
/** When "down": the time from which a probe may be sent. */
let retryAt = 0;
let listeningForOnline = false;
const listeners = new Set<() => void>();

function set(next: PhotonHealth): void {
  if (health === next) return;
  health = next;
  for (const listener of Array.from(listeners)) listener();
}

export function getPhotonHealth(): PhotonHealth {
  return health;
}

export function subscribePhotonHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A request to Photon was answered. */
export function reportPhotonSuccess(): void {
  set("up");
}

/**
 * A phone cuts requests off when the user switches apps (iOS Safari: "Load
 * failed"). That says nothing about Photon: failures that end while the page
 * is hidden, or just after it is shown again, are not counted.
 */
export const BACKGROUND_GRACE_MS = 1000;

/** When the page last came back to the foreground. */
let visibleSince = Number.NEGATIVE_INFINITY;

function pageIsHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * True if a request that failed at `now` may have been cut off by the page
 * going to the background rather than by the service.
 */
export function failedInBackground(now: number = Date.now()): boolean {
  return pageIsHidden() || now - visibleSince < BACKGROUND_GRACE_MS;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (pageIsHidden()) return;
    visibleSince = Date.now();
    // Back in front of the user is the moment to try again: do not sit out the cool-down.
    retryAt = 0;
  });
}

/**
 * A request to Photon failed for good (not aborted; retries used up). Ignored
 * when the page was in the background — see `failedInBackground`.
 */
export function reportPhotonFailure(now: number = Date.now()): void {
  if (failedInBackground(now)) return;
  retryAt = now + PHOTON_COOL_DOWN_MS;
  set("down");
  // Coming back online is the best moment to try again, too.
  if (!listeningForOnline && typeof window !== "undefined") {
    listeningForOnline = true;
    window.addEventListener("online", () => {
      retryAt = 0;
    });
  }
}

/** True while Photon should be left alone: down, and the cool-down still running. */
export function isPhotonResting(now: number = Date.now()): boolean {
  return health === "down" && now < retryAt;
}

/**
 * Call when a request to Photon is wanted (the user typed). If Photon is down
 * and the cool-down is over, the health becomes "probing" — requests flow
 * again and the first outcome settles it. Returns whether a probe started.
 */
export function probePhotonIfDue(now: number = Date.now()): boolean {
  if (health !== "down" || now < retryAt) return false;
  set("probing");
  return true;
}

/** Back to "up" with no history. For tests and dev harnesses. */
export function resetPhotonHealth(): void {
  retryAt = 0;
  visibleSince = Number.NEGATIVE_INFINITY;
  set("up");
}
