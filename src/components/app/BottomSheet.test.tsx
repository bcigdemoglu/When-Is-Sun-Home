// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomSheet, type BottomSheetHandle } from "./BottomSheet";

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
        return this.querySelector("[data-testid='header']") && !this.classList.contains("sheet")
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
  restore.forEach((undo) => undo());
  restore = [];
});

function setup(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const ref = createRef<BottomSheetHandle>();
  const onSettle = vi.fn();
  const onPeekChange = vi.fn();
  const view = render(
    <BottomSheet
      ref={ref}
      label="Sun report"
      topInset={76}
      header={<div data-testid="header">The answer</div>}
      onSettle={onSettle}
      onPeekChange={onPeekChange}
      {...props}
    >
      <p>The report</p>
    </BottomSheet>,
  );
  const scroller = view.container.querySelector<HTMLDivElement>(".sheet-scroller")!;
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  return { ref, onSettle, onPeekChange, scroller, scrollTo };
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
    act(() => {
      scroller.scrollTop = 900; // well into the content
      scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(200);
    });
    expect(scroller.dataset.detent).toBe("full");
    expect(onSettle).toHaveBeenLastCalledWith(780 - 76, "full");
    expect(
      screen.getByRole("button", { name: "Collapse the sheet to show the map" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(scroller.querySelector(".sheet-fabs")).toHaveAttribute("inert");
    vi.useRealTimers();
  });

  it("has no half stop when told so (the start screen)", async () => {
    const { scroller, scrollTo } = setup({ halfRatio: null });
    expect(scroller.querySelector(".sheet-snap-half")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand the sheet" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 780 - 172 - 76, behavior: "smooth" });
  });
});
