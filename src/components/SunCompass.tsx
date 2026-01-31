"use client";

import type { SunData, SunVisibility } from "@/types/sun";
import { getSunVisuals } from "@/types/sun";

interface SunCompassProps {
  sunData: SunData | null;
  sunVisibility: SunVisibility;
}

export default function SunCompass({ sunData, sunVisibility }: SunCompassProps) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 60;

  const sunAzimuth = sunData?.position.azimuth ?? 0;
  const sunriseAz = sunData
    ? sunData.arc.find((p) => p.altitude >= 0)?.azimuth ?? 0
    : 0;
  const sunsetAz = sunData
    ? [...sunData.arc].reverse().find((p) => p.altitude >= 0)?.azimuth ?? 0
    : 0;

  const toXY = (azDeg: number, r: number) => {
    const rad = ((azDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const sunPos = toXY(sunAzimuth, radius * 0.7);
  const sunrisePos = toXY(sunriseAz, radius);
  const sunsetPos = toXY(sunsetAz, radius);

  const visuals = getSunVisuals(sunVisibility);

  return (
    <div className="rounded-xl bg-white/90 p-3 shadow-md backdrop-blur dark:bg-zinc-800/90">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Compass circle */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-zinc-300 dark:text-zinc-600"
        />

        {/* Cardinal directions */}
        {[
          { label: "N", az: 0 },
          { label: "E", az: 90 },
          { label: "S", az: 180 },
          { label: "W", az: 270 },
        ].map(({ label, az }) => {
          const pos = toXY(az, radius + 12);
          return (
            <text
              key={label}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-zinc-500 text-[10px] font-semibold dark:fill-zinc-400"
            >
              {label}
            </text>
          );
        })}

        {/* Sunrise line */}
        {sunData && (
          <line
            x1={cx}
            y1={cy}
            x2={sunrisePos.x}
            y2={sunrisePos.y}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 2"
            opacity={0.6}
          />
        )}

        {/* Sunset line */}
        {sunData && (
          <line
            x1={cx}
            y1={cy}
            x2={sunsetPos.x}
            y2={sunsetPos.y}
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeDasharray="4 2"
            opacity={0.6}
          />
        )}

        {/* Sun icon — color/opacity from SunVisibility state */}
        {sunData && (
          <>
            <circle
              cx={sunPos.x}
              cy={sunPos.y}
              r={8}
              fill={visuals.dotColor}
              opacity={visuals.opacity}
            />
            {visuals.showCross && (
              <text
                x={sunPos.x}
                y={sunPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="10"
                fontWeight="bold"
              >
                ✕
              </text>
            )}
          </>
        )}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={2.5} fill="currentColor" className="text-zinc-400 dark:text-zinc-500" />
      </svg>
    </div>
  );
}
