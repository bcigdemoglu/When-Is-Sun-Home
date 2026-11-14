import { useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { Card } from "@/components/ui/Card";
import type { YearAnalysis } from "@/lib/types";

import { formatDate, formatDuration, formatHours } from "./format";
import { dayIndexInYear, moveSelection, type MonthSpan } from "./heatmap";
import { useElementSize } from "./hooks";
import type { ReportModel } from "./model";
import { ChartTooltip, LineKey, SkeletonBlock } from "./parts";

const MARGIN = { left: 26, right: 4, top: 10, bottom: 20 };

interface DailyHoursChartProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  date: string;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

/** Upper end and tick step (hours) of the y-axis for a largest value. */
export function hoursAxis(maxHours: number): { max: number; step: number } {
  const step = maxHours <= 6 ? 2 : maxHours <= 12 ? 3 : maxHours <= 16 ? 4 : 6;
  return { max: Math.max(step, Math.ceil(maxHours / step - 1e-9) * step), step };
}

/** Direct sun per day against possible daylight, across the year. One axis: hours. */
export function DailyHoursChart({ year, model, date, onSelectDateTime }: DailyHoursChartProps) {
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const plot = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(0, width - MARGIN.left - MARGIN.right),
    height: Math.max(0, height - MARGIN.top - MARGIN.bottom),
  };

  const chart = useMemo(() => {
    if (!year || plot.width <= 0 || plot.height <= 0) return null;
    let maxDaylight = 0;
    for (const day of year.days) maxDaylight = Math.max(maxDaylight, day.daylightMinutes / 60);
    const axis = hoursAxis(maxDaylight);
    const xOf = (dayIndex: number) => plot.x + ((dayIndex + 0.5) / year.dayCount) * plot.width;
    const yOf = (hours: number) => plot.y + plot.height * (1 - hours / axis.max);
    const base = plot.y + plot.height;

    let sun = "";
    let daylight = "";
    year.days.forEach((day, i) => {
      const x = xOf(i).toFixed(1);
      sun += `${i === 0 ? "M" : "L"}${x} ${yOf(day.sunMinutes / 60).toFixed(1)}`;
      daylight += `${i === 0 ? "M" : "L"}${x} ${yOf(day.daylightMinutes / 60).toFixed(1)}`;
    });
    const last = year.dayCount - 1;
    const area = `${sun}L${xOf(last).toFixed(1)} ${base}L${xOf(0).toFixed(1)} ${base}Z`;
    const ticks: number[] = [];
    for (let hours = 0; hours <= axis.max; hours += axis.step) ticks.push(hours);
    return { axis, sun, daylight, area, ticks };
  }, [year, plot.x, plot.y, plot.width, plot.height]);

  const ready = year !== null && model !== null && chart !== null;
  const selectedDay = year ? dayIndexInYear(year, date) : null;

  const xOf = (dayIndex: number) =>
    plot.x + ((dayIndex + 0.5) / (year?.dayCount ?? 365)) * plot.width;
  const yOf = (hours: number) => plot.y + plot.height * (1 - hours / (chart?.axis.max ?? 24));

  const dayFromEvent = (event: PointerEvent<SVGRectElement> | MouseEvent<SVGRectElement>) => {
    if (!year || plot.width <= 0) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.min(year.dayCount - 1, Math.max(0, Math.floor(fraction * year.dayCount)));
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
    onSelectDateTime(next.date);
  };

  const hovered = year && hoverDay !== null ? year.days[hoverDay] : null;

  return (
    <Card title="Direct sun, day by day">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <li className="flex items-center gap-1.5">
          <LineKey color="var(--report-sun-line)" />
          Hours of direct sun
        </li>
        <li className="flex items-center gap-1.5">
          <LineKey color="var(--ink-3)" width={1.25} />
          Possible daylight
        </li>
      </ul>

      <div
        ref={sizeRef}
        className="relative mt-2 h-[176px] rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
        role="group"
        tabIndex={0}
        aria-roledescription="interactive chart"
        aria-label={
          year
            ? `Line chart of hours of direct sun for each day of ${year.year}, against the hours of daylight. Left and right arrow keys change the selected day.`
            : "Line chart of hours of direct sun per day, loading"
        }
        aria-busy={!ready}
        onKeyDown={onKeyDown}
      >
        {!ready || !year || !model ? (
          <SkeletonBlock className="absolute inset-0" />
        ) : (
          <>
            <svg width={width} height={height} className="block" aria-hidden="true">
              <Axes
                plot={plot}
                ticks={chart.ticks}
                max={chart.axis.max}
                months={model.months}
                dayCount={year.dayCount}
              />
              <path d={chart.area} fill="var(--state-sun)" fillOpacity={0.22} />
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

              {selectedDay !== null && (
                <SelectedDayMark
                  x={xOf(selectedDay)}
                  y={yOf(year.days[selectedDay].sunMinutes / 60)}
                  plot={plot}
                  label={`${formatHours(year.days[selectedDay].sunMinutes / 60)} h`}
                />
              )}

              {hovered && hoverDay !== null && (
                <g>
                  <line
                    x1={xOf(hoverDay)}
                    x2={xOf(hoverDay)}
                    y1={plot.y}
                    y2={plot.y + plot.height}
                    stroke="var(--ink-3)"
                  />
                  <circle
                    cx={xOf(hoverDay)}
                    cy={yOf(hovered.daylightMinutes / 60)}
                    r={3.5}
                    fill="var(--ink-3)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                  <circle
                    cx={xOf(hoverDay)}
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
                x={plot.x}
                y={plot.y}
                width={plot.width}
                height={plot.height}
                fill="transparent"
                className="cursor-crosshair touch-pan-y"
                style={{ pointerEvents: "all" }}
                onPointerDown={(event) => setHoverDay(dayFromEvent(event))}
                onPointerMove={(event) => setHoverDay(dayFromEvent(event))}
                onPointerLeave={() => setHoverDay(null)}
                onPointerCancel={() => setHoverDay(null)}
                onClick={(event) => {
                  const day = dayFromEvent(event);
                  if (day !== null) onSelectDateTime(year.days[day].date);
                }}
              />
            </svg>

            {hovered && hoverDay !== null && (
              <ChartTooltip
                x={xOf(hoverDay)}
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
          </>
        )}
      </div>
    </Card>
  );
}

interface Plot {
  x: number;
  y: number;
  width: number;
  height: number;
}

function Axes({
  plot,
  ticks,
  max,
  months,
  dayCount,
}: {
  plot: Plot;
  ticks: number[];
  max: number;
  months: MonthSpan[];
  dayCount: number;
}) {
  const base = plot.y + plot.height;
  const monthWidth = plot.width / 12;
  return (
    <g fontSize="10">
      {ticks.map((hours) => {
        const y = Math.round(plot.y + plot.height * (1 - hours / max)) + 0.5;
        return (
          <g key={hours}>
            <line
              x1={plot.x}
              x2={plot.x + plot.width}
              y1={y}
              y2={y}
              stroke={hours === 0 ? "var(--report-axis)" : "var(--report-grid)"}
            />
            <text x={plot.x - 6} y={y} dy="0.32em" textAnchor="end" className="fill-ink-3">
              {hours === max ? `${hours}h` : hours}
            </text>
          </g>
        );
      })}
      {months.map((month) => {
        const x = Math.round(plot.x + (month.startDay / dayCount) * plot.width) + 0.5;
        return (
          <g key={month.month}>
            <line x1={x} x2={x} y1={base} y2={base + 4} stroke="var(--report-axis)" />
            <text
              x={plot.x + ((month.startDay + month.dayCount / 2) / dayCount) * plot.width}
              y={base + 14}
              textAnchor="middle"
              className="fill-ink-3"
            >
              {monthWidth >= 21 ? month.label : month.label.charAt(0)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function SelectedDayMark({
  x,
  y,
  plot,
  label,
}: {
  x: number;
  y: number;
  plot: Plot;
  label: string;
}) {
  const half = (label.length * 5.8) / 2;
  const labelX = Math.min(Math.max(x, plot.x + half), plot.x + plot.width - half);
  const labelY = y - 9 < plot.y + 8 ? y + 16 : y - 9;
  return (
    <g data-testid="daily-selection">
      <line x1={x} x2={x} y1={plot.y} y2={plot.y + plot.height} stroke="var(--ink-2)" />
      <circle
        cx={x}
        cy={y}
        r={4.5}
        fill="var(--report-sun-line)"
        stroke="var(--surface)"
        strokeWidth={2}
      />
      <text
        x={labelX}
        y={labelY}
        fontSize="10"
        fontWeight="600"
        textAnchor="middle"
        className="report-halo fill-ink"
      >
        {label}
      </text>
    </g>
  );
}
