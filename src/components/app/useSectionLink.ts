"use client";

import { useEffect, useRef } from "react";
import { sectionFromHash } from "@/components/report/sections";

/** How often to look whether the section can be shown yet, and whether it moved, ms. */
export const SECTION_LINK_POLL_MS = 100;
/** Give up on a section that has not appeared by then (a cold load can take a few seconds), ms. */
export const SECTION_LINK_TIMEOUT_MS = 20_000;
/** Keep the section in place this long after the numbers are final, ms. */
export const SECTION_LINK_HOLD_MS = 2_000;
/** …but never longer than this after the jump, whatever is still loading, ms. */
export const SECTION_LINK_MAX_HOLD_MS = 15_000;

/** Anything the reader does to the page: from then on the scroll position is theirs. */
const USER_INPUT = ["pointerdown", "touchstart", "wheel", "keydown"] as const;

interface SectionLinkOptions {
  /** Whether a place was pinned when the page opened: without one there is no report. */
  hasPlace: boolean;
  /**
   * Whether the layout around the report is ready to be scrolled — on
   * phones, the sheet has been measured (until then it puts itself back at
   * peek). Read on every poll.
   */
  canJump(): boolean;
  /** The numbers are final (nothing more will grow above the section). */
  settled: boolean;
}

/** The nearest ancestor that scrolls vertically (the sheet on phones, the panel on desktop). */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** Drops the hash from the address bar, keeping the path and query. */
function clearHash(): void {
  const { pathname, search, hash } = window.location;
  if (hash === "") return;
  try {
    window.history.replaceState(null, "", pathname + search);
  } catch {
    // a browser that refuses: the hash stays, nothing else depends on it
  }
}

/**
 * Opens a section link: a page loaded as `/?…#trees` shows the report
 * scrolled to that section (on phones that is the sheet at full, since the
 * sheet and the report scroll as one; on desktop the side panel), then drops
 * the hash so that neither a refresh nor a later share repeats it. Once per
 * page load; an unknown hash is left alone. Neither the map nor any setting
 * is touched.
 *
 * The jump is instant (`scrollIntoView({ block: "start" })`, as a tab does,
 * minus the smooth scroll — so reduced motion needs nothing extra), and the
 * section's `scroll-margin-top` stops it under the sticky jump tabs, which
 * then mark it as the section being read.
 *
 * Late layout — skeletons turning into numbers, charts measuring
 * themselves, the Trees records arriving — can push the section away again,
 * or (near the end of the report) make room for it to come up further. So it
 * is held in place: whenever its top moves, or the content it scrolls in
 * changes height, the jump is made again, until
 * `SECTION_LINK_HOLD_MS` after the numbers are final (at most
 * `SECTION_LINK_MAX_HOLD_MS` after the jump), and only until the reader
 * touches, scrolls, clicks or types. If the section never appears it gives
 * up after `SECTION_LINK_TIMEOUT_MS`.
 */
export function useSectionLink({ hasPlace, canJump, settled }: SectionLinkOptions): void {
  const latest = useRef({ hasPlace, canJump, settled });
  useEffect(() => {
    latest.current = { hasPlace, canJump, settled };
  });

  useEffect(() => {
    const section = sectionFromHash(window.location.hash);
    if (!section) return;
    if (!latest.current.hasPlace) {
      clearHash();
      return;
    }

    const startedAt = Date.now();
    let jumpedAt = 0;
    let settledAt: number | null = null;
    // Where the section was left, and how tall the content it scrolls in was:
    // if either changes, the jump is made again.
    let pinnedTop = 0;
    let pinnedHeight = 0;

    const stop = () => {
      clearInterval(timer);
      for (const type of USER_INPUT) window.removeEventListener(type, stop, true);
    };
    const pin = (element: HTMLElement) => {
      // "auto", not "instant": no stylesheet here asks for smooth scrolling, and an
      // engine that does not know "instant" would throw.
      element.scrollIntoView({ block: "start", behavior: "auto" });
      pinnedTop = element.getBoundingClientRect().top;
      pinnedHeight = scrollParent(element)?.scrollHeight ?? 0;
    };

    const tick = () => {
      const now = Date.now();
      const element = document.getElementById(section.id);
      if (jumpedAt === 0) {
        if (now - startedAt > SECTION_LINK_TIMEOUT_MS) {
          clearHash();
          stop();
          return;
        }
        if (!element || !latest.current.canJump()) return;
        jumpedAt = now;
        pin(element);
        clearHash();
        // From the jump on, the reader's own input ends the holding.
        for (const type of USER_INPUT) {
          window.addEventListener(type, stop, { capture: true, passive: true });
        }
        return;
      }
      if (settledAt === null && latest.current.settled) settledAt = now;
      const holdUntil = Math.min(
        Math.max(jumpedAt, settledAt ?? Infinity) + SECTION_LINK_HOLD_MS,
        jumpedAt + SECTION_LINK_MAX_HOLD_MS,
      );
      if (!element || now > holdUntil) {
        stop();
        return;
      }
      const moved = Math.abs(element.getBoundingClientRect().top - pinnedTop) > 1;
      // Content arriving below a section near the end lets it come up further.
      const grew = (scrollParent(element)?.scrollHeight ?? 0) !== pinnedHeight;
      if (moved || grew) pin(element);
    };

    // First look after one interval, not during the effect: React's development
    // double run of effects must not jump (and drop the hash) on the throwaway run.
    const timer = setInterval(tick, SECTION_LINK_POLL_MS);
    return stop;
  }, []);
}
