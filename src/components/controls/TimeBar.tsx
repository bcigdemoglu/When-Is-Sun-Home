"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatClock, formatShortDate } from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  ShadeIcon,
  SunIcon,
} from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import type { PlayMode } from "@/hooks/playback";
import { usePlayback } from "@/hooks/usePlayback";
import { addDays } from "@/lib/analysis";
import { SunState, type SunStateCode } from "@/lib/types";
import { SETTINGS_LIMITS, isValidIsoDate, useSettings } from "@/state";
import { minuteRatio, thumbLeft, type KeyDates } from "./dayMenu";
import { THUMB_PX } from "./dayTrack";

const PLAY_MODES: readonly { value: PlayMode; label: string }[] = [
  { value: "day", label: "Through the day" },
  { value: "year", label: "Through the year" },
];

/** How long the readout lingers after the last keyboard step, ms. */
const READOUT_LINGER_MS = 1200;

/** What the sun is doing, as an icon and a word (never colour alone). */
export function sunStateLabel(state: SunStateCode | null): { text: string; tone: string } {
  switch (state) {
    case SunState.Sun:
      return { text: "In sun", tone: "sun" };
    case SunState.Blocked:
      return { text: "In shade", tone: "shade" };
    case SunState.OutOfView:
      return { text: "Sun out of view", tone: "out" };
    case SunState.Night:
      return { text: "Night", tone: "night" };
    default:
      return { text: "", tone: "none" };
  }
}

function StateIcon({ state }: { state: SunStateCode | null }) {
  if (state === SunState.Sun)
    return <SunIcon className="text-accent-fill" width={18} height={18} />;
  if (state === SunState.Night) return <MoonIcon width={18} height={18} />;
  if (state === null) return null;
  return <ShadeIcon width={18} height={18} />;
}

export interface TimeBarProps {
  /** "docked": full width along the bottom edge (phones). "floating": a card over the map. */
  variant: "docked" | "floating";
  /** The place's zone in words ("Los Angeles time (PDT, UTC−7)") and its short name ("PDT"). */
  zoneLabel: string;
  zone: string;
  date: string;
  minuteOfDay: number;
  /** True while date and time follow the clock. */
  isLive: boolean;
  /** Today's date and the current minute at the place (for "Today" and the now tick). */
  today: string | null;
  nowMinute: number | null;
  /** CSS background for the slider's track: the day's sun / shade strip (see `dayTrack.ts`). */
  track: string | undefined;
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  /** What the sun is doing at the selected moment. */
  sunState: SunStateCode | null;
  /** Shortcuts for the day menu, once the year is known. */
  keyDates: KeyDates | null;
  className?: string;
}

/**
 * The time bar: which day, what time, play. The slider's track is the answer
 * for the day — sun, shade and night along the clock — so the thumb is dragged
 * along it, and a readout above the thumb says what the sun is doing there.
 */
