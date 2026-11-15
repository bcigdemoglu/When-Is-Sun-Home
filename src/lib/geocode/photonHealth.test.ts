import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  PHOTON_COOL_DOWN_MS,
  getPhotonHealth,
  isPhotonResting,
  probePhotonIfDue,
  reportPhotonFailure,
  reportPhotonSuccess,
  resetPhotonHealth,
  subscribePhotonHealth,
} from "./photonHealth";

beforeEach(() => {
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
