"use client";

import { useRef, useCallback } from "react";
import type { AnimationMode } from "@/types/sun";

interface TimeControlsProps {
  dateTime: Date;
  onDateTimeChange: (dt: Date) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  animationMode: AnimationMode;
  onAnimationModeChange: (mode: AnimationMode) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** Compact layout for mobile map overlay */
  compact?: boolean;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function setDayOfYear(date: Date, day: number): Date {
  const result = new Date(date.getFullYear(), 0, 1);
  result.setDate(day);
  result.setHours(date.getHours(), date.getMinutes(), 0, 0);
  return result;
}

export default function TimeControls({
  dateTime,
  onDateTimeChange,
  isPlaying,
  onPlayPause,
  animationMode,
  onAnimationModeChange,
  speed,
  onSpeedChange,
  compact = false,
}: TimeControlsProps) {
  const totalMinutes = dateTime.getHours() * 60 + dateTime.getMinutes();
  const dayOfYear = getDayOfYear(dateTime);

  // Batch rapid slider changes into a single rAF callback so the expensive
  // downstream computations (arc, blockage, shadows) run at most once per frame
  // instead of 60-120× per second on mobile touch input.
  const rafRef = useRef(0);
  const pendingRef = useRef<Date | null>(null);
  const flush = useCallback(() => {
    rafRef.current = 0;
    if (pendingRef.current) {
      onDateTimeChange(pendingRef.current);
      pendingRef.current = null;
    }
  }, [onDateTimeChange]);

  const scheduleUpdate = useCallback((dt: Date) => {
    pendingRef.current = dt;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  const handleTimeChange = (minutes: number) => {
    const next = new Date(dateTime);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    scheduleUpdate(next);
  };

  const handleDateChange = (day: number) => {
    scheduleUpdate(setDayOfYear(dateTime, day));
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5 rounded-xl bg-white/90 px-3 py-2 shadow-md backdrop-blur dark:bg-zinc-800/90">
        {/* Time row */}
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] text-zinc-400">Time</span>
          <input
            type="range"
            min={0}
            max={1439}
            value={totalMinutes}
            onChange={(e) => handleTimeChange(parseInt(e.target.value))}
            className="sun-slider min-w-0 flex-1"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[10px] font-medium text-zinc-700 dark:text-zinc-200">
            {formatTime(totalMinutes)}
          </span>
        </div>
        {/* Date row */}
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] text-zinc-400">Date</span>
          <input
            type="range"
            min={1}
            max={365}
            value={dayOfYear}
            onChange={(e) => handleDateChange(parseInt(e.target.value))}
            className="sun-slider min-w-0 flex-1"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[10px] font-medium text-zinc-700 dark:text-zinc-200">
            {formatDate(dateTime)}
          </span>
        </div>
        {/* Controls row */}
        <div className="flex items-center gap-2">
          <button
            onClick={onPlayPause}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow transition-colors hover:bg-amber-600"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="8" height="8" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="1" width="3.5" height="12" rx="1" />
                <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="8" height="8" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l9-5.5z" />
              </svg>
            )}
          </button>
          <div className="flex rounded border border-zinc-200 text-[10px] dark:border-zinc-600">
            <button
              onClick={() => onAnimationModeChange("time")}
              className={`px-2 py-0.5 transition-colors ${
                animationMode === "time"
                  ? "bg-amber-500 text-white"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              T
            </button>
            <button
              onClick={() => onAnimationModeChange("date")}
              className={`px-2 py-0.5 transition-colors ${
                animationMode === "date"
                  ? "bg-amber-500 text-white"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              D
            </button>
          </div>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value={0.5}>½x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
            <option value={20}>20x</option>
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white/90 p-4 shadow-md backdrop-blur dark:bg-zinc-800/90">
      {/* Time slider */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Time of Day</span>
          <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
            {formatTime(totalMinutes)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1439}
          value={totalMinutes}
          onChange={(e) => handleTimeChange(parseInt(e.target.value))}
          className="sun-slider w-full"
        />
      </div>

      {/* Date slider */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Date</span>
          <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
            {formatDate(dateTime)}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={365}
          value={dayOfYear}
          onChange={(e) => handleDateChange(parseInt(e.target.value))}
          className="sun-slider w-full"
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPlayPause}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-white shadow transition-colors hover:bg-amber-600"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 1.5v11l9-5.5z" />
            </svg>
          )}
        </button>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-zinc-200 text-xs dark:border-zinc-600">
          <button
            onClick={() => onAnimationModeChange("time")}
            className={`rounded-l-lg px-3 py-1.5 transition-colors ${
              animationMode === "time"
                ? "bg-amber-500 text-white"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            Time
          </button>
          <button
            onClick={() => onAnimationModeChange("date")}
            className={`rounded-r-lg px-3 py-1.5 transition-colors ${
              animationMode === "date"
                ? "bg-amber-500 text-white"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            Date
          </button>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Speed</span>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
            <option value={20}>20x</option>
          </select>
        </div>
      </div>
    </div>
  );
}
