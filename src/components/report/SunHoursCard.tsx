import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Segmented } from "@/components/ui/Segmented";
import type { YearAnalysis } from "@/lib/types";

import {
  daysInMonth,
  formatClockRange,
  formatDate,
  formatDuration,
  formatHours,
  formatPercent,
  parseIsoDate,
  toIsoDate,
} from "./format";
import {
  gestureInput,
  IDLE_GESTURE,
  isFingerPointer,
  reduceGesture,
  type GestureInput,
} from "./gesture";
import { dayIndexInYear, moveSelection, type MonthSpan } from "./heatmap";
import { useElementSize, type ElementSize } from "./hooks";
import type { ReportModel } from "./model";
import {
  ChartTooltip,
  LineKey,
  ReportCard,
  SkeletonBlock,
  SkeletonText,
  ValueUnit,
  useReport,
} from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import type { MonthDetail } from "./summary";
import type { SunReportProps } from "./types";

type View = "months" | "days";

const VIEW_OPTIONS: readonly { value: View; label: string }[] = [
  { value: "months", label: "Months" },
  { value: "days", label: "Days" },
];

interface SunHoursCardProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  date: string;
  onSelectDateTime: SunReportProps["onSelectDateTime"];
}

/** The date a month's bar jumps to: same day of the month, clamped to its length. */
export function dateInMonth(currentDate: string, year: number, month: number): string {
  const parts = parseIsoDate(currentDate);
  const day = Math.min(parts?.day ?? 15, daysInMonth(year, month));
  return toIsoDate(year, month, day);
}

/** Upper end of an hours axis: the next multiple of 4 (so the middle tick is whole), at least 4. */
export function hoursAxisMax(maxHours: number): number {
  return Math.max(4, Math.ceil(maxHours / 4 - 1e-9) * 4);
}

/**
 * Hours of direct sun through the year in one card, two ways: twelve monthly
 * averages (bars against that month's daylight) or every single day (a line
 * against the daylight curve). One axis either way: hours.
 */
