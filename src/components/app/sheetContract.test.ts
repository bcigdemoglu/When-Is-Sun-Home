/**
 * The CSS half of "the sheet works on iOS by construction".
 *
 * Safari on iOS cannot touch-scroll a container that has `pointer-events:
 * none` — not even from a child that takes input (WebKit bug 183870). That
 * shipped once, and no Chromium-based check noticed. So the stylesheet itself
 * is held to the contract here: read as text, no browser needed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8")
  // Comments may talk about anything.
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { declarations }` block (media queries are looked into, not kept). */
function rules(source: string): { selector: string; body: string; media: string | null }[] {
  const found: { selector: string; body: string; media: string | null }[] = [];
  const walk = (text: string, media: string | null) => {
    let depth = 0;
    let start = 0;
    let head = "";
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "{") {
        if (depth === 0) {
          head = text.slice(start, i).trim();
          start = i + 1;
        }
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          const body = text.slice(start, i);
          if (
            head.startsWith("@media") ||
            head.startsWith("@layer") ||
            head.startsWith("@supports")
          )
            walk(body, head.startsWith("@media") ? head : media);
          else if (!head.startsWith("@")) found.push({ selector: head, body, media });
          start = i + 1;
        }
      }
    }
  };
  walk(source, null);
  return found;
}

const all = rules(css);
const sheetRules = all.filter((rule) => /\.sheet\b|\.sheet-/.test(rule.selector));
const declarations = (selector: string, media: "phone" | "desktop" = "phone") =>
  all
    .filter(
      (rule) =>
        rule.selector === selector &&
        (media === "phone" ? rule.media === null : /min-width:\s*1024px/.test(rule.media ?? "")),
    )
    .map((rule) => rule.body)
    .join("\n");
const value = (body: string, property: string) =>
  new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim() ?? null;

describe("the sheet's stylesheet contract (globals.css)", () => {
  it("finds the rules it is about", () => {
    const selectors = sheetRules.map((rule) => rule.selector);
    for (const selector of [
      ".sheet-scroller",
      ".sheet-map",
      ".sheet",
      ".sheet-handle",
      ".sheet-snap",
    ])
      expect(selectors).toContain(selector);
  });

  it("never uses pointer-events in any sheet rule — nothing is reached through anything", () => {
    const offenders = sheetRules.filter((rule) => /pointer-events/.test(rule.body));
    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it("makes the scroller an ordinary vertical scroll container", () => {
    const scroller = declarations(".sheet-scroller");
    expect(value(scroller, "overflow-y")).toBe("auto");
    expect(value(scroller, "position")).toBe("fixed");
    // No clipping or masking of the scroller: that would cut the map too.
    expect(scroller).not.toMatch(/clip-path|mask/);
    // No rubber band that could pull the map away from the top edge, no chaining to the page.
    expect(value(scroller, "overscroll-behavior")).toBe("none");
  });

  it("never traps the content beyond “full”: proximity snapping, no forced stops", () => {
    expect(value(declarations(".sheet-scroller"), "scroll-snap-type")).toBe("y proximity");
    for (const rule of sheetRules) {
      const stop = value(rule.body, "scroll-snap-stop");
      if (stop !== null) expect(stop).toBe("normal");
    }
    expect(css).not.toMatch(/scroll-snap-stop\s*:\s*always/);
    expect(css).not.toMatch(/scroll-snap-type\s*:\s*y\s+mandatory/);
  });

  it("keeps the map inside the scroller: stuck to its top, full height, handling its own touches", () => {
    const map = declarations(".sheet-map");
    expect(value(map, "position")).toBe("sticky");
    expect(value(map, "top")).toBe("0");
    expect(value(map, "height")).toBe("100%");
    expect(value(map, "touch-action")).toBe("none");
  });

  it("lays the sheet over the bottom of the map by its peek height, above it", () => {
    const sheet = declarations(".sheet");
    expect(value(sheet, "margin-top")).toBe("calc(-1 * var(--sheet-peek, 180px))");
    expect(Number(value(sheet, "z-index"))).toBeGreaterThan(
      Number(value(declarations(".sheet-map"), "z-index")),
    );
    expect(value(sheet, "scroll-snap-align")).toBe("start");
  });

  it("keeps the snap markers out of the way of every touch", () => {
    const marker = declarations(".sheet-snap");
    expect(Number(value(marker, "z-index"))).toBeLessThan(0);
    expect(value(marker, "width")).toBe("1px");
    expect(value(marker, "height")).toBe("1px");
  });

  it("turns the same element into a plain frame for the map on desktop", () => {
    const scroller = declarations(".sheet-scroller", "desktop");
    expect(value(scroller, "position")).toBe("relative");
    expect(value(scroller, "overflow")).toBe("visible");
    expect(value(scroller, "scroll-snap-type")).toBe("none");
    expect(value(declarations(".sheet-map", "desktop"), "position")).toBe("relative");
  });
});
