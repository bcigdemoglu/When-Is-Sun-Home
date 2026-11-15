// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { StrictMode, createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Place } from "@/lib/types";
import { DEFAULT_SETTINGS, isSettings, type Settings } from "../schema";
import { arbJunk, arbSettings, arbWildPatch } from "./arbitraries";

type StoreModule = typeof import("../store");

const KEY = "sun-home:v2";
const NYC: Place = { lat: 40.7128, lng: -74.006, name: "New York" };
const PARIS: Place = { lat: 48.8566, lng: 2.3522, name: "Paris" };

const STORED: Settings = {
  place: PARIS,
  date: "2026-03-20",
  minuteOfDay: 600,
  observer: { mode: "window", heightM: 10.5, facingDeg: 270, fovDeg: 90 },
  layers: { buildings3d: false, shadows: false },
};

/** A fresh copy of the store module: new store, new hydration flags. */
async function loadStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("../store");
}

/** A fresh store that has already been hydrated (the state every action normally runs in). */
async function loadHydratedStore(): Promise<StoreModule> {
  const m = await loadStore();
  m.hydrateSettings();
  return m;
}

const settingsOf = (m: StoreModule) => m.pickSettings(m.useSettings.getState());
const persist = (state: unknown, version: unknown = 1) =>
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
const readPersisted = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
const setUrl = (url: string) => window.history.replaceState(null, "", url);
const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setUrl("/");
});

