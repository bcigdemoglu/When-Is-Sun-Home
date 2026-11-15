// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import type { Settings } from "../schema";

type StoreModule = typeof import("../store");
type SyncModule = typeof import("../urlSync");

const KEY = "sun-home:v2";
const SAFARI_LIMIT = 100;
const SAFARI_WINDOW_MS = 30_000;

const STORED: Settings = {
  place: { lat: 48.8566, lng: 2.3522, name: "Paris" },
  date: null,
  minuteOfDay: null,
  observer: { mode: "window", heightM: 10.5, facingDeg: 270, fovDeg: 90 },
  layers: { buildings3d: true, shadows: true },
};
const STORED_QUERY = "?lat=48.85660&lng=2.35220&n=Paris&m=w&h=10.5&dir=270&fov=90";

let store: StoreModule;
let sync: SyncModule;
let replaceState: MockInstance<History["replaceState"]>;
/** `Date.now()` at each replaceState call. */
let callTimes: number[];

/** Sets the address bar behind the spy's back (test setup is not app behaviour). */
const setUrl = (url: string) => History.prototype.replaceState.call(window.history, null, "", url);
const href = () => location.pathname + location.search + location.hash;
const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });

/** The largest number of calls inside any rolling window of `windowMs`. */
function maxCallsInAnyWindow(times: number[], windowMs: number): number {
  let worst = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end] - times[start] >= windowMs) start++;
    worst = Math.max(worst, end - start + 1);
  }
  return worst;
}

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  setUrl("/");
  // Fresh modules: a new store, a new hydration flag and a new limiter.
  vi.resetModules();
  store = await import("../store");
  sync = await import("../urlSync");
  callTimes = [];
  replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    callTimes.push(Date.now());
    History.prototype.replaceState.apply(window.history, args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // Drain pending storage writes of this test's store copy (see store.test.ts).
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("buildShareUrl", () => {
  test("is re-exported from the codec", async () => {
    const codec = await import("../urlCodec");
    expect(sync.buildShareUrl).toBe(codec.buildShareUrl);
    expect(sync.buildShareUrl(STORED, "https://sun.example/x#y")).toBe(
      `https://sun.example/x${STORED_QUERY}#y`,
    );
  });
});

describe("startUrlSync", () => {
  test("mirrors a change into the address bar after the debounce, not before", () => {
    store.hydrateSettings();
    sync.startUrlSync();

    store.useSettings.getState().setPlace({ lat: 40.7128, lng: -74.006, name: "New York" });
    vi.advanceTimersByTime(sync.URL_SYNC_DEBOUNCE_MS - 1);
    expect(replaceState).not.toHaveBeenCalled();
    expect(href()).toBe("/");

    vi.advanceTimersByTime(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?lat=40.71280&lng=-74.00600&n=New+York");
    expect(href()).toBe("/?lat=40.71280&lng=-74.00600&n=New+York");
  });

  test("preserves pathname and hash, replaces the whole query", () => {
    setUrl("/some/path/?utm_source=x&fov=45#report");
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(400);
    expect(href()).toBe("/some/path/?fov=45#report");

    store.useSettings.getState().setObserver({ fovDeg: 180 });
    vi.advanceTimersByTime(400);
    expect(href()).toBe("/some/path/#report");
  });

  test("never touches the URL before hydration has finished", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: STORED, version: 1 }));
    setUrl("/?fov=120");
    sync.startUrlSync();

    // Something changes the store too early. Without the guard this would wipe
    // "?fov=120" from the address bar before hydration could read it.
    store.useSettings.getState().setMinuteOfDay(600);
    store.useSettings.getState().setMinuteOfDay(null);
    vi.advanceTimersByTime(60_000);
    expect(replaceState).not.toHaveBeenCalled();
    expect(href()).toBe("/?fov=120");

    store.hydrateSettings();
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?lat=48.85660&lng=2.35220&n=Paris&m=w&h=10.5&dir=270&fov=120");
  });

  test("after hydration the URL is brought in line with the restored settings", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: STORED, version: 1 }));
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(400);
    expect(href()).toBe(`/${STORED_QUERY}`);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  test("a legacy link is rewritten in the current format", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12));
    setUrl("/?lat=40.71280&lng=-74.00600&z=15&t=870&d=172&f=3&dir=90&bl=0");
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(400);
    expect(href()).toBe("/?lat=40.71280&lng=-74.00600&d=2026-06-21&t=1430&m=w&h=7.5&dir=90");
  });

  test("skips the call when the query string is unchanged", () => {
    setUrl(`/${STORED_QUERY}`);
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(10_000);
    expect(replaceState).not.toHaveBeenCalled();

    // a change that is undone within the debounce window
    store.useSettings.getState().setObserver({ fovDeg: 100 });
    vi.advanceTimersByTime(200);
    store.useSettings.getState().setObserver({ fovDeg: 90 });
    vi.advanceTimersByTime(10_000);
    expect(replaceState).not.toHaveBeenCalled();

    // sub-precision changes do not alter the URL either
    store.useSettings.getState().setObserver({ heightM: 10.52 });
    vi.advanceTimersByTime(10_000);
    expect(replaceState).not.toHaveBeenCalled();
  });

  test("default settings on a clean URL: no call at all", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(60_000);
    expect(replaceState).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("1000 rapid store updates produce a single replaceState", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    vi.advanceTimersByTime(1000);

    for (let i = 0; i < 1000; i++) store.useSettings.getState().setMinuteOfDay(i);
    expect(replaceState).not.toHaveBeenCalled();
    // one timer serves the whole burst
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // url debounce + storage throttle

    vi.advanceTimersByTime(30_000);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?t=1639");
  });

  test("a 30 s slider drag (one update per frame) produces a single replaceState, at the end", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    for (let frame = 0; frame < 1800; frame++) {
      store.useSettings.getState().setMinuteOfDay(frame % 1440);
      vi.advanceTimersByTime(1000 / 60);
    }
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?t=0559");
  });

  test("worst case — a change exactly every debounce period — stays far below Safari's limit", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    // 10 minutes of the most hostile cadence: each change lands just after the
    // previous one was written, so the debounce alone would allow 75 per 30 s.
    for (let i = 0; i < 1500; i++) {
      store.useSettings.getState().setMinuteOfDay(i % 1440);
      vi.advanceTimersByTime(sync.URL_SYNC_DEBOUNCE_MS);
    }
    vi.advanceTimersByTime(60_000);

    const worst = maxCallsInAnyWindow(callTimes, SAFARI_WINDOW_MS);
    expect(worst).toBeLessThanOrEqual(sync.URL_SYNC_MAX_CALLS_PER_WINDOW);
    expect(worst).toBeLessThan(SAFARI_LIMIT / 3);
    for (let i = 1; i < callTimes.length; i++) {
      expect(callTimes[i] - callTimes[i - 1]).toBeGreaterThanOrEqual(sync.URL_SYNC_MIN_INTERVAL_MS);
    }
    // nothing was lost: the address bar ends on the final state
    expect(href()).toBe("/?t=0059");
  });

  test("any update pattern respects both limits (randomised)", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let minute = 0;
    for (let i = 0; i < 4000; i++) {
      minute = (minute + 1) % 1440;
      store.useSettings.getState().setMinuteOfDay(minute);
      // bursts, pauses around the debounce period, and the odd long break
      const r = random();
      vi.advanceTimersByTime(r < 0.5 ? 5 : r < 0.95 ? 380 + Math.floor(random() * 60) : 3000);
    }
    vi.advanceTimersByTime(60_000);

    expect(callTimes.length).toBeGreaterThan(10);
    expect(maxCallsInAnyWindow(callTimes, SAFARI_WINDOW_MS)).toBeLessThanOrEqual(30);
    for (let i = 1; i < callTimes.length; i++) {
      expect(callTimes[i] - callTimes[i - 1]).toBeGreaterThanOrEqual(400);
    }
    expect(location.search).toBe(
      `?t=${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`,
    );
  });

  test("the hard rate limit holds even with the debounce switched off", () => {
    store.hydrateSettings();
    sync.startUrlSync({ debounceMs: 0 });
    for (let i = 0; i < 1000; i++) {
      store.useSettings.getState().setMinuteOfDay(i);
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(60_000);
    // 10 s of updates at ≥ 400 ms spacing
    expect(callTimes.length).toBeLessThanOrEqual(27);
    for (let i = 1; i < callTimes.length; i++) {
      expect(callTimes[i] - callTimes[i - 1]).toBeGreaterThanOrEqual(400);
    }
    expect(href()).toBe("/?t=1639");
  });

  test("the budget is per page: restarting the sync does not refill it", () => {
    store.hydrateSettings();
    for (let i = 0; i < 300; i++) {
      const stop = sync.startUrlSync({ debounceMs: 0, minIntervalMs: 0 });
      store.useSettings.getState().setMinuteOfDay(i);
      vi.advanceTimersByTime(20);
      stop();
    }
    expect(maxCallsInAnyWindow(callTimes, SAFARI_WINDOW_MS)).toBeLessThanOrEqual(30);
  });

  test("an update dropped by the limiter is written once the limiter allows", () => {
    store.hydrateSettings();
    sync.startUrlSync({ debounceMs: 0, minIntervalMs: 1000 });
    store.useSettings.getState().setMinuteOfDay(1);
    vi.advanceTimersByTime(0);
    expect(href()).toBe("/?t=0001");

    store.useSettings.getState().setMinuteOfDay(2);
    vi.advanceTimersByTime(999);
    expect(href()).toBe("/?t=0001");
    vi.advanceTimersByTime(1);
    expect(href()).toBe("/?t=0002");
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  test("a throwing replaceState (Safari SecurityError) is swallowed and retried after a pause", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    replaceState.mockImplementationOnce(() => {
      throw new DOMException(
        "Attempt to use history.replaceState() more than 100 times per 30 seconds",
        "SecurityError",
      );
    });

    store.useSettings.getState().setMinuteOfDay(60);
    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/");
    // the store was never affected
    expect(store.useSettings.getState().minuteOfDay).toBe(60);

    // no attempt during the pause, then one retry — without any new change
    vi.advanceTimersByTime(sync.URL_SYNC_FAILURE_BACKOFF_MS - 1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(href()).toBe("/?t=0100");
  });

  test("changes made during the pause wait for it to end", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    replaceState.mockImplementationOnce(() => {
      throw new DOMException("nope", "SecurityError");
    });
    store.useSettings.getState().setMinuteOfDay(60);
    vi.advanceTimersByTime(400);

    store.useSettings.getState().setMinuteOfDay(61);
    vi.advanceTimersByTime(sync.URL_SYNC_FAILURE_BACKOFF_MS - 500);
    expect(replaceState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(href()).toBe("/?t=0101");
  });

  test("where replaceState can never work it gives up quietly until the next change", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    replaceState.mockImplementation(() => {
      throw new DOMException("nope", "SecurityError");
    });

    store.useSettings.getState().setMinuteOfDay(60);
    expect(() => vi.advanceTimersByTime(10 * 60_000)).not.toThrow();
    expect(replaceState).toHaveBeenCalledTimes(1 + sync.URL_SYNC_MAX_RETRIES);
    expect(vi.getTimerCount()).toBe(0);

    // a new change is one new attempt, not a new series
    store.useSettings.getState().setMinuteOfDay(61);
    vi.advanceTimersByTime(10 * 60_000);
    expect(replaceState).toHaveBeenCalledTimes(2 + sync.URL_SYNC_MAX_RETRIES);
  });

  test("a permanently failing replaceState under constant changes never throws and stays slow", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    replaceState.mockImplementation(() => {
      throw new DOMException("nope", "SecurityError");
    });
    expect(() => {
      for (let i = 0; i < 600; i++) {
        store.useSettings.getState().setMinuteOfDay(i);
        vi.advanceTimersByTime(500);
      }
    }).not.toThrow();
    // 5 minutes: one attempt per 10 s pause at most
    expect(replaceState.mock.calls.length).toBeLessThanOrEqual(31);
    expect(store.useSettings.getState().minuteOfDay).toBe(599);
  });

  test("going to the background writes immediately instead of waiting out the debounce", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    store.useSettings.getState().setMinuteOfDay(90);
    vi.advanceTimersByTime(100);
    expect(replaceState).not.toHaveBeenCalled();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?t=0130");

    vi.advanceTimersByTime(10_000);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  test("stop() cancels pending work and detaches everything", () => {
    store.hydrateSettings();
    const stop = sync.startUrlSync();
    store.useSettings.getState().setMinuteOfDay(90);
    stop();
    vi.advanceTimersByTime(60_000);
    store.useSettings.getState().setMinuteOfDay(91);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    expect(replaceState).not.toHaveBeenCalled();
    expect(href()).toBe("/");
  });

  test("stop() before hydration: hydrating later starts nothing", () => {
    const stop = sync.startUrlSync();
    stop();
    setUrl("/?fov=45&junk=1");
    store.hydrateSettings();
    vi.advanceTimersByTime(60_000);
    expect(replaceState).not.toHaveBeenCalled();
  });

  test("the address bar always converges on the final state", () => {
    store.hydrateSettings();
    sync.startUrlSync();
    const s = store.useSettings.getState();
    s.setPlace({ lat: 1, lng: 2 });
    vi.advanceTimersByTime(399);
    s.setObserver({ mode: "window", fovDeg: 77 });
    vi.advanceTimersByTime(399);
    s.setLayer("shadows", false);
    vi.advanceTimersByTime(399);
    s.setDateTime("2026-06-21", 720);
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?lat=1.00000&lng=2.00000&d=2026-06-21&t=1200&m=w&fov=77&sh=0");

    s.reset();
    vi.advanceTimersByTime(400);
    expect(href()).toBe("/");
  });
});

