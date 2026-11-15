import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SATELLITE_STORAGE_KEY, readSatelliteChoice, useMapUi } from "./mapUi";

beforeEach(() => {
  useMapUi.setState({
    ready: false,
    tilted: false,
    wantsTilt: true,
    satellite: false,
    bearing: 0,
    command: null,
    commandSeq: 0,
    insets: { top: 0, bottom: 0 },
  });
});

describe("useMapUi", () => {
  it("numbers commands so the same one can be sent twice", () => {
    useMapUi.getState().send({ type: "zoom", delta: 1 });
    useMapUi.getState().send({ type: "zoom", delta: 1 });
    expect(useMapUi.getState().commandSeq).toBe(2);
    expect(useMapUi.getState().command).toEqual({ type: "zoom", delta: 1 });
  });

  it("remembers the 2D / 3D choice separately from what the camera shows", () => {
    useMapUi.getState().send({ type: "tilt", tilted: false });
    expect(useMapUi.getState().wantsTilt).toBe(false);
    // The map reports its own pitch; that never overrides the choice.
    useMapUi.getState().report({ tilted: true });
    expect(useMapUi.getState().wantsTilt).toBe(false);
    expect(useMapUi.getState().tilted).toBe(true);
  });

  it("does not notify when nothing changed", () => {
    const listener = vi.fn();
    const unsubscribe = useMapUi.subscribe(listener);
    useMapUi.getState().setInsets({ top: 0, bottom: 0 });
    useMapUi.getState().report({ bearing: 0, tilted: false });
    expect(listener).not.toHaveBeenCalled();
    useMapUi.getState().setInsets({ top: 76, bottom: 236 });
    useMapUi.getState().report({ bearing: 12 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("the Satellite choice", () => {
  /** A stand-in for the browser's storage (these tests run without a DOM). */
  function fakeStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    return {
      items,
      getItem: vi.fn((key: string) => items.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is off until the browser's memory has been read", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [SATELLITE_STORAGE_KEY]: "1" }));
    expect(useMapUi.getState().satellite).toBe(false);
    useMapUi.getState().hydrate();
    expect(useMapUi.getState().satellite).toBe(true);
  });

  it("is remembered when chosen and when left", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    useMapUi.getState().setSatellite(true);
    expect(useMapUi.getState().satellite).toBe(true);
    expect(storage.items.get(SATELLITE_STORAGE_KEY)).toBe("1");
    expect(readSatelliteChoice()).toBe(true);

    useMapUi.getState().setSatellite(false);
    expect(useMapUi.getState().satellite).toBe(false);
    expect(storage.items.get(SATELLITE_STORAGE_KEY)).toBe("0");
    expect(readSatelliteChoice()).toBe(false);
  });

  it("survives a reload: a fresh store reads what the last one wrote", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    useMapUi.getState().setSatellite(true);
    // The next visit starts from the defaults…
    useMapUi.setState({ satellite: false });
    // …and reads the choice back.
    useMapUi.getState().hydrate();
    expect(useMapUi.getState().satellite).toBe(true);
  });

  it("asking for the tilted 3D view leaves it, and that is remembered too", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    useMapUi.getState().setSatellite(true);
    useMapUi.getState().send({ type: "tilt", tilted: true });
    expect(useMapUi.getState().satellite).toBe(false);
    expect(useMapUi.getState().wantsTilt).toBe(true);
    expect(storage.items.get(SATELLITE_STORAGE_KEY)).toBe("0");
  });

  it("nothing else leaves it: flat 2D, zooming, turning north", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    useMapUi.getState().setSatellite(true);
    useMapUi.getState().send({ type: "tilt", tilted: false });
    useMapUi.getState().send({ type: "zoom", delta: 1 });
    useMapUi.getState().send({ type: "north" });
    useMapUi.getState().send({ type: "recenter" });
    expect(useMapUi.getState().satellite).toBe(true);
    // …and the 2D / 3D choice is kept for when the photos are left.
    expect(useMapUi.getState().wantsTilt).toBe(false);
  });

  it("works for the visit when storage cannot be read or written", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(readSatelliteChoice()).toBe(false);
    expect(() => useMapUi.getState().hydrate()).not.toThrow();
    expect(() => useMapUi.getState().setSatellite(true)).not.toThrow();
    expect(useMapUi.getState().satellite).toBe(true);
    expect(() => useMapUi.getState().send({ type: "tilt", tilted: true })).not.toThrow();
    expect(useMapUi.getState().satellite).toBe(false);
  });

  it("is simply off where there is no storage at all, or something else was stored", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readSatelliteChoice()).toBe(false);
    expect(() => useMapUi.getState().setSatellite(true)).not.toThrow();
    vi.stubGlobal("localStorage", fakeStorage({ [SATELLITE_STORAGE_KEY]: "yes" }));
    expect(readSatelliteChoice()).toBe(false);
  });

  it("does not notify when the choice did not change", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const listener = vi.fn();
    const unsubscribe = useMapUi.subscribe(listener);
    useMapUi.getState().setSatellite(false);
    useMapUi.getState().hydrate();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
