import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { Card } from "@/components/ui/Card";
import type { Observer, YearAnalysis } from "@/lib/types";

import {
  formatClock,
  formatDate,
  formatDuration,
  formatHours,
  formatHourTick,
  MONTHS_LONG,
} from "./format";
import {
  buildHeatmapPixels,
  cellAtPoint,
  dayCenterX,
  dayIndexInYear,
  dayX,
  hourTicks,
  minuteY,
  moveSelection,
  type ClockShift,
  type HeatmapCell,
  type HeatmapGeometry,
} from "./heatmap";
import { createHeatmapBitmap, drawHeatmapBase, type HeatmapBitmap } from "./heatmapCanvas";
import { useColorSchemeKey, useDevicePixelRatio, useElementSize } from "./hooks";
import type { ReportModel } from "./model";
import { MonthlyTable } from "./MonthlyTable";
import { ChartTooltip, SkeletonBlock, StateLegend, StateSwatch, useReport } from "./parts";
import { legendStates, resolveStateColors, stateMeta } from "./states";

const MARGIN = { left: 42, right: 4, top: 18, bottom: 20 };

interface YearHeatmapProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  date: string;
  minuteOfDay: number;
  observer: Observer;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

/** The hero chart: every day of the year × every time of day, coloured by state. */
export function YearHeatmap({
  year,
  model,
  date,
  minuteOfDay,
  observer,
  onSelectDateTime,
}: YearHeatmapProps) {
  const { hour12 } = useReport();
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<(HeatmapCell & { x: number; y: number }) | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const liveId = useId();
  const tableId = useId();

  const ready = year !== null && model !== null && size !== null && size.width > 0;
  const geometry: HeatmapGeometry | null =
    year && model && size
      ? {
          x: MARGIN.left,
          y: MARGIN.top,
          width: Math.max(0, size.width - MARGIN.left - MARGIN.right),
          height: Math.max(0, size.height - MARGIN.top - MARGIN.bottom),
          dayCount: year.dayCount,
          stepMinutes: year.stepMinutes,
          startMinute: model.range.startMinute,
          endMinute: model.range.endMinute,
        }
      : null;

  const selectedDay = year ? dayIndexInYear(year, date) : null;

  const cellFromEvent = (
    event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
  ): (HeatmapCell & { x: number; y: number }) | null => {
    if (!geometry) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = geometry.x + (event.clientX - rect.left);
    const y = geometry.y + (event.clientY - rect.top);
    const cell = cellAtPoint(geometry, x, y, true);
    return cell ? { ...cell, x, y } : null;
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => setHover(cellFromEvent(event));
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const cell = cellFromEvent(event);
    if (cell && year) onSelectDateTime(year.days[cell.dayIndex].date, cell.minute);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    try {
      next = moveSelection(date, minuteOfDay, event.key);
    } catch {
      return;
    }
    if (!next) return;
    event.preventDefault();
    onSelectDateTime(next.date, next.minute);
  };

  const selectedState =
    year && selectedDay !== null
      ? year.state[
          selectedDay * year.slotsPerDay +
            Math.min(year.slotsPerDay - 1, Math.floor(minuteOfDay / year.stepMinutes))
        ]
      : null;

  return (
    <Card title="Sun through the year" aside={year ? String(year.year) : undefined}>
      <p className="text-xs text-ink-2">
        Each column is a day, read top to bottom from morning to evening. Tap anywhere to jump to
        that date and time.
      </p>
      <StateLegend states={legendStates(observer)} className="mt-2" />

      <div
        ref={sizeRef}
        className="relative mt-2 h-[300px] rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent @lg:h-[340px]"
        role="group"
        tabIndex={0}
        aria-roledescription="interactive chart"
        aria-label={chartSummary(year, model)}
        aria-describedby={liveId}
        aria-busy={!ready}
        onKeyDown={onKeyDown}
      >
        {!ready || !geometry || !year || !model ? (
          <SkeletonBlock className="absolute inset-0" />
        ) : (
          <>
            <HeatmapCanvas year={year} geometry={geometry} />
            <svg
              width={size.width}
              height={size.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              <Furniture geometry={geometry} model={model} hour12={hour12} />
              <ClockShiftMarks geometry={geometry} shifts={model.clockShifts} />
              {hover && <HoverMark geometry={geometry} cell={hover} />}
              {selectedDay !== null && (
                <SelectionMark
                  geometry={geometry}
                  dayIndex={selectedDay}
                  minute={minuteOfDay}
                  label={formatDate(date)}
                />
              )}
            </svg>
            <div
              data-testid="heatmap-hit"
              className="absolute cursor-crosshair touch-pan-y"
              style={{
                left: geometry.x,
                top: geometry.y,
                width: geometry.width,
                height: geometry.height,
              }}
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              onPointerLeave={() => setHover(null)}
              onPointerCancel={() => setHover(null)}
              onClick={onClick}
            />
            {hover && (
              <ChartTooltip
                x={hover.x}
                y={hover.y}
                containerWidth={size.width}
                containerHeight={size.height}
              >
                <div className="font-semibold text-ink tabular-nums">
                  {formatDate(year.days[hover.dayIndex].date, { weekday: true })} {"·"}{" "}
                  {formatClock(hover.minute, hour12)}
                </div>
                <div className="mt-1 flex items-start gap-1.5 text-ink">
                  <StateSwatch
                    state={
                      year.state[hover.dayIndex * year.slotsPerDay + hover.slot] as 0 | 1 | 2 | 3
                    }
                    className="mt-0.5"
                  />
                  <span>
                    {stateMeta(year.state[hover.dayIndex * year.slotsPerDay + hover.slot]).phrase}
                  </span>
                </div>
                <div className="mt-1 tabular-nums">
                  <strong className="font-semibold text-ink">
                    {formatDuration(year.days[hover.dayIndex].sunMinutes)}
                  </strong>{" "}
                  of direct sun that day
                </div>
              </ChartTooltip>
            )}
          </>
        )}
      </div>

      <p id={liveId} className="sr-only" aria-live="polite">
        {year && selectedDay !== null && selectedState !== null
          ? `Selected ${formatDate(date, { weekday: true })}, ${formatClock(minuteOfDay, hour12)}: ${
              stateMeta(selectedState).phrase
            }. ${formatDuration(year.days[selectedDay].sunMinutes)} of direct sun that day.`
          : ""}
      </p>

      {/* Always the same height, so the card does not grow when the analysis arrives. */}
      <p className="mt-1 min-h-8 text-xs text-ink-3 @lg:min-h-4">
        {model && clockShiftNote(model.clockShifts)}
      </p>

      <div className="mt-2">
        <button
          type="button"
          className="rounded text-xs font-medium text-ink-2 underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((open) => !open)}
        >
          {tableOpen ? "Hide the monthly numbers" : "Show the monthly numbers as a table"}
        </button>
        <div id={tableId} hidden={!tableOpen}>
          {tableOpen && model && year && <MonthlyTable year={year.year} details={model.details} />}
        </div>
      </div>
    </Card>
  );
}

function chartSummary(year: YearAnalysis | null, model: ReportModel | null): string {
  if (!year || !model) return "Heat map of direct sun through the year, loading";
  const { best, worst } = model;
  const parts = [
    `Heat map of direct sun through ${year.year}: each column is a day, each row a time of day.`,
    `On average ${formatHours(year.annual.avgSunHoursPerDay)} hours of direct sun per day.`,
  ];
  if (best && worst) {
    parts.push(
      `Most in ${MONTHS_LONG[best.month]} (${formatHours(best.avgSunHours)} hours a day), least in ${
        MONTHS_LONG[worst.month]
      } (${formatHours(worst.avgSunHours)} hours a day).`,
    );
  }
  parts.push(
    "Arrow keys move the selection by one day or by 15 minutes. A table of monthly numbers follows the chart.",
  );
  return parts.join(" ");
}

function clockShiftNote(shifts: readonly ClockShift[]): string {
  if (shifts.length === 0) {
    return "Clocks do not change here, so the band has no daylight-saving steps.";
  }
  const dates = shifts.map((shift) => formatDate(shift.date)).join(" and ");
  return `\u25be Clocks change on ${dates} (daylight saving): hence the one-hour steps.`;
}

// ─── Base layer (canvas) ───────────────────────────────────────────────────

interface BitmapCache {
  year: YearAnalysis;
  startMinute: number;
  endMinute: number;
  colorsKey: string;
  bitmap: HeatmapBitmap | null;
}

/**
 * The 365 × 288 grid, painted once per (analysis, colours) into a small bitmap
 * and then only re-scaled when the size changes. Nothing here depends on the
 * selection or on hovering.
 */
function HeatmapCanvas({ year, geometry }: { year: YearAnalysis; geometry: HeatmapGeometry }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef<BitmapCache | null>(null);
  const scheme = useColorSchemeKey();
  const pixelRatio = useDevicePixelRatio();
  const { x, y, width, height, startMinute, endMinute } = geometry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const style = getComputedStyle(canvas);
    const colors = resolveStateColors((name) => style.getPropertyValue(name));

    let entry = cache.current;
    if (
      !entry ||
      entry.year !== year ||
      entry.startMinute !== startMinute ||
      entry.endMinute !== endMinute ||
      entry.colorsKey !== colors.key
    ) {
      const pixels = buildHeatmapPixels(year, { startMinute, endMinute }, colors);
      entry = {
        year,
        startMinute,
        endMinute,
        colorsKey: colors.key,
        bitmap: createHeatmapBitmap(pixels),
      };
      cache.current = entry;
    }
    if (entry.bitmap)
      drawHeatmapBase(canvas, entry.bitmap, width, height, pixelRatio, colors.hatch);
  }, [year, startMinute, endMinute, width, height, pixelRatio, scheme]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="heatmap-canvas"
      aria-hidden="true"
      className="absolute rounded-[3px]"
      style={{ left: x, top: y, width, height }}
    />
  );
}

