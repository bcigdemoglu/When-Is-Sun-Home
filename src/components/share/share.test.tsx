// @vitest-environment jsdom
import { render } from "@testing-library/react";
import fc from "fast-check";
import { encode } from "uqr";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { DEFAULT_SETTINGS, type Settings } from "@/state/schema";
import { searchParamsToSettings, searchParamsToSummary } from "@/state/urlCodec";
import {
  bestWorstLine,
  coordinatesLabel,
  shortPlaceName,
  truncate,
  viewpointLabel,
} from "./describe";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { placePopover } from "./popoverPosition";
import { QrCode } from "./QrCode";
import { canShareNatively, copyText, isAbortError } from "./shareActions";
import { isLiveView, shareLink, sharedSettings, viewedDateTime } from "./shareLink";

const PLACE: Place = { lat: 37.7912, lng: -122.4301, name: "2550 Pacific Ave, San Francisco" };
const SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 4,
  sunFraction: 0.34,
  totalSunHours: 1477,
  monthlySunHours: [3.6, 4.9, 5, 4.9, 3.7, 3.1, 3.4, 4.5, 5.2, 5, 4.3, 1.2],
  monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
  bestMonth: 8,
  worstMonth: 11,
};
const observer = (patch: Partial<Observer>): Observer => ({
  ...DEFAULT_SETTINGS.observer,
  ...patch,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describe", () => {
  test("shortPlaceName takes the first component of an address", () => {
    expect(shortPlaceName(PLACE)).toBe("2550 Pacific Ave");
    expect(shortPlaceName({ lat: 1, lng: 2, name: "Home" })).toBe("Home");
    expect(shortPlaceName({ lat: 1, lng: 2, name: " , San Francisco" })).toBeNull();
    expect(shortPlaceName({ lat: 1, lng: 2 })).toBeNull();
  });

  test("coordinatesLabel names the hemispheres", () => {
    expect(coordinatesLabel(PLACE)).toBe("37.7912° N, 122.4301° W");
    expect(coordinatesLabel({ lat: -33.87, lng: 151.21 })).toBe("33.8700° S, 151.2100° E");
  });

  test("truncate counts characters, not UTF-16 units, and marks the cut", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("exactly ten", 11)).toBe("exactly ten");
    expect(truncate("a rather long place name", 10)).toBe("a rather…");
    expect(truncate("🏠🏠🏠🏠🏠", 3)).toBe("🏠🏠…");
  });

  test.each<[Partial<Observer>, string]>([
    [{ mode: "yard", heightM: 1 }, "Backyard · ground level"],
    [{ mode: "yard", heightM: 2.9 }, "Backyard · ground level"],
    [{ mode: "yard", heightM: 10.5 }, "Terrace · 4th floor"],
    [{ mode: "window", heightM: 1.5, facingDeg: 0 }, "Window · ground floor · facing N"],
    [{ mode: "window", heightM: 4.5, facingDeg: 180 }, "Window · 2nd floor · facing S"],
    [{ mode: "window", heightM: 7.5, facingDeg: 225 }, "Window · 3rd floor · facing SW"],
    [{ mode: "window", heightM: 31.5, facingDeg: 350 }, "Window · 11th floor · facing N"],
    [{ mode: "window", heightM: 61.5, facingDeg: 60 }, "Window · 21st floor · facing NE"],
    [{ mode: "window", heightM: 64.5, facingDeg: 90 }, "Window · 22nd floor · facing E"],
    [{ mode: "window", heightM: 298.5, facingDeg: 315 }, "Window · 100th floor · facing NW"],
  ])("viewpointLabel(%o) = %s", (patch, expected) => {
    expect(viewpointLabel(observer(patch))).toBe(expected);
  });

  test("bestWorstLine: best and worst month, 'none' for zero, null when flat", () => {
    expect(bestWorstLine(SUMMARY)).toBe("5.2 h in September · 1.2 h in December");
    expect(bestWorstLine(SUMMARY, ", ")).toBe("5.2 h in September, 1.2 h in December");
    const zeroWinter = {
      ...SUMMARY,
      monthlySunHours: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1],
      bestMonth: 6,
      worstMonth: 0,
    };
    expect(bestWorstLine(zeroWinter)).toBe("6.0 h in July · none in January");
    const flat = { ...SUMMARY, monthlySunHours: Array(12).fill(3) as number[], worstMonth: 8 };
    expect(bestWorstLine(flat)).toBeNull();
  });
});

