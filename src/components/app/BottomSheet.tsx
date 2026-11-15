"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import {
  coveringAt,
  detentAt,
  detentOffsets,
  nextDetent,
  restingCorrection,
  sheetMetrics,
  visibleSheetHeight,
  type Detent,
  type SheetMetrics,
} from "./sheetGeometry";

export interface BottomSheetHandle {
  /** Move the sheet to a detent (animated unless reduced motion is on). */
  snapTo(detent: Detent): void;
}

/** What the sheet shows. A new `key` is a new sheet: it opens at peek again. */
export interface SheetContent {
  key: string;
  /** Names the region for assistive tech. */
  label: string;
  /** The block that is always visible; its height is the peek detent. */
  header: ReactNode;
  /** Everything below the header: revealed at half, scrolls at full. */
  content?: ReactNode;
  /** Floating buttons that ride on the sheet's top edge (hidden at full). */
  fabs?: ReactNode;
  /** Half detent as a share of the available height; null for none. */
  halfRatio?: number | null;
  /** Make the peek at least this share of the available height. */
  minPeekRatio?: number;
}

interface BottomSheetProps {
  ref?: Ref<BottomSheetHandle>;
  /** The map (and whatever floats on it): always the scroller's first child. */
  map: ReactNode;
  /** The sheet, or null where there is none (the desktop layout). */
  sheet: SheetContent | null;
  /** Space to keep free above the sheet at full, px (the search pill). */
  topInset: number;
  /** The sheet came to rest: how much of it is showing, and at which detent. */
  onSettle?(visibleHeight: number, detent: Detent): void;
  /** The peek height changed (the header was measured again). */
  onPeekChange?(peek: number): void;
}

/** Scrolling has stopped once no scroll event arrived for this long, ms. */
const SETTLE_MS = 140;
/** A sheet still between two stops this long after the last movement is put on one, ms. */
const CORRECT_MS = 360;

/**
 * The map with, on phones, the bottom sheet riding over it — built on ONE
 * native scroll container whose content is the map (stuck to the top, so it
 * never moves) followed by the sheet, which overlaps the map's bottom edge by
 * its peek height. Dragging the sheet scrolls the container, with the
 * platform's own momentum and snap points; a touch on the map lands on the
 * map itself, which declares `touch-action: none` and handles it.
 *
 * Nothing here relies on `pointer-events: none`, and nothing is reached
 * "through" another element: Safari on iOS cannot touch-scroll a container
 * that has `pointer-events: none`, even from a child that takes input
 * (WebKit bug 183870). This component only measures, labels and reports.
 *
 * Without a sheet (desktop) it is simply the frame the map sits in, so the
 * one map instance stays mounted whatever the layout.
 */
