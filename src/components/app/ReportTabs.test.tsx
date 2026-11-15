// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

  it("scrolls to the section that is tapped and marks it", async () => {
    const targets = REPORT_SECTIONS.map((section) => {
      const element = document.createElement("section");
      element.id = section.id;
      element.scrollIntoView = vi.fn();
      document.body.appendChild(element);
      return element;
    });
    render(<ReportTabs stickyTop={0} anchorOffset={56} />);
    await userEvent.click(screen.getByRole("button", { name: "Skyline" }));
    expect(targets[3].scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByRole("button", { name: "Skyline" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("does nothing when the report is not on the page", async () => {
    render(<ReportTabs stickyTop={0} anchorOffset={56} />);
    await userEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(screen.getByRole("button", { name: "Year" })).not.toHaveAttribute("aria-current");
  });
});
