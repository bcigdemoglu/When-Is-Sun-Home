"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { REPORT_SECTIONS } from "@/components/report/SunReport";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

/** Height of the tab row, px. */
export const REPORT_TABS_HEIGHT = 44;

/** The nearest ancestor that scrolls vertically (the sheet on phones, the panel on desktop). */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Which section is "the one being read": the last one whose top has passed
 * the reading line — or simply the last one once the container is scrolled to
 * its end (a short final section can never reach the line). `tops` are the
 * sections' tops relative to the line, in reading order; null means none has
 * reached it yet.
 */
export function activeSectionIndex(tops: readonly number[], atEnd = false): number | null {
  if (atEnd && tops.length > 0) return tops.length - 1;
  let active: number | null = null;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= 1) active = i;
  }
  return active;
}

interface ReportTabsProps {
  /** Where the row sticks, px from the top of the scrolling container. */
  stickyTop: number;
  /**
   * Where a section's top comes to rest after a jump, px from the top of the
   * scrolling container — the same value the shell gives the report as
   * `--report-anchor-offset`.
   */
  anchorOffset: number;
  /** Changes when the report is replaced (another place), so the sections are found again. */
  resetKey?: string;
  className?: string;
}

/**
 * Jump tabs for the sun report: a slim row that sticks under the header,
 * marks the section being read and scrolls to the one that is tapped.
 * The report itself only exposes the targets (`REPORT_SECTIONS`).
 */
export function ReportTabs({ stickyTop, anchorOffset, resetKey, className = "" }: ReportTabsProps) {
  const navRef = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = scrollParent(nav);
    const sections = REPORT_SECTIONS.map((section) => document.getElementById(section.id));
    if (!root || sections.some((section) => section === null)) return;

    // Read the positions once per frame while the container scrolls (five
    // rectangles: nothing next to the scrolling itself), and once more when a
    // jump comes to rest exactly on the line.
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + anchorOffset;
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      // Before the first section is in reach "the end" means nothing (a sheet at peek).
      const firstTop = sections[0]!.getBoundingClientRect().top - line;
      setActive(
        activeSectionIndex(
          sections.map((section) => section!.getBoundingClientRect().top - line),
          atEnd && firstTop <= 1,
        ),
      );
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [anchorOffset, resetKey]);

  const jump = (index: number) => {
    const section = document.getElementById(REPORT_SECTIONS[index].id);
    if (!section) return;
    // The sections carry `scroll-margin-top`, so they stop below the sticky rows.
    section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Report sections"
      className={`sticky z-[1] flex items-stretch gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] ${className}`}
      style={{ top: stickyTop, height: REPORT_TABS_HEIGHT } as CSSProperties}
    >
      {REPORT_SECTIONS.map((section, index) => {
        const current = index === active;
        return (
          <button
            key={section.id}
            type="button"
            aria-current={current ? "location" : undefined}
            className={`relative shrink-0 px-3 text-sm whitespace-nowrap transition-colors ${
              current ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink"
            }`}
            onClick={() => jump(index)}
          >
            {section.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink transition-opacity ${
                current ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        );
      })}
    </nav>
  );
}
