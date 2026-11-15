// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode, createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { DEFAULT_OBSERVER } from "../schema";
import type { PlaceEntry } from "./types";

type StoreModule = typeof import("./index");

const KEY = "sun-home:places:v1";
const YARD: Observer = { ...DEFAULT_OBSERVER };
const ELM: Place = { lat: 37.79, lng: -122.43, name: "12 Elm St, Springfield, CA" };
const OAK: Place = { lat: 37.8, lng: -122.44, name: "7 Oak Ave, Springfield, CA" };
const PIN: Place = { lat: -33.87, lng: 151.21 };

const SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 6.4,
  sunFraction: 0.52,
  totalSunHours: 2336,
  monthlySunHours: [1.2, 2.5, 4.4, 6.8, 8.6, 9.8, 9.5, 8.1, 6.2, 4.1, 2, 1.2],
  monthlyDaylightHours: [9.8, 10.8, 12, 13.2, 14.3, 14.8, 14.5, 13.6, 12.4, 11.2, 10.1, 9.5],
  bestMonth: 5,
  worstMonth: 0,
};

function storedEntry(place: Place, extra: Partial<PlaceEntry> = {}): PlaceEntry {
  return {
    id: `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`,
    place,
    observer: YARD,
    label: place.name?.split(",")[0] ?? "Pin",
    summary: null,
    savedAt: 100,
    visitedAt: 200,
    ...extra,
  };
}

/** A fresh copy of the store module: new store, new hydration flags. */
async function loadStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("./index");
}

async function loadHydratedStore(): Promise<StoreModule> {
  const m = await loadStore();
  m.hydratePlaces();
  return m;
}

