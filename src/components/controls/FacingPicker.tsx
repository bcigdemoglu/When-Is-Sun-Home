"use client";

import { compassName, compassPoint } from "@/components/shared/format";

const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
/** Diameter of the dial and the radius its buttons sit on, px. */
const SIZE = 188;
const RING = 72;

interface FacingPickerProps {
  facingDeg: number;
  /** Full width of the view cone, drawn as a wedge. */
  fovDeg: number;
  onChange(facingDeg: number): void;
}

/**
 * A compass to point the window with: eight buttons around a dial whose
 * needle and wedge show where the window looks. (The slider next to it is
 * for the degrees in between.)
 */
export function FacingPicker({ facingDeg, fovDeg, onChange }: FacingPickerProps) {
  const half = Math.min(fovDeg, 359.9) / 2;
  const point = (deg: number, radius: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(radius * Math.sin(a)).toFixed(2)},${(-radius * Math.cos(a)).toFixed(2)}`;
  };
  const wedge =
    fovDeg >= 360
      ? null
      : `M0,0L${point(facingDeg - half, 44)}A44,44 0 ${fovDeg > 180 ? 1 : 0} 1 ${point(facingDeg + half, 44)}Z`;

  return (
    <div
      role="group"
      aria-label="Facing direction"
      className="relative shrink-0"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg
        viewBox="-94 -94 188 188"
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="absolute inset-0"
      >
        <circle r="50" fill="var(--surface-2)" />
        {fovDeg >= 360 ? (
          <circle r="44" fill="var(--accent-fill)" fillOpacity="0.35" />
        ) : (
          <path d={wedge ?? ""} fill="var(--accent-fill)" fillOpacity="0.45" />
        )}
        <line
          x1="0"
          y1="0"
          x2={point(facingDeg, 40).split(",")[0]}
          y2={point(facingDeg, 40).split(",")[1]}
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle r="4.5" fill="var(--ink)" />
      </svg>
      {DIRECTIONS.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const selected = facingDeg === deg;
        return (
          <button
            key={deg}
            type="button"
            aria-label={`Face ${compassName(deg)}`}
            aria-pressed={selected}
            className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[13px] font-semibold transition-colors ${
              selected ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
            style={{
              left: SIZE / 2 + RING * Math.sin(a),
              top: SIZE / 2 - RING * Math.cos(a),
            }}
            onClick={() => onChange(deg)}
          >
            {compassPoint(deg)}
          </button>
        );
      })}
    </div>
  );
}
