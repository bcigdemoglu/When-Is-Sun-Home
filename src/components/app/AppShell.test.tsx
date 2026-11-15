// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "@/state";
import { AppShell } from "./AppShell";
import { Providers } from "./Providers";

// The map needs WebGL; the shell only needs to know where it sits.
vi.mock("@/components/map/MapPanel", () => ({
  MapPanel: () => <div data-testid="map">the map</div>,
}));

/** Everything between `element` and the document that says `pointer-events: none` (class or inline style). */
function pointerEventsNoneOn(element: Element): string[] {
  const found: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const inline = (node as HTMLElement).style?.pointerEvents === "none";
    const byClass = /(^|\s)pointer-events-none(\s|$)/.test(node.getAttribute("class") ?? "");
    if (inline || byClass) found.push(node.outerHTML.slice(0, 100));
  }
  return found;
}

function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query.includes("min-width: 1024px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function renderShell() {
  const view = render(
    <Providers>
      <AppShell />
    </Providers>,
  );
  // The saved settings load first; then the real layout replaces the skeleton.
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId("map");
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  useSettings.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppShell, phone layout — what Safari on iOS needs (WebKit bug 183870)", () => {
  beforeEach(() => stubMatchMedia(false));

  it("has exactly one scroll container for the map and the sheet, with the map inside it", async () => {
    const { container } = await renderShell();
    const scrollers = container.querySelectorAll(".sheet-scroller");
    expect(scrollers).toHaveLength(1);
    const scroller = scrollers[0] as HTMLElement;
    expect(screen.getAllByTestId("map")).toHaveLength(1);
    expect(scroller.contains(screen.getByTestId("map"))).toBe(true);
    // (jsdom does no layout, so the sheet is never measured and stays hidden: no role query.)
    const sheet = container.querySelector("section.sheet")!;
    expect(sheet).toHaveAttribute("aria-label", "Get started");
    expect(sheet.parentElement).toBe(scroller);
    expect(scroller.dataset.sheet).toBe("start");
  });

  it("puts pointer-events: none on neither the scroll container nor any of its ancestors", async () => {
    const { container } = await renderShell();
    const scroller = container.querySelector(".sheet-scroller")!;
    expect(pointerEventsNoneOn(scroller)).toEqual([]);
    // Nor on the way to anything a finger starts on: the sheet, the map, the search pill.
    expect(pointerEventsNoneOn(container.querySelector("section.sheet h1")!)).toEqual([]);
    expect(pointerEventsNoneOn(screen.getByTestId("map"))).toEqual([]);
    const topBar = container.querySelector(".sheet-topbar")!;
    expect(pointerEventsNoneOn(topBar)).toEqual([]);
    expect(container.querySelectorAll(".pointer-events-none")).toHaveLength(0);
  });

  it("keeps the search strip after the scroller, where the stylesheet can find it", async () => {
    const { container } = await renderShell();
    const scroller = container.querySelector(".sheet-scroller")!;
    const topBar = container.querySelector(".sheet-topbar")!;
    expect(topBar.parentElement).toBe(scroller.parentElement);
    expect(
      scroller.compareDocumentPosition(topBar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("AppShell, desktop layout", () => {
  beforeEach(() => stubMatchMedia(true));

  it("shows the same single map, in the same frame, without a sheet", async () => {
    const { container } = await renderShell();
    expect(screen.getAllByTestId("map")).toHaveLength(1);
    const frame = container.querySelector(".sheet-scroller")!;
    expect(frame.contains(screen.getByTestId("map"))).toBe(true);
    expect(container.querySelector(".sheet")).toBeNull();
    expect(container.querySelector(".sheet-topbar")).toBeNull();
  });
});
