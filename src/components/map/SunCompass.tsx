import { formatClockCompact } from "@/components/shared/format";
import { SunState, type Observer, type SunInstant } from "@/lib/types";
import {
  COMPASS_RADIUS,
  pointString,
  polarPoint,
  rimPoint,
  wedgePath,
  type RimMark,
  type SunPathModel,
} from "./compassGeometry";

/** Radius of the horizon circle in SVG units; the viewBox leaves room for labels. */
const R = COMPASS_RADIUS;

const PATH_COLOR: Record<number, string> = {
  [SunState.Sun]: "var(--state-sun)",
  [SunState.Blocked]: "var(--state-blocked)",
  [SunState.OutOfView]: "var(--state-out)",
};

const CARDINALS = [
  { label: "N", azimuth: 0 },
  { label: "E", azimuth: 90 },
  { label: "S", azimuth: 180 },
  { label: "W", azimuth: 270 },
] as const;

/** Halo that keeps thin marks and text readable over any basemap. */
const HALO = {
  stroke: "var(--surface)",
  strokeWidth: 3,
  paintOrder: "stroke" as const,
  strokeLinejoin: "round" as const,
};

function RimLabel({ mark }: { mark: RimMark }) {
  const tickFrom = rimPoint(mark.azimuthDeg, R - 5);
  const tickTo = rimPoint(mark.azimuthDeg, R + 5);
  const text = rimPoint(mark.azimuthDeg, R + 10);
  const anchor = text.x > 12 ? "start" : text.x < -12 ? "end" : "middle";
  return (
    <g>
      <line
        x1={tickFrom.x}
        y1={tickFrom.y}
        x2={tickTo.x}
        y2={tickTo.y}
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <text
        x={text.x}
        y={text.y}
        dy={text.y > 12 ? 9 : text.y < -12 ? -2 : 3.5}
        textAnchor={anchor}
        fontSize={13}
        fontWeight={600}
        fill="var(--ink)"
        {...HALO}
      >
        {formatClockCompact(mark.minute)}
      </text>
    </g>
  );
}

function SunPath({ path }: { path: SunPathModel }) {
  const { runs, rise, set } = path;
  return (
    <g>
      {runs.map((run, index) => (
        <path
          key={`halo-${index}`}
          d={run.d}
          fill="none"
          stroke="var(--surface)"
          strokeOpacity={0.85}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {runs.map((run, index) => (
        <path
          key={index}
          d={run.d}
          fill="none"
          stroke={PATH_COLOR[run.state]}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {rise && <RimLabel mark={rise} />}
      {set && <RimLabel mark={set} />}
    </g>
  );
}

function CompassFace() {
  return (
    <g>
      <circle r={R} fill="var(--surface)" fillOpacity={0.55} />
      <circle r={R} fill="none" stroke="var(--ink-2)" strokeOpacity={0.7} strokeWidth={1.5} />
      {[60, 30].map((altitude) => (
        <circle
          key={altitude}
          r={(R * (90 - altitude)) / 90}
          fill="none"
          stroke="var(--ink-3)"
          strokeOpacity={0.5}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
      ))}
      {CARDINALS.map(({ label, azimuth }) => {
        const from = rimPoint(azimuth, R - 7);
        const to = rimPoint(azimuth, R);
        const text = rimPoint(azimuth, R - 17);
        return (
          <g key={label}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--ink-2)"
              strokeWidth={1.5}
            />
            <text
              x={text.x}
              y={text.y}
              dy={4}
              textAnchor="middle"
              fontSize={label === "N" ? 14 : 12}
              fontWeight={label === "N" ? 700 : 600}
              fill={label === "N" ? "var(--ink)" : "var(--ink-2)"}
              {...HALO}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function SunMarker({ instant }: { instant: SunInstant }) {
  if (!Number.isFinite(instant.azimuthDeg) || !Number.isFinite(instant.altitudeDeg)) return null;

  if (!(instant.altitudeDeg > 0)) {
    // Below the horizon: a hollow mark on the rim shows where it is hiding.
    const rim = rimPoint(instant.azimuthDeg, R);
    return (
      <circle
        cx={rim.x}
        cy={rim.y}
        r={5}
        fill="var(--state-night)"
        stroke="var(--surface)"
        strokeWidth={2}
        opacity={0.8}
      />
    );
  }

  const sun = polarPoint(instant.azimuthDeg, instant.altitudeDeg, R);
  const rim = rimPoint(instant.azimuthDeg, R);
  const shining = instant.state === SunState.Sun;
  const color = PATH_COLOR[instant.state] ?? "var(--state-out)";
  return (
    <g>
      {/* The direction the light comes from, all the way to the horizon. */}
      <line
        x1={0}
        y1={0}
        x2={rim.x}
        y2={rim.y}
        stroke="var(--surface)"
        strokeOpacity={0.8}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <line
        x1={0}
        y1={0}
        x2={rim.x}
        y2={rim.y}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={shining ? undefined : "5 5"}
      />
      {shining && <circle cx={sun.x} cy={sun.y} r={14} fill="var(--state-sun)" fillOpacity={0.3} />}
      <circle
        cx={sun.x}
        cy={sun.y}
        r={8}
        fill={color}
        stroke={shining ? "var(--surface)" : "var(--ink)"}
        strokeWidth={2}
      />
    </g>
  );
}

interface SunCompassProps {
  /** Today's sun path (see `sunPathModel`). */
  path: SunPathModel | null;
  instant: SunInstant | null;
  observer: Observer;
  /** Fade the diagram, e.g. while the pin is being dragged somewhere else. */
  dimmed?: boolean;
}

/**
 * Polar sun-path diagram drawn on the ground around the pin: north up, the
 * horizon on the rim and the zenith at the pin. Shows today's path coloured by
 * what the sun does for the observer, the sun right now with the direction its
 * light comes from, sunrise / sunset times and — for a window — the view cone.
 *
 * Purely decorative for assistive tech (the report says the same in words)
 * and never takes pointer input.
 */
export function SunCompass({ path, instant, observer, dimmed = false }: SunCompassProps) {
  const cone =
    observer.mode === "window" && observer.fovDeg < 360
      ? wedgePath(observer.facingDeg, observer.fovDeg, R)
      : null;
  const facing = observer.mode === "window" ? rimPoint(observer.facingDeg, R) : null;

  return (
    <div
      className={`h-40 w-40 transition-opacity lg:h-[220px] lg:w-[220px] ${dimmed ? "opacity-30" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="-110 -110 220 220" width="100%" height="100%" overflow="visible">
        <CompassFace />
        {cone && (
          <path
            d={cone}
            fill="var(--accent)"
            fillOpacity={0.16}
            stroke="var(--accent)"
            strokeOpacity={0.7}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}
        {facing && (
          <polygon
            points={[
              pointString(rimPoint(observer.facingDeg, R + 9)),
              pointString(rimPoint(observer.facingDeg - 4, R - 1)),
              pointString(rimPoint(observer.facingDeg + 4, R - 1)),
            ].join(" ")}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={1}
          />
        )}
        {path && <SunPath path={path} />}
        {instant && <SunMarker instant={instant} />}
      </svg>
    </div>
  );
}
