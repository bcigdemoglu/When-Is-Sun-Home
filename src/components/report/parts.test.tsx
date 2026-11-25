// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportCard, ReportContext } from "./parts";
import { REPORT_SECTION_IDS, type ReportSection } from "./sections";

afterEach(cleanup);

function withShare(children: ReactNode, renderSectionShare = vi.fn(shareFor)) {
  return (
    <ReportContext.Provider value={{ hour12: true, hatchId: "h", renderSectionShare }}>
      {children}
    </ReportContext.Provider>
  );
}

function shareFor(section: ReportSection) {
  return <button type="button">Share the {section.label} section</button>;
}

describe("ReportCard share slot", () => {
  it("renders the shell's control for its section right after the title", () => {
    const renderSectionShare = vi.fn(shareFor);
    render(
      withShare(
        <ReportCard id={REPORT_SECTION_IDS.year} title="Through the year" aside="2026" />,
        renderSectionShare,
      ),
    );
    const heading = screen.getByRole("heading", { name: "Through the year" });
    const button = screen.getByRole("button", { name: "Share the Year section" });
    expect(heading.nextElementSibling).toBe(button);
    expect(renderSectionShare).toHaveBeenCalledWith(expect.objectContaining({ slug: "year" }));
    // the aside stays the last thing in the row
    const header = heading.closest("header")!;
    expect(header.lastElementChild).toHaveTextContent("2026");
    expect(within(header.lastElementChild as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("renders none for a card that is not a section, or has no id", () => {
    const renderSectionShare = vi.fn(shareFor);
    render(
      withShare(
        <>
          <ReportCard id="something-else" title="Other" />
          <ReportCard title="Seasons" />
        </>,
        renderSectionShare,
      ),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(renderSectionShare).not.toHaveBeenCalled();
  });

  it("renders none when the shell offers no control", () => {
    render(<ReportCard id={REPORT_SECTION_IDS.year} title="Through the year" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: "Through the year" })).toBeTruthy();
  });
});
