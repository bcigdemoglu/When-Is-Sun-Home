import { MONTHS_SHORT, formatHours } from "./format";

interface MonthBarsProps {
  /** Mean direct sun per day for each month, hours; January first. */
  values: readonly number[];
  /** The value drawn at full height — share it between charts to compare them. */
  max: number;
  /** Month to emphasise (0..11), if any. */
  currentMonth?: number | null;
  /** Drawing height in px. */
  height: number;
  /** Fill the width of the parent instead of the natural 82 px. */
  stretch?: boolean;
  className?: string;
}

const BAR = 5;
const GAP = 2;
const WIDTH = 12 * BAR + 11 * GAP;
/** Even a month with no sun shows a stub, so the baseline is readable. */
const MIN_BAR = 1.5;

/** Twelve tiny bars: the shape of a place's year at a glance. */
export function MonthBars({
  values,
  max,
  currentMonth = null,
  height,
  stretch = false,
  className = "",
}: MonthBarsProps) {
  const top = max > 0 ? max : 1;
  const description = values
    .slice(0, 12)
    .map((hours, month) => `${MONTHS_SHORT[month]} ${formatHours(hours)}`)
    .join(", ");
  return (
    <svg
      role="img"
      aria-label={`Direct sun per day by month, in hours: ${description}`}
      viewBox={`0 0 ${WIDTH} ${height}`}
      width={stretch ? "100%" : WIDTH}
      height={height}
      preserveAspectRatio="none"
      className={`shrink-0 ${className}`}
    >
      {Array.from({ length: 12 }, (_, month) => {
        const hours = Math.max(0, values[month] ?? 0);
        const barHeight = Math.max(MIN_BAR, (Math.min(hours, top) / top) * height);
        const emphasised = currentMonth === null || currentMonth === month;
        return (
          <rect
            key={month}
            data-month={month}
            x={month * (BAR + GAP)}
            y={height - barHeight}
            width={BAR}
            height={barHeight}
            rx={stretch ? 0 : 1}
            className={
              hours <= 0
                ? "fill-ink-3"
                : currentMonth === month
                  ? "fill-state-sun-line"
                  : "fill-state-sun"
            }
            opacity={hours <= 0 ? 0.45 : emphasised ? 1 : 0.7}
          />
        );
      })}
    </svg>
  );
}
