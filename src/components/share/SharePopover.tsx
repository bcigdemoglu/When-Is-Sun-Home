"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatClock, formatDate } from "@/components/shared/format";
import { useHour12 } from "@/components/shared/useHour12";
import { Button } from "@/components/ui/Button";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import type { Place, PlaceSummary } from "@/lib/types";
import { pickSettings, useSettings } from "@/state";
import { coordinatesLabel, shortPlaceName, truncate, viewpointLabel } from "./describe";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { placePopover } from "./popoverPosition";
import { QrCode } from "./QrCode";
import { copyText } from "./shareActions";
import { isLiveView, shareLink, viewedDateTime } from "./shareLink";

/** How long the Copy button says "Copied". */
export const COPIED_MS = 2000;

interface SharePopoverProps {
  /** The button that opened the popover: it is positioned next to it. */
  getAnchor(): HTMLElement | null;
  place: Place;
  label: string;
  summary: PlaceSummary | null;
  /** `restoreFocus` is false when the user clicked somewhere else. */
  onClose(options: { restoreFocus: boolean }): void;
}

/**
 * The Popover API (top layer). Checked before the attribute is used at all:
 * an engine that knows the `[popover]` style rule but not `showPopover()`
 * would leave the panel hidden for good. (This component only ever renders
 * in the browser, after a click.)
 */
const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The desktop way to share: a small floating panel next to the Share button
 * with a preview of the link card, the link and a Copy button, a QR code to
 * continue on a phone, and the choice whether the link pins the day and time
 * on screen.
 *
 * Not a modal: the page behind stays usable, and a click on it (or Escape)
 * closes the panel. It is rendered in the browser's top layer where the
 * Popover API exists (so no stacking context of the app can cover it) and as
 * a fixed, high z-index box elsewhere.
 */
export function SharePopover({ getAnchor, place, label, summary, onClose }: SharePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const checkboxId = useId();
  const hintId = useId();
  const hour12 = useHour12();

  const date = useSettings((s) => s.date);
  const minuteOfDay = useSettings((s) => s.minuteOfDay);
  const observer = useSettings((s) => s.observer);
  const layers = useSettings((s) => s.layers);
  const settings = useMemo(
    () => ({ ...pickSettings(useSettings.getState()), date, minuteOfDay, observer, layers }),
    [date, minuteOfDay, observer, layers],
  );

  // "Now", fixed when the panel opens, so the link does not change under the
  // user's cursor as the minutes pass.
  const [openedAt] = useState(() => new Date());
  const [includeDateTime, setIncludeDateTime] = useState(() => !isLiveView(settings));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = typeof window === "undefined" ? "/" : window.location.href;
  const link = { settings, place, label, includeDateTime, base, now: openedAt };
  const url = shareLink({ ...link, summary });
  // The phone that scans the code opens the app itself; it needs no preview
  // numbers, and a shorter link makes a coarser, easier code.
  const qrUrl = shareLink({ ...link, summary: null });
  const viewed = viewedDateTime(settings, place, openedAt);

  const cardLabel = truncate(label.trim() || shortPlaceName(place) || coordinatesLabel(place), 40);

  // ── Position: next to the anchor, inside the viewport, kept there. ──
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Top layer where available; harmless to skip elsewhere.
    try {
      if (SUPPORTS_POPOVER && !panel.matches(":popover-open")) panel.showPopover();
    } catch {
      // not connected / unsupported selector: the fixed box still works
    }
    const position = () => {
      const anchor = getAnchor();
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const placement = placePopover(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: panel.offsetWidth, height: panel.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      panel.style.top = `${placement.top}px`;
      panel.style.left = `${placement.left}px`;
      panel.style.maxHeight = `${placement.maxHeight}px`;
      panel.style.visibility = "visible";
      panel.dataset.side = placement.side;
    };
    position();
    window.addEventListener("resize", position);
    // Capture: scrolling any ancestor (the panel, the sheet) moves the anchor.
    window.addEventListener("scroll", position, { capture: true, passive: true });
    const observerOfSize =
      typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    observerOfSize?.observe(panel);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, { capture: true });
      observerOfSize?.disconnect();
    };
  }, [getAnchor]);

  // ── Focus goes to the main action; Escape and outside clicks close. ──
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>("[data-share-copy]")
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // A press on the Share button itself is its own toggle.
      if (getAnchor()?.contains(target)) return;
      onClose({ restoreFocus: false });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose({ restoreFocus: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [getAnchor, onClose]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  /** Tab stays inside the panel while it is open. */
  const keepFocusInside = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copy = async () => {
    const copied = await copyText(url);
    setCopyState(copied ? "copied" : "failed");
    if (!copied) {
      // Leave the link selected so that Ctrl/⌘+C finishes the job.
      urlRef.current?.focus();
      urlRef.current?.select();
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), COPIED_MS);
  };

  return (
    <div
      ref={panelRef}
      // "manual": we do the dismissing ourselves, the same way in every browser.
      popover={SUPPORTS_POPOVER ? "manual" : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="share-popover"
      onKeyDown={keepFocusInside}
      className="fixed z-[1000] m-0 w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-[20px] border border-line bg-surface p-4 text-ink shadow-[0_8px_24px_rgba(30,26,21,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      // `inset: auto` undoes the browser's centring of [popover]; the real
      // position is set before paint by the layout effect above.
      style={{ inset: "auto", top: 0, left: 0, visibility: "hidden" }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-base leading-[22px] font-semibold">
          Share this report
        </h2>
        <Button
          variant="ghost"
          iconOnly
          aria-label="Close"
          className="-my-2 -mr-2"
          onClick={() => onClose({ restoreFocus: true })}
        >
          <CloseIcon />
        </Button>
      </div>

      <div className="mt-3">
        <LinkPreviewCard label={cardLabel} viewpoint={viewpointLabel(observer)} summary={summary} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={urlRef}
          type="text"
          readOnly
          value={url}
          aria-label="Link to this report"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 font-mono text-[13px] text-ink-2"
        />
        <Button variant="primary" className="min-w-[104px]" data-share-copy="" onClick={copy}>
          {copyState === "copied" ? (
            <>
              Copied <CheckIcon width={16} height={16} />
            </>
          ) : (
            "Copy link"
          )}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Link copied" : ""}
      </p>
      {copyState === "failed" && (
        <p className="mt-1.5 text-xs text-ink-2">
          Couldn’t copy automatically. The link is selected — press Ctrl+C (⌘C on a Mac).
        </p>
      )}

      <div className="mt-3 flex items-center gap-3.5">
        <QrCode value={qrUrl} size={128} className="shrink-0 rounded-lg border border-line" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Open on your phone</p>
          <p className="mt-0.5 text-xs leading-4 text-ink-2">
            Point the camera at the code to continue there.
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-1">
        <label
          htmlFor={checkboxId}
          className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={includeDateTime}
            onChange={(event) => setIncludeDateTime(event.currentTarget.checked)}
            aria-describedby={hintId}
            className="size-[18px] shrink-0 accent-ink"
          />
          Include the day and time I’m looking at
        </label>
        <p id={hintId} className="-mt-1 pl-[28px] text-xs text-ink-2">
          {includeDateTime
            ? `Opens on ${formatDate(viewed.date, { weekday: true })} at ${formatClock(viewed.minuteOfDay, hour12)}.`
            : "Opens on the current day and time."}
        </p>
      </div>
    </div>
  );
}
