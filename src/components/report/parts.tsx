/**
 * Small building blocks shared by the report's sections: context, skeletons,
 * the tooltip, the state legend and state-coloured SVG fills.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

import { SunState, type SunStateCode } from "@/lib/types";

import { stateMeta } from "./states";

// ─── Context ───────────────────────────────────────────────────────────────

export interface ReportContextValue {
  /** Clock style of the user's locale. */
  hour12: boolean;
  /** `id` of the shared SVG hatch pattern (out-of-view texture). */
  hatchId: string;
}

export const ReportContext = createContext<ReportContextValue>({
  hour12: true,
  hatchId: "sun-report-hatch",
});

export function useReport(): ReportContextValue {
  return useContext(ReportContext);
}

/** The shared `<pattern>`; rendered once per report in a zero-size SVG. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <pattern
          id={id}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0.5" y1="0" x2="0.5" y2="6" stroke="var(--report-hatch)" strokeWidth="1" />
        </pattern>
      </defs>
    </svg>
  );
}

// ─── Skeletons ─────────────────────────────────────────────────────────────

/** A block placeholder; give it the exact size of what it stands in for. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={`animate-pulse rounded-md bg-surface-2 ${className}`}
    />
  );
}

/** An inline placeholder that occupies exactly one line of the surrounding text. */
export function SkeletonText({ width, className = "" }: { width: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="skeleton"
      className={`inline-block animate-pulse rounded bg-surface-2 align-baseline select-none ${className}`}
      style={{ width }}
    >
      {" "}
    </span>
  );
}

// ─── Tooltip ───────────────────────────────────────────────────────────────

const TOOLTIP_WIDTH = 184;

interface ChartTooltipProps {
  /** Anchor point, in pixels from the top-left of the positioned container. */
  x: number;
  y: number;
  /** Size of the container, to keep the tooltip inside it horizontally. */
  containerWidth: number;
  containerHeight: number;
  children: ReactNode;
}

/**
 * The one tooltip used by every chart. It sits above the pointer (so a finger
 * does not cover it), flips below near the top edge, and never takes pointer
 * events. Everything it shows is also available without hovering.
 */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  containerHeight,
  children,
}: ChartTooltipProps) {
  const width = Math.min(TOOLTIP_WIDTH, Math.max(120, containerWidth));
  const left = Math.min(Math.max(0, x - width / 2), Math.max(0, containerWidth - width));
  const above = y > 92;
  const style: CSSProperties = above
    ? { left, width, bottom: containerHeight - y + 14 }
    : { left, width, top: y + 20 };
  return (
    <div
      role="presentation"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute z-20 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs leading-snug text-ink-2 shadow-lg shadow-black/10"
      style={style}
    >
      {children}
    </div>
  );
}

// ─── State swatches & legend ───────────────────────────────────────────────

export function StateSwatch({
  state,
  className = "",
}: {
  state: SunStateCode;
  className?: string;
}) {
  const meta = stateMeta(state);
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3 shrink-0 rounded-[3px] ring-1 ring-line ring-inset ${
        state === SunState.OutOfView ? "report-hatch" : ""
      } ${className}`}
      style={{ backgroundColor: `var(${meta.cssVar})` }}
    />
  );
}

export function StateLegend({
  states,
  labels,
  className = "",
}: {
  states: readonly SunStateCode[];
  /** Override the default label of a state. */
  labels?: Partial<Record<SunStateCode, string>>;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2 ${className}`}>
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <StateSwatch state={state} />
          {labels?.[state] ?? stateMeta(state).label}
        </li>
      ))}
    </ul>
  );
}

/** An SVG rect filled with a state's colour (hatched for out-of-view). */
export function StateRect({
  state,
  x,
  y,
  width,
  height,
}: {
  state: number;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const { hatchId } = useReport();
  if (!(width > 0 && height > 0)) return null;
  return (
    <>
      <rect x={x} y={y} width={width} height={height} fill={`var(${stateMeta(state).cssVar})`} />
      {state === SunState.OutOfView && (
        <rect x={x} y={y} width={width} height={height} fill={`url(#${hatchId})`} />
      )}
    </>
  );
}

/** A short line sample for legends of line charts. */
export function LineKey({ color, width = 2 }: { color: string; width?: number }) {
  return (
    <svg width="16" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="15" y2="4" stroke={color} strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}
