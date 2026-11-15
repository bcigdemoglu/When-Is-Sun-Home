import type { SunSummaryHeaderProps } from "./types";

/** Placeholder — replaced by the compact answer block. */
export function SunSummaryHeader({ day, className = "" }: SunSummaryHeaderProps) {
  return (
    <div className={className}>
      <p className="text-2xl font-semibold text-ink">
        {day ? `${Math.floor(day.sunMinutes / 60)} h ${day.sunMinutes % 60} m` : "—"}
      </p>
      <p className="text-sm text-ink-2">direct sun on this day</p>
    </div>
  );
}