describe("shareLink", () => {
  const pinned: Settings = {
    ...DEFAULT_SETTINGS,
    place: PLACE,
    date: "2026-06-21",
    minuteOfDay: 940,
    observer: observer({ mode: "window", heightM: 4.5, fovDeg: 120 }),
  };
  const live: Settings = { ...pinned, date: null, minuteOfDay: null };
  // 12:07 PM on 14 Nov 2026 in San Francisco.
  const now = new Date("2026-11-14T20:07:30Z");
  const input = { place: PLACE, label: "Elm St backyard", base: "https://sun.example/#x", now };

  test("isLiveView: only when both date and time follow the clock", () => {
    expect(isLiveView(live)).toBe(true);
    expect(isLiveView(pinned)).toBe(false);
    expect(isLiveView({ ...live, date: "2026-06-21" })).toBe(false);
    expect(isLiveView({ ...live, minuteOfDay: 0 })).toBe(false);
  });

  test("viewedDateTime fills what follows the clock with the place's own now", () => {
    expect(viewedDateTime(pinned, PLACE, now)).toEqual({ date: "2026-06-21", minuteOfDay: 940 });
    expect(viewedDateTime(live, PLACE, now)).toEqual({ date: "2026-11-14", minuteOfDay: 727 });
    expect(viewedDateTime({ ...live, date: "2026-06-21" }, PLACE, now)).toEqual({
      date: "2026-06-21",
      minuteOfDay: 727,
    });
    // the same instant is already the next morning in Sydney
    expect(viewedDateTime(live, { lat: -33.87, lng: 151.21 }, now)).toEqual({
      date: "2026-11-15",
      minuteOfDay: 7 * 60 + 7,
    });
  });

  test("the link names the place by its label and reproduces the view", () => {
    const url = shareLink({ ...input, settings: pinned, includeDateTime: true, summary: SUMMARY });
    const params = new URL(url).searchParams;
    expect(searchParamsToSettings(params)).toEqual({
      place: { lat: 37.7912, lng: -122.4301, name: "Elm St backyard" },
      date: "2026-06-21",
      minuteOfDay: 940,
      observer: { mode: "window", heightM: 4.5, fovDeg: 120 },
    });
    expect(searchParamsToSummary(params)).toEqual(SUMMARY);
    expect(url.endsWith("#x")).toBe(true);
  });

  test("includeDateTime: false always opens on today, now", () => {
    const params = new URL(shareLink({ ...input, settings: pinned, includeDateTime: false }))
      .searchParams;
    expect(params.has("d")).toBe(false);
    expect(params.has("t")).toBe(false);
    expect(params.has("s")).toBe(false);
  });

  test("includeDateTime: true in a live view pins the current day and time at the place", () => {
    const params = new URL(shareLink({ ...input, settings: live, includeDateTime: true }))
      .searchParams;
    expect(params.get("d")).toBe("2026-11-14");
    expect(params.get("t")).toBe("1207");
  });

  test("an empty label falls back to the place's own name; the settings are not mutated", () => {
    const frozen = Object.freeze({ ...pinned });
    const shared = sharedSettings({
      ...input,
      label: "  ",
      settings: frozen,
      includeDateTime: true,
    });
    expect(shared.place?.name).toBe("2550 Pacific Ave, San Francisco");
    expect(frozen.place).toBe(PLACE);
  });

  test("the place comes from the prop, not from whatever the store holds", () => {
    const elsewhere = { ...pinned, place: { lat: 1, lng: 2, name: "Old" } };
    const shared = sharedSettings({ ...input, settings: elsewhere, includeDateTime: false });
    expect(shared.place).toEqual({ lat: 37.7912, lng: -122.4301, name: "Elm St backyard" });
  });

  test("a full share link stays short", () => {
    const url = shareLink({
      ...input,
      label: "x".repeat(60),
      settings: pinned,
      includeDateTime: true,
      summary: SUMMARY,
    });
    expect(url.length).toBeLessThan(300);
  });
});

