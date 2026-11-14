/**
 * Runs in the default `node` environment: no `window`, no `document`, no
 * `localStorage` — what the modules see during a Next.js server render.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as state from "../index";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  state.useSettings.getState().reset();
});

describe("on the server", () => {
  test("there really is no DOM here", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  test("the modules load and the store holds the defaults", () => {
    expect(state.pickSettings(state.useSettings.getState())).toEqual(state.DEFAULT_SETTINGS);
    expect(state.isSettingsHydrated()).toBe(false);
  });

  test("hydrateSettings and startUrlSync are inert", () => {
    expect(() => state.hydrateSettings()).not.toThrow();
    expect(() => state.hydrateSettings({ search: "?fov=90" })).not.toThrow();
    expect(state.isSettingsHydrated()).toBe(false);
    expect(state.useSettings.getState().observer.fovDeg).toBe(180);

    const stop = state.startUrlSync();
    expect(() => stop()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("actions work without storage and never start a timer or warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = state.useSettings.getState();
    s.setPlace({ lat: 1, lng: 2 });
    s.setObserver({ facingDeg: 370 });
    s.setMinuteOfDay(1500);
    expect(state.useSettings.getState().observer.facingDeg).toBe(10);
    expect(state.useSettings.getState().minuteOfDay).toBe(1439);
    expect(state.settingsStorage.hasPending()).toBe(false);
    expect(() => state.settingsStorage.flush()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test("components render with the defaults and hydrated = false", () => {
    const App = () => {
      const hydrated = state.useHydrateSettings();
      state.useUrlSync();
      const observer = state.useSettings(state.selectObserver);
      const place = state.useSettings(state.selectPlace);
      return createElement("p", null, `${hydrated}|${observer.mode}|${observer.fovDeg}|${place}`);
    };
    expect(renderToString(createElement(App))).toContain("false|yard|180|null");
  });

  test("the pure helpers work (share links, metadata)", () => {
    const patch = state.searchParamsToSettings(new URLSearchParams("lat=40.7&lng=-74&m=w"));
    const settings = state.overlayUrlSettings(state.DEFAULT_SETTINGS, patch);
    expect(settings.observer.mode).toBe("window");
    expect(state.buildShareUrl(settings, "https://sun.example/")).toBe(
      "https://sun.example/?lat=40.70000&lng=-74.00000&m=w",
    );
  });
});

describe("barrel", () => {
  test("exports the public API", () => {
    const expected = [
      // schema
      "DEFAULT_SETTINGS",
      "SETTINGS_LIMITS",
      "settingsSchema",
      "sanitizeSettings",
      "mergeSettings",
      "isSettings",
      // url codec
      "settingsToSearchParams",
      "searchParamsToSettings",
      "isLegacySearchParams",
      "overlayUrlSettings",
      "buildShareUrl",
      // store
      "useSettings",
      "useHydrateSettings",
      "useSettingsHydrated",
      "hydrateSettings",
      "isSettingsHydrated",
      "SETTINGS_STORAGE_KEY",
      // url sync
      "useUrlSync",
      "startUrlSync",
      // selectors
      "selectObserver",
      "selectPlace",
      "floorToHeightM",
      "heightMToFloor",
    ];
    for (const name of expected) expect(state, name).toHaveProperty(name);
  });

  test("the store exposes exactly the specified actions", () => {
    const s = state.useSettings.getState();
    const actions = Object.keys(s).filter((key) => typeof s[key as keyof typeof s] === "function");
    expect(actions.sort()).toEqual(
      [
        "hydrate",
        "reset",
        "resetToNow",
        "setDate",
        "setDateTime",
        "setLayer",
        "setMinuteOfDay",
        "setObserver",
        "setPlace",
      ].sort(),
    );
  });
});
