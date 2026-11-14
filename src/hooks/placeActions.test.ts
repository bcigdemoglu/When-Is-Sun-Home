import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "@/state";
import {
  REVERSE_GEOCODE_DELAY_MS,
  cancelPendingPlaceLookup,
  pinSpot,
  pinSuggestion,
} from "./placeActions";

const reverseGeocode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geocode/photon", () => ({ reverseGeocode }));

const A = { lat: 37.79, lng: -122.43 };
const B = { lat: 37.8, lng: -122.44 };
const place = () => useSettings.getState().place;

/** Let the debounce elapse and the lookup's promise chain settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(REVERSE_GEOCODE_DELAY_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  reverseGeocode.mockReset();
  useSettings.getState().reset();
});

afterEach(() => {
  cancelPendingPlaceLookup();
  vi.useRealTimers();
});

describe("pinSpot", () => {
  it("pins at once, without the previous place's name", () => {
    useSettings.getState().setPlace({ ...B, name: "Old place" });
    reverseGeocode.mockResolvedValue(null);
    pinSpot(A);
    expect(place()).toEqual(A);
    expect(place()).not.toHaveProperty("name");
    expect(reverseGeocode).not.toHaveBeenCalled(); // still debouncing
  });

  it("adds the looked-up label when the pin has not moved", async () => {
    reverseGeocode.mockResolvedValue("2550 Pacific Avenue");
    pinSpot(A);
    await settle();
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(reverseGeocode.mock.calls[0][0]).toMatchObject(A);
    expect(place()).toEqual({ ...A, name: "2550 Pacific Avenue" });
  });

  it("looks up only the last of several quick pin moves", async () => {
    reverseGeocode.mockResolvedValue("Somewhere");
    pinSpot(A);
    await vi.advanceTimersByTimeAsync(100);
    pinSpot(B);
    await settle();
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(reverseGeocode.mock.calls[0][0]).toMatchObject(B);
    expect(place()).toEqual({ ...B, name: "Somewhere" });
  });

  it("ignores an answer that arrives after the pin moved on", async () => {
    let resolveFirst: (name: string) => void = () => {};
    reverseGeocode.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveFirst = resolve)),
    );
    reverseGeocode.mockResolvedValue(null);
    pinSpot(A);
    await settle(); // first lookup is now in flight
    pinSpot(B);
    resolveFirst("Label for A");
    await settle();
    expect(place()).toEqual(B);
  });

  it("aborts the lookup in flight when the pin moves", async () => {
    reverseGeocode.mockImplementation(() => new Promise(() => {}));
    pinSpot(A);
    await settle();
    const signal: AbortSignal = reverseGeocode.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    pinSpot(B);
    expect(signal.aborted).toBe(true);
  });

  it("does not overwrite a name set in the meantime (a search result at the same spot)", async () => {
    let resolveLookup: (name: string) => void = () => {};
    reverseGeocode.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveLookup = resolve)),
    );
    pinSpot(A);
    await settle();
    useSettings.getState().setPlace({ ...A, name: "Chosen name" });
    resolveLookup("Looked-up name");
    await settle();
    expect(place()).toEqual({ ...A, name: "Chosen name" });
  });

  it("keeps the bare pin when the lookup fails or finds nothing", async () => {
    reverseGeocode.mockRejectedValueOnce(new Error("offline"));
    pinSpot(A);
    await settle();
    expect(place()).toEqual(A);

    reverseGeocode.mockResolvedValueOnce(null);
    pinSpot(B);
    await settle();
    expect(place()).toEqual(B);
  });
});

describe("pinSuggestion", () => {
  it("pins a search result with its name and cancels any pending lookup", async () => {
    reverseGeocode.mockResolvedValue("Should not be used");
    pinSpot(A);
    pinSuggestion({ id: "x", ...B, name: "Pacific Heights, San Francisco", label: "Pacific Heights", detail: "" });
    await settle();
    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(place()).toEqual({ ...B, name: "Pacific Heights, San Francisco" });
  });
});
