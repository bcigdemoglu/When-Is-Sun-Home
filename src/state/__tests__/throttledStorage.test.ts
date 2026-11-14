// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_PERSIST_INTERVAL_MS,
  createThrottledStorage,
  flushWhenPageHides,
  type StorageLike,
} from "../throttledStorage";

interface FakeStorage extends StorageLike {
  data: Map<string, string>;
  getItem: ReturnType<typeof vi.fn<(key: string) => string | null>>;
  setItem: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;
  removeItem: ReturnType<typeof vi.fn<(key: string) => void>>;
}

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createThrottledStorage: writes", () => {
  test("a burst of 1000 setItem calls costs one write, of the latest value", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<{ n: number }>({ getStorage: () => backing });

    for (let n = 0; n < 1000; n++) storage.setItem("k", { state: { n }, version: 1 });

    expect(backing.setItem).not.toHaveBeenCalled();
    expect(storage.hasPending()).toBe(true);

    vi.advanceTimersByTime(DEFAULT_PERSIST_INTERVAL_MS - 1);
    expect(backing.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(backing.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(backing.data.get("k") ?? "")).toEqual({ state: { n: 999 }, version: 1 });
    expect(storage.hasPending()).toBe(false);

    vi.advanceTimersByTime(10_000);
    expect(backing.setItem).toHaveBeenCalledTimes(1);
  });

  test("the default interval is 500 ms", () => {
    expect(DEFAULT_PERSIST_INTERVAL_MS).toBe(500);
  });

  test("a continuous stream is written at most once per interval", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<number>({ getStorage: () => backing, intervalMs: 500 });
    const writeTimes: number[] = [];
    backing.setItem.mockImplementation(() => void writeTimes.push(Date.now()));

    // an animation: one update every 16 ms for 10 s
    for (let i = 0; i < 625; i++) {
      storage.setItem("k", { state: i });
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(1000);

    expect(writeTimes.length).toBeGreaterThanOrEqual(19);
    expect(writeTimes.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < writeTimes.length; i++) {
      expect(writeTimes[i] - writeTimes[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  test("the final value always lands", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<number>({ getStorage: () => backing, intervalMs: 500 });
    storage.setItem("k", { state: 1 });
    vi.advanceTimersByTime(499);
    storage.setItem("k", { state: 2 });
    vi.advanceTimersByTime(1);
    expect(JSON.parse(backing.data.get("k") ?? "")).toEqual({ state: 2 });
    storage.setItem("k", { state: 3 });
    vi.advanceTimersByTime(500);
    expect(JSON.parse(backing.data.get("k") ?? "")).toEqual({ state: 3 });
    expect(backing.setItem).toHaveBeenCalledTimes(2);
  });

  test("flush() writes immediately and disarms the timer", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<number>({ getStorage: () => backing });
    storage.setItem("k", { state: 7 });
    storage.flush();
    expect(backing.setItem).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    storage.flush(); // nothing pending: no-op
    vi.advanceTimersByTime(5000);
    expect(backing.setItem).toHaveBeenCalledTimes(1);
  });

  test("cancel() drops the pending value", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<number>({ getStorage: () => backing });
    expect(storage.cancel()).toBe(false);
    storage.setItem("k", { state: 7 });
    expect(storage.cancel()).toBe(true);
    expect(storage.hasPending()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(backing.setItem).not.toHaveBeenCalled();
  });

  test("removeItem removes and forgets a pending write for that key", () => {
    const backing = fakeStorage({ k: "{}" });
    const storage = createThrottledStorage<number>({ getStorage: () => backing });
    storage.setItem("k", { state: 7 });
    storage.removeItem("k");
    vi.advanceTimersByTime(5000);
    expect(backing.data.has("k")).toBe(false);
    expect(backing.setItem).not.toHaveBeenCalled();
  });

  test("serialisation happens at flush time, not per call", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<object>({ getStorage: () => backing });
    const toJSON = vi.fn(() => ({ ok: true }));
    for (let i = 0; i < 100; i++) storage.setItem("k", { state: { toJSON } });
    expect(toJSON).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(toJSON).toHaveBeenCalledTimes(1);
  });
});

