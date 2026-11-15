import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { horizonBinFor } from "@/lib/analysis";
import {
  SunState,
  type DayAnalysis,
  type HorizonProfile,
  type Observer,
  type SunStateCode,
  type SunYearGrid,
  type YearAnalysis,
} from "@/lib/types";

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
  timeAxisTicks,
  minuteY,
  moveSelection,
  type ClockShift,
  type HeatmapCell,
  type HeatmapGeometry,
} from "./heatmap";
import {
  gestureInput,
  IDLE_GESTURE,
  isFingerPointer,
  reduceGesture,
  type GestureInput,
} from "./gesture";
import {
  createHeatmapBitmap,
  drawHeatmapBase,
  releaseHeatmapBitmap,
  releaseHeatmapScratch,
  type HeatmapBitmap,
} from "./heatmapCanvas";
import { useColorSchemeKey, useDevicePixelRatio, useElementSize } from "./hooks";
import type { ReportModel } from "./model";
import { MonthlyTable } from "./MonthlyTable";
import {
  ChartTooltip,
  ReportCard,
  SkeletonBlock,
  SkeletonText,
  StateLegend,
  StateSwatch,
  useReport,
} from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import {
  blockedLabel,
  legendStates,
  resolveStateColors,
  stateMeta,
  statePhrase,
  stateShort,
} from "./states";
import { dayTotals } from "./summary";
import type { SunReportProps } from "./types";

const MARGIN = { left: 44, right: 1, top: 20, bottom: 22 };

interface YearHeatmapProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  /** The selected day's 1-minute analysis: only for that day's total (see `dayTotals`). */
  day: DayAnalysis | null;
  /** Sun positions and skyline: only used to say WHAT shades a hovered cell. */
  grid: SunYearGrid | null;
  horizon: HorizonProfile | null;
  hasTerrain: boolean;
  date: string;
  minuteOfDay: number;
  observer: Observer;
  onSelectDateTime: SunReportProps["onSelectDateTime"];
}

/** The cell under the pointer, where it is, and whether a floating tooltip suits the pointer. */
type HoverCell = HeatmapCell & { x: number; y: number; floating: boolean };

