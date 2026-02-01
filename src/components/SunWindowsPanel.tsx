"use client";

import type { SunWindow } from "@/lib/sunBlockage";

interface SunWindowsPanelProps {
  sunWindows: SunWindow[] | null;
  blockageEnabled: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(start: Date, end: Date): string {
  const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function SunWindowsPanel({
  sunWindows,
  blockageEnabled,
}: SunWindowsPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/90 p-4 shadow-md backdrop-blur dark:bg-zinc-800/90">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Sun Windows
      </h3>

      {!blockageEnabled && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Enable sun blockage to see visible windows.
        </p>
      )}

      {blockageEnabled && !sunWindows && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Waiting for building data...
        </p>
      )}

      {blockageEnabled && sunWindows && sunWindows.length === 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No direct sunlight today.
        </p>
      )}

      {blockageEnabled && sunWindows && sunWindows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sunWindows.map((w, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-1.5 text-xs dark:bg-zinc-700"
            >
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {formatTime(w.start)} – {formatTime(w.end)}
              </span>
              <span className="text-zinc-400 dark:text-zinc-500">
                {formatDuration(w.start, w.end)}
              </span>
            </div>
          ))}
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {sunWindows.length} window{sunWindows.length !== 1 ? "s" : ""} of direct sunlight
          </div>
        </div>
      )}
    </div>
  );
}