// ─── Overlay layers (SVG) ──────────────────────────────────────────────────

function Furniture({
  geometry,
  model,
  hour12,
}: {
  geometry: HeatmapGeometry;
  model: ReportModel;
  hour12: boolean;
}) {
  const bottom = geometry.y + geometry.height;
  const right = geometry.x + geometry.width;
  const monthWidth = geometry.width / 12;
  return (
    <g fontSize="10">
      {hourTicks(model.range, geometry.height).map((minute) => {
        const y = Math.round(minuteY(geometry, minute)) + 0.5;
        const inside = minute > geometry.startMinute && minute < geometry.endMinute;
        return (
          <g key={minute}>
            {inside && (
              <line x1={geometry.x} x2={right} y1={y} y2={y} stroke="var(--report-heat-grid)" />
            )}
            <text x={geometry.x - 6} y={y} dy="0.32em" textAnchor="end" className="fill-ink-3">
              {formatHourTick(minute, hour12)}
            </text>
          </g>
        );
      })}
      {model.months.map((month) => {
        const x = Math.round(dayX(geometry, month.startDay)) + 0.5;
        return (
          <g key={month.month}>
            {month.month > 0 && (
              <line x1={x} x2={x} y1={geometry.y} y2={bottom} stroke="var(--report-heat-grid)" />
            )}
            <text
              x={dayX(geometry, month.startDay + month.dayCount / 2)}
              y={bottom + 14}
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

function ClockShiftMarks({
  geometry,
  shifts,
}: {
  geometry: HeatmapGeometry;
  shifts: readonly ClockShift[];
}) {
  return (
    <g className="fill-ink-3">
      {shifts.map((shift) => {
        const x = dayX(geometry, shift.dayIndex);
        const y = geometry.y - 2;
        return <path key={shift.dayIndex} d={`M${x - 3.5} ${y - 5}h7l-3.5 5z`} />;
      })}
    </g>
  );
}

function HoverMark({ geometry, cell }: { geometry: HeatmapGeometry; cell: HeatmapCell }) {
  const x = dayCenterX(geometry, cell.dayIndex);
  const y = minuteY(geometry, cell.minute + geometry.stepMinutes / 2);
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={geometry.y}
        y2={geometry.y + geometry.height}
        stroke="var(--report-marker-halo)"
        strokeOpacity={0.55}
      />
      <circle cx={x} cy={y} r={4} fill="none" stroke="var(--report-marker-halo)" strokeWidth={3} />
      <circle cx={x} cy={y} r={4} fill="none" stroke="var(--report-marker)" strokeWidth={1.25} />
    </g>
  );
}

/** Crosshair at the selected date and time, with the date flagged above the plot. */
function SelectionMark({
  geometry,
  dayIndex,
  minute,
  label,
}: {
  geometry: HeatmapGeometry;
  dayIndex: number;
  minute: number;
  label: string;
}) {
  const x = dayCenterX(geometry, dayIndex);
  const top = geometry.y;
  const bottom = geometry.y + geometry.height;
  const right = geometry.x + geometry.width;
  const inRange = minute >= geometry.startMinute && minute <= geometry.endMinute;
  const y = minuteY(geometry, minute);
  const labelHalf = (label.length * 5.8) / 2;
  const labelX = Math.min(Math.max(x, geometry.x + labelHalf), right - labelHalf);
  return (
    <g data-testid="heatmap-selection">
      <line
        x1={x}
        x2={x}
        y1={top - 3}
        y2={bottom}
        stroke="var(--report-marker-halo)"
        strokeWidth={3}
        strokeOpacity={0.5}
      />
      <line x1={x} x2={x} y1={top - 3} y2={bottom} stroke="var(--report-marker)" strokeWidth={1} />
      {inRange && (
        <>
          <line
            x1={geometry.x}
            x2={right}
            y1={y}
            y2={y}
            stroke="var(--report-marker-halo)"
            strokeWidth={3}
            strokeOpacity={0.22}
          />
          <line
            x1={geometry.x}
            x2={right}
            y1={y}
            y2={y}
            stroke="var(--report-marker)"
            strokeWidth={1}
            strokeOpacity={0.45}
          />
          <circle
            cx={x}
            cy={y}
            r={5}
            fill="none"
            stroke="var(--report-marker-halo)"
            strokeWidth={4}
          />
          <circle
            cx={x}
            cy={y}
            r={5}
            fill="none"
            stroke="var(--report-marker)"
            strokeWidth={1.75}
          />
        </>
      )}
      <text
        x={labelX}
        y={top - 6}
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
