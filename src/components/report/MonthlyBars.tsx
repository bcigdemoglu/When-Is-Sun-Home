import { useState } from "react";

import { Card } from "@/components/ui/Card";
import type { YearAnalysis } from "@/lib/types";

import {
  daysInMonth,
  formatClockRange,
  formatHours,
  formatPercent,
  parseIsoDate,
  toIsoDate,
} from "./format";
import { useElementSize } from "./hooks";
import type { ReportModel } from "./model";
import { ChartTooltip, SkeletonBlock, useReport } from "./parts";
import type { MonthDetail } from "./summary";

interface MonthlyBarsProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  date: string;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

/** Room above the tallest track for a value label. */
const LABEL_ROOM = 16;

/** The date a month's bar jumps to: same day of the month, clamped to its length. */
export function dateInMonth(currentDate: string, year: number, month: number): string {
  const parts = parseIsoDate(currentDate);
  const day = Math.min(parts?.day ?? 15, daysInMonth(year, month));
  return toIsoDate(year, month, day);
}

/** Twelve bars: average direct sun per day, each against that month's daylight. */
export function MonthlyBars({ year, model, date, onSelectDateTime }: MonthlyBarsProps) {
  const { hour12 } = useReport();
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const details = model?.details ?? [];
  const max = Math.max(1, ...details.map((month) => month.avgDaylightHours));
  const parts = parseIsoDate(date);
  const selectedMonth = year && parts && parts.year === year.year ? parts.month : null;
  const activeMonth: MonthDetail | null = active !== null ? (details[active] ?? null) : null;

  return (
    <Card title="Average day, month by month">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-2.5 rounded-t-[3px] bg-state-sun"
          />
          Direct sun, hours per day
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-2.5 rounded-t-[3px] bg-surface-2 ring-1 ring-line ring-inset"
          />
          Daylight
        </li>
      </ul>

      <div ref={sizeRef} className="relative mt-2 h-[188px]" aria-busy={!year || !model}>
        {!year || !model ? (
          <SkeletonBlock className="absolute inset-0" />
        ) : (
          <>
            <div
              className="flex h-full items-stretch"
              role="group"
              aria-label={`Average hours of direct sun per day in each month of ${year.year}`}
            >
              {details.map((month) => {
                const selected = month.month === selectedMonth;
                const sunShare = month.avgSunHours / max;
                const daylightShare = month.avgDaylightHours / max;
                return (
                  <button
                    key={month.month}
                    type="button"
                    className="group flex min-w-0 flex-1 cursor-pointer flex-col items-center rounded-md px-px focus-visible:outline-2 focus-visible:outline-accent"
                    aria-pressed={selected}
                    aria-label={`${month.longLabel}: ${formatHours(month.avgSunHours)} hours of direct sun per day, out of ${formatHours(month.avgDaylightHours)} hours of daylight`}
                    onClick={() => onSelectDateTime(dateInMonth(date, year.year, month.month))}
                    onPointerEnter={() => setActive(month.month)}
                    onPointerLeave={() =>
                      setActive((current) => (current === month.month ? null : current))
                    }
                    onFocus={() => setActive(month.month)}
                    onBlur={() =>
                      setActive((current) => (current === month.month ? null : current))
                    }
                  >
                    <span
                      className="relative block w-full flex-1"
                      style={{ marginTop: LABEL_ROOM }}
                    >
                      <span
                        className="absolute bottom-0 left-1/2 w-[72%] max-w-6 -translate-x-1/2 rounded-t-[4px] bg-surface-2 ring-1 ring-line ring-inset group-hover:bg-line"
                        style={{ height: `${daylightShare * 100}%` }}
                      />
                      <span
                        className="absolute bottom-0 left-1/2 w-[72%] max-w-6 -translate-x-1/2 rounded-t-[4px] bg-state-sun"
                        style={{ height: `${sunShare * 100}%` }}
                      />
                      <span
                        className={`absolute left-1/2 -translate-x-1/2 text-[10px] leading-none tabular-nums ${
                          selected ? "font-semibold text-ink" : "text-ink-2"
                        }`}
                        style={{ bottom: `calc(${sunShare * 100}% + 3px)` }}
                      >
                        {formatHours(month.avgSunHours)}
                      </span>
                    </span>
                    <span
                      className={`mt-1 rounded px-1 py-0.5 text-[10px] leading-none ${
                        selected ? "bg-ink font-semibold text-surface" : "text-ink-3"
                      }`}
                    >
                      {size && size.width < 300 ? month.label.charAt(0) : month.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeMonth && size && (
              <ChartTooltip
                x={((activeMonth.month + 0.5) / 12) * size.width}
                y={
                  LABEL_ROOM +
                  (size.height - LABEL_ROOM - 18) * (1 - activeMonth.avgDaylightHours / max)
                }
                containerWidth={size.width}
                containerHeight={size.height}
              >
                <div className="font-semibold text-ink">{activeMonth.longLabel}</div>
                <div className="mt-1 tabular-nums">
                  <strong className="font-semibold text-ink">
                    {formatHours(activeMonth.avgSunHours)} h
                  </strong>{" "}
                  direct sun per day
                </div>
                <div className="tabular-nums">
                  <strong className="font-semibold text-ink">
                    {formatHours(activeMonth.avgDaylightHours)} h
                  </strong>{" "}
                  daylight ({formatPercent(activeMonth.sunFraction)} in sun)
                </div>
                {activeMonth.firstMinute !== null && activeMonth.lastMinute !== null && (
                  <div className="mt-1 tabular-nums">
                    Typically{" "}
                    {formatClockRange(activeMonth.firstMinute, activeMonth.lastMinute, hour12)}
                  </div>
                )}
              </ChartTooltip>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