export function BottomSheet({
  ref,
  map,
  sheet,
  topInset,
  onSettle,
  onPeekChange,
}: BottomSheetProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const sheetKey = sheet ? sheet.key : null;
  const [viewport, setViewport] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [detent, setDetent] = useState<Detent>("peek");
  const [covering, setCovering] = useState(false);

  // A different sheet starts over: at peek, and hidden until it is measured.
  const [shownKey, setShownKey] = useState(sheetKey);
  if (shownKey !== sheetKey) {
    setShownKey(sheetKey);
    setHeaderHeight(0);
    setDetent("peek");
    setCovering(false);
  }

  const metrics: SheetMetrics = sheetMetrics({
    viewport,
    header: headerHeight,
    gap: topInset,
    halfRatio: sheet?.halfRatio === undefined ? 0.5 : sheet.halfRatio,
    minPeekRatio: sheet?.minPeekRatio ?? 0,
  });
  const measured = sheet !== null && viewport > 0 && headerHeight > 0;

  // The scroll handler and the imperative handle read the latest numbers.
  const latest = useRef({ metrics, measured, onSettle, reducedMotion });
  useEffect(() => {
    latest.current = { metrics, measured, onSettle, reducedMotion };
  });

  // ── Measure the room there is … ──────────────────────────────────────────
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setViewport(scroller.clientHeight);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);
  // … and the header that defines the peek.
  useEffect(() => {
    const handle = handleRef.current;
    const headerElement = headerRef.current;
    if (!handle || !headerElement) return;
    const measure = () => setHeaderHeight(handle.offsetHeight + headerElement.offsetHeight);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(headerElement);
    return () => observer.disconnect();
  }, [sheetKey]);

  const peek = metrics.peek;
  useEffect(() => {
    if (measured) onPeekChange?.(peek);
  }, [measured, peek, onPeekChange]);

  // A sheet always opens at peek, whatever the browser snapped to while the
  // measurements were still coming in. (Without a sheet nothing may be scrolled.)
  useEffect(() => {
    if (scrollerRef.current && (measured || sheetKey === null)) scrollerRef.current.scrollTop = 0;
  }, [measured, sheetKey]);

  // ── Follow the scroll position: which detent, and when it comes to rest ───
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let correctTimer: ReturnType<typeof setTimeout> | undefined;
    let touching = false;

    const scrollTo = (top: number) => {
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top, behavior: latest.current.reducedMotion ? "auto" : "smooth" });
      } else {
        scroller.scrollTop = top;
      }
    };
    const settle = () => {
      const current = latest.current;
      if (!current.measured) return;
      const top = scroller.scrollTop;
      setDetent(detentAt(top, current.metrics));
      current.onSettle?.(visibleSheetHeight(top, current.metrics), detentAt(top, current.metrics));
    };
    // The net under the browser's scroll snapping: a sheet left between two
    // stops (no finger on it, nothing moving) is put on the nearest one.
    const correct = () => {
      const current = latest.current;
      if (touching || !current.measured) return;
      const target = restingCorrection(scroller.scrollTop, current.metrics);
      if (target !== null) scrollTo(target);
    };
    const scheduleCorrection = () => {
      clearTimeout(correctTimer);
      correctTimer = setTimeout(correct, CORRECT_MS);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = latest.current;
        if (!current.measured) return;
        setDetent(detentAt(scroller.scrollTop, current.metrics));
        setCovering(coveringAt(scroller.scrollTop, current.metrics));
      });
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_MS);
      scheduleCorrection();
    };
    const onTouchStart = () => {
      touching = true;
      clearTimeout(correctTimer);
    };
    const onTouchEnd = (event: TouchEvent) => {
      touching = event.touches.length > 0;
      if (!touching) scheduleCorrection();
    };
    const passive = { passive: true } as const;
    scroller.addEventListener("scroll", onScroll, passive);
    scroller.addEventListener("touchstart", onTouchStart, passive);
    scroller.addEventListener("touchend", onTouchEnd, passive);
    scroller.addEventListener("touchcancel", onTouchEnd, passive);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      clearTimeout(correctTimer);
    };
  }, []);

  // Report the resting height once it is known, and whenever the geometry changes.
  const { viewport: vp, half, gap } = metrics;
  useEffect(() => {
    if (!measured) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const current = latest.current;
    const top = scroller.scrollTop;
    current.onSettle?.(visibleSheetHeight(top, current.metrics), detentAt(top, current.metrics));
  }, [measured, vp, peek, half, gap]);

  const snapTo = (target: Detent) => {
    const scroller = scrollerRef.current;
    if (!scroller || !latest.current.measured) return;
    const top = detentOffsets(latest.current.metrics)[target];
    if (Math.abs(scroller.scrollTop - top) < 1) return;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top, behavior: latest.current.reducedMotion ? "auto" : "smooth" });
    } else {
      scroller.scrollTop = top;
    }
  };
  useImperativeHandle(ref, () => ({ snapTo }));

  const style = sheet
    ? ({
        "--sheet-peek": `${metrics.peek}px`,
        "--sheet-half": `${metrics.half}px`,
        "--sheet-gap": `${metrics.gap}px`,
      } as CSSProperties)
    : undefined;

  const atFull = detent === "full";
  const next = nextDetent(detent, metrics);

  return (
    <div
      ref={scrollerRef}
      className="sheet-scroller"
      style={style}
      data-sheet={sheetKey ?? undefined}
      data-detent={sheet ? detent : undefined}
      data-covering={sheet && covering ? "" : undefined}
    >
      {/* First, and stuck to the top: the sheet scrolls over it, it never moves. */}
      <div className="sheet-map">{map}</div>
      {sheet && (
        <>
          <div className="sheet-snap sheet-snap-peek" />
          {/* Only once it has a place of its own: two snap points at one spot confuse re-snapping. */}
          {measured && metrics.half > metrics.peek && (
            <div className="sheet-snap sheet-snap-half" />
          )}
          <section
            key={sheet.key}
            className="sheet"
            aria-label={sheet.label}
            // Until the first measurement the sheet would sit where the CSS defaults put it.
            style={{ visibility: measured ? "visible" : "hidden" }}
          >
            {sheet.fabs && (
              <div className={`sheet-fabs ${atFull ? "sheet-fabs-away" : ""}`} inert={atFull}>
                {sheet.fabs}
              </div>
            )}
            {/* A direct child of the sheet, so it can stay stuck while all the content scrolls. */}
            <div ref={handleRef} className="sheet-handle">
              <button
                type="button"
                // The hit area reaches a little above the sheet's edge: 44 px in all.
                className="relative flex h-7 w-full items-center justify-center before:absolute before:inset-x-0 before:-top-4 before:h-4"
                aria-label={
                  next === "peek" ? "Collapse the sheet to show the map" : "Expand the sheet"
                }
                aria-expanded={detent !== "peek"}
                onClick={() => snapTo(next)}
              >
                <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-line" />
              </button>
            </div>
            <div ref={headerRef}>{sheet.header}</div>
            {sheet.content}
          </section>
        </>
      )}
    </div>
  );
}
