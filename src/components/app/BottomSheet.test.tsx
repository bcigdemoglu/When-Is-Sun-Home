// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomSheet, type BottomSheetHandle, type SheetContent } from "./BottomSheet";

// jsdom does no layout: give the scroller and the header the sizes a phone would.
const SIZES: Record<string, number> = { "sheet-scroller": 780, "sheet-handle": 28, header: 144 };
let restore: (() => void)[] = [];

beforeEach(() => {
  const patch = (property: "clientHeight" | "offsetHeight") => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        for (const [name, size] of Object.entries(SIZES)) {
          if (this.classList.contains(name) || this.dataset.testid === name) return size;
        }
        return this.querySelector("[data-testid='header']") &&
          !this.classList.contains("sheet") &&
          !this.classList.contains("sheet-scroller")
          ? SIZES.header
          : 0;
      },
    });
    restore.push(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, property, original);
    });
  };
  patch("clientHeight");
  patch("offsetHeight");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restore.forEach((undo) => undo());
  restore = [];
});

const SHEET: SheetContent = {
  key: "place",
  label: "Sun report",
  header: <div data-testid="header">The answer</div>,
  content: <p>The report</p>,
};

function Stage({
  sheet,
  handle,
  onSettle,
  onPeekChange,
}: {
  sheet: SheetContent | null;
  handle: React.Ref<BottomSheetHandle>;
  onSettle: (height: number, detent: string) => void;
  onPeekChange: (peek: number) => void;
}) {
  return (
    <div data-testid="root" className="relative h-dvh overflow-clip">
      <BottomSheet
        ref={handle}
        map={<div data-testid="map">the map</div>}
        sheet={sheet}
        topInset={76}
        onSettle={onSettle}
        onPeekChange={onPeekChange}
      />
    </div>
  );
}

function setup(overrides: Partial<SheetContent> | null = {}) {
  const ref = createRef<BottomSheetHandle>();
  const onSettle = vi.fn();
  const onPeekChange = vi.fn();
  const sheet = overrides === null ? null : { ...SHEET, ...overrides };
  const view = render(
    <Stage sheet={sheet} handle={ref} onSettle={onSettle} onPeekChange={onPeekChange} />,
  );
  const scroller = view.container.querySelector<HTMLDivElement>(".sheet-scroller")!;
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  const show = (next: SheetContent | null) =>
    view.rerender(
      <Stage sheet={next} handle={ref} onSettle={onSettle} onPeekChange={onPeekChange} />,
    );
  return { ref, onSettle, onPeekChange, scroller, scrollTo, show, view };
}

/** Every `pointer-events: none` a touch on `element` would have to get past, from the root down. */
function pointerEventsNoneOn(element: Element): string[] {
  const found: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const inline = (node as HTMLElement).style?.pointerEvents === "none";
    const byClass = /(^|\s)pointer-events-none(\s|$)/.test(node.getAttribute("class") ?? "");
    if (inline || byClass) found.push(node.outerHTML.slice(0, 80));
  }
  return found;
}