describe("createThrottledStorage: failures never escape", () => {
  test("no backing storage (server render): nothing happens, no timer is started", () => {
    for (const none of [() => null, () => undefined]) {
      const storage = createThrottledStorage<number>({ getStorage: none });
      expect(storage.getItem("k")).toBeNull();
      storage.setItem("k", { state: 1 });
      expect(storage.hasPending()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => storage.removeItem("k")).not.toThrow();
      expect(() => storage.flush()).not.toThrow();
    }
  });

  test("storage that throws on access (blocked cookies, sandboxed iframe)", () => {
    const storage = createThrottledStorage<number>({
      getStorage: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(storage.getItem("k")).toBeNull();
    expect(() => storage.setItem("k", { state: 1 })).not.toThrow();
    expect(() => storage.removeItem("k")).not.toThrow();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  test("quota exceeded on write (Safari private mode)", () => {
    const backing = fakeStorage();
    backing.setItem.mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const storage = createThrottledStorage<number>({ getStorage: () => backing });
    storage.setItem("k", { state: 1 });
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(backing.setItem).toHaveBeenCalledTimes(1);
    // and it keeps trying on later changes
    storage.setItem("k", { state: 2 });
    expect(() => storage.flush()).not.toThrow();
    expect(backing.setItem).toHaveBeenCalledTimes(2);
  });

  test("getItem / removeItem that throw", () => {
    const backing = fakeStorage();
    backing.getItem.mockImplementation(() => {
      throw new Error("nope");
    });
    backing.removeItem.mockImplementation(() => {
      throw new Error("nope");
    });
    const storage = createThrottledStorage<number>({ getStorage: () => backing });
    expect(storage.getItem("k")).toBeNull();
    expect(() => storage.removeItem("k")).not.toThrow();
  });

  test("values that cannot be serialised", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<unknown>({ getStorage: () => backing });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    storage.setItem("k", { state: cyclic });
    expect(() => storage.flush()).not.toThrow();
    expect(backing.setItem).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", undefined],
    ["empty string", ""],
    ["not JSON", "{oops"],
    ["truncated JSON", '{"state":{"place":{"lat":40'],
    ["JSON null", "null"],
    ["a number", "42"],
    ["a string", '"hello"'],
    ["an array", "[1,2,3]"],
    ["an object without state", '{"version":1}'],
  ])("corrupt content reads as 'nothing stored': %s", (_label, raw) => {
    const backing = fakeStorage(raw === undefined ? {} : { k: raw });
    const storage = createThrottledStorage<unknown>({ getStorage: () => backing });
    expect(storage.getItem("k")).toBeNull();
  });

  test("reads back what it wrote; a non-numeric version is dropped", () => {
    const backing = fakeStorage();
    const storage = createThrottledStorage<{ a: number }>({ getStorage: () => backing });
    storage.setItem("k", { state: { a: 1 }, version: 3 });
    storage.flush();
    expect(storage.getItem("k")).toEqual({ state: { a: 1 }, version: 3 });

    backing.data.set("k", '{"state":{"a":2},"version":"three"}');
    expect(storage.getItem("k")).toEqual({ state: { a: 2 } });
    backing.data.set("k", '{"state":null}');
    expect(storage.getItem("k")).toEqual({ state: null });
  });
});

describe("flushWhenPageHides", () => {
  const setVisibility = (state: DocumentVisibilityState) =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });

  afterEach(() => {
    setVisibility("visible");
  });

  test("flushes on pagehide and when the page becomes hidden, not when it becomes visible", () => {
    const flush = vi.fn();
    const stop = flushWhenPageHides(flush);

    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
