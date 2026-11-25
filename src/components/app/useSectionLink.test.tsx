// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  SECTION_LINK_HOLD_MS,
  SECTION_LINK_MAX_HOLD_MS,
  SECTION_LINK_POLL_MS,
  SECTION_LINK_TIMEOUT_MS,
  useSectionLink,
} from "./useSectionLink";

const scrollIntoView = vi.fn();
let top = 0;

function addSection(id: string): HTMLElement {
  const element = document.createElement("section");
  element.id = id;
  element.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

const tick = (ms = SECTION_LINK_POLL_MS) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  top = 0;
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function open(hash: string, options: Partial<Parameters<typeof useSectionLink>[0]> = {}) {
  window.history.replaceState(null, "", `/?lat=45.5&lng=-122.6${hash}`);
  const props = { hasPlace: true, canJump: () => true, settled: false, ...options };
  return renderHook((p: typeof props) => useSectionLink(p), { initialProps: props });
}

describe("useSectionLink", () => {
  test("scrolls the named section into view at once, then drops the hash", () => {
    const section = addSection("report-trees");
    open("#Trees");
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(section);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?lat=45.5&lng=-122.6");
  });

  test("waits until the layout can be scrolled and the section exists", () => {
    let ready = false;
    open("#about", { canJump: () => ready });
    tick(500);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#about");
    ready = true;
    tick(500);
    expect(scrollIntoView).not.toHaveBeenCalled(); // no section yet
    addSection("report-about");
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
  });

  test("holds the section in place while the layout settles, then lets go", () => {
    addSection("report-trees");
    const { rerender } = open("#trees");
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    top = 300; // a chart above grew
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    rerender({ hasPlace: true, canJump: () => true, settled: true });
    tick();
    tick(SECTION_LINK_HOLD_MS);
    top = 600;
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  test("never holds longer than the cap, even if the numbers never settle", () => {
    addSection("report-trees");
    open("#trees");
    tick();
    tick(SECTION_LINK_MAX_HOLD_MS);
    top = 300;
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("the reader's own touch or scroll ends the holding", () => {
    addSection("report-trees");
    open("#trees");
    tick();
    fireEvent.wheel(window);
    top = 300;
    tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("an unknown hash, or none, does nothing", () => {
    addSection("report-trees");
    open("#report");
    tick(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#report");
    cleanup();
    open("");
    tick(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("without a place it only drops the hash", () => {
    addSection("report-trees");
    open("#trees", { hasPlace: false });
    tick(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  test("gives up quietly on a section that never appears", () => {
    open("#trees");
    tick(SECTION_LINK_TIMEOUT_MS + SECTION_LINK_POLL_MS * 2);
    expect(window.location.hash).toBe("");
    addSection("report-trees");
    tick(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