export function TimeBar({
  variant,
  zoneLabel,
  zone,
  date,
  minuteOfDay,
  isLive,
  today,
  nowMinute,
  track,
  sunriseMinute,
  sunsetMinute,
  sunState,
  keyDates,
  className = "",
}: TimeBarProps) {
  const setDate = useSettings((s) => s.setDate);
  const setMinuteOfDay = useSettings((s) => s.setMinuteOfDay);
  const resetToNow = useSettings((s) => s.resetToNow);

  const playback = usePlayback({ date, minuteOfDay, sunriseMinute, sunsetMinute });
  const pause = playback.pause;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // What is being typed into the date field; null = show the selected date.
  const [dateDraft, setDateDraft] = useState<string | null>(null);

  // The readout shows while the thumb is held, and lingers after a key press.
  const [held, setHeld] = useState(false);
  const [lingering, setLingering] = useState(false);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    },
    [],
  );
  const linger = () => {
    setLingering(true);
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = setTimeout(() => setLingering(false), READOUT_LINGER_MS);
  };
  const scrubbing = held || lingering;

  const isToday = today !== null && date === today;
  const dayLabel = isToday
    ? "Today"
    : formatShortDate(date, today !== null && date.slice(0, 4) !== today.slice(0, 4));
  const clock = formatClock(minuteOfDay);
  const state = sunStateLabel(sunState);
  const ratio = minuteRatio(minuteOfDay);

  const pickDate = (next: string | null) => {
    pause();
    if (next === null || isValidIsoDate(next)) setDate(next);
  };
  const shiftDay = (days: number) => pickDate(addDays(date, days));
  const choose = (next: string | null) => {
    pickDate(next);
    setMenuOpen(false);
  };

  const ticks: { key: string; minute: number; className: string }[] = [];
  if (sunriseMinute !== null) {
    ticks.push({ key: "rise", minute: sunriseMinute, className: "h-2 w-px bg-ink-2" });
  }
  if (sunsetMinute !== null) {
    ticks.push({ key: "set", minute: sunsetMinute, className: "h-2 w-px bg-ink-2" });
  }

  const docked = variant === "docked";
  const menuRows: { label: string; detail: string; date: string | null; current: boolean }[] = [
    { label: "Today", detail: today ? formatShortDate(today) : "", date: null, current: isToday },
  ];
  if (keyDates) {
    menuRows.push(
      { label: "Longest day", detail: "", date: keyDates.longest, current: false },
      { label: "Shortest day", detail: "", date: keyDates.shortest, current: false },
      { label: "March equinox", detail: "", date: keyDates.marchEquinox, current: false },
      { label: "September equinox", detail: "", date: keyDates.septemberEquinox, current: false },
    );
    for (const row of menuRows) {
      if (row.date !== null) {
        row.detail = formatShortDate(row.date);
        row.current = row.date === date;
      }
    }
  }

  return (
    <section
      aria-label="Date and time"
      className={`${
        docked
          ? "border-t border-line bg-surface pb-[var(--safe-bottom)]"
          : "rounded-card border border-line bg-surface shadow-float"
      } ${className}`}
    >
      <div
        className={`relative flex h-16 items-center ${
          docked
            ? "gap-1.5 pr-[max(0.75rem,var(--safe-right))] pl-[max(0.5rem,var(--safe-left))]"
            : "gap-2 px-3"
        }`}
      >
        {!docked && (
          <Button variant="ghost" iconOnly aria-label="Previous day" onClick={() => shiftDay(-1)}>
            <ChevronLeftIcon />
          </Button>
        )}
        <button
          ref={menuButtonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-label={`${dayLabel}, ${clock} ${zone}. Change the day`}
          className={`flex h-12 shrink-0 flex-col items-start justify-center rounded-xl px-2 text-left hover:bg-surface-2 ${
            docked ? "min-w-[5.5rem]" : "min-w-[7rem]"
          }`}
          onClick={() => setMenuOpen(true)}
        >
          <span className="type-label flex items-center gap-0.5 text-ink-2">
            {dayLabel}
            <ChevronDownIcon width={14} height={14} />
          </span>
          <span className="text-[17px] leading-[22px] font-semibold text-ink tabular-nums">
            {clock}
          </span>
        </button>
        {!docked && (
          <Button variant="ghost" iconOnly aria-label="Next day" onClick={() => shiftDay(1)}>
            <ChevronRightIcon />
          </Button>
        )}

        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor="time-of-day">
            Time of day
          </label>
          <input
            id="time-of-day"
            type="range"
            className="range"
            style={
              {
                "--range-track": track,
                "--range-track-h": "12px",
                "--range-thumb": `${THUMB_PX}px`,
              } as CSSProperties
            }
            min={SETTINGS_LIMITS.minuteOfDay.min}
            max={SETTINGS_LIMITS.minuteOfDay.max}
            step={1}
            value={minuteOfDay}
            aria-valuetext={`${clock} ${zone}${state.text ? `, ${state.text.toLowerCase()}` : ""}`.trim()}
            onPointerDown={() => {
              pause();
              setHeld(true);
            }}
            onPointerUp={() => setHeld(false)}
            onPointerCancel={() => setHeld(false)}
            onBlur={() => setHeld(false)}
            onKeyDown={() => {
              pause();
              linger();
            }}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) setMinuteOfDay(next);
            }}
          />
          {/* Sunrise and sunset: hairline ticks under the track. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2">
            {ticks.map((tick) => (
              <span
                key={tick.key}
                className={`absolute top-2.5 -translate-x-1/2 ${tick.className}`}
                style={{ left: thumbLeft(minuteRatio(tick.minute), THUMB_PX) }}
              />
            ))}
            {isToday && nowMinute !== null && (
              <span
                className="absolute -top-3.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent"
                style={{ left: thumbLeft(minuteRatio(nowMinute), THUMB_PX) }}
              />
            )}
          </div>
          {scrubbing && (
            <output
              htmlFor="time-of-day"
              className="pointer-events-none absolute bottom-full mb-2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-surface shadow-float"
              style={{
                left: `clamp(2.5rem, ${thumbLeft(ratio, THUMB_PX)}, calc(100% - 2.5rem))`,
              }}
            >
              <span className="text-xl leading-7 font-semibold whitespace-nowrap tabular-nums">
                {clock}
              </span>
              {state.text && (
                <span className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                  <StateIcon state={sunState} />
                  {state.text}
                </span>
              )}
            </output>
          )}
        </div>

        {!isLive && !held && (
          <Button
            variant="ghost"
            iconOnly
            aria-label="Back to now"
            title="Back to now"
            onClick={() => {
              pause();
              resetToNow();
            }}
          >
            <ResetIcon />
          </Button>
        )}
        <Button
          variant="primary"
          iconOnly
          aria-label={
            playback.playing
              ? "Pause"
              : playback.mode === "day"
                ? "Play the day, sunrise to sunset"
                : "Play through the year"
          }
          onClick={playback.toggle}
        >
          {playback.playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
      </div>

      <Dialog
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          setDateDraft(null);
        }}
        title="Day"
        variant="menu"
        anchorRef={menuButtonRef}
      >
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-1">
          <Button variant="ghost" iconOnly aria-label="Previous day" onClick={() => shiftDay(-1)}>
            <ChevronLeftIcon />
          </Button>
          <span className="type-card-title text-ink tabular-nums" aria-live="polite">
            {formatShortDate(date, true)}
          </span>
          <Button variant="ghost" iconOnly aria-label="Next day" onClick={() => shiftDay(1)}>
            <ChevronRightIcon />
          </Button>
        </div>

        <ul className="mt-2">
          {!isLive && (
            <li>
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
                onClick={() => {
                  pause();
                  resetToNow();
                  setMenuOpen(false);
                }}
              >
                <span className="type-body flex items-center gap-2 font-medium text-accent">
                  <ResetIcon />
                  Back to now
                </span>
                <span className="type-label text-ink-2 tabular-nums">
                  {nowMinute !== null ? formatClock(nowMinute) : ""}
                </span>
              </button>
            </li>
          )}
          {menuRows.map((row) => (
            <li key={row.label}>
              <button
                type="button"
                aria-current={row.current ? "date" : undefined}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
                onClick={() => choose(row.date)}
              >
                <span
                  className={`type-body ${row.current ? "font-semibold text-ink" : "text-ink"}`}
                >
                  {row.label}
                </span>
                <span className="type-label text-ink-2 tabular-nums">{row.detail}</span>
              </button>
            </li>
          ))}
          <li>
            <label className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 hover:bg-surface-2">
              <span className="type-body flex items-center gap-2 text-ink">
                <CalendarIcon className="text-ink-2" />
                Pick a date
              </span>
              <input
                type="date"
                aria-label="Pick a date"
                className="h-10 min-w-0 rounded-xl border border-line bg-surface px-2 text-ink tabular-nums"
                min={`${SETTINGS_LIMITS.year.min}-01-01`}
                max={`${SETTINGS_LIMITS.year.max}-12-31`}
                value={dateDraft ?? date}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDateDraft(value);
                  // Half-typed dates ("0002-11-14") stay in the field until they make sense.
                  if (isValidIsoDate(value)) pickDate(value);
                }}
                onBlur={() => setDateDraft(null)}
              />
            </label>
          </li>
        </ul>

        <div className="mt-3 border-t border-line pt-3">
          <p className="type-label mb-2 text-ink-2">The play button runs</p>
          <Segmented
            label="What the play button animates"
            options={PLAY_MODES}
            value={playback.mode}
            onChange={playback.setMode}
            className="w-full"
          />
          <p className="type-footnote mt-3 text-ink-3">Times are in {zoneLabel}.</p>
        </div>
      </Dialog>
    </section>
  );
}
