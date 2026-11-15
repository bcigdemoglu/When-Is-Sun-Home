"use client";

import { useEffect, useRef, useState } from "react";
import { dateFromDayIndex, dayIndexFromDate, daysInYear, yearOfDate } from "@/lib/analysis";
import { useSettings } from "@/state";
import {
  advanceDayIndex,
  advanceMinute,
  dayLoopRange,
  dayLoopSpeed,
  frameElapsedMs,
  yearLoopSpeed,
  type PlayMode,
} from "./playback";

export interface PlaybackInput {
  /** The selected date and minute (wall clock at the place). */
  date: string;
  minuteOfDay: number;
  /** Sunrise / sunset of `date`, for the "day" loop. */
  sunriseMinute: number | null;
  sunsetMinute: number | null;
}

export interface Playback {
  playing: boolean;
  mode: PlayMode;
  /** Start (or resume) the animation. Leaves "live" mode. */
  play(): void;
  /** Stop the animation. Safe to call when it is not running. */
  pause(): void;
  toggle(): void;
  setMode(mode: PlayMode): void;
}

/**
 * The play animation: "day" sweeps the time of day over the selected date
 * (sunrise to sunset in about 8 s, looping), "year" sweeps the date at the
 * selected time (a year in about 15 s).
 *
 * Driven by `requestAnimationFrame` with time-based steps, so the speed does
 * not depend on the frame rate and a busy frame never queues up work. It
 * writes to the settings store only when the whole minute / day changes, and
 * stops by itself when the tab is hidden or when anything else changes the
 * date or time (a slider, the date field, a click in the report, "Now").
 */
export function usePlayback(input: PlaybackInput): Playback {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<PlayMode>("day");

  // The frame loop reads the latest inputs without restarting on every tick.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (!playing) return;
    const { setDateTime } = useSettings.getState();

    const start = latest.current;
    const year = yearOfDate(start.date);
    const dayCount = daysInYear(year);
    let minutePosition: number = start.minuteOfDay;
    let dayPosition: number = dayIndexFromDate(start.date);
    let writtenDay = Math.floor(dayPosition);
    // Pin the starting point: from here on the app is no longer "live".
    setDateTime(start.date, start.minuteOfDay);
    // What the animation itself last put in the store (in canonical form).
    let written = { date: useSettings.getState().date, minute: useSettings.getState().minuteOfDay };
    const write = (date: string, minute: number) => {
      setDateTime(date, minute);
      const state = useSettings.getState();
      written = { date: state.date, minute: state.minuteOfDay };
    };

    let frame = 0;
    let previous: number | null = null;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (previous === null) {
        previous = time;
        return;
      }
      const elapsed = frameElapsedMs(previous, time);
      previous = time;

      // Someone else moved the date or time: they are in charge now.
      const state = useSettings.getState();
      if (state.date !== written.date || state.minuteOfDay !== written.minute) {
        setPlaying(false);
        return;
      }

      if (mode === "day") {
        const { sunriseMinute, sunsetMinute } = latest.current;
        const loop = dayLoopRange(sunriseMinute, sunsetMinute);
        minutePosition = advanceMinute(minutePosition, elapsed, dayLoopSpeed(loop), loop);
        const minute = Math.floor(minutePosition);
        if (minute !== written.minute) write(start.date, minute);
      } else {
        dayPosition = advanceDayIndex(dayPosition, elapsed, yearLoopSpeed(dayCount), dayCount);
        const day = Math.min(dayCount - 1, Math.floor(dayPosition));
        if (day !== writtenDay) {
          writtenDay = day;
          write(dateFromDayIndex(year, day), start.minuteOfDay);
        }
      }
    };
    frame = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playing, mode]);

  return {
    playing,
    mode,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((value) => !value),
    setMode,
  };
}