const persist = (state: unknown, version: unknown = 1) =>
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
const readPersisted = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
const lists = (m: StoreModule) => {
  const { saved, recent } = m.usePlaces.getState();
  return { saved, recent };
};
/** What another tab's write looks like from here. */
const otherTabWrote = (state: unknown) => {
  if (state === undefined) localStorage.removeItem(KEY);
  else persist(state);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: KEY,
      newValue: localStorage.getItem(KEY),
      storageArea: localStorage,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("before hydration", () => {
  test("both lists are empty and nothing is read on import", async () => {
    persist({ saved: [storedEntry(ELM)], recent: [] });
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const m = await loadStore();
    expect(lists(m)).toEqual({ saved: [], recent: [] });
    expect(m.isPlacesHydrated()).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  test("uses the versioned storage key and skips automatic hydration", async () => {
    const m = await loadStore();
    expect(m.PLACES_STORAGE_KEY).toBe(KEY);
    expect(m.usePlaces.persist.getOptions().name).toBe(KEY);
    expect(m.usePlaces.persist.getOptions().version).toBe(m.PLACES_STORAGE_VERSION);
    expect(m.usePlaces.persist.getOptions().skipHydration).toBe(true);
  });

  test("renders on the server without touching storage", async () => {
    const m = await loadStore();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    function Probe() {
      const hydrated = m.useHydratePlaces();
      const count = m.usePlaces((state) => state.saved.length);
      return createElement("p", null, `${hydrated}:${count}`);
    }
    expect(renderToString(createElement(Probe))).toContain("false:0");
    expect(getItem).not.toHaveBeenCalled();
  });

  test("a place saved before hydration is not written until then, and is merged in", async () => {
    persist({ saved: [storedEntry(ELM)], recent: [storedEntry(OAK, { savedAt: null })] });
    const m = await loadStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    m.usePlaces.getState().save(OAK, YARD, SUMMARY);
    m.usePlaces.getState().recordVisit(PIN, YARD, null);
    expect(setItem).not.toHaveBeenCalled();

    m.hydratePlaces();
    expect(lists(m).saved.map((entry) => entry.label)).toEqual(["12 Elm St", "7 Oak Ave"]);
    expect(lists(m).recent.map((entry) => entry.id)).toEqual([m.placeEntryId(PIN)]);
    expect(readPersisted().state.saved).toHaveLength(2);
    expect(readPersisted().version).toBe(1);
  });
});

describe("hydratePlaces", () => {
  test("restores what was stored and flips the flag", async () => {
    const saved = [storedEntry(ELM, { summary: SUMMARY, note: "garden" }), storedEntry(PIN)];
    const recent = [storedEntry(OAK, { savedAt: null })];
    persist({ saved, recent });
    const m = await loadStore();
    const seen: boolean[] = [];
    m.usePlaces.subscribe(() => seen.push(m.isPlacesHydrated()));
    m.hydratePlaces();
    expect(lists(m)).toEqual({ saved, recent });
    expect(m.isPlacesHydrated()).toBe(true);
    expect(m.usePlaces.persist.hasHydrated()).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  test("is idempotent: the second call reads nothing and keeps later changes", async () => {
    persist({ saved: [storedEntry(ELM)], recent: [] });
    const m = await loadHydratedStore();
    m.usePlaces.getState().unsave(lists(m).saved[0].id);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const addListener = vi.spyOn(window, "addEventListener");
    m.hydratePlaces();
    m.hydratePlaces();
    expect(getItem).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(lists(m).saved).toEqual([]);
  });

  test("StrictMode's double effects hydrate once", async () => {
    persist({ saved: [storedEntry(ELM)], recent: [] });
    const m = await loadStore();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const addListener = vi.spyOn(window, "addEventListener");
    const flags: boolean[] = [];
    function Probe() {
      flags.push(m.useHydratePlaces());
      const count = m.usePlaces((state) => state.saved.length);
      return createElement("p", null, String(count));
    }
    const view = render(createElement(StrictMode, null, createElement(Probe)));
    expect(view.container.textContent).toBe("1");
    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    expect(flags[0]).toBe(false);
    expect(flags.at(-1)).toBe(true);
  });

  test("usePlacesHydrated turns true for components mounted before hydration", async () => {
    const m = await loadStore();
    const hook = renderHook(() => m.usePlacesHydrated());
    expect(hook.result.current).toBe(false);
    act(() => m.hydratePlaces());
    expect(hook.result.current).toBe(true);
  });

  test.each([
    ["not JSON", "{{{"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["a state of the wrong shape", JSON.stringify({ state: "garbage", version: 1 })],
    ["lists of the wrong type", JSON.stringify({ state: { saved: 5, recent: {} }, version: 1 })],
    ["no version", JSON.stringify({ state: { saved: [null], recent: [7] } })],
  ])("corrupt storage (%s) leaves the lists empty and the app working", async (_, raw) => {
    localStorage.setItem(KEY, raw);
    const m = await loadHydratedStore();
    expect(lists(m)).toEqual({ saved: [], recent: [] });
    expect(m.isPlacesHydrated()).toBe(true);
    m.usePlaces.getState().save(ELM, YARD, null);
    expect(readPersisted().state.saved).toHaveLength(1);
  });

  test("a corrupt entry is dropped, the rest survive", async () => {
    persist({
      saved: [
        storedEntry(ELM),
        { ...storedEntry(OAK), place: { lat: 999, lng: 0 } },
        "junk",
        storedEntry(PIN, { summary: { ...SUMMARY, monthlySunHours: [1, 2] } as PlaceSummary }),
      ],
      recent: [null, storedEntry(OAK, { savedAt: null })],
    });
    const m = await loadHydratedStore();
    expect(lists(m).saved.map((entry) => entry.id)).toEqual([
      m.placeEntryId(ELM),
      m.placeEntryId(PIN),
    ]);
    expect(lists(m).saved[1].summary).toBeNull();
    expect(lists(m).recent).toHaveLength(1);
  });

  test("storage that throws on every access is survived", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const m = await loadHydratedStore();
    expect(m.isPlacesHydrated()).toBe(true);
    const entry = m.usePlaces.getState().save(ELM, YARD, SUMMARY);
    expect(entry.savedAt).not.toBeNull();
    expect(lists(m).saved).toHaveLength(1);
  });

  test("a missing localStorage is survived", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const m = await loadHydratedStore();
      m.usePlaces.getState().recordVisit(ELM, YARD, null);
      expect(lists(m).recent).toHaveLength(1);
      expect(m.isPlacesHydrated()).toBe(true);
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});

describe("migration", () => {
  test("data of another version is repaired and rewritten at the current one", async () => {
    persist(
      {
        saved: [
          { place: ELM, label: "Old build entry", observer: { mode: "yard" }, visitedAt: 5 },
          { place: null },
        ],
        recent: "n/a",
        somethingElse: true,
      },
      0,
    );
    const m = await loadHydratedStore();
    expect(lists(m).saved).toEqual([
      {
        id: m.placeEntryId(ELM),
        place: ELM,
        observer: YARD,
        label: "Old build entry",
        summary: null,
        savedAt: 5,
        visitedAt: 5,
      },
    ]);
    expect(readPersisted()).toEqual({ state: lists(m), version: 1 });
  });

  test("data from a newer build is read as far as it makes sense", async () => {
    persist({ saved: [storedEntry(ELM)], recent: [], folders: [{ name: "Shortlist" }] }, 7);
    const m = await loadHydratedStore();
    expect(lists(m).saved).toEqual([storedEntry(ELM)]);
  });
});

describe("writing", () => {
  test("every change is written at once, in the versioned envelope", async () => {
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    store.recordVisit(ELM, YARD, null);
    expect(readPersisted().state.recent).toHaveLength(1);
    const entry = store.save(ELM, YARD, SUMMARY, "Backyard");
    store.setNote(entry.id, "Lovely garden");
    expect(readPersisted()).toEqual({ state: lists(m), version: 1 });
    expect(readPersisted().state.saved[0]).toMatchObject({
      label: "Backyard",
      note: "Lovely garden",
      summary: SUMMARY,
    });
  });

  test("recordVisit with identical data does not write or notify", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    store.recordVisit(ELM, YARD, SUMMARY);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const listener = vi.fn();
    m.usePlaces.subscribe(listener);
    vi.advanceTimersByTime(5_000);
    store.recordVisit({ ...ELM }, { ...YARD }, { ...SUMMARY });
    store.recordVisit(ELM, YARD, null);
    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    // Coming back much later is a new visit.
    vi.advanceTimersByTime(120_000);
    store.recordVisit(ELM, YARD, null);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(lists(m).recent[0].visitedAt).toBe(1_125_000);
  });

  test("actions that change nothing do not write either", async () => {
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    const entry = store.save(ELM, YARD, null);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    store.rename(entry.id, "   ");
    store.rename(entry.id, entry.label);
    store.setNote(entry.id, "");
    store.reorder([entry.id]);
    store.unsave("nope");
    store.removeRecent("nope");
    store.clearRecents();
    store.save(ELM, YARD, null);
    expect(setItem).not.toHaveBeenCalled();
  });

  test("only the list that changed gets a new identity", async () => {
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    store.save(ELM, YARD, null);
    const before = lists(m);
    store.recordVisit(OAK, YARD, null);
    expect(lists(m).saved).toBe(before.saved);
    expect(lists(m).recent).not.toBe(before.recent);
  });

  test("the full list refuses one more and says so through the selector", async () => {
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    for (let i = 0; i < m.PLACES_LIMITS.saved; i++) {
      expect(m.selectCanSave(m.usePlaces.getState())).toBe(true);
      store.save({ lat: i, lng: i }, YARD, null);
    }
    expect(m.selectCanSave(m.usePlaces.getState())).toBe(false);
    expect(m.selectSavedCount(m.usePlaces.getState())).toBe(30);
    const refused = store.save(ELM, YARD, null);
    expect(refused.savedAt).toBeNull();
    expect(lists(m).saved).toHaveLength(m.PLACES_LIMITS.saved);
    expect(m.selectIsSaved(m.usePlaces.getState(), ELM)).toBe(false);
  });
});

describe("selectors", () => {
  test("find entries by place and by id", async () => {
    const m = await loadHydratedStore();
    const store = m.usePlaces.getState();
    const saved = store.save(ELM, YARD, null);
    store.recordVisit(OAK, YARD, null);
    const state = m.usePlaces.getState();
    expect(m.selectSavedEntry(state, { lat: ELM.lat + 0.000001, lng: ELM.lng })).toBe(
      state.saved[0],
    );
    expect(m.selectSavedEntry(state, OAK)).toBeNull();
    expect(m.selectSavedEntry(state, null)).toBeNull();
    expect(m.selectIsSaved(state, ELM)).toBe(true);
    expect(m.selectEntry(state, saved.id)).toBe(state.saved[0]);
    expect(m.selectEntry(state, m.placeEntryId(OAK))).toBe(state.recent[0]);
    expect(m.selectEntry(state, "nope")).toBeNull();
    expect(m.selectEntry(state, null)).toBeNull();
    expect(m.entryLabel(state.saved[0])).toBe("12 Elm St");
  });
});

describe("two tabs", () => {
  test("a write in another tab shows up here", async () => {
    const m = await loadHydratedStore();
    m.usePlaces.getState().save(ELM, YARD, null);
    const mine = lists(m).saved[0];
    const theirs = storedEntry(OAK, { summary: SUMMARY });
    otherTabWrote({ saved: [mine, theirs], recent: [storedEntry(PIN, { savedAt: null })] });
    expect(lists(m).saved.map((entry) => entry.id)).toEqual([mine.id, theirs.id]);
    expect(lists(m).recent).toHaveLength(1);
    // What did not change keeps its identity (no needless re-render).
    expect(lists(m).saved[0]).toBe(mine);
  });

  test("a place removed in another tab is removed here, not merged back", async () => {
    const m = await loadHydratedStore();
    m.usePlaces.getState().save(ELM, YARD, null);
    m.usePlaces.getState().save(OAK, YARD, null);
    const [first] = lists(m).saved;
    otherTabWrote({ saved: [first], recent: [] });
    expect(lists(m).saved).toEqual([first]);
    otherTabWrote(undefined);
    expect(lists(m)).toEqual({ saved: [], recent: [] });
  });

  test("taking over another tab's write does not write back (no ping-pong)", async () => {
    const m = await loadHydratedStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    persist({ saved: [storedEntry(ELM)], recent: [] });
    setItem.mockClear();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: localStorage }));
    expect(lists(m).saved).toHaveLength(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  test("an identical write notifies no list subscriber", async () => {
    const m = await loadHydratedStore();
    m.usePlaces.getState().save(ELM, YARD, SUMMARY);
    const before = lists(m);
    otherTabWrote(JSON.parse(JSON.stringify(before)));
    expect(lists(m).saved).toBe(before.saved);
    expect(lists(m).recent).toBe(before.recent);
  });

  test("events for other keys and other storage areas are ignored; clear() empties", async () => {
    const m = await loadHydratedStore();
    m.usePlaces.getState().save(ELM, YARD, null);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    window.dispatchEvent(new StorageEvent("storage", { key: "sun-home:v2" }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: sessionStorage }));
    expect(getItem).not.toHaveBeenCalled();
    expect(lists(m).saved).toHaveLength(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(lists(m).saved).toEqual([]);
  });

  test("corrupt data from another tab cannot crash this one", async () => {
    const m = await loadHydratedStore();
    m.usePlaces.getState().save(ELM, YARD, null);
    localStorage.setItem(KEY, "{{{");
    expect(() =>
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: localStorage })),
    ).not.toThrow();
    expect(lists(m)).toEqual({ saved: [], recent: [] });
    m.usePlaces.getState().save(OAK, YARD, null);
    expect(readPersisted().state.saved).toHaveLength(1);
  });

  test("nothing is listened to before hydration", async () => {
    const m = await loadStore();
    persist({ saved: [storedEntry(ELM)], recent: [] });
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: localStorage }));
    expect(lists(m).saved).toEqual([]);
  });
});
