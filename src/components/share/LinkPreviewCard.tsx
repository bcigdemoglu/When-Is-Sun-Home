import type { PlaceSummary } from "@/lib/types";
import { formatSunHours } from "@/state/urlCodec";
import { bestWorstLine } from "./describe";

interface LinkPreviewCardProps {
  /** Short place label. */
  label: string;
  /** "Yard · ground", "Window · 2nd floor · facing S". */
  viewpoint: string;
  summary: PlaceSummary | null;
}

/** Twelve tiny bars: the month's direct sun standing in a track as tall as its daylight. */
function MiniBars({ summary }: { summary: PlaceSummary }) {
  const scale = Math.max(12, ...summary.monthlyDaylightHours);
  const percent = (hours: number) => `${Math.round((Math.max(0, hours) / scale) * 100)}%`;
  return (
    <div className="flex h-12 shrink-0 items-end gap-[3px]" aria-hidden="true">
      {summary.monthlySunHours.map((sun, month) => {
        const daylight = summary.monthlyDaylightHours[month];
        return (
          <div
            key={month}
            className="flex w-[7px] items-end overflow-hidden rounded-[2px] bg-surface-2"
            style={{ height: percent(daylight) }}
          >
            {sun > 0 && daylight > 0 && (
              <div
                className="w-full rounded-[2px] bg-state-sun"
                style={{ height: `max(2px, ${Math.round(Math.min(1, sun / daylight) * 100)}%)` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the link will look like when it lands in a chat: a small HTML version
 * of the link-preview image (`/og`) — the place, the headline number and the
 * twelve months.
 */
export function LinkPreviewCard({ label, viewpoint, summary }: LinkPreviewCardProps) {
  const hasSun = summary !== null && summary.avgSunHoursPerDay > 0;
  const detail =
    summary === null
      ? null
      : hasSun
        ? (bestWorstLine(summary) ?? "About the same in every month")
        : "No direct sun at any time of year";
  return (
    <div className="rounded-xl border border-line bg-page px-3.5 py-3" data-testid="share-preview">
      <p className="truncate text-sm font-semibold text-ink">{label}</p>
      <p className="truncate text-xs text-ink-2">{viewpoint}</p>
      {summary === null ? (
        <p className="mt-2 text-sm text-ink-2">See when this spot gets direct sun</p>
      ) : (
        <>
          <p className="mt-2.5 text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
            Direct sun · average day
          </p>
          <div className="mt-0.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[32px] leading-9 font-semibold tracking-[-0.03em] text-ink tabular-nums">
                {hasSun ? (
                  <>
                    {formatSunHours(summary.avgSunHoursPerDay).replace(" h", "")}
                    <span className="ml-1 text-base font-medium tracking-normal text-ink-2">h</span>
                  </>
                ) : (
                  "None"
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-2">{detail}</p>
            </div>
            <MiniBars summary={summary} />
          </div>
        </>
      )}
    </div>
  );
}
