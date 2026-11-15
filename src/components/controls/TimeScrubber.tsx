"use client";

import { useState } from "react";
import { formatClock, formatMonthDay, formatShortDate } from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { Slider } from "@/components/ui/Slider";
import { PLAY_SPEEDS, type PlayMode } from "@/hooks/playback";
import { usePlayback } from "@/hooks/usePlayback";
import {
  addDays,
  dateFromDayIndex,
  dayIndexFromDate,
  daysInYear,
  yearOfDate,
} from "@/lib/analysis";
import { SETTINGS_LIMITS, isValidIsoDate, useSettings } from "@/state";

const PLAY_MODES: readonly { value: PlayMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "year", label: "Year" },
];

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const HOUR_TICKS = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"];

interface TimeScrubberProps {
  /** IANA zone of the place: everything here is wall-clock time there. */
  timeZone: string;
  /** Its short name at the selected time, e.g. "PDT". */
  zone: string;
  date: string;
  minuteOfDay: number;
  /** True while date and time follow the clock. */
  isLive: boolean;
  /** CSS background for the time slider: the day's sun / shade strip (see `dayTrack.ts`). */
  track: string | undefined;
  /** Sunrise / sunset of `date`, which bound the "day" animation. */
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  className?: string;
}

/** Pick the date and the time of day, jump back to "now", or let them play. */
export function TimeScrubber({
  timeZone,
  zone,
  date,
  minuteOfDay,
  isLive,
  track,
  sunriseMinute,
  sunsetMinute,
  className = "",
}: TimeScrubberProps) {
  const setDate = useSettings((s) => s.setDate);
  const setMinuteOfDay = useSettings((s) => s.setMinuteOfDay);
  const resetToNow = useSettings((s) => s.resetToNow);

  const playback = usePlayback({ date, minuteOfDay, sunriseMinute, sunsetMinute });
  const pause = playback.pause;

  // What is being typed into the date field; null = show the selected date.
  const [dateDraft, setDateDraft] = useState<string | null>(null);

  const year = yearOfDate(date);
  const dayIndex = dayIndexFromDate(date);
  const lastDayIndex = daysInYear(year) - 1;
  const speed = PLAY_SPEEDS[playback.speedIndex] ?? PLAY_SPEEDS[0];

  const shiftDay = (days: number) => {
    pause();
    const next = addDays(date, days);
    if (isValidIsoDate(next)) setDate(next);
  };

  return (
    <Card className={className}>
      <h2 className="sr-only">Date and time</h2>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button iconOnly aria-label="Previous day" onClick={() => shiftDay(-1)}>
            <ChevronLeftIcon />
          </Button>
          <input
            type="date"
            aria-label="Date"
            className="h-10 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink tabular-nums"
            min={`${SETTINGS_LIMITS.year.min}-01-01`}
            max={`${SETTINGS_LIMITS.year.max}-12-31`}
            value={dateDraft ?? date}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDateDraft(value);
              // Half-typed dates ("0002-11-14") stay in the field until they make sense.
              if (isValidIsoDate(value)) {
                pause();
                setDate(value);
              }
            }}
            onBlur={() => setDateDraft(null)}
          />
          <Button iconOnly aria-label="Next day" onClick={() => shiftDay(1)}>
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="flex min-w-0 items-baseline gap-1.5" aria-live="off">
          <span className="text-xl leading-none font-semibold text-ink tabular-nums">
            {formatClock(minuteOfDay)}
          </span>
          <span className="text-xs text-ink-2" title={timeZone}>
            {zone}
          </span>
        </div>

        <Button
          aria-pressed={isLive}
          aria-label={
            isLive ? "Live: following the current time" : "Now: return to the current time"
          }
          className="min-w-18"
          onClick={() => {
            pause();
            resetToNow();
          }}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isLive ? "bg-accent motion-safe:animate-pulse" : "border border-ink-3"
            }`}
          />
          {isLive ? "Live" : "Now"}
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="primary"
            iconOnly
            aria-label={playback.playing ? "Pause" : `Play the ${playback.mode}`}
            onClick={playback.toggle}
          >
            {playback.playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Segmented
            compact
            label="Animate"
            options={PLAY_MODES}
            value={playback.mode}
            onChange={playback.setMode}
          />
          <Button
            aria-label={`Speed ${speed.label}. Change speed`}
            className="w-11 px-0! tabular-nums"
            onClick={() => playback.setSpeedIndex((playback.speedIndex + 1) % PLAY_SPEEDS.length)}
          >
            {speed.label}
          </Button>
        </div>
      </div>

      <div className="mt-1.5 grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-2">
        <span className="pt-2.5 text-xs font-medium text-ink-2" aria-hidden="true">
          Time
        </span>
        <div>
          <Slider
            label="Time of day"
            hideLabel
            value={minuteOfDay}
            min={SETTINGS_LIMITS.minuteOfDay.min}
            max={SETTINGS_LIMITS.minuteOfDay.max}
            step={1}
            valueText={`${formatClock(minuteOfDay)} ${zone}`.trim()}
            track={track}
            onGrab={pause}
            onChange={setMinuteOfDay}
          />
          <div
            className="-mt-1.5 flex justify-between px-1 text-[10px] leading-none text-ink-3"
            aria-hidden="true"
          >
            {HOUR_TICKS.map((tick, index) => (
              <span key={index}>{tick}</span>
            ))}
          </div>
        </div>

        <span className="pt-2.5 text-xs font-medium text-ink-2" aria-hidden="true">
          Date
        </span>
        <div>
          <Slider
            label="Day of the year"
            hideLabel
            value={dayIndex}
            min={0}
            max={lastDayIndex}
            step={1}
            valueText={`${formatMonthDay(date)}, ${formatShortDate(date).slice(0, 3)}`}
            onGrab={pause}
            onChange={(index) => setDate(dateFromDayIndex(year, index))}
          />
          <div
            className="-mt-1.5 grid grid-cols-12 px-3 text-center text-[10px] leading-none text-ink-3"
            aria-hidden="true"
          >
            {MONTH_INITIALS.map((initial, index) => (
              <span key={index}>{initial}</span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
