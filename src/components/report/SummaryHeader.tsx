"use client";

import { formatDate, formatDuration } from "./format";
import { useElementSize, useHour12 } from "./hooks";
import { Glyph, SkeletonText, type GlyphName } from "./parts";
import "./report.css";
import { describeLiveStatus, type StatusIcon } from "./status";
import type { SunSummaryHeaderProps } from "./types";

/** Average advance of the status line's 15 px medium text, for fitting the wording. */
const STATUS_CHAR_WIDTH = 7.5;
const STATUS_BADGE_WIDTH = 32;

/**
 * The compact answer — the most-seen element of the app (the collapsed sheet
 * on phones, the top of the panel on desktop): the selected day's direct sun
 * as one big figure, and one line saying what the sun is doing at the
 * selected instant and when that changes.
 *
 * The block is exactly 72 px tall in every state (skeleton, provisional while
 * buildings load, ready), so nothing around it moves.
 */
export function SunSummaryHeader({
  date,
  minuteOfDay,
  isLive,
  day,
  instant,
  buildingsStatus,
  className = "",
}: SunSummaryHeaderProps) {
  const hour12 = useHour12();
  const [statusRef, statusSize] = useElementSize<HTMLParagraphElement>();
  const maxChars = statusSize
    ? Math.max(24, Math.floor((statusSize.width - STATUS_BADGE_WIDTH) / STATUS_CHAR_WIDTH))
    : 44;

  // Until building data is in, the figures describe an open sky.
  const checking = buildingsStatus === "loading" || buildingsStatus === "idle";
  const unshaded = checking || buildingsStatus === "error";
  const when = isLive ? "today" : `on ${formatDate(date, { weekday: true })}`;

  let status: { icon: GlyphName; badge: StatusIcon | null; text: string } | null = null;
  if (checking) {
    status = { icon: "loading", badge: null, text: "Checking nearby buildings…" };
  } else if (buildingsStatus === "error") {
    status = { icon: "warning", badge: null, text: "Building heights unavailable" };
  } else if (day && instant) {
    const live = describeLiveStatus({ day, instant, minuteOfDay, isLive, hour12, maxChars });
    status = { icon: live.icon, badge: live.icon, text: live.text };
  }

  return (
    <div
      className={`sun-report flex h-[72px] min-w-0 flex-col justify-between ${className}`}
      aria-busy={!day}
    >
      <div className="flex min-w-0 items-center gap-3">
        <p className="text-[34px]/[40px] font-semibold tracking-[-0.02em] whitespace-nowrap text-ink tabular-nums">
          {day ? (
            <>
              {unshaded && (
                <span className="font-medium text-ink-2" title="Before shading">
                  {"≈ "}
                </span>
              )}
              {formatDuration(day.sunMinutes)}
            </>
          ) : (
            <SkeletonText width="8.5rem" />
          )}
        </p>
        <p className="min-w-0 text-[13px]/4 font-medium text-ink-2">
          <span className="block truncate">
            {unshaded ? "of direct sun before shading" : "of direct sun"}
          </span>
          <span className="block truncate">{when}</span>
        </p>
      </div>

      <p
        ref={statusRef}
        className="flex h-6 min-w-0 items-center gap-2 text-[15px]/6 font-medium text-ink"
        aria-live={isLive ? "polite" : "off"}
      >
        {status ? (
          <>
            <StatusBadge icon={status.icon} badge={status.badge} />
            <span className="min-w-0 truncate">{status.text}</span>
          </>
        ) : (
          <SkeletonText width="15rem" />
        )}
      </p>
    </div>
  );
}

const BADGE_STYLE: Record<StatusIcon, { background: string; color: string; hatch?: boolean }> = {
  sun: { background: "var(--state-sun)", color: "#1e1a15" },
  shade: { background: "var(--state-blocked)", color: "#ffffff" },
  hill: { background: "var(--report-terrain)", color: "#ffffff" },
  night: { background: "var(--state-night)", color: "#f5f0e6" },
  out: { background: "var(--state-out)", color: "var(--ink)", hatch: true },
};

/** The state as a small round badge: its colour AND its own icon, beside the words. */
function StatusBadge({ icon, badge }: { icon: GlyphName; badge: StatusIcon | null }) {
  if (!badge) {
    return (
      <span
        className={`flex size-6 shrink-0 items-center justify-center ${icon === "warning" ? "text-danger" : "text-ink-2"}`}
      >
        <Glyph name={icon} />
      </span>
    );
  }
  const style = BADGE_STYLE[badge];
  return (
    <span
      data-testid={`status-${badge}`}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-line ring-inset ${
        style.hatch ? "report-hatch" : ""
      }`}
      style={{ backgroundColor: style.background, color: style.color }}
    >
      <Glyph name={icon} className="size-4" />
    </span>
  );
}
