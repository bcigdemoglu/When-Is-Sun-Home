import { useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { Card } from "@/components/ui/Card";
import { SunState, type DayAnalysis, type Observer, type SunInstant } from "@/lib/types";

import {
  compassWords,
  formatAngle,
  formatClock,
  formatClockRange,
  formatDate,
  formatDuration,
  formatHourTick,
  formatPercent,
} from "./format";
import { useElementSize } from "./hooks";
import { SkeletonBlock, SkeletonText, StateRect, StateSwatch, useReport } from "./parts";
import { describeInstant } from "./states";
import { stateRuns } from "./summary";

interface DayPanelProps {
  date: string;
  minuteOfDay: number;
  day: DayAnalysis | null;
  instant: SunInstant | null;
  observer: Observer;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

/** Room for the figure and its sentence on two lines when the card is narrow. */
const HERO_LINE =
  "flex min-h-[50px] flex-wrap content-start items-baseline gap-x-2 @md:min-h-[30px]";

/** The selected date: how much sun, when exactly, and what is happening right now. */
export function DayPanel({
  date,
  minuteOfDay,
  day,
  instant,
  observer,
  onSelectDateTime,
}: DayPanelProps) {
  const { hour12 } = useReport();
  // A day analysis for another date is stale: keep the frame, dim the numbers.
  const stale = day !== null && day.date !== date;

  return (
    <Card title="Selected day" aside={formatDate(date, { weekday: true, year: true })}>
      <div aria-busy={!day} className={stale ? "opacity-60" : undefined}>
        {day ? (
          <p className={HERO_LINE}>
            <span className="text-2xl leading-tight font-semibold text-ink">
              {formatDuration(day.sunMinutes)}
            </span>
            <span className="text-sm text-ink-2">
              of direct sun, out of {formatDuration(day.daylightMinutes)} of daylight
              {day.daylightMinutes > 0 &&
                ` (${formatPercent(day.sunMinutes / day.daylightMinutes)})`}
            </span>
          </p>
        ) : (
          <p className={HERO_LINE}>
            <SkeletonText width="6rem" className="text-2xl leading-tight" />
            <SkeletonText width="13rem" className="text-sm" />
          </p>
        )}

        <DayTimeline
          date={date}
          minuteOfDay={minuteOfDay}
          day={day}
          statusText={instant ? describeInstant(instant, observer) : ""}
          onSelectDateTime={onSelectDateTime}
        />

        <p className="mt-2 flex min-h-10 items-start gap-2 text-sm @lg:min-h-5" aria-live="polite">
          {instant ? (
            <>
              <StateSwatch state={instant.state} className="mt-1" />
              <span>
                <strong className="font-semibold text-ink tabular-nums">
                  {formatClock(minuteOfDay, hour12)}
                </strong>
                <span className="text-ink-2"> {"—"} </span>
                <span className="text-ink">{describeInstant(instant, observer)}</span>
                {instant.state !== SunState.Night && Number.isFinite(instant.altitudeDeg) && (
                  <span className="text-ink-3">
                    {" "}
                    {"·"} sun {formatAngle(instant.altitudeDeg)} up, to the{" "}
                    {compassWords(instant.azimuthDeg)}
                  </span>
                )}
              </span>
            </>
          ) : (
            <SkeletonText width="15rem" />
          )}
        </p>

        <SunWindows day={day} />
      </div>
    </Card>
  );
}

// ─── Sun windows ───────────────────────────────────────────────────────────

function SunWindows({ day }: { day: DayAnalysis | null }) {
  const { hour12 } = useReport();
  return (
    <section className="mt-3 border-t border-line pt-3" aria-label="Times of direct sun">
      <h3 className="text-xs text-ink-3">Direct sun on this day</h3>
      <div className="mt-1.5 min-h-12">
        {!day ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <SkeletonText width="14rem" />
            <SkeletonText width="12rem" />
          </div>
        ) : day.windows.length === 0 ? (
          <p className="text-sm text-ink-2">
            {day.daylightMinutes === 0
              ? "No direct sun — the sun does not rise on this day."
              : "No direct sun — the sun is up, but never reaches this spot."}
          </p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1 text-sm @lg:grid-cols-2">
            {day.windows.map((window) => (
              <li
                key={window.startMinute}
                className="flex items-baseline justify-between gap-3 tabular-nums"
              >
                <span className="text-ink">
                  {window.startMinute <= 0 && window.endMinute >= 1440
                    ? "All day"
                    : formatClockRange(window.startMinute, window.endMinute, hour12)}
                </span>
                <span className="text-ink-2">
                  {formatDuration(window.endMinute - window.startMinute)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ─── 24-hour timeline ──────────────────────────────────────────────────────

const TIMELINE_HEIGHT = 64;
const PAD_X = 7;
const BAR_Y = 17;
const BAR_HEIGHT = 26;
const SNAP_MINUTES = 5;
/** Rough width of a 10px label, for keeping the sunrise/sunset labels inside. */
const CHAR_WIDTH = 5.6;

interface DayTimelineProps {
  date: string;
  minuteOfDay: number;
  day: DayAnalysis | null;
  statusText: string;
  onSelectDateTime: (date: string, minuteOfDay?: number) => void;
}

function DayTimeline({ date, minuteOfDay, day, statusText, onSelectDateTime }: DayTimelineProps) {
  const { hour12 } = useReport();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const clipId = `clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dragging = useRef(false);

  const runs = useMemo(() => {
    if (!day) return [];
    const states = day.samples.map((sample) => sample.state);
    const minutes = day.samples.map((sample) => sample.minute);
    return stateRuns(states, day.stepMinutes, minutes);
  }, [day]);

  const width = size?.width ?? 0;
  const innerWidth = Math.max(0, width - 2 * PAD_X);
  const xOf = (minute: number) => PAD_X + (minute / 1440) * innerWidth;

  const minuteAt = (clientX: number, element: HTMLElement): number => {
    const rect = element.getBoundingClientRect();
    const fraction = innerWidth > 0 ? (clientX - rect.left - PAD_X) / innerWidth : 0;
    const minute = Math.round((fraction * 1440) / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(1439, Math.max(0, minute));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectDateTime(date, minuteAt(event.clientX, event.currentTarget));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const minute = minuteAt(event.clientX, event.currentTarget);
    if (minute !== minuteOfDay) onSelectDateTime(date, minute);
  };
  const stopDragging = () => {
    dragging.current = false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = event.shiftKey ? 60 : SNAP_MINUTES;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = minuteOfDay - big;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = minuteOfDay + big;
    else if (event.key === "PageDown") next = minuteOfDay - 60;
    else if (event.key === "PageUp") next = minuteOfDay + 60;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1439;
    if (next === null) return;
    event.preventDefault();
    onSelectDateTime(date, Math.min(1439, Math.max(0, next)));
  };

  const clock = formatClock(minuteOfDay, hour12);
  const ready = day !== null && width > 0;

  return (
    <div
      ref={ref}
      className="relative mt-3 cursor-ew-resize touch-pan-y rounded-md outline-offset-4 select-none focus-visible:outline-2 focus-visible:outline-accent"
      style={{ height: TIMELINE_HEIGHT }}
      role="slider"
      tabIndex={0}
      aria-label="Time of day on the selected date"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={1439}
      aria-valuenow={Math.round(minuteOfDay)}
      aria-valuetext={statusText ? `${clock}, ${statusText}` : clock}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={onKeyDown}
    >
      {!ready ? (
        <div className="absolute inset-x-0" style={{ top: BAR_Y, height: BAR_HEIGHT }}>
          <SkeletonBlock className="h-full" />
        </div>
      ) : (
        <svg width={width} height={TIMELINE_HEIGHT} className="block" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD_X} y={BAR_Y} width={innerWidth} height={BAR_HEIGHT} rx={6} />
            </clipPath>
          </defs>

          <g clipPath={`url(#${clipId})`}>
            <rect
              x={PAD_X}
              y={BAR_Y}
              width={innerWidth}
              height={BAR_HEIGHT}
              fill="var(--state-night)"
            />
            {runs.map(
              (run) =>
                run.state !== SunState.Night && (
                  <StateRect
                    key={run.startMinute}
                    state={run.state}
                    x={xOf(run.startMinute)}
                    y={BAR_Y}
                    width={xOf(run.endMinute) - xOf(run.startMinute)}
                    height={BAR_HEIGHT}
                  />
                ),
            )}
          </g>

          <SunEventLabels day={day} width={width} xOf={xOf} />

          {/* Hour ticks and labels. */}
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => {
            const x = xOf(hour * 60);
            const major = hour % 6 === 0;
            return (
              <g key={hour}>
                <line
                  x1={x}
                  x2={x}
                  y1={BAR_Y + BAR_HEIGHT + 2}
                  y2={BAR_Y + BAR_HEIGHT + (major ? 6 : 4)}
                  stroke="var(--report-axis)"
                />
                {major && (
                  <text
                    x={x}
                    y={TIMELINE_HEIGHT - 3}
                    fontSize="10"
                    textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}
                    dx={hour === 0 ? -PAD_X : hour === 24 ? PAD_X : 0}
                    className="fill-ink-3"
                  >
                    {formatHourTick(hour * 60, hour12)}
                  </text>
                )}
              </g>
            );
          })}

          <TimeMarker x={xOf(minuteOfDay)} />
        </svg>
      )}
    </div>
  );
}

function SunEventLabels({
  day,
  width,
  xOf,
}: {
  day: DayAnalysis;
  width: number;
  xOf: (minute: number) => number;
}) {
  const { hour12 } = useReport();
  const events = [
    { key: "sunrise", minute: day.sunriseMinute, word: "Sunrise", preferEnd: true },
    { key: "sunset", minute: day.sunsetMinute, word: "Sunset", preferEnd: false },
  ];
  return (
    <>
      {events.map((event) => {
        if (event.minute === null) return null;
        const x = xOf(event.minute);
        const text = `${event.word} ${formatClock(event.minute, hour12)}`;
        const textWidth = text.length * CHAR_WIDTH + 4;
        // Sunrise reads leftwards from its tick and sunset rightwards, so the
        // two never collide — unless that would run off the edge.
        const anchorEnd = event.preferEnd ? x - textWidth >= 0 : x + textWidth > width;
        return (
          <g key={event.key}>
            <line x1={x} x2={x} y1={BAR_Y - 5} y2={BAR_Y - 1} stroke="var(--ink-3)" />
            <text
              x={anchorEnd ? x - 4 : x + 4}
              y={BAR_Y - 6}
              fontSize="10"
              textAnchor={anchorEnd ? "end" : "start"}
              className="fill-ink-2"
            >
              {text}
            </text>
          </g>
        );
      })}
    </>
  );
}

/** The draggable "now" marker: a thumb straddling the bar. */
function TimeMarker({ x }: { x: number }) {
  return (
    <g data-testid="time-marker" transform={`translate(${x} 0)`}>
      <rect
        x={-3.5}
        y={BAR_Y - 4}
        width={7}
        height={BAR_HEIGHT + 8}
        rx={3.5}
        fill="var(--report-marker-halo)"
        stroke="var(--report-marker)"
        strokeWidth={1.5}
      />
    </g>
  );
}
