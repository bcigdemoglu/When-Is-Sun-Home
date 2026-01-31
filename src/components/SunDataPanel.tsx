"use client";

import type { SunData, SunBlockageInfo, SunVisibility } from "@/types/sun";
import { getSunVisuals } from "@/types/sun";

interface SunDataPanelProps {
  sunData: SunData | null;
  sunVisibility: SunVisibility;
  sunBlockage: SunBlockageInfo | null;
}

function formatTimeStr(date: Date): string {
  if (isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function formatDegrees(deg: number): string {
  return `${deg.toFixed(1)}°`;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span
        className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function formatVisibilityLabel(
  sunVisibility: SunVisibility,
  sunBlockage: SunBlockageInfo | null
): string {
  const visuals = getSunVisuals(sunVisibility);
  if (sunVisibility === "blocked" && sunBlockage?.blockDistance) {
    return `${visuals.label} (${sunBlockage.blockDistance}m away)`;
  }
  return visuals.label;
}

export default function SunDataPanel({ sunData, sunVisibility, sunBlockage }: SunDataPanelProps) {
  if (!sunData) {
    return (
      <div className="rounded-xl bg-white/90 p-4 text-center text-sm text-zinc-400 shadow-md backdrop-blur dark:bg-zinc-800/90">
        Select a location to see sun data
      </div>
    );
  }

  const { position, times } = sunData;
  const visuals = getSunVisuals(sunVisibility);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white/90 p-4 shadow-md backdrop-blur dark:bg-zinc-800/90">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Sun Position
      </h3>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
        <Row label="Elevation" value={formatDegrees(position.altitude)} />
        <Row label="Azimuth" value={formatDegrees(position.azimuth)} />
        <Row
          label="Status"
          value={position.altitude > 0 ? "Above horizon" : "Below horizon"}
        />
        {sunBlockage && (
          <Row
            label="Sun Visibility"
            value={formatVisibilityLabel(sunVisibility, sunBlockage)}
            valueColor={visuals.labelColor}
          />
        )}
      </div>

      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Key Times
      </h3>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
        <Row label="Sunrise" value={formatTimeStr(times.sunrise)} />
        <Row label="Solar Noon" value={formatTimeStr(times.solarNoon)} />
        <Row label="Sunset" value={formatTimeStr(times.sunset)} />
        <Row label="Day Length" value={formatDuration(times.dayLength)} />
      </div>

      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Golden Hour
      </h3>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
        <Row label="Morning" value={formatTimeStr(times.goldenHourEnd)} />
        <Row label="Evening" value={formatTimeStr(times.goldenHourStart)} />
      </div>

      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Twilight
      </h3>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
        <Row label="Civil Dawn" value={formatTimeStr(times.civilDawn)} />
        <Row label="Civil Dusk" value={formatTimeStr(times.civilDusk)} />
        <Row label="Nautical Dawn" value={formatTimeStr(times.nauticalDawn)} />
        <Row label="Nautical Dusk" value={formatTimeStr(times.nauticalDusk)} />
        <Row label="Astro Dawn" value={formatTimeStr(times.astronomicalDawn)} />
        <Row label="Astro Dusk" value={formatTimeStr(times.astronomicalDusk)} />
      </div>
    </div>
  );
}