afterEach(() => {
  vi.restoreAllMocks();
  // Each test loads its own copy of the store module, and each hydrated copy
  // listens for `pagehide`. Drain them all so that no copy still holds a
  // pending write that a later test's `pagehide` would flush.
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("initial state", () => {
  test("is the defaults, not hydrated, and reads nothing on import", async () => {
    persist(STORED);
    setUrl("/?fov=45");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const m = await loadStore();
    expect(settingsOf(m)).toEqual(DEFAULT_SETTINGS);
    expect(m.isSettingsHydrated()).toBe(false);
    expect(m.useSettings.persist.hasHydrated()).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  test("uses the new storage key and a version", async () => {
    const m = await loadStore();
    expect(m.SETTINGS_STORAGE_KEY).toBe("sun-home:v2");
    expect(m.useSettings.persist.getOptions().name).toBe("sun-home:v2");
    expect(m.useSettings.persist.getOptions().version).toBe(m.SETTINGS_STORAGE_VERSION);
    expect(m.useSettings.persist.getOptions().skipHydration).toBe(true);
  });
});

describe("actions", () => {
  test("setPlace stores, normalises and clears", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();

    s().setPlace(NYC);
    expect(s().place).toEqual(NYC);

    s().setPlace({ lat: 95, lng: 190, name: "  Far   away " });
    expect(s().place).toEqual({ lat: 90, lng: -170, name: "Far away" });

    s().setPlace({ lat: NaN, lng: 0 });
    expect(s().place).toEqual({ lat: 90, lng: -170, name: "Far away" });

    s().setPlace({ lat: 1, lng: 2 });
    expect(s().place).toEqual({ lat: 1, lng: 2 });
    expect(s().place).not.toHaveProperty("name");

    s().setPlace(null);
    expect(s().place).toBeNull();
  });

  test("setPlace copies its argument (later mutation by the caller cannot reach the store)", async () => {
    const { useSettings } = await loadStore();
    const mine = { ...NYC };
    useSettings.getState().setPlace(mine);
    mine.lat = 0;
    expect(useSettings.getState().place?.lat).toBe(40.7128);
  });

  test("setDate accepts real dates and null only", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();
    s().setDate("2026-06-21");
    expect(s().date).toBe("2026-06-21");
    s().setDate("2026-02-30");
    expect(s().date).toBe("2026-06-21");
    s().setDate("21/06/2026");
    expect(s().date).toBe("2026-06-21");
    s().setDate(null);
    expect(s().date).toBeNull();
  });

  test("setMinuteOfDay clamps and rounds", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();
    s().setMinuteOfDay(1500);
    expect(s().minuteOfDay).toBe(1439);
    s().setMinuteOfDay(-20);
    expect(s().minuteOfDay).toBe(0);
    s().setMinuteOfDay(612.4);
    expect(s().minuteOfDay).toBe(612);
    s().setMinuteOfDay(NaN);
    expect(s().minuteOfDay).toBe(612);
    s().setMinuteOfDay(Infinity);
    expect(s().minuteOfDay).toBe(612);
    s().setMinuteOfDay(null);
    expect(s().minuteOfDay).toBeNull();
  });

  test("setDateTime sets both with a single notification; resetToNow clears both", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();
    const listener = vi.fn();
    useSettings.subscribe(listener);

    s().setDateTime("2026-12-21", 9999);
    expect(s().date).toBe("2026-12-21");
    expect(s().minuteOfDay).toBe(1439);
    expect(listener).toHaveBeenCalledTimes(1);

    s().setDateTime("bad", 100);
    expect(s().date).toBe("2026-12-21");
    expect(s().minuteOfDay).toBe(100);

    s().resetToNow();
    expect(s().date).toBeNull();
    expect(s().minuteOfDay).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test("setObserver merges and normalises each field", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();

    s().setObserver({ facingDeg: 370 });
    expect(s().observer).toEqual({ mode: "yard", heightM: 1, facingDeg: 10, fovDeg: 180 });

    s().setObserver({ mode: "window", fovDeg: 5, heightM: -3 });
    expect(s().observer).toEqual({ mode: "window", heightM: 0, facingDeg: 10, fovDeg: 10 });

    s().setObserver({ fovDeg: 1000, heightM: 999, facingDeg: -90 });
    expect(s().observer).toEqual({ mode: "window", heightM: 300, facingDeg: 270, fovDeg: 360 });

    s().setObserver({ facingDeg: 359.7, fovDeg: 44.5 });
    expect(s().observer.facingDeg).toBe(0);
    expect(s().observer.fovDeg).toBe(45);

    // unusable values leave the field alone
    s().setObserver({ mode: "balcony" as never, heightM: NaN, facingDeg: "90" as never });
    expect(s().observer).toEqual({ mode: "window", heightM: 300, facingDeg: 0, fovDeg: 45 });

    s().setObserver({});
    s().setObserver(undefined as never);
    s().setObserver(null as never);
    expect(s().observer).toEqual({ mode: "window", heightM: 300, facingDeg: 0, fovDeg: 45 });
  });

  test("setLayer toggles one layer", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();
    s().setLayer("shadows", false);
    expect(s().layers).toEqual({ buildings3d: true, shadows: false });
    s().setLayer("buildings3d", false);
    expect(s().layers).toEqual({ buildings3d: false, shadows: false });
    s().setLayer("shadows", "yes" as never);
    s().setLayer("terrain" as never, true);
    expect(s().layers).toEqual({ buildings3d: false, shadows: false });
  });

  test("reset restores the defaults, optionally keeping the place", async () => {
    const m = await loadStore();
    const s = () => m.useSettings.getState();
    const dirty = () => {
      s().hydrate(STORED);
      expect(settingsOf(m)).toEqual(STORED);
    };

    dirty();
    s().reset({ keepPlace: true });
    expect(settingsOf(m)).toEqual({ ...DEFAULT_SETTINGS, place: PARIS });

    dirty();
    s().reset({ keepPlace: false });
    expect(settingsOf(m)).toEqual(DEFAULT_SETTINGS);

    dirty();
    s().reset();
    expect(settingsOf(m)).toEqual(DEFAULT_SETTINGS);
    // the actions are still there afterwards
    expect(typeof s().setPlace).toBe("function");
  });

  test("hydrate merges a partial update leaf by leaf", async () => {
    const m = await loadStore();
    const s = () => m.useSettings.getState();
    s().hydrate(STORED);
    s().hydrate({ observer: { fovDeg: 400 }, layers: { shadows: true }, minuteOfDay: null });
    expect(settingsOf(m)).toEqual({
      ...STORED,
      minuteOfDay: null,
      observer: { ...STORED.observer, fovDeg: 360 },
      layers: { buildings3d: false, shadows: true },
    });
    s().hydrate({});
    s().hydrate(null as never);
    s().hydrate("junk" as never);
    expect(settingsOf(m).place).toEqual(PARIS);
  });

  test("the store can never hold invalid settings, whatever the actions are fed", async () => {
    const m = await loadStore();
    const s = () => m.useSettings.getState();
    const action = fc.oneof(
      arbJunk.map((v) => () => s().setPlace(v as never)),
      arbJunk.map((v) => () => s().setDate(v as never)),
      arbJunk.map((v) => () => s().setMinuteOfDay(v as never)),
      fc.tuple(arbJunk, arbJunk).map(
        ([a, b]) =>
          () =>
            s().setDateTime(a as never, b as never),
      ),
      arbWildPatch.map((p) => () => s().setObserver(p.observer as never)),
      fc.tuple(arbJunk, arbJunk).map(
        ([k, v]) =>
          () =>
            s().setLayer(k as never, v as never),
      ),
      arbJunk.map((v) => () => s().reset(v as never)),
      fc.oneof(arbWildPatch, arbJunk, arbSettings).map((p) => () => s().hydrate(p as never)),
      fc.constant(() => s().resetToNow()),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 12 }), (actions) => {
        for (const run of actions) {
          expect(run).not.toThrow();
          expect(isSettings(settingsOf(m))).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  test("a full valid Settings passed to hydrate is stored exactly", async () => {
    const m = await loadStore();
    fc.assert(
      fc.property(arbSettings, (settings) => {
        m.useSettings.getState().hydrate(settings);
        expect(settingsOf(m)).toEqual(settings);
      }),
      { numRuns: 200 },
    );
  });
});

describe("referential stability", () => {
  test("slices keep their identity until their content changes", async () => {
    const { useSettings } = await loadStore();
    const s = () => useSettings.getState();
    s().hydrate(STORED);
    const { place, observer, layers } = s();

    s().setMinuteOfDay(700);
    s().setDate("2026-07-01");
    expect(s().place).toBe(place);
    expect(s().observer).toBe(observer);
    expect(s().layers).toBe(layers);

    s().setObserver({ fovDeg: 91 });
    expect(s().observer).not.toBe(observer);
    expect(s().place).toBe(place);
    expect(s().layers).toBe(layers);

    s().setLayer("shadows", true);
    expect(s().layers).not.toBe(layers);
    expect(s().place).toBe(place);
  });

  test("an action that changes nothing notifies nobody and writes nothing", async () => {
    const { useSettings, settingsStorage } = await loadHydratedStore();
    const s = () => useSettings.getState();
    s().hydrate(STORED);
    expect(settingsStorage.hasPending()).toBe(true);
    settingsStorage.flush();
    const listener = vi.fn();
    useSettings.subscribe(listener);
    const before = s();

    s().setPlace({ ...PARIS });
    s().setDate("2026-03-20");
    s().setMinuteOfDay(600);
    s().setMinuteOfDay(600.2);
    s().setObserver({ fovDeg: 90 });
    s().setObserver({ facingDeg: 270.3, heightM: 10.5 });
    s().setObserver({ facingDeg: 630 });
    s().setLayer("shadows", false);
    s().hydrate(STORED);
    s().setObserver({ heightM: NaN });

    expect(listener).not.toHaveBeenCalled();
    expect(s()).toBe(before);
    expect(settingsStorage.hasPending()).toBe(false);
  });

  test("a hook subscribed to the observer does not re-render while the time changes", async () => {
    const { useSettings } = await loadStore();
    const { selectObserver, selectMinuteOfDay } = await import("../selectors");
    let observerRenders = 0;
    let minuteRenders = 0;
    const ObserverPanel = () => {
      observerRenders++;
      return createElement("span", null, useSettings(selectObserver).fovDeg);
    };
    const Clock = () => {
      minuteRenders++;
      return createElement("span", null, useSettings(selectMinuteOfDay));
    };
    render(createElement("div", null, createElement(ObserverPanel), createElement(Clock)));
    expect(observerRenders).toBe(1);

    for (let minute = 0; minute < 200; minute++) {
      act(() => useSettings.getState().setMinuteOfDay(minute));
    }
    expect(observerRenders).toBe(1);
    expect(minuteRenders).toBe(201);

    act(() => useSettings.getState().setObserver({ fovDeg: 77 }));
    expect(observerRenders).toBe(2);
  });
});

describe("persistence", () => {
  test("1000 slider ticks cause a single localStorage write", async () => {
    const { useSettings, PERSIST_THROTTLE_MS } = await loadHydratedStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const stringify = vi.spyOn(JSON, "stringify");
    const parse = vi.spyOn(JSON, "parse");

    for (let i = 0; i < 1000; i++) useSettings.getState().setMinuteOfDay(i);

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PERSIST_THROTTLE_MS);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(KEY, expect.any(String));
    expect(readPersisted().state.minuteOfDay).toBe(999);

    vi.advanceTimersByTime(60_000);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  test("a 10 s animation writes at most once per 500 ms", async () => {
    const { useSettings } = await loadHydratedStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    for (let frame = 0; frame < 600; frame++) {
      useSettings.getState().setMinuteOfDay(frame % 1440);
      vi.advanceTimersByTime(1000 / 60);
    }
    vi.advanceTimersByTime(1000);
    expect(setItem.mock.calls.length).toBeGreaterThan(0);
    expect(setItem.mock.calls.length).toBeLessThanOrEqual(21);
    expect(readPersisted().state.minuteOfDay).toBe(599);
  });

  test("only the settings are persisted, with a version", async () => {
    const { useSettings, SETTINGS_STORAGE_VERSION } = await loadHydratedStore();
    useSettings.getState().hydrate(STORED);
    vi.advanceTimersByTime(500);
    expect(readPersisted()).toEqual({ state: STORED, version: SETTINGS_STORAGE_VERSION });
    expect(Object.keys(readPersisted().state).sort()).toEqual([
      "date",
      "layers",
      "minuteOfDay",
      "observer",
      "place",
    ]);
  });

  test("pending writes are flushed when the page hides", async () => {
    const m = await loadStore();
    m.hydrateSettings();

    m.useSettings.getState().setPlace(NYC);
    expect(localStorage.getItem(KEY)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(readPersisted().state.place).toEqual(NYC);

    m.useSettings.getState().setMinuteOfDay(77);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(readPersisted().state.minuteOfDay).toBe(77);
  });

  test("a full or blocked localStorage never breaks an action", async () => {
    const { useSettings } = await loadHydratedStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => {
      useSettings.getState().setPlace(NYC);
      vi.advanceTimersByTime(1000);
      useSettings.getState().setObserver({ fovDeg: 60 });
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(useSettings.getState().place).toEqual(NYC);
    expect(useSettings.getState().observer.fovDeg).toBe(60);
  });

  test("works when reading window.localStorage itself throws", async () => {
    const m = await loadStore();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    setUrl("/?fov=120");
    expect(() => m.hydrateSettings()).not.toThrow();
    expect(m.isSettingsHydrated()).toBe(true);
    expect(m.useSettings.getState().observer.fovDeg).toBe(120);
    expect(() => {
      m.useSettings.getState().setPlace(NYC);
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
    expect(m.useSettings.getState().place).toEqual(NYC);
  });

  test("what one page load saves, the next one restores", async () => {
    const first = await loadStore();
    first.hydrateSettings();
    first.useSettings.getState().hydrate(STORED);
    first.settingsStorage.flush();

    const second = await loadStore();
    expect(settingsOf(second)).toEqual(DEFAULT_SETTINGS);
    second.hydrateSettings();
    expect(settingsOf(second)).toEqual(STORED);
  });

  test("arbitrary settings survive save → reload exactly", async () => {
    await fc.assert(
      fc.asyncProperty(arbSettings, async (settings) => {
        localStorage.clear();
        const first = await loadStore();
        first.hydrateSettings();
        first.useSettings.getState().hydrate(settings);
        first.settingsStorage.flush();
        const second = await loadStore();
        second.hydrateSettings();
        expect(settingsOf(second)).toEqual(settings);
      }),
      { numRuns: 30 },
    );
  });
});

describe("hydration", () => {
  test("restores from localStorage", async () => {
    persist(STORED);
    const m = await loadStore();
    m.hydrateSettings();
    expect(settingsOf(m)).toEqual(STORED);
    expect(m.isSettingsHydrated()).toBe(true);
    expect(m.useSettings.persist.hasHydrated()).toBe(true);
    expect(typeof m.useSettings.getState().setPlace).toBe("function");
  });

  test("with nothing stored and a clean URL the defaults stay and nothing is written", async () => {
    const m = await loadStore();
    const before = m.useSettings.getState();
    m.hydrateSettings();
    vi.advanceTimersByTime(5000);
    expect(m.useSettings.getState()).toBe(before);
    expect(m.isSettingsHydrated()).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  test("order: storage first, then the URL on top, field by field", async () => {
    persist(STORED);
    setUrl("/?fov=120&sh=1");
    const m = await loadStore();
    const seen: Settings[] = [];
    m.useSettings.subscribe((state) => seen.push(m.pickSettings(state)));

    m.hydrateSettings();

    // first the stored state arrives, then the URL is laid over it
    expect(seen).toEqual([
      STORED,
      {
        ...STORED,
        observer: { ...STORED.observer, fovDeg: 120 },
        layers: { buildings3d: false, shadows: true },
      },
    ]);
    expect(settingsOf(m)).toEqual(seen[1]);
  });

  test("the URL wins over storage for every field it carries", async () => {
    persist(STORED);
    setUrl("/?d=2026-12-21&t=0815&m=y&h=2&dir=45&fov=60&b=1&sh=1");
    const m = await loadStore();
    m.hydrateSettings();
    expect(settingsOf(m)).toEqual({
      place: PARIS, // not in the URL → from storage
      date: "2026-12-21",
      minuteOfDay: 495,
      observer: { mode: "yard", heightM: 2, facingDeg: 45, fovDeg: 60 },
      layers: { buildings3d: true, shadows: true },
    });
  });

  test("a shared link with a place is taken as a whole, not mixed with stored settings", async () => {
    persist(STORED);
    setUrl("/?lat=40.71280&lng=-74.00600&n=New+York&t=0930");
    const m = await loadStore();
    m.hydrateSettings();
    expect(settingsOf(m)).toEqual({ ...DEFAULT_SETTINGS, place: NYC, minuteOfDay: 570 });
  });

  test("URL only, nothing stored", async () => {
    setUrl("/?lat=40.71280&lng=-74.00600&n=New+York&m=w&h=7.5#report");
    const m = await loadStore();
    m.hydrateSettings();
    expect(settingsOf(m)).toEqual({
      ...DEFAULT_SETTINGS,
      place: NYC,
      observer: { ...DEFAULT_SETTINGS.observer, mode: "window", heightM: 7.5 },
    });
  });

  test("a legacy link is converted on the way in", async () => {
    persist(STORED);
    setUrl("/?lat=40.71280&lng=-74.00600&n=New+York&z=15&t=870&d=172&f=3&dir=90");
    const m = await loadStore();
    m.hydrateSettings({ now: new Date(2026, 5, 15) });
    expect(settingsOf(m)).toEqual({
      place: NYC,
      date: "2026-06-21",
      minuteOfDay: 870,
      observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 180 },
      layers: { buildings3d: true, shadows: true },
    });
  });

  test("junk in the URL is ignored", async () => {
    persist(STORED);
    setUrl("/?lat=abc&lng=&fov=wide&t=9999&d=2026-02-30&utm_source=x&%E0%A4%A=1");
    const m = await loadStore();
    expect(() => m.hydrateSettings()).not.toThrow();
    expect(settingsOf(m)).toEqual(STORED);
  });

  test("the result of the overlay is persisted", async () => {
    persist(STORED);
    setUrl("/?fov=120");
    const m = await loadStore();
    m.hydrateSettings();
    vi.advanceTimersByTime(500);
    expect(readPersisted().state.observer.fovDeg).toBe(120);
    expect(readPersisted().state.place).toEqual(PARIS);
  });

  test("an explicit search string can be passed instead of location.search", async () => {
    setUrl("/?fov=120");
    const m = await loadStore();
    m.hydrateSettings({ search: "?fov=33" });
    expect(m.useSettings.getState().observer.fovDeg).toBe(33);
  });

  test("runs once: later calls do nothing", async () => {
    persist(STORED);
    const m = await loadStore();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    m.hydrateSettings();
    m.useSettings.getState().setObserver({ fovDeg: 15 });
    setUrl("/?fov=200");
    persist({ ...STORED, date: "2030-01-01" });
    m.hydrateSettings();
    m.hydrateSettings({ search: "?fov=300" });
    expect(m.useSettings.getState().observer.fovDeg).toBe(15);
    expect(m.useSettings.getState().date).toBe("2026-03-20");
    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  test("removes the old app's keys and leaves everything else", async () => {
    localStorage.setItem("sun-home-state", '{"location":{"lat":1,"lng":2}}');
    localStorage.setItem("sun-building-cache", "x".repeat(100_000));
    localStorage.setItem("someone-elses-key", "keep me");
    persist(STORED);
    const m = await loadStore();
    expect(m.LEGACY_STORAGE_KEYS).toEqual(["sun-home-state", "sun-building-cache"]);
    m.hydrateSettings();
    expect(localStorage.getItem("sun-home-state")).toBeNull();
    expect(localStorage.getItem("sun-building-cache")).toBeNull();
    expect(localStorage.getItem("someone-elses-key")).toBe("keep me");
    expect(settingsOf(m)).toEqual(STORED);
  });

  test("a failing removeItem does not stop hydration", async () => {
    persist(STORED);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("nope");
    });
    const m = await loadStore();
    expect(() => m.hydrateSettings()).not.toThrow();
    expect(settingsOf(m)).toEqual(STORED);
    expect(m.isSettingsHydrated()).toBe(true);
  });

  test("a store update before hydration cannot clobber the saved settings", async () => {
    persist(STORED);
    const m = await loadStore();
    m.useSettings.getState().setObserver({ fovDeg: 33 }); // too early
    expect(m.settingsStorage.hasPending()).toBe(false);
    // …however long hydration takes to come
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("pagehide"));
    expect(readPersisted().state).toEqual(STORED);

    m.hydrateSettings();
    expect(settingsOf(m)).toEqual(STORED);
    vi.advanceTimersByTime(5000);
    expect(readPersisted().state).toEqual(STORED);
  });

  test("nothing is ever written before hydration", async () => {
    const m = await loadStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    for (let i = 0; i < 100; i++) m.useSettings.getState().setMinuteOfDay(i);
    m.useSettings.setState({ date: "2026-06-21" });
    m.settingsStorage.flush();
    vi.advanceTimersByTime(60_000);
    expect(setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("state set before hydration survives (and is saved) when nothing was stored", async () => {
    const m = await loadStore();
    m.useSettings.getState().setPlace(NYC);
    m.hydrateSettings();
    expect(m.useSettings.getState().place).toEqual(NYC);
    vi.advanceTimersByTime(500);
    expect(readPersisted().state.place).toEqual(NYC);
  });

  test("onSettingsHydrated fires once, immediately if already hydrated", async () => {
    const m = await loadStore();
    const early = vi.fn();
    const cancelled = vi.fn();
    m.onSettingsHydrated(early);
    m.onSettingsHydrated(cancelled)();
    expect(early).not.toHaveBeenCalled();
    m.hydrateSettings();
    expect(early).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    const late = vi.fn();
    m.onSettingsHydrated(late);
    expect(late).toHaveBeenCalledTimes(1);
    m.hydrateSettings();
    expect(early).toHaveBeenCalledTimes(1);
  });

  test("subscribers see the settings before the hydrated flag flips", async () => {
    persist(STORED);
    const m = await loadStore();
    let placeWhenHydrated: Place | null | undefined;
    m.onSettingsHydrated(() => {
      placeWhenHydrated = m.useSettings.getState().place;
    });
    m.hydrateSettings();
    expect(placeWhenHydrated).toEqual(PARIS);
  });
});

describe("corrupt localStorage never crashes", () => {
  const cases: [string, string, Settings][] = [
    ["not JSON", "{oops", DEFAULT_SETTINGS],
    ["truncated", '{"state":{"place":{"lat":40.7,"lng":', DEFAULT_SETTINGS],
    ["JSON null", "null", DEFAULT_SETTINGS],
    ["a bare string", '"hello"', DEFAULT_SETTINGS],
    ["an array", "[]", DEFAULT_SETTINGS],
    ["no state", '{"version":1}', DEFAULT_SETTINGS],
    ["state: null", '{"state":null,"version":1}', DEFAULT_SETTINGS],
    ["state: number", '{"state":42,"version":1}', DEFAULT_SETTINGS],
    ["state: array", '{"state":[1,2],"version":1}', DEFAULT_SETTINGS],
    [
      "a bad fovDeg next to a good place",
      JSON.stringify({
        state: { place: PARIS, observer: { fovDeg: "wide", mode: "window" } },
        version: 1,
      }),
      {
        ...DEFAULT_SETTINGS,
        place: PARIS,
        observer: { ...DEFAULT_SETTINGS.observer, mode: "window" },
      },
    ],
    [
      "out-of-range numbers",
      JSON.stringify({
        state: {
          place: { lat: 123, lng: 500 },
          minuteOfDay: 99999,
          observer: { mode: "window", heightM: -1, facingDeg: 725, fovDeg: 0 },
        },
        version: 1,
      }),
      {
        ...DEFAULT_SETTINGS,
        place: { lat: 90, lng: 140 },
        minuteOfDay: 1439,
        observer: { mode: "window", heightM: 0, facingDeg: 5, fovDeg: 10 },
      },
    ],
    [
      "an impossible date and stray keys",
      JSON.stringify({
        state: { ...STORED, date: "2026-02-30", zoom: 13, setPlace: "pwned" },
        version: 1,
      }),
      { ...STORED, date: null },
    ],
    ["an older version", JSON.stringify({ state: STORED, version: 0 }), STORED],
    ["a newer version", JSON.stringify({ state: STORED, version: 99 }), STORED],
    ["no version", JSON.stringify({ state: STORED }), STORED],
    ["a non-numeric version", JSON.stringify({ state: STORED, version: "2" }), STORED],
    [
      "an older version with garbage",
      JSON.stringify({ state: { place: "home", layers: { shadows: false } }, version: 0 }),
      { ...DEFAULT_SETTINGS, layers: { buildings3d: true, shadows: false } },
    ],
    [
      "the old app's state shape under the new key",
      JSON.stringify({ state: { location: PARIS, userFloor: 3, dayOfYear: 12 }, version: 1 }),
      DEFAULT_SETTINGS,
    ],
  ];

  test.each(cases)("%s", async (_label, raw, expected) => {
    localStorage.setItem(KEY, raw);
    const m = await loadStore();
    expect(() => m.hydrateSettings()).not.toThrow();
    expect(settingsOf(m)).toEqual(expected);
    expect(isSettings(settingsOf(m))).toBe(true);
    expect(m.isSettingsHydrated()).toBe(true);
    // the actions survived and the store still works
    expect(() => m.useSettings.getState().setMinuteOfDay(5)).not.toThrow();
    expect(m.useSettings.getState().minuteOfDay).toBe(5);
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(isSettings(readPersisted().state)).toBe(true);
  });

  test("anything at all in storage yields valid settings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string(),
          fc.json(),
          fc
            .record({ state: fc.oneof(arbWildPatch, fc.jsonValue()), version: fc.jsonValue() })
            .map((v) => JSON.stringify(v)),
        ),
        async (raw) => {
          localStorage.setItem(KEY, raw);
          const m = await loadStore();
          m.hydrateSettings();
          expect(isSettings(settingsOf(m))).toBe(true);
          expect(m.isSettingsHydrated()).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });

  test("a migrated (older-version) payload is rewritten in the current version", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: STORED, version: 0 }));
    const m = await loadStore();
    m.hydrateSettings();
    vi.advanceTimersByTime(500);
    expect(readPersisted()).toEqual({ state: STORED, version: m.SETTINGS_STORAGE_VERSION });
  });
});

describe("React hooks", () => {
  test("server render: not hydrated, defaults, storage untouched", async () => {
    persist(STORED);
    const m = await loadStore();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const App = () => {
      const hydrated = m.useHydrateSettings();
      const fov = m.useSettings((s) => s.observer.fovDeg);
      return createElement("p", null, `${hydrated}:${fov}`);
    };
    expect(renderToString(createElement(App))).toContain("false:180");
    expect(getItem).not.toHaveBeenCalled();
    expect(m.isSettingsHydrated()).toBe(false);
  });

  test("useHydrateSettings: first render with defaults, then hydrated — once, under StrictMode", async () => {
    persist(STORED);
    setUrl("/?fov=120");
    const m = await loadStore();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const renders: string[] = [];

    const { result, rerender, unmount } = renderHook(
      () => {
        const hydrated = m.useHydrateSettings();
        const fov = m.useSettings((s) => s.observer.fovDeg);
        renders.push(`${hydrated}:${fov}`);
        return hydrated;
      },
      { wrapper: StrictMode },
    );

    // the very first render matched the server: not hydrated, default value
    expect(renders[0]).toBe("false:180");
    expect(renders).not.toContain("true:180");
    expect(renders).not.toContain("false:120");
    expect(result.current).toBe(true);
    expect(renders.at(-1)).toBe("true:120");
    expect(settingsOf(m)).toEqual({ ...STORED, observer: { ...STORED.observer, fovDeg: 120 } });

    // StrictMode ran the effect twice; storage was read and cleaned once
    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
    expect(removeItem).toHaveBeenCalledTimes(m.LEGACY_STORAGE_KEYS.length);

    rerender();
    unmount();
    renderHook(() => m.useHydrateSettings(), { wrapper: StrictMode });
    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  test("several components may call useHydrateSettings; all see the flag flip", async () => {
    persist(STORED);
    const m = await loadStore();
    const a = renderHook(() => m.useHydrateSettings());
    const b = renderHook(() => m.useSettingsHydrated());
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
  });

  test("useSettingsHydrated updates when hydration happens elsewhere", async () => {
    const m = await loadStore();
    const { result } = renderHook(() => m.useSettingsHydrated());
    expect(result.current).toBe(false);
    act(() => m.hydrateSettings());
    expect(result.current).toBe(true);
  });
});
