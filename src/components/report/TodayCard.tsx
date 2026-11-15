import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { SunState, type DayAnalysis, type Observer, type SunStateCode } from "@/lib/types";

import {
  formatClock,
  formatDate,
  formatDuration,
  formatHourTick,
  formatPercent,
  formatRangeList,
} from "./format";
import { useElementSize } from "./hooks";
import {
  ReportCard,
  SkeletonBlock,
  SkeletonText,
  StateRect,
  StateSwatch,
  ValueUnit,
  useReport,
} from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import { blockedLabel, legendStates, stateMeta } from "./states";
import { stateRuns, type StateRun } from "./summary";

interface TodayCardProps {
  date: string;
  minuteOfDay: number;
  day: DayAnalysis | null;
  observer: Observer;
  hasTerrain: boolean;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

export interface DayLegendRow {
  state: SunStateCode;
  label: string;
  /** Clock ranges, e.g. "9:10 AM – 12:40 PM, 3:00 PM – 4:40 PM"; "" when the state never occurs. */
  ranges: string;
  minutes: number;
}

/**
 * The legend of the day bar, which is also the day's timetable: one row per
 * state with its clock ranges and its total. Direct sun is always listed
 * (even when there is none); other states only when they occur.
 */
export function dayLegendRows(
  runs: readonly StateRun[],
  observer: Pick<Observer, "mode" | "fovDeg">,
  hour12: boolean,
  hasTerrain = false,
): DayLegendRow[] {
  const rows: DayLegendRow[] = [];
  for (const state of legendStates(observer)) {
    const own = runs.filter((run) => run.state === state);
    const minutes = own.reduce((sum, run) => sum + (run.endMinute - run.startMinute), 0);
    if (minutes === 0 && state !== SunState.Sun) continue;
    rows.push({
      state,
      label: state === SunState.Blocked ? blockedLabel(hasTerrain) : stateMeta(state).label,
      ranges: formatRangeList(own, hour12, { openEnded: state === SunState.Night }),
      minutes,
    });
  }
  return rows;
}

/**
 * The selected day: how much direct sun, a 24-hour bar of sun / shade / night,
 * and the clock ranges of each. The app's time bar owns scrubbing; this bar is
 * the detailed picture — it still takes a tap, a drag and the arrow keys.
 */
export function TodayCard({
  date,
  minuteOfDay,
  day,
  observer,
  hasTerrain,
  onSelectDateTime,
}: TodayCardProps) {
  const { hour12 } = useReport();
  const [probe, setProbe] = useState<number | null>(null);
  // A day analysis for another date is stale: keep the frame, dim the numbers.
  const stale = day !== null && day.date !== date;

  const runs = useMemo(() => {
    if (!day) return [];
    const states = day.samples.map((sample) => sample.state);
    const minutes = day.samples.map((sample) => sample.minute);
    return stateRuns(states, day.stepMinutes, minutes);
  }, [day]);
  const rows = useMemo(
    () => (day ? dayLegendRows(runs, observer, hour12, hasTerrain) : []),
    [day, runs, observer, hour12, hasTerrain],
  );

  const probed =
    probe !== null ? runs.find((run) => probe >= run.startMinute && probe < run.endMinute) : null;

  let value;
  let detail;
  if (!day) {
    value = <SkeletonText width="9rem" />;
    detail = <SkeletonText width="12rem" />;
  } else if (probe !== null) {
    value = formatClock(probe, hour12);
    detail = stateText(probed?.state ?? SunState.Night, hasTerrain);
  } else {
    value = (
      <>
        {formatDuration(day.sunMinutes)}
        <ValueUnit>of direct sun</ValueUnit>
      </>
    );
    detail =
      day.daylightMinutes > 0
        ? `${formatPercent(day.sunMinutes / day.daylightMinutes)} of the day’s ${formatDuration(day.daylightMinutes)} of daylight`
        : "The sun does not rise on this day";
  }

  return (
    <ReportCard
      id={REPORT_SECTION_IDS.today}
      title={formatDate(date, { weekday: true })}
      aside="Selected day"
      value={value}
      detail={detail}
      busy={!day}
    >
      <div className={stale ? "opacity-60" : undefined}>
        <DayBar
          date={date}
          minuteOfDay={minuteOfDay}
          day={day}
          runs={runs}
          onProbe={setProbe}
          onSelectDateTime={onSelectDateTime}
        />

        <ul className="mt-3 flex min-h-[96px] flex-col gap-2" aria-label="Times of each state">
          {!day
            ? [0, 1, 2].map((i) => (
                <li key={i} className="text-sm/5">
                  <SkeletonText width={i === 0 ? "70%" : "85%"} />
                </li>
              ))
            : rows.map((row) => (
                <li
                  key={row.state}
                  className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-sm/5"
                >
                  <StateSwatch state={row.state} className="translate-y-px self-start mt-1" />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{row.label}</span>{" "}
                    <span className="text-ink-2 tabular-nums">
                      {row.minutes === 0 ? "none on this day" : row.ranges}
                    </span>
                  </span>
                  <span className="font-medium whitespace-nowrap text-ink tabular-nums">
                    {row.state === SunState.Night ? "" : formatDuration(row.minutes)}
                  </span>
                </li>
              ))}
        </ul>
      </div>
    </ReportCard>
  );
}

function stateText(state: number, hasTerrain: boolean): string {
  if (state === SunState.Blocked)
    return hasTerrain ? "Shaded by a building or a hill" : "Shaded by a building";
  if (state === SunState.Night) return "Sun below the horizon";
  if (state === SunState.OutOfView) return "Sun outside the view";
  return "In direct sun";
}

// ─── 24-hour bar ───────────────────────────────────────────────────────────

const BAR_TOP = 6;
const BAR_HEIGHT = 28;
const BAR_SVG_HEIGHT = 56;
const SNAP_MINUTES = 5;

interface DayBarProps {
  date: string;
  minuteOfDay: number;
  day: DayAnalysis | null;
  runs: StateRun[];
  onProbe: (minute: number | null) => void;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

function DayBar({ date, minuteOfDay, day, runs, onProbe, onSelectDateTime }: DayBarProps) {
  const { hour12 } = useReport();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const clipId = `clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dragging = useRef(false);

  const width = size?.width ?? 0;
  const xOf = (minute: number) => (minute / 1440) * width;

  const minuteAt = (clientX: number, element: HTMLElement): number => {
    const rect = element.getBoundingClientRect();
    const fraction = width > 0 ? (clientX - rect.left) / width : 0;
    const minute = Math.round((fraction * 1440) / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(1439, Math.max(0, minute));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const minute = minuteAt(event.clientX, event.currentTarget);
    onProbe(minute);
    onSelectDateTime(date, minute);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const minute = minuteAt(event.clientX, event.currentTarget);
    if (dragging.current) {
      onProbe(minute);
      if (minute !== minuteOfDay) onSelectDateTime(date, minute);
    } else if (event.pointerType === "mouse") {
      onProbe(minute);
    }
  };
  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.pointerType !== "mouse") onProbe(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 60 : SNAP_MINUTES;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = minuteOfDay - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = minuteOfDay + step;
    else if (event.key === "PageDown") next = minuteOfDay - 60;
    else if (event.key === "PageUp") next = minuteOfDay + 60;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1439;
    if (next === null) return;
    event.preventDefault();
    onSelectDateTime(date, Math.min(1439, Math.max(0, next)));
  };

  const state = day
    ? (runs.find((run) => minuteOfDay >= run.startMinute && minuteOfDay < run.endMinute)?.state ??
      SunState.Night)
    : null;
  const clock = formatClock(minuteOfDay, hour12);
  const ready = day !== null && width > 0;

  return (
    <div
      ref={ref}
      className="relative mt-3 cursor-pointer touch-pan-y rounded-md outline-offset-4 select-none focus-visible:outline-2 focus-visible:outline-accent"
      style={{ height: BAR_SVG_HEIGHT }}
      role="slider"
      tabIndex={0}
      aria-label="Time of day on the selected date"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={1439}
      aria-valuenow={Math.round(minuteOfDay)}
      aria-valuetext={state === null ? clock : `${clock}, ${stateMeta(state).phrase}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerLeave={() => {
        if (!dragging.current) onProbe(null);
      }}
      onKeyDown={onKeyDown}
    >
      {!ready ? (
        <div className="absolute inset-x-0" style={{ top: BAR_TOP, height: BAR_HEIGHT }}>
          <SkeletonBlock className="h-full" />
        </div>
      ) : (
        <svg
          width={width}
          height={BAR_SVG_HEIGHT}
          className="block overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={BAR_TOP} width={width} height={BAR_HEIGHT} rx={6} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <rect x={0} y={BAR_TOP} width={width} height={BAR_HEIGHT} fill="var(--state-night)" />
            {runs.map(
              (run) =>
                run.state !== SunState.Night && (
                  <StateRect
                    key={run.startMinute}
                    state={run.state}
                    x={xOf(run.startMinute)}
                    y={BAR_TOP}
                    width={xOf(run.endMinute) - xOf(run.startMinute)}
                    height={BAR_HEIGHT}
                  />
                ),
            )}
            {/* The darker edge that keeps sun legible against a light card. */}
            {runs.map(
              (run) =>
                run.state === SunState.Sun && (
                  <rect
                    key={run.startMinute}
                    x={xOf(run.startMinute) + 0.5}
                    y={BAR_TOP + 0.5}
                    width={Math.max(0, xOf(run.endMinute) - xOf(run.startMinute) - 1)}
                    height={BAR_HEIGHT - 1}
                    fill="none"
                    stroke="var(--report-sun-line)"
                  />
                ),
            )}
          </g>
          <rect
            x={0.5}
            y={BAR_TOP + 0.5}
            width={Math.max(0, width - 1)}
            height={BAR_HEIGHT - 1}
            rx={5.5}
            fill="none"
            stroke="var(--report-axis)"
          />

          {/* Four ticks, the same as every other time axis in the report. */}
          {[0, 6, 12, 18].map((hour) => {
            const x = xOf(hour * 60);
            return (
              <g key={hour}>
                <line
                  x1={Math.max(0.5, x)}
                  x2={Math.max(0.5, x)}
                  y1={BAR_TOP + BAR_HEIGHT + 3}
                  y2={BAR_TOP + BAR_HEIGHT + 7}
                  stroke="var(--report-axis)"
                />
                <text
                  x={x}
                  y={BAR_SVG_HEIGHT - 1}
                  fontSize="12"
                  fontWeight="500"
                  textAnchor={hour === 0 ? "start" : "middle"}
                  className="fill-ink-2"
                >
                  {formatHourTick(hour * 60, hour12)}
                </text>
              </g>
            );
          })}

          <TimeNeedle x={xOf(minuteOfDay)} />
        </svg>
      )}
    </div>
  );
}

/** The selected time: a slim needle, not a second slider thumb. */
function TimeNeedle({ x }: { x: number }) {
  return (
    <g data-testid="time-marker" transform={`translate(${x} 0)`}>
      <line
        y1={BAR_TOP - 4}
        y2={BAR_TOP + BAR_HEIGHT + 3}
        stroke="var(--report-marker-halo)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <line
        y1={BAR_TOP - 4}
        y2={BAR_TOP + BAR_HEIGHT + 3}
        stroke="var(--report-marker)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}