export function SunHoursCard({ year, model, date, onSelectDateTime }: SunHoursCardProps) {
  const { hour12 } = useReport();
  const [view, setView] = useState<View>("months");
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<{ day: number; floating: boolean } | null>(null);

  const parts = parseIsoDate(date);
  const selectedMonth = year && parts && parts.year === year.year ? parts.month : null;
  const selectedDay = year ? dayIndexInYear(year, date) : null;
  const ready = year !== null && model !== null;

  let value;
  let detail;
  if (!year || !model) {
    value = <SkeletonText width="9rem" />;
    detail = <SkeletonText width="13rem" />;
  } else if (view === "months") {
    const month = model.details[activeMonth ?? selectedMonth ?? model.best?.month ?? 0];
    value = (
      <>
        {formatHours(month.avgSunHours)} h<ValueUnit>a day in {month.longLabel}</ValueUnit>
      </>
    );
    detail = monthDetailText(month, hour12);
  } else {
    const day = year.days[hoverDay?.day ?? selectedDay ?? 0];
    value = (
      <>
        {formatDuration(day.sunMinutes)}
        <ValueUnit>on {formatDate(day.date, { weekday: true })}</ValueUnit>
      </>
    );
    detail =
      day.daylightMinutes > 0
        ? `${formatPercent(day.sunMinutes / day.daylightMinutes)} of ${formatDuration(day.daylightMinutes)} of daylight`
        : "The sun does not rise";
  }

  return (
    <ReportCard
      id={REPORT_SECTION_IDS.sunHours}
      title="Sun hours"
      aside={
        <Segmented<View>
          label="Show sun hours by"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          compact
        />
      }
      value={value}
      detail={detail}
      footnote={
        view === "months"
          ? "Average hours of direct sun per day in each month, against that month’s daylight. Tap a month to go to it."
          : "Hours of direct sun on every day of the year, against the hours of daylight. Tap to go to a day."
      }
      footnoteLines={2}
      busy={!ready}
    >
      <div ref={sizeRef} className="relative mt-3 h-[184px]">
        {!year || !model || !size ? (
          <SkeletonBlock className="absolute inset-0" />
        ) : view === "months" ? (
          <MonthBars
            year={year}
            details={model.details}
            size={size}
            date={date}
            selectedMonth={selectedMonth}
            active={activeMonth}
            onActive={setActiveMonth}
            onSelectDateTime={onSelectDateTime}
          />
        ) : (
          <DayLine
            year={year}
            months={model.months}
            size={size}
            date={date}
            selectedDay={selectedDay}
            hover={hoverDay}
            onHover={setHoverDay}
            onSelectDateTime={onSelectDateTime}
          />
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs/4 font-medium text-ink-2">
        {view === "months" ? (
          <>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="report-sun-edge inline-block h-3 w-2.5 rounded-t-[3px] bg-state-sun"
              />
              Direct sun
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-2.5 rounded-t-[3px] bg-surface-2 ring-1 ring-line ring-inset"
              />
              Possible daylight
            </li>
          </>
        ) : (
          <>
            <li className="flex items-center gap-1.5">
              <LineKey color="var(--report-sun-line)" />
              Direct sun
            </li>
            <li className="flex items-center gap-1.5">
              <LineKey color="var(--ink-3)" width={1.25} />
              Possible daylight
            </li>
          </>
        )}
      </ul>
    </ReportCard>
  );
}

function monthDetailText(month: MonthDetail, hour12: boolean): string {
  const share = `${formatPercent(month.sunFraction)} of ${formatHours(month.avgDaylightHours)} h daylight`;
  if (month.firstMinute === null || month.lastMinute === null) return share;
  if (month.firstMinute <= 0 && month.lastMinute >= 1440) return `${share} · around the clock`;
  return `${share} · ${formatClockRange(month.firstMinute, month.lastMinute, hour12)}`;
}

// ─── Months: twelve bars ───────────────────────────────────────────────────

/** Room above the tallest track for a value label. */
const LABEL_ROOM = 16;
const MONTH_LABEL_ROOM = 22;

interface MonthBarsProps {
  year: YearAnalysis;
  details: MonthDetail[];
  size: ElementSize;
  date: string;
  selectedMonth: number | null;
  active: number | null;
  onActive: (month: number | null) => void;
  onSelectDateTime: SunReportProps["onSelectDateTime"];
}

function MonthBars({
  year,
  details,
  size,
  date,
  selectedMonth,
  active,
  onActive,
  onSelectDateTime,
}: MonthBarsProps) {
  const { hour12 } = useReport();
  const [floating, setFloating] = useState(false);
  const max = Math.max(1, ...details.map((month) => month.avgDaylightHours));
  const activeMonth = active !== null ? (details[active] ?? null) : null;
  const leave = (month: number) => () => onActive(active === month ? null : active);

  return (
    <>
      <div
        className="flex h-full touch-pan-y items-stretch"
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
              onClick={() =>
                onSelectDateTime(dateInMonth(date, year.year, month.month), undefined, "months")
              }
              onPointerEnter={(event) => {
                // Only a mouse hovers; a finger passing over (scrolling) must not change the reading.
                if (isFingerPointer(event)) return;
                setFloating(true);
                onActive(month.month);
              }}
              onPointerLeave={leave(month.month)}
              onFocus={() => {
                setFloating(false);
                onActive(month.month);
              }}
              onBlur={leave(month.month)}
            >
              <span className="relative block w-full flex-1" style={{ marginTop: LABEL_ROOM }}>
                <span
                  className="absolute bottom-0 left-1/2 w-[70%] max-w-6 -translate-x-1/2 rounded-t-[4px] bg-surface-2 ring-1 ring-line ring-inset"
                  style={{ height: `${daylightShare * 100}%` }}
                />
                <span
                  className="report-sun-edge absolute bottom-0 left-1/2 w-[70%] max-w-6 -translate-x-1/2 rounded-t-[4px] bg-state-sun"
                  style={{ height: `${sunShare * 100}%` }}
                />
                <span
                  className={`absolute left-1/2 -translate-x-1/2 text-[11px] leading-none text-ink tabular-nums ${
                    selected ? "font-bold" : "font-medium"
                  }`}
                  style={{ bottom: `calc(${sunShare * 100}% + 3px)` }}
                >
                  {formatHours(month.avgSunHours)}
                </span>
              </span>
              <span
                className={`flex flex-col items-center pt-1.5 text-xs leading-none ${
                  selected ? "font-bold text-ink" : "font-medium text-ink-2"
                }`}
                style={{ height: MONTH_LABEL_ROOM }}
              >
                {size.width < 400 ? month.label.charAt(0) : month.label}
                <span
                  aria-hidden="true"
                  className={`mt-1 size-1 rounded-full ${selected ? "bg-ink" : "bg-transparent"}`}
                />
              </span>
            </button>
          );
        })}
      </div>

      {activeMonth && floating && (
        <ChartTooltip
          x={((activeMonth.month + 0.5) / 12) * size.width}
          y={
            LABEL_ROOM +
            (size.height - LABEL_ROOM - MONTH_LABEL_ROOM) * (1 - activeMonth.avgDaylightHours / max)
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
              Typically {formatClockRange(activeMonth.firstMinute, activeMonth.lastMinute, hour12)}
            </div>
          )}
        </ChartTooltip>
      )}
    </>
  );
}

