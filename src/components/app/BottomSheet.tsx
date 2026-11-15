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
  detentAt,
  detentOffsets,
  nextDetent,
  sheetMetrics,
  visibleSheetHeight,
  type Detent,
  type SheetMetrics,
} from "./sheetGeometry";

export interface BottomSheetHandle {
  /** Move the sheet to a detent (animated unless reduced motion is on). */
  snapTo(detent: Detent): void;
}

interface BottomSheetProps {
  ref?: Ref<BottomSheetHandle>;
  /** Names the region for assistive tech. */
  label: string;
  /** The block that is always visible; its height is the peek detent. */
  header: ReactNode;
  /** Everything below the header: revealed at half, scrolls at full. */
  children?: ReactNode;
  /** Floating buttons that ride on the sheet's top edge (hidden at full). */
  fabs?: ReactNode;
  /** Space to keep free above the sheet at full, px (the search pill). */
  topInset: number;
  /** Half detent as a share of the available height; null for none. */
  halfRatio?: number | null;
  /** Make the peek at least this share of the available height. */
  minPeekRatio?: number;
  /** The sheet came to rest: how much of it is showing, and at which detent. */
  onSettle?(visibleHeight: number, detent: Detent): void;
  /** The peek height changed (the header was measured again). */
  onPeekChange?(peek: number): void;
}

/** Scrolling has stopped once no scroll event arrived for this long, ms. */
const SETTLE_MS = 140;

/**
 * The phone's bottom sheet, built on native scrolling: a scroll container
 * laid over the map whose content is a see-through spacer followed by the
 * sheet. Dragging the sheet scrolls the container (with the platform's own
 * momentum, rubber-banding and scroll-snap detents); touches on the spacer
 * fall through to the map. This component only measures, labels and reports.
 */
export function BottomSheet({
  ref,
  label,
  header,
  children,
  fabs,
  topInset,
  halfRatio = 0.5,
  minPeekRatio = 0,
  onSettle,
  onPeekChange,
}: BottomSheetProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [viewport, setViewport] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [detent, setDetent] = useState<Detent>("peek");

  const metrics: SheetMetrics = sheetMetrics({
    viewport,
    header: headerHeight,
    gap: topInset,
    halfRatio,
    minPeekRatio,
  });
  const measured = viewport > 0 && headerHeight > 0;

  // The scroll handler and the imperative handle read the latest numbers.
  const latest = useRef({ metrics, onSettle, reducedMotion });
  useEffect(() => {
    latest.current = { metrics, onSettle, reducedMotion };
  });

  // ── Measure the room there is and the header that defines the peek ───────
  useEffect(() => {
    const scroller = scrollerRef.current;
    const handle = handleRef.current;
    const headerElement = headerRef.current;
    if (!scroller || !handle || !headerElement) return;
    const measure = () => {
      setViewport(scroller.clientHeight);
      setHeaderHeight(handle.offsetHeight + headerElement.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(headerElement);
    return () => observer.disconnect();
  }, []);

  const peek = metrics.peek;
  useEffect(() => {
    if (measured) onPeekChange?.(peek);
  }, [measured, peek, onPeekChange]);

  // The sheet always opens at peek, whatever the browser snapped to while
  // the measurements were still coming in.
  useEffect(() => {
    if (measured && scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [measured]);

  // ── Follow the scroll position: which detent, and when it comes to rest ───
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      const { metrics: current, onSettle: report } = latest.current;
      const top = scroller.scrollTop;
      setDetent(detentAt(top, current));
      report?.(visibleSheetHeight(top, current), detentAt(top, current));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setDetent(detentAt(scroller.scrollTop, latest.current.metrics));
      });
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_MS);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
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
    if (!scroller) return;
    const top = detentOffsets(latest.current.metrics)[target];
    if (Math.abs(scroller.scrollTop - top) < 1) return;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top, behavior: latest.current.reducedMotion ? "auto" : "smooth" });
    } else {
      scroller.scrollTop = top;
    }
  };
  useImperativeHandle(ref, () => ({ snapTo }));

  const style = {
    "--sheet-peek": `${metrics.peek}px`,
    "--sheet-half": `${metrics.half}px`,
    "--sheet-gap": `${metrics.gap}px`,
    // Until the first measurement the sheet sits where the CSS defaults put it.
    visibility: measured ? "visible" : "hidden",
  } as CSSProperties;

  const atFull = detent === "full";
  const next = nextDetent(detent, metrics);

  return (
    <div ref={scrollerRef} className="sheet-scroller" style={style} data-detent={detent}>
      <div className="sheet-spacer" />
      {/* Only once it has a place of its own: two snap points at one spot confuse re-snapping. */}
      {measured && metrics.half > metrics.peek && <div className="sheet-snap-half" />}
      <section className="sheet" aria-label={label}>
        {fabs && (
          <div
            className={`sheet-fabs ${atFull ? "pointer-events-none opacity-0" : ""}`}
            inert={atFull}
          >
            {fabs}
          </div>
        )}
        {/* A direct child of the sheet, so it can stay stuck while all the content scrolls. */}
        <div ref={handleRef} className="sheet-handle">
            <button
              type="button"
              className="flex h-7 w-full items-center justify-center"
              aria-label={
                next === "peek" ? "Collapse the sheet to show the map" : "Expand the sheet"
              }
              aria-expanded={detent !== "peek"}
              onClick={() => snapTo(next)}
            >
              <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-line" />
            </button>
        </div>
        <div ref={headerRef}>{header}</div>
        {children}
      </section>
    </div>
  );
}
