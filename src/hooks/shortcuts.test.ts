// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shiftMinute, shortcutFor, usesKeysItself } from "./shortcuts";

describe("shortcutFor", () => {
  it("moves the time with the arrow keys", () => {
    expect(shortcutFor({ key: "ArrowRight" }, false)).toEqual({ type: "time", deltaMinutes: 5 });
    expect(shortcutFor({ key: "ArrowLeft" }, false)).toEqual({ type: "time", deltaMinutes: -5 });
    expect(shortcutFor({ key: "ArrowRight", shiftKey: true }, false)).toEqual({
      type: "time",
      deltaMinutes: 60,
    });
    expect(shortcutFor({ key: "ArrowLeft", shiftKey: true }, false)).toEqual({
      type: "time",
      deltaMinutes: -60,
    });
  });

  it("focuses the search with a slash", () => {
    expect(shortcutFor({ key: "/" }, false)).toEqual({ type: "focus-search" });
  });

  it("stays out of the way of browser shortcuts, handled events and busy elements", () => {
    expect(shortcutFor({ key: "ArrowLeft", altKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: "ArrowRight", metaKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: "/", ctrlKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: "ArrowRight", defaultPrevented: true }, false)).toBeNull();
    expect(shortcutFor({ key: "ArrowRight" }, true)).toBeNull();
    expect(shortcutFor({ key: "/" }, true)).toBeNull();
    expect(shortcutFor({ key: "a" }, false)).toBeNull();
  });
});

describe("usesKeysItself", () => {
  function element(html: string, selector: string): Element {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.querySelector(selector)!;
  }

  it("recognises places where arrows or typing already mean something", () => {
    expect(usesKeysItself(element('<input type="text">', "input"))).toBe(true);
    expect(usesKeysItself(element('<input type="range">', "input"))).toBe(true);
    expect(usesKeysItself(element("<textarea></textarea>", "textarea"))).toBe(true);
    expect(usesKeysItself(element('<div role="slider" tabindex="0"></div>', "div"))).toBe(true);
    expect(
      usesKeysItself(element('<div class="maplibregl-map"><canvas></canvas></div>', "canvas")),
    ).toBe(true);
    expect(usesKeysItself(element("<dialog open><button>x</button></dialog>", "button"))).toBe(
      true,
    );
  });

  it("lets shortcuts through from buttons, the page and nothing at all", () => {
    expect(usesKeysItself(element("<button>Play</button>", "button"))).toBe(false);
    expect(usesKeysItself(document.body)).toBe(false);
    expect(usesKeysItself(null)).toBe(false);
  });
});

describe("shiftMinute", () => {
  it("clamps to the day", () => {
    expect(shiftMinute(930, 5)).toBe(935);
    expect(shiftMinute(930, -60)).toBe(870);
    expect(shiftMinute(1438, 5)).toBe(1439);
    expect(shiftMinute(20, -60)).toBe(0);
  });
});