describe("useUrlSync", () => {
  test("works under StrictMode (double-invoked effects) without doubling the calls", () => {
    store.hydrateSettings();
    const { unmount } = renderHook(() => sync.useUrlSync(), { wrapper: StrictMode });

    store.useSettings.getState().setMinuteOfDay(600);
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?t=1000");

    unmount();
    store.useSettings.getState().setMinuteOfDay(601);
    vi.advanceTimersByTime(60_000);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  test("mounted together with useHydrateSettings: reads the URL first, then mirrors", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: STORED, version: 1 }));
    setUrl("/?fov=120#h");
    const { result } = renderHook(
      () => {
        // deliberately in the "wrong" order: the sync effect runs first
        sync.useUrlSync();
        return store.useHydrateSettings();
      },
      { wrapper: StrictMode },
    );
    expect(result.current).toBe(true);
    expect(store.useSettings.getState().observer.fovDeg).toBe(120);
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(href()).toBe("/?lat=48.85660&lng=2.35220&n=Paris&m=w&h=10.5&dir=270&fov=120#h");
  });

  test("two mounted instances do not double the writes", () => {
    store.hydrateSettings();
    renderHook(() => sync.useUrlSync());
    renderHook(() => sync.useUrlSync());
    store.useSettings.getState().setMinuteOfDay(600);
    vi.advanceTimersByTime(5000);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
