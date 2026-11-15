// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BACKGROUND_GRACE_MS,
  PHOTON_COOL_DOWN_MS,
  failedInBackground,
  getPhotonHealth,
  isPhotonResting,
  probePhotonIfDue,
  reportPhotonFailure,
  reportPhotonSuccess,
  resetPhotonHealth,
  subscribePhotonHealth,
} from "./photonHealth";

/** Send the page to the background or bring it back, as the browser would. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

beforeEach(() => {
  resetPhotonHealth();
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
  resetPhotonHealth();
});

describe("photonHealth", () => {
  test("starts up; a failure takes it down for the cool-down", () => {
    expect(getPhotonHealth()).toBe("up");
    expect(isPhotonResting(0)).toBe(false);
    reportPhotonFailure(1000);
    expect(getPhotonHealth()).toBe("down");
    expect(isPhotonResting(1000)).toBe(true);
    expect(isPhotonResting(1000 + PHOTON_COOL_DOWN_MS - 1)).toBe(true);
    expect(isPhotonResting(1000 + PHOTON_COOL_DOWN_MS)).toBe(false);
    expect(PHOTON_COOL_DOWN_MS).toBe(60_000);
  });

  test("no probe during the cool-down; one becomes due after it", () => {
    reportPhotonFailure(1000);
    expect(probePhotonIfDue(1000 + PHOTON_COOL_DOWN_MS - 1)).toBe(false);
    expect(getPhotonHealth()).toBe("down");
    expect(probePhotonIfDue(1000 + PHOTON_COOL_DOWN_MS)).toBe(true);
    expect(getPhotonHealth()).toBe("probing");
    // Already probing: nothing more to start.
    expect(probePhotonIfDue(1000 + PHOTON_COOL_DOWN_MS + 5)).toBe(false);
    expect(isPhotonResting(1000 + PHOTON_COOL_DOWN_MS + 5)).toBe(false);
  });

  test("the probe's outcome settles it: up again, or down for another cool-down", () => {
    reportPhotonFailure(0);
    probePhotonIfDue(PHOTON_COOL_DOWN_MS);
    reportPhotonFailure(PHOTON_COOL_DOWN_MS + 10);
    expect(getPhotonHealth()).toBe("down");
    expect(probePhotonIfDue(2 * PHOTON_COOL_DOWN_MS)).toBe(false);
    expect(probePhotonIfDue(2 * PHOTON_COOL_DOWN_MS + 10)).toBe(true);
    reportPhotonSuccess();
    expect(getPhotonHealth()).toBe("up");
    expect(probePhotonIfDue(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  test("subscribers hear about changes only", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhotonHealth(listener);
    reportPhotonSuccess();
    expect(listener).not.toHaveBeenCalled();
    reportPhotonFailure(0);
    reportPhotonFailure(5);
    expect(listener).toHaveBeenCalledTimes(1);
    reportPhotonSuccess();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    reportPhotonFailure(10);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("photonHealth — the page in the background", () => {
  test("a failure while the page is hidden says nothing about Photon", () => {
    setVisibility("hidden");
    expect(failedInBackground()).toBe(true);
    reportPhotonFailure();
    expect(getPhotonHealth()).toBe("up");
    expect(isPhotonResting()).toBe(false);
  });

  test("nor does one that lands within a second of coming back (iOS reports the cut-off late)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setVisibility("hidden");
    setVisibility("visible");
    const back = Date.now();
    vi.setSystemTime(back + BACKGROUND_GRACE_MS - 1);
    expect(failedInBackground()).toBe(true);
    reportPhotonFailure();
    expect(getPhotonHealth()).toBe("up");

    // After that, a failure is a failure again.
    vi.setSystemTime(back + BACKGROUND_GRACE_MS);
    expect(failedInBackground()).toBe(false);
    reportPhotonFailure();
    expect(getPhotonHealth()).toBe("down");
    expect(BACKGROUND_GRACE_MS).toBe(1000);
  });

  test("a page that was never hidden gets no grace", () => {
    expect(failedInBackground()).toBe(false);
    reportPhotonFailure();
    expect(getPhotonHealth()).toBe("down");
  });

  test("coming back makes a probe due at once instead of sitting out the cool-down", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    reportPhotonFailure();
    expect(getPhotonHealth()).toBe("down");
    vi.setSystemTime(Date.now() + 5000);
    expect(probePhotonIfDue()).toBe(false);

    setVisibility("hidden");
    // Going away changes nothing…
    expect(isPhotonResting()).toBe(true);
    setVisibility("visible");
    // …coming back does.
    expect(isPhotonResting()).toBe(false);
    expect(probePhotonIfDue()).toBe(true);
    expect(getPhotonHealth()).toBe("probing");
  });

  test("a success is always a success, hidden or not", () => {
    reportPhotonFailure();
    setVisibility("hidden");
    reportPhotonSuccess();
    expect(getPhotonHealth()).toBe("up");
  });
});