// ─── Days: one line ────────────────────────────────────────────────────────

const MARGIN = { left: 24, right: 1, top: 10, bottom: 22 };

interface DayLineProps {
  year: YearAnalysis;
  months: MonthSpan[];
  size: ElementSize;
  date: string;
  selectedDay: number | null;
  hover: { day: number; floating: boolean } | null;
  onHover: (hover: { day: number; floating: boolean } | null) => void;
  onSelectDateTime: SunReportProps["onSelectDateTime"];
}

function DayLine({
  year,
  months,
  size,
  date,
  selectedDay,
  hover,
  onHover,
  onSelectDateTime,
}: DayLineProps) {
  const gesture = useRef(IDLE_GESTURE);
  const { width, height } = size;
  const plotX = MARGIN.left;
  const plotY = MARGIN.top;
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const chart = useMemo(() => {
    let maxDaylight = 0;
    for (const day of year.days) maxDaylight = Math.max(maxDaylight, day.daylightMinutes / 60);
    const max = hoursAxisMax(maxDaylight);
    const xOf = (dayIndex: number) => plotX + ((dayIndex + 0.5) / year.dayCount) * plotWidth;
    const yOf = (hours: number) => plotY + plotHeight * (1 - hours / max);
    const base = plotY + plotHeight;
    let sun = "";
    let daylight = "";
    year.days.forEach((day, i) => {
      const x = xOf(i).toFixed(1);
      sun += `${i === 0 ? "M" : "L"}${x} ${yOf(day.sunMinutes / 60).toFixed(1)}`;
      daylight += `${i === 0 ? "M" : "L"}${x} ${yOf(day.daylightMinutes / 60).toFixed(1)}`;
    });
    const last = year.dayCount - 1;
    const area = `${sun}L${xOf(last).toFixed(1)} ${base}L${xOf(0).toFixed(1)} ${base}Z`;
    return { max, sun, daylight, area };
  }, [year, plotX, plotY, plotWidth, plotHeight]);

  const xOf = (dayIndex: number) => plotX + ((dayIndex + 0.5) / year.dayCount) * plotWidth;
  const yOf = (hours: number) => plotY + plotHeight * (1 - hours / chart.max);
  const base = plotY + plotHeight;
  const monthWidth = plotWidth / 12;

  const dayFromEvent = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.min(year.dayCount - 1, Math.max(0, Math.floor(fraction * year.dayCount)));
  };
  const preview = (event: PointerEvent<SVGRectElement>) =>
    onHover({
      day: dayFromEvent(event),
      floating: !isFingerPointer(event),
    });

  // Reading vs choosing, as on the heat map: a moving finger previews, a tap
  // (or a mouse click) selects the day, a vertical move is the page scrolling.
  const step = (type: GestureInput["type"], event: PointerEvent<SVGRectElement>) => {
    const result = reduceGesture(gesture.current, gestureInput(type, event));
    gesture.current = result.state;
    return result.action;
  };
  const onPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (!isFingerPointer(event) && event.button !== 0) return;
    step("down", event);
  };
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    if (gesture.current.phase === "idle") {
      if (!isFingerPointer(event)) preview(event);
      return;
    }
    const action = step("move", event);
    if (action === "scrub") preview(event);
    else if (action === "discard") onHover(null);
  };
  const onPointerUp = (event: PointerEvent<SVGRectElement>) => {
    if (step("up", event) === "tap") {
      onSelectDateTime(year.days[dayFromEvent(event)].date, undefined, "days");
    }
    if (isFingerPointer(event)) onHover(null);
  };
  const onPointerCancel = (event: PointerEvent<SVGRectElement>) => {
    step("cancel", event);
    onHover(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    try {
      next = moveSelection(date, 0, event.key);
    } catch {
      return;
    }
    if (!next) return;
    event.preventDefault();
    onSelectDateTime(next.date, undefined, "days");
  };

  const hovered = hover ? year.days[hover.day] : null;
  const selected = selectedDay !== null ? year.days[selectedDay] : null;

  return (
    // touch-action lives on this HTML element: browsers do not honour it on the SVG hit rect.
    <div
      className="absolute inset-0 touch-pan-y rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
      role="group"
      tabIndex={0}
      aria-roledescription="interactive chart"
      aria-label={`Line chart of hours of direct sun for each day of ${year.year}, against the hours of daylight. Left and right arrow keys change the selected day.`}
      onKeyDown={onKeyDown}
    >
      <svg width={width} height={height} className="block" aria-hidden="true">
        <g fontSize="12" fontWeight="500">
          {[0, chart.max / 2, chart.max].map((hours) => {
            const y = Math.round(yOf(hours)) + 0.5;
            return (
              <g key={hours}>
                <line
                  x1={plotX}
                  x2={plotX + plotWidth}
                  y1={y}
                  y2={y}
                  stroke={hours === 0 ? "var(--report-axis)" : "var(--report-grid)"}
                />
                <text x={plotX - 6} y={y} dy="0.32em" textAnchor="end" className="fill-ink-2">
                  {hours}
                </text>
              </g>
            );
          })}
          {months.map((month) => (
            <text
              key={month.month}
              x={plotX + ((month.startDay + month.dayCount / 2) / year.dayCount) * plotWidth}
              y={base + 16}
              textAnchor="middle"
              className="fill-ink-2"
            >
              {monthWidth >= 26 ? month.label : month.label.charAt(0)}
            </text>
          ))}
        </g>

        <path d={chart.area} fill="var(--state-sun)" fillOpacity={0.24} />
        <path
          d={chart.daylight}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        <path
          d={chart.sun}
          fill="none"
          stroke="var(--report-sun-line)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {selected && selectedDay !== null && (
          <g data-testid="daily-selection">
            <line
              x1={xOf(selectedDay)}
              x2={xOf(selectedDay)}
              y1={plotY}
              y2={base}
              stroke="var(--ink)"
            />
            <circle
              cx={xOf(selectedDay)}
              cy={yOf(selected.sunMinutes / 60)}
              r={4.5}
              fill="var(--report-sun-line)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}

        {hovered && hover && (
          <g>
            <line
              x1={xOf(hover.day)}
              x2={xOf(hover.day)}
              y1={plotY}
              y2={base}
              stroke="var(--ink-3)"
            />
            <circle
              cx={xOf(hover.day)}
              cy={yOf(hovered.daylightMinutes / 60)}
              r={3.5}
              fill="var(--ink-3)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
            <circle
              cx={xOf(hover.day)}
              cy={yOf(hovered.sunMinutes / 60)}
              r={4}
              fill="var(--report-sun-line)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}

        <rect
          data-testid="daily-hit"
          x={plotX}
          y={plotY}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          className="cursor-crosshair"
          style={{ pointerEvents: "all" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(event) => {
            if (!isFingerPointer(event)) {
              gesture.current = IDLE_GESTURE;
              onHover(null);
            }
          }}
        />
      </svg>

      {hovered && hover && hover.floating && (
        <ChartTooltip
          x={xOf(hover.day)}
          y={Math.min(yOf(hovered.daylightMinutes / 60), yOf(hovered.sunMinutes / 60))}
          containerWidth={width}
          containerHeight={height}
        >
          <div className="font-semibold text-ink">
            {formatDate(hovered.date, { weekday: true })}
          </div>
          <div className="mt-1 flex items-center gap-1.5 tabular-nums">
            <LineKey color="var(--report-sun-line)" />
            <span>
              <strong className="font-semibold text-ink">
                {formatDuration(hovered.sunMinutes)}
              </strong>{" "}
              direct sun
            </span>
          </div>
          <div className="flex items-center gap-1.5 tabular-nums">
            <LineKey color="var(--ink-3)" width={1.25} />
            <span>
              <strong className="font-semibold text-ink">
                {formatDuration(hovered.daylightMinutes)}
              </strong>{" "}
              daylight
            </span>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}