describe("placePopover", () => {
  const viewport = { width: 1440, height: 900 };
  const size = { width: 360, height: 480 };

  test("below the anchor, left edges aligned, when there is room", () => {
    const anchor = { top: 100, left: 40, width: 96, height: 44 };
    expect(placePopover(anchor, size, viewport)).toEqual({
      top: 152,
      left: 40,
      maxHeight: 740,
      side: "below",
    });
  });

  test("above when it does not fit below", () => {
    const anchor = { top: 800, left: 40, width: 96, height: 44 };
    const placed = placePopover(anchor, size, viewport);
    expect(placed.side).toBe("above");
    expect(placed.top).toBe(800 - 8 - 480);
  });

  test("right-aligned to an anchor in the right half, and never off screen", () => {
    const anchor = { top: 100, left: 1380, width: 44, height: 44 };
    expect(placePopover(anchor, size, viewport).left).toBe(1380 + 44 - 360);
    const edge = { top: 100, left: 1436, width: 44, height: 44 };
    expect(placePopover(edge, size, viewport).left).toBe(1440 - 8 - 360);
    const negative = { top: 100, left: -50, width: 44, height: 44 };
    expect(placePopover(negative, size, viewport).left).toBe(8);
  });

  test("fits the 440 px panel and a phone-wide viewport", () => {
    const inPanel = placePopover({ top: 120, left: 320, width: 96, height: 44 }, size, viewport);
    expect(inPanel.left).toBe(320);
    const phone = { width: 390, height: 844 };
    const placed = placePopover({ top: 327, left: 33, width: 100, height: 44 }, size, phone);
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + size.width).toBeLessThanOrEqual(390 - 8);
    // not enough room for all of it: it keeps to its side and scrolls inside
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(327 + 44 + 8);
    expect(placed.maxHeight).toBe(844 - 8 - placed.top);
  });

  test("a very short viewport: stays on screen, even over the anchor", () => {
    const short = { width: 800, height: 400 };
    const placed = placePopover({ top: 180, left: 40, width: 96, height: 44 }, size, short);
    expect(placed.top).toBe(8);
    expect(placed.maxHeight).toBe(384);
  });

  test("whatever the geometry, the panel stays inside the viewport", () => {
    fc.assert(
      fc.property(
        fc.record({
          top: fc.integer({ min: -200, max: 2200 }),
          left: fc.integer({ min: -200, max: 3000 }),
          width: fc.integer({ min: 20, max: 300 }),
          height: fc.integer({ min: 20, max: 80 }),
        }),
        fc.record({
          width: fc.integer({ min: 100, max: 400 }),
          height: fc.integer({ min: 100, max: 900 }),
        }),
        fc.record({
          width: fc.integer({ min: 416, max: 2600 }),
          height: fc.integer({ min: 300, max: 2000 }),
        }),
        (anchor, panel, view) => {
          const placed = placePopover(anchor, panel, view);
          const height = Math.min(panel.height, placed.maxHeight);
          expect(placed.left).toBeGreaterThanOrEqual(8);
          expect(placed.left + panel.width).toBeLessThanOrEqual(view.width - 8);
          expect(placed.maxHeight).toBeLessThanOrEqual(view.height - 16);
          // vertically inside whenever the anchor itself is on screen
          if (anchor.top >= 0 && anchor.top + anchor.height <= view.height) {
            expect(placed.top).toBeGreaterThanOrEqual(8);
            expect(placed.top + height).toBeLessThanOrEqual(view.height - 8);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("QrCode", () => {
  const url = "https://sun.example/?lat=37.79120&lng=-122.43010&n=Elm+St+backyard&m=w&h=4.5";

  test("draws every dark module of the code, and only those", () => {
    const { container } = render(<QrCode value={url} size={128} />);
    const svg = container.querySelector("svg");
    const { data, size } = encode(url, { ecc: "L", border: 0 });
    expect(svg).toHaveAttribute("width", "128");
    expect(svg).toHaveAttribute("data-modules", String(size));
    expect(svg).toHaveAttribute("viewBox", `-4 -4 ${size + 8} ${size + 8}`);

    // Re-rasterise the path and compare with the matrix.
    const drawn = data.map((row) => row.map(() => false));
    const path = svg?.querySelector("path")?.getAttribute("d") ?? "";
    for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let col = Number(x); col < Number(x) + Number(w); col++) drawn[Number(y)][col] = true;
    }
    expect(drawn).toEqual(data);
  });

  test("is dark on white whatever the theme, with a quiet zone", () => {
    const { container } = render(<QrCode value={url} />);
    expect(container.querySelector("rect")).toHaveAttribute("fill", "#ffffff");
    expect(container.querySelector("path")).toHaveAttribute("fill", "#1e1a15");
    expect(container.querySelector("svg")).toHaveAccessibleName(/QR code/);
  });

  test("renders nothing rather than throwing when the text cannot be encoded", () => {
    const { container } = render(<QrCode value={"x".repeat(10_000)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LinkPreviewCard", () => {
  test("a spot without sun says None", () => {
    const none = {
      ...SUMMARY,
      avgSunHoursPerDay: 0,
      sunFraction: 0,
      totalSunHours: 0,
      monthlySunHours: Array(12).fill(0) as number[],
      bestMonth: 0,
      worstMonth: 0,
    };
    const { container } = render(
      <LinkPreviewCard
        label="North window"
        viewpoint="Window · 2nd floor · facing N"
        summary={none}
      />,
    );
    expect(container).toHaveTextContent("None");
    expect(container).toHaveTextContent("No direct sun at any time of year");
    expect(container.querySelectorAll(".bg-state-sun")).toHaveLength(0);
  });

  test("bars never stand taller than their track", () => {
    const { container } = render(<LinkPreviewCard label="x" viewpoint="y" summary={SUMMARY} />);
    const bars = [...container.querySelectorAll<HTMLElement>(".bg-state-sun")];
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      const percent = Number(/(\d+)%/.exec(bar.style.height)?.[1]);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe("shareActions", () => {
  const define = (key: string, value: unknown) =>
    Object.defineProperty(navigator, key, { configurable: true, value });
  const pointer = (coarse: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("pointer: coarse") && coarse,
    })) as unknown as typeof window.matchMedia;
  };

  test("canShareNatively needs the Web Share API and a touch-first device", () => {
    define("share", async () => {});
    pointer(true);
    expect(canShareNatively()).toBe(true);
    pointer(false);
    expect(canShareNatively()).toBe(false);
    define("share", undefined);
    pointer(true);
    expect(canShareNatively()).toBe(false);
  });

  test("canShareNatively respects canShare and survives a missing matchMedia", () => {
    define("share", async () => {});
    pointer(true);
    define("canShare", (data: ShareData) => data.url !== "nope");
    expect(canShareNatively({ url: "https://x.example" })).toBe(true);
    expect(canShareNatively({ url: "nope" })).toBe(false);
    define("canShare", undefined);
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(canShareNatively()).toBe(false);
    window.matchMedia = (() => {
      throw new Error("boom");
    }) as unknown as typeof window.matchMedia;
    expect(canShareNatively()).toBe(false);
  });

  test("isAbortError", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new DOMException("x", "NotAllowedError"))).toBe(false);
    expect(isAbortError(new Error("AbortError"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });

  test("copyText: Clipboard API first", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    define("clipboard", { writeText });
    document.execCommand = vi.fn() as unknown as typeof document.execCommand;
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("copyText: falls back to a selected, hidden textarea and cleans up", async () => {
    define("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    let seen: { value: string; start: number | null; end: number | null } | null = null;
    document.execCommand = vi.fn(() => {
      const area = document.activeElement as HTMLTextAreaElement;
      seen = { value: area.value, start: area.selectionStart, end: area.selectionEnd };
      return true;
    }) as unknown as typeof document.execCommand;
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();

    await expect(copyText("the link")).resolves.toBe(true);
    expect(seen).toEqual({ value: "the link", start: 0, end: 8 });
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  test("copyText: resolves false, never rejects, when nothing works", async () => {
    define("clipboard", undefined);
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand;
    await expect(copyText("x")).resolves.toBe(false);
    document.execCommand = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof document.execCommand;
    await expect(copyText("x")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    (document as { execCommand?: unknown }).execCommand = undefined;
    await expect(copyText("x")).resolves.toBe(false);
  });
});