/** The hero chart: every day of the year × every time of day, coloured by state. */
export function YearHeatmap({
  year,
  model,
  day,
  grid,
  horizon,
  hasTerrain,
  date,
  minuteOfDay,
  observer,
  onSelectDateTime,
}: YearHeatmapProps) {
  const { hour12 } = useReport();
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<HoverCell | null>(null);
  const gesture = useRef(IDLE_GESTURE);
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

  const cellFromEvent = (event: PointerEvent<HTMLDivElement>): HoverCell | null => {
    if (!geometry) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = geometry.x + (event.clientX - rect.left);
    const y = geometry.y + (event.clientY - rect.top);
    const cell = cellAtPoint(geometry, x, y, true);
    return cell ? { ...cell, x, y, floating: !isFingerPointer(event) } : null;
  };

  // Reading vs choosing: a moving finger previews (the value line follows it),
  // only a tap — or a mouse click — commits. A vertical move is the page scrolling.
  const step = (type: GestureInput["type"], event: PointerEvent<HTMLDivElement>) => {
    const result = reduceGesture(gesture.current, gestureInput(type, event));
    gesture.current = result.state;
    return result.action;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isFingerPointer(event) && event.button !== 0) return;
    step("down", event);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current.phase === "idle") {
      if (!isFingerPointer(event)) setHover(cellFromEvent(event));
      return;
    }
    const action = step("move", event);
    if (action === "scrub") setHover(cellFromEvent(event));
    else if (action === "discard") setHover(null);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const action = step("up", event);
    if (action === "tap") {
      const cell = cellFromEvent(event);
      if (cell && year) onSelectDateTime(year.days[cell.dayIndex].date, cell.minute, "heatmap");
    }
    // A lifted finger leaves no hover behind; a mouse is still over the chart.
    if (isFingerPointer(event)) setHover(null);
  };
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    step("cancel", event);
    setHover(null);
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
    onSelectDateTime(next.date, next.minute, "heatmap");
  };

  const selectedState =
    year && selectedDay !== null
      ? year.state[
          selectedDay * year.slotsPerDay +
            Math.min(year.slotsPerDay - 1, Math.floor(minuteOfDay / year.stepMinutes))
        ]
      : null;

  // A day's total: the selected day reads like every other card (see `dayTotals`).
  const sunOf = (dayIndex: number) => dayTotals(year, day, date, dayIndex)?.sunMinutes ?? 0;

  // The value line reads the cell under the pointer, else the selection.
  const shown: HeatmapCell | null =
    hover ??
    (year && selectedDay !== null
      ? {
          dayIndex: selectedDay,
          slot: Math.min(year.slotsPerDay - 1, Math.floor(minuteOfDay / year.stepMinutes)),
          minute: minuteOfDay,
        }
      : null);
  const shownState =
    year && shown ? year.state[shown.dayIndex * year.slotsPerDay + shown.slot] : null;

  return (
    <ReportCard
      id={REPORT_SECTION_IDS.year}
      title="Through the year"
      aside={year ? String(year.year) : undefined}
      value={
        !year ? (
          <SkeletonText width="12rem" />
        ) : shown ? (
          <>
            {formatDate(year.days[shown.dayIndex].date, { weekday: true })} {"\u00b7"}{" "}
            {formatClock(shown.minute, hour12)}
          </>
        ) : (
          String(year.year)
        )
      }
      detail={
        !year ? (
          <>
            <SkeletonText width="10rem" />
            <br />
            <SkeletonText width="13rem" />
          </>
        ) : shown && shownState !== null ? (
          <>
            <span className="block truncate" data-testid="heatmap-readout">
              <StateSwatch state={shownState as SunStateCode} className="mr-1.5 translate-y-px" />
              {stateShort(shownState, blockerAt(grid, horizon, shown.dayIndex, shown.slot))}
            </span>
            <span className="block truncate" data-testid="heatmap-day-total">
              {formatDuration(sunOf(shown.dayIndex))} of direct sun that day
            </span>
          </>
        ) : (
          "Tap the chart to pick a date and time"
        )
      }
      detailLines={2}
      busy={!ready}
    >
      <div
        ref={sizeRef}
        className="relative mt-3 h-[272px] rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent @2xl:h-[340px]"
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
              <ClockShiftMarks
                geometry={geometry}
                shifts={model.clockShifts}
                avoid={
                  selectedDay !== null ? flagSpan(geometry, selectedDay, formatDate(date)) : null
                }
              />
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
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={(event) => {
                if (!isFingerPointer(event)) {
                  gesture.current = IDLE_GESTURE;
                  setHover(null);
                }
              }}
            />
            {/* With a mouse the reading also floats beside the pointer; a finger would cover it. */}
            {hover && hover.floating && (
              <ChartTooltip
                x={hover.x}
                y={hover.y}
                containerWidth={size.width}
                containerHeight={size.height}
              >
                <div className="font-semibold text-ink tabular-nums">
                  {formatDate(year.days[hover.dayIndex].date, { weekday: true })} {"\u00b7"}{" "}
                  {formatClock(hover.minute, hour12)}
                </div>
                <div className="mt-1 flex items-start gap-1.5 text-ink">
                  <StateSwatch
                    state={
                      year.state[hover.dayIndex * year.slotsPerDay + hover.slot] as SunStateCode
                    }
                    className="mt-0.5"
                  />
                  <span>
                    {statePhrase(
                      year.state[hover.dayIndex * year.slotsPerDay + hover.slot],
                      blockerAt(grid, horizon, hover.dayIndex, hover.slot),
                    )}
                  </span>
                </div>
                <div className="mt-1 tabular-nums">
                  <strong className="font-semibold text-ink">
                    {formatDuration(sunOf(hover.dayIndex))}
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
            }. ${formatDuration(sunOf(selectedDay))} of direct sun that day.`
          : ""}
      </p>

      <StateLegend
        states={legendStates(observer)}
        labels={{ [SunState.Blocked]: blockedLabel(hasTerrain) }}
        className="mt-3"
      />

      {/* Always the same height, so the card does not grow when the analysis arrives. */}
      <p className="mt-3 min-h-12 text-xs/4 text-ink-3 @md:min-h-8">
        Each column is a day, with morning at the top. {model && clockShiftNote(model.clockShifts)}
      </p>

      <div className="mt-1">
        <button
          type="button"
          className="-mx-1 inline-flex min-h-11 cursor-pointer items-center rounded px-1 text-xs font-medium text-ink-2 underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
    </ReportCard>
  );
}

/** The skyline's blocker in the sun's direction at a grid cell, if both are known. */
function blockerAt(
  grid: SunYearGrid | null,
  horizon: HorizonProfile | null,
  dayIndex: number,
  slot: number,
): number | undefined {
  if (!grid || !horizon) return undefined;
  const bin = horizonBinFor(horizon, grid.azimuthDeg[dayIndex * grid.slotsPerDay + slot]);
  return bin < 0 ? undefined : horizon.blockerIndex[bin];
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
  bitmap: HeatmapBitmap;
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
      // Repaint the previous bitmap's canvases in place: a new analysis can
      // arrive many times a second, and canvas memory is a hard budget on iOS.
      const bitmap = createHeatmapBitmap(pixels, entry?.bitmap ?? null);
      // No context to be had: keep the frame that is on screen.
      if (!bitmap) return;
      entry = { year, startMinute, endMinute, colorsKey: colors.key, bitmap };
      cache.current = entry;
    }
    drawHeatmapBase(canvas, entry.bitmap, width, height, pixelRatio, colors.hatch);
  }, [year, startMinute, endMinute, width, height, pixelRatio, scheme]);

  // Hand the canvas memory back as soon as the chart goes away.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      releaseHeatmapBitmap(cache.current?.bitmap ?? null);
      cache.current = null;
      releaseHeatmapScratch();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

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
    <g fontSize="12" fontWeight="500">
      {timeAxisTicks(model.range).map((minute) => {
        const y = Math.round(minuteY(geometry, minute)) + 0.5;
        return (
          <g key={minute}>
            <line x1={geometry.x} x2={right} y1={y} y2={y} stroke="var(--report-heat-grid)" />
            <text x={geometry.x - 6} y={y} dy="0.32em" textAnchor="end" className="fill-ink-2">
              {formatHourTick(minute, hour12)}
            </text>
          </g>
        );
      })}
      {model.months.map((month) => {
        const x = Math.round(dayX(geometry, month.startDay)) + 0.5;
        return (
          <g key={month.month}>
            {month.month > 0 && month.month % 3 === 0 && (
              <line x1={x} x2={x} y1={geometry.y} y2={bottom} stroke="var(--report-heat-grid)" />
            )}
            <text
              x={dayX(geometry, month.startDay + month.dayCount / 2)}
              y={bottom + 15}
              textAnchor="middle"
              className="fill-ink-2"
            >
              {monthWidth >= 26 ? month.label : month.label.charAt(0)}
            </text>
          </g>
        );
      })}
      {/* A hairline frame: the night at the edges must not melt into a dark card. */}
      <rect
        x={geometry.x + 0.5}
        y={geometry.y + 0.5}
        width={Math.max(0, geometry.width - 1)}
        height={Math.max(0, geometry.height - 1)}
        rx={3}
        fill="none"
        stroke="var(--report-axis)"
      />
    </g>
  );
}

/** Horizontal extent of the selected-date flag above the plot. */
function flagSpan(geometry: HeatmapGeometry, dayIndex: number, label: string) {
  const half = (label.length * 7) / 2;
  const right = geometry.x + geometry.width;
  const center = Math.min(
    Math.max(dayCenterX(geometry, dayIndex), geometry.x + half),
    right - half,
  );
  return { center, x0: center - half, x1: center + half };
}

function ClockShiftMarks({
  geometry,
  shifts,
  avoid,
}: {
  geometry: HeatmapGeometry;
  shifts: readonly ClockShift[];
  /** Span taken by the selected-date flag: marks under it are left out. */
  avoid: { x0: number; x1: number } | null;
}) {
  return (
    <g className="fill-ink-3">
      {shifts.map((shift) => {
        const x = dayX(geometry, shift.dayIndex);
        const y = geometry.y - 2;
        if (avoid && x + 5 > avoid.x0 && x - 5 < avoid.x1) return null;
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
  const inRange = minute >= geometry.startMinute && minute <= geometry.endMinute;
  const y = minuteY(geometry, minute);
  const labelX = flagSpan(geometry, dayIndex, label).center;
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
        fontSize="12"
        fontWeight="600"
        textAnchor="middle"
        className="report-halo fill-ink"
      >
        {label}
      </text>
    </g>
  );
}
