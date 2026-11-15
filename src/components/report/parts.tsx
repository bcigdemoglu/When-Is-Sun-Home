/**
 * Small building blocks shared by the report's sections: context, skeletons,
 * the tooltip, the state legend and state-coloured SVG fills.
 */
import { createContext, useContext, useId, type CSSProperties, type ReactNode } from "react";

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
 * The one tooltip used by every chart. It always sits above the anchor — so
 * neither a finger nor the tooltip itself covers the mark being read — and may
 * overhang the top of the chart. It never takes pointer events, and everything
 * it shows is also available without hovering.
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
  const style: CSSProperties = { left, width, bottom: containerHeight - y + 14 };
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

// ─── Card anatomy ──────────────────────────────────────────────────────────

/** Small caps label above a figure. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-[11px]/[14px] font-semibold tracking-[0.08em] text-ink-2 uppercase ${className}`}
    >
      {children}
    </p>
  );
}

interface ReportCardProps {
  /** Anchor id (see `REPORT_SECTIONS`). */
  id?: string;
  title: string;
  /** Right side of the title row: a switch, a date… */
  aside?: ReactNode;
  /**
   * The value line: the card's one figure. It doubles as the tooltip — charts
   * swap it for the reading under the pointer or finger.
   */
  value?: ReactNode;
  /** One line under the value: what the figure means. */
  detail?: ReactNode;
  /** Let the detail run to two lines (room for both is always kept) instead of cutting it. */
  detailLines?: 1 | 2;
  /** One short sentence under everything. */
  footnote?: ReactNode;
  /** Lines of footnote to keep room for, so the card does not grow when the text arrives. */
  footnoteLines?: number;
  busy?: boolean;
  children?: ReactNode;
}

/**
 * The report's card: title → value line → chart → legend rows → footnote.
 * Tone-on-tone with a hairline, no shadow.
 */
export function ReportCard({
  id,
  title,
  aside,
  value,
  detail,
  detailLines = 1,
  footnote,
  footnoteLines = 1,
  busy = false,
  children,
}: ReportCardProps) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={busy}
      className="report-section rounded-[20px] border border-line bg-surface p-4"
    >
      <header className="flex min-h-[22px] items-center justify-between gap-3">
        <h2 id={headingId} className="text-base/[22px] font-semibold text-ink">
          {title}
        </h2>
        {aside && <div className="shrink-0 text-xs font-medium text-ink-2">{aside}</div>}
      </header>
      {value !== undefined && (
        <p className="mt-1 min-h-7 truncate text-2xl/7 font-semibold tracking-[-0.01em] text-ink tabular-nums">
          {value}
        </p>
      )}
      {detail !== undefined && (
        <p
          className={`text-[15px]/[22px] text-ink-2 tabular-nums ${
            detailLines === 2 ? "min-h-[44px]" : "min-h-[22px] truncate"
          }`}
        >
          {detail}
        </p>
      )}
      {children}
      {footnote && (
        <p className="mt-3 text-xs/4 text-ink-3" style={{ minHeight: footnoteLines * 16 }}>
          {footnote}
        </p>
      )}
    </section>
  );
}

/** A suffix inside a value line, set smaller and quieter than the figure. */
export function ValueUnit({ children }: { children: ReactNode }) {
  return (
    <span className="text-[15px] leading-none font-normal tracking-normal text-ink-2">
      {" "}
      {children}
    </span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────

export type GlyphName =
  "sun" | "shade" | "hill" | "night" | "out" | "loading" | "warning" | "chevron";

/** 20 px line icons, 1.5 px stroke, drawn in the current text colour. */
export function Glyph({ name, className = "" }: { name: GlyphName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${name === "loading" ? "animate-spin" : ""} ${className}`}
    >
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
        </>
      )}
      {name === "shade" && (
        <>
          <path d="M4 20.5V8.5l6-4v16M10 10.5h6.5v10M2.5 20.5h19" />
          <path d="M6.5 11h1M6.5 14.5h1M13 13.5h1M13 17h1" />
        </>
      )}
      {name === "hill" && <path d="M2.5 19.5 9 8l3.5 5.5 2.5-3 6.5 9z" />}
      {name === "night" && <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" />}
      {name === "out" && (
        <>
          <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
          <path d="M12 3.5v17M4 12h16" />
        </>
      )}
      {name === "loading" && (
        <>
          <circle cx="12" cy="12" r="8.5" opacity="0.25" />
          <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
        </>
      )}
      {name === "warning" && (
        <>
          <path d="M12 4 21 19.5H3z" />
          <path d="M12 10v4.5M12 17v.2" />
        </>
      )}
      {name === "chevron" && <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />}
    </svg>
  );
}