describe("BottomSheet", () => {
  it("is a labelled region with its header and content", () => {
    setup();
    const region = screen.getByRole("region", { name: "Sun report" });
    expect(region).toHaveTextContent("The answer");
    expect(region).toHaveTextContent("The report");
  });

  it("hands its measurements to the CSS that does the actual work", () => {
    const { scroller, onPeekChange } = setup();
    // peek = handle (28) + header (144); half = 50% of 780; gap = the top inset.
    expect(scroller.style.getPropertyValue("--sheet-peek")).toBe("172px");
    expect(scroller.style.getPropertyValue("--sheet-half")).toBe("390px");
    expect(scroller.style.getPropertyValue("--sheet-gap")).toBe("76px");
    expect(scroller.dataset.detent).toBe("peek");
    expect(scroller.dataset.sheet).toBe("place");
    expect(onPeekChange).toHaveBeenLastCalledWith(172);
  });

  it("reports how much of it is showing once it knows", () => {
    const { onSettle } = setup();
    expect(onSettle).toHaveBeenLastCalledWith(172, "peek");
  });

  it("steps up a detent when the handle is pressed", async () => {
    const { scrollTo } = setup();
    const handle = screen.getByRole("button", { name: "Expand the sheet" });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(handle);
    // half sits 390 − 172 px into the scroll.
    expect(scrollTo).toHaveBeenCalledWith({ top: 218, behavior: "smooth" });
  });

  it("moves to any detent on request", () => {
    const { ref, scrollTo } = setup();
    act(() => ref.current?.snapTo("full"));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 780 - 172 - 76, behavior: "smooth" });
    scrollTo.mockClear();
    act(() => ref.current?.snapTo("peek")); // already there
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("follows the scroll position: detent, handle label and hidden buttons at full", () => {
    vi.useFakeTimers();
    const { scroller, onSettle } = setup({ fabs: <button type="button">Locate</button> });
    expect(scroller.dataset.covering).toBeUndefined();
    act(() => {
      scroller.scrollTop = 900; // well into the content
      scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(200);
    });
    expect(scroller.dataset.detent).toBe("full");
    // The strip behind the search pill turns solid (`.sheet-topbar`).
    expect(scroller.dataset.covering).toBe("");
    expect(onSettle).toHaveBeenLastCalledWith(780 - 76, "full");
    expect(
      screen.getByRole("button", { name: "Collapse the sheet to show the map" }),
    ).toHaveAttribute("aria-expanded", "true");
    const fabs = scroller.querySelector(".sheet-fabs")!;
    expect(fabs).toHaveAttribute("inert");
    expect(fabs).toHaveClass("sheet-fabs-away");
  });

  it("has no half stop when told so (the start screen)", async () => {
    const { scroller, scrollTo } = setup({ halfRatio: null });
    expect(scroller.querySelector(".sheet-snap-half")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand the sheet" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 780 - 172 - 76, behavior: "smooth" });
  });

  // ── What Safari on iOS needs (WebKit bug 183870) ─────────────────────────
  describe("works on iOS by construction", () => {
    it("keeps the map INSIDE the scroll container, as its first child", () => {
      const { scroller } = setup();
      const map = screen.getByTestId("map");
      expect(scroller.contains(map)).toBe(true);
      expect(scroller.firstElementChild).toHaveClass("sheet-map");
      expect(scroller.firstElementChild!.contains(map)).toBe(true);
      // … and the sheet after it, in the same scroller.
      const sheet = screen.getByRole("region", { name: "Sun report" });
      expect(sheet.parentElement).toBe(scroller);
      expect(
        scroller.firstElementChild!.compareDocumentPosition(sheet) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("has no pointer-events: none on the scroller, around it, or on the way to the sheet or the map", () => {
      const { scroller } = setup({ fabs: <button type="button">Locate</button> });
      expect(pointerEventsNoneOn(scroller)).toEqual([]);
      expect(pointerEventsNoneOn(screen.getByRole("region", { name: "Sun report" }))).toEqual([]);
      expect(pointerEventsNoneOn(screen.getByText("The answer"))).toEqual([]);
      expect(pointerEventsNoneOn(screen.getByText("The report"))).toEqual([]);
      expect(pointerEventsNoneOn(screen.getByTestId("map"))).toEqual([]);
      expect(pointerEventsNoneOn(screen.getByRole("button", { name: "Locate" }))).toEqual([]);
      // Nothing inside the scroller uses it at all — not even at full, with the buttons away.
      vi.useFakeTimers();
      act(() => {
        scroller.scrollTop = 900;
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(200);
      });
      expect(
        scroller.querySelectorAll(".pointer-events-none, [style*='pointer-events']"),
      ).toHaveLength(0);
    });

    it("puts a sheet that came to rest between two stops on the nearest one", () => {
      vi.useFakeTimers();
      const { scroller, scrollTo } = setup();
      act(() => {
        scroller.scrollTop = 150; // half is at 218
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(1000);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 218, behavior: "smooth" });
    });

    it("never moves the sheet under a finger, and never pulls the content back at full", () => {
      vi.useFakeTimers();
      const { scroller, scrollTo } = setup();
      act(() => {
        scroller.dispatchEvent(new Event("touchstart"));
        scroller.scrollTop = 150;
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(1000); // held still, between two stops
      });
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => {
        const end = new Event("touchend") as Event & { touches: unknown[] };
        end.touches = [];
        scroller.dispatchEvent(end);
        vi.advanceTimersByTime(1000);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 218, behavior: "smooth" });

      scrollTo.mockClear();
      act(() => {
        scroller.scrollTop = 1234; // reading the report
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(1000);
      });
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  // ── One map for every layout ─────────────────────────────────────────────
  describe("the map's frame", () => {
    it("is just that when there is no sheet (desktop)", () => {
      const { scroller, onSettle, onPeekChange } = setup(null);
      expect(screen.getByTestId("map")).toBeInTheDocument();
      expect(screen.queryByRole("region")).toBeNull();
      expect(scroller.children).toHaveLength(1);
      expect(scroller.dataset.detent).toBeUndefined();
      expect(onSettle).not.toHaveBeenCalled();
      expect(onPeekChange).not.toHaveBeenCalled();
    });

    it("keeps the very same map element when the sheet changes, appears or goes", () => {
      const { show, scroller } = setup({ key: "start", label: "Get started" });
      const map = screen.getByTestId("map");
      const frame = scroller;

      show(SHEET); // a place was pinned
      expect(screen.getByTestId("map")).toBe(map);
      expect(screen.getByRole("region", { name: "Sun report" })).toBeInTheDocument();

      show(null); // the window grew to the desktop layout
      expect(screen.getByTestId("map")).toBe(map);
      expect(map.closest(".sheet-scroller")).toBe(frame);

      show(SHEET); // and back
      expect(screen.getByTestId("map")).toBe(map);
    });

    it("opens a new sheet at peek", () => {
      vi.useFakeTimers();
      const { show, scroller } = setup({ key: "start", label: "Get started" });
      act(() => {
        scroller.scrollTop = 900;
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(200);
      });
      expect(scroller.dataset.detent).toBe("full");
      show(SHEET);
      expect(scroller.scrollTop).toBe(0);
      expect(scroller.dataset.detent).toBe("peek");
      expect(scroller.dataset.covering).toBeUndefined();
      expect(scroller.dataset.sheet).toBe("place");
    });
  });
});
