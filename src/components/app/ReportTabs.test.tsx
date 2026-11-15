// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_SECTIONS } from "@/components/report/SunReport";
import { ReportTabs, activeSectionIndex } from "./ReportTabs";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("activeSectionIndex", () => {
  it("is the last section whose top has passed the reading line", () => {
    expect(activeSectionIndex([300, 900, 1500])).toBeNull();
    expect(activeSectionIndex([0, 600, 1200])).toBe(0);
    expect(activeSectionIndex([-500, 100, 700])).toBe(0);
    expect(activeSectionIndex([-900, -300, 300])).toBe(1);
    expect(activeSectionIndex([-2000, -1400, -800])).toBe(2);
    // Sub-pixel rounding after a jump still counts as "arrived".
    expect(activeSectionIndex([-600, 0.6, 600])).toBe(1);
  });

  it("is the last section at the end of the scroll, even if it never reaches the line", () => {
    expect(activeSectionIndex([-900, -300, 310], true)).toBe(2);
    expect(activeSectionIndex([-900, -300, 310], false)).toBe(1);
    expect(activeSectionIndex([], true)).toBeNull();
  });
});

describe("ReportTabs", () => {
  it("offers one tab per report section, in reading order", () => {
    render(<ReportTabs stickyTop={0} anchorOffset={56} />);
    const nav = screen.getByRole("navigation", { name: "Report sections" });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(
      REPORT_SECTIONS.map((section) => section.label),
    );
  });

  /** A scrolling container with the report's sections at the given tops (px from its top). */
  function page(tops: number[]) {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperties(scroller, {
      clientHeight: { value: 600 },
      scrollHeight: { value: 3000 },
    });
    const host = document.createElement("div");
    scroller.appendChild(host);
    const sections = REPORT_SECTIONS.map((section, index) => {
      const element = document.createElement("section");
      element.id = section.id;
      element.scrollIntoView = vi.fn();
      element.getBoundingClientRect = () => ({ top: tops[index] }) as DOMRect;
      scroller.appendChild(element);
      return element;
    });
    document.body.appendChild(scroller);
    return { scroller, host, sections };
  }

  it("scrolls to the section that is tapped (below the sticky rows, via scroll-margin)", async () => {
    const { host, sections } = page([400, 900, 1400, 1900, 2400]);
    render(<ReportTabs stickyTop={0} anchorOffset={56} />, { container: host });
    await userEvent.click(screen.getByRole("button", { name: "Skyline" }));
    expect(sections[3].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("marks the section being read, following the scroll", () => {
    const tops = [400, 900, 1400, 1900, 2400];
    const { scroller, host } = page(tops);
    render(<ReportTabs stickyTop={0} anchorOffset={56} />, { container: host });
    // Nothing has reached the reading line (56 px down) yet.
    expect(screen.queryByRole("button", { current: "location" })).not.toBeInTheDocument();

    vi.useFakeTimers();
    for (let i = 0; i < tops.length; i++) tops[i] -= 900; // scrolled: "Year" sits at 0
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(50); // the next animation frame
    });
    vi.useRealTimers();
    expect(screen.getByRole("button", { current: "location" })).toHaveTextContent("Year");
  });

  it("does nothing when the report is not on the page", async () => {
    render(<ReportTabs stickyTop={0} anchorOffset={56} />);
    await userEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(screen.queryByRole("button", { current: "location" })).not.toBeInTheDocument();
  });
});
