import { memo, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";

import { isInViewCone } from "@/lib/analysis";
import {
  SunState,
  type HorizonProfile,
  type Observer,
  type SunInstant,
  type SunYearGrid,
} from "@/lib/types";

import {
  compassPoint,
  formatAngle,
  formatBearing,
  formatClock,
  formatDate,
  formatDistance,
  formatHourTick,
} from "./format";
import { dayIndexInYear } from "./heatmap";
import { useElementSize } from "./hooks";
import {
  ChartTooltip,
  LineKey,
  ReportCard,
  SkeletonBlock,
  SkeletonText,
  ValueUnit,
  useReport,
} from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import {
  azimuthToFraction,
  buildPathSegments,
  compassTicks,
  createElevationScale,
  fractionToAzimuth,
  hourMarks,
  maxSunAltitude,
  obstructionKind,
  obstructionPhrase,
  outsideViewSpans,
  panoramaCenter,
  referenceDays,
  sectorSummary,
  skylineRuns,
  sunDirectionMask,
  sunPassageAt,
  sunPathForDay,
  tallestObstruction,
  type ElevationScale,
  type HourMark,
  type Obstruction,
  type PathSegment,
  type SkylineRun,
  type SunPathPoint,
} from "./skyline";

const MARGIN = { left: 0, right: 0, top: 6, bottom: 22 };
/** Narrow cards show about half the compass at a time; the panorama pans sideways. */
const MIN_PANORAMA_WIDTH = 680;
const PAN_BELOW_WIDTH = 600;

interface SkylineChartProps {
  grid: SunYearGrid | null;
  horizon: HorizonProfile | null;
  observer: Observer;
  date: string;
  instant: SunInstant | null;
}

interface PathModel {
  key: string;
  label: string;
  points: SunPathPoint[];
  segments: PathSegment[];
}

/** Everything about the panorama that does not depend on the selected day. */
interface SkylineModel {
  centerDeg: number;
  scale: ElevationScale;
  runs: SkylineRun[];
  hasTerrain: boolean;
  outside: { x0: number; x1: number }[];
  references: (PathModel & { dayIndex: number })[];
  /** Tallest obstruction in the directions the sun passes (and the window sees). */
  tallest: Obstruction | null;
}

interface Probe {
  /** 0..1 across the whole panorama. */
  fraction: number;
  /** Pixels from the left edge of the visible frame, for the floating tooltip. */
  frameX: number;
  floating: boolean;
}

/**
 * "Why": the skyline around the spot with the sun's paths drawn over it.
 * Wherever a path runs behind the silhouette, the spot is in shade.
 *
 * On a narrow card the panorama is wider than the card and pans sideways; it
 * opens centred on the side of the sky the sun crosses.
 */
export function SkylineChart({ grid, horizon, observer, date, instant }: SkylineChartProps) {
  const { hour12 } = useReport();
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startScroll: number } | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const { mode, heightM, facingDeg, fovDeg } = observer;

  const model = useMemo((): SkylineModel | null => {
    if (!grid) return null;
    const viewer: Observer = { mode, heightM, facingDeg, fovDeg };
    const centerDeg = panoramaCenter(grid.lat);
    let skylineMax = 0;
    if (horizon)
      for (const elevation of horizon.elevationDeg) skylineMax = Math.max(skylineMax, elevation);
    const runs = horizon ? skylineRuns(horizon, centerDeg) : [];
    const references = referenceDays(grid.year).map((day) => {
      const points = sunPathForDay(grid, day.dayIndex, horizon, viewer);
      return {
        key: day.key,
        label: day.label,
        dayIndex: day.dayIndex,
        points,
        segments: buildPathSegments(points, centerDeg, grid.stepMinutes),
      };
    });
    let tallest: Obstruction | null = null;
    if (horizon) {
      const mask = sunDirectionMask(
        references.map((path) => path.points),
        horizon.binCount,
        grid.stepMinutes,
      );
      for (let bin = 0; bin < horizon.binCount; bin++) {
        if (mask[bin] && !isInViewCone(((bin + 0.5) * 360) / horizon.binCount, viewer))
          mask[bin] = 0;
      }
      tallest = tallestObstruction(horizon, mask);
    }
    return {
      centerDeg,
      scale: createElevationScale(Math.max(maxSunAltitude(grid.lat), skylineMax) + 6),
      runs,
      hasTerrain: runs.some((run) => run.kind === "terrain"),
      outside: outsideViewSpans(viewer, centerDeg),
      references,
      tallest,
    };
  }, [grid, horizon, mode, heightM, facingDeg, fovDeg]);

  const selectedDay = grid ? dayIndexInYear(grid, date) : null;
  const selected = useMemo((): (PathModel & { marks: HourMark[] }) | null => {
    if (!grid || !model || selectedDay === null) return null;
    const viewer: Observer = { mode, heightM, facingDeg, fovDeg };
    const points = sunPathForDay(grid, selectedDay, horizon, viewer);
    return {
      key: "selected",
      label: formatDate(date),
      points,
      segments: buildPathSegments(points, model.centerDeg, grid.stepMinutes),
      marks: hourMarks(grid, selectedDay),
    };
  }, [grid, model, horizon, selectedDay, date, mode, heightM, facingDeg, fovDeg]);

  const frameWidth = size?.width ?? 0;
  const height = size?.height ?? 0;
  const pannable = frameWidth > 0 && frameWidth < PAN_BELOW_WIDTH;
  const width = pannable ? Math.max(frameWidth, MIN_PANORAMA_WIDTH) : frameWidth;
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const ready = model !== null && plotWidth > 0 && plotHeight > 0;

  // Open on the sun's side: the middle of the panorama.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && ready) scroller.scrollLeft = Math.max(0, (width - frameWidth) / 2);
  }, [ready, width, frameWidth, model?.centerDeg]);

  const xOf = (fraction: number) => MARGIN.left + fraction * plotWidth;
  const yOf = (elevationDeg: number) =>
    MARGIN.top + plotHeight * (1 - (model?.scale.fraction(elevationDeg) ?? 0));

  const probeFromEvent = (event: PointerEvent<SVGRectElement>): Probe => {
    const rect = event.currentTarget.getBoundingClientRect();
    const frameLeft = scrollerRef.current?.getBoundingClientRect().left ?? rect.left;
    return {
      fraction: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      frameX: event.clientX - frameLeft,
      floating: event.pointerType !== "touch",
    };
  };
  const onPointerDown = (event: PointerEvent<SVGRectElement>) => {
    const dragging = pannable && event.pointerType === "mouse" && scrollerRef.current !== null;
    // While a mouse drags the panorama the floating tooltip would only be in the way.
    setProbe({ ...probeFromEvent(event), ...(dragging ? { floating: false } : {}) });
    // A mouse has no swipe: let it drag the panorama.
    if (dragging && scrollerRef.current) {
      drag.current = { startX: event.clientX, startScroll: scrollerRef.current.scrollLeft };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    if (drag.current && scrollerRef.current) {
      scrollerRef.current.scrollLeft =
        drag.current.startScroll - (event.clientX - drag.current.startX);
      return;
    }
    if (event.pointerType === "mouse") setProbe(probeFromEvent(event));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const reading = (() => {
    if (!probe || !model) return null;
    const azimuthDeg = fractionToAzimuth(Math.min(probe.fraction, 0.999999), model.centerDeg);
    const bin = horizon
      ? Math.min(horizon.binCount - 1, Math.floor((azimuthDeg * horizon.binCount) / 360))
      : -1;
    const elevationDeg = horizon && bin >= 0 ? horizon.elevationDeg[bin] : 0;
    return {
      azimuthDeg,
      elevationDeg,
      distanceM: horizon && bin >= 0 ? horizon.blockerDistanceM[bin] : 0,
      kind:
        horizon && bin >= 0 && elevationDeg > 0 ? obstructionKind(horizon.blockerIndex[bin]) : null,
      passage:
        selected && grid ? sunPassageAt(selected.points, azimuthDeg, grid.stepMinutes) : null,
    };
  })();

  const sunUp = instant !== null && Number.isFinite(instant.altitudeDeg) && instant.altitudeDeg > 0;
  const tallest = model?.tallest ?? null;
  const open = horizon !== null && (tallest === null || tallest.elevationDeg < 1);

  let value;
  let detail;
  if (!model) {
    value = <SkeletonText width="8rem" />;
    detail = <SkeletonText width="15rem" />;
  } else if (reading) {
    value = formatBearing(reading.azimuthDeg);
    detail = (
      <>
        {reading.kind
          ? `${formatAngle(reading.elevationDeg)} up \u00b7 ${reading.kind === "terrain" ? "hill" : "building"} ${formatDistance(reading.distanceM)} away`
          : horizon
            ? "Open sky"
            : "No building data"}
        {reading.passage &&
          ` \u00b7 sun ${formatClock(reading.passage.minute, hour12)}${
            reading.passage.state === SunState.Sun ? "" : ", hidden"
          }`}
      </>
    );
  } else if (!horizon) {
    value = "Open horizon";
    detail = takeaway(horizon, tallest, open);
  } else if (open || !tallest) {
    value = "Open sky";
    detail = takeaway(horizon, tallest, open);
  } else {
    value = (
      <>
        {formatAngle(tallest.elevationDeg)}
        <ValueUnit>up, to the {compassPoint(tallest.azimuthDeg, 16)}</ValueUnit>
      </>
    );
    detail = `The tallest obstruction in the sun\u2019s way: ${
      tallest.kind === "terrain" ? "a hill" : "a building"
    }${tallest.distanceM > 0 ? ` ${formatDistance(tallest.distanceM)} away` : ""}.`;
  }

  return (
    <ReportCard
      id={REPORT_SECTION_IDS.skyline}
      title="What blocks the sun"
      value={value}
      detail={detail}
      detailLines={2}
      footnoteLines={2}
      footnote={
        <>
          {horizon
            ? "Dotted: the sun\u2019s path is hidden behind the skyline."
            : "Building data is not available."}
          {pannable && " Drag sideways to look around."}
        </>
      }
      busy={!ready}
    >
      <div
        ref={sizeRef}
        className="relative mt-3 h-[236px] @2xl:h-[264px]"
        role="img"
        aria-label={skylineSummary(horizon, grid !== null)}
      >
        {!ready || !model ? (
          <SkeletonBlock className="absolute inset-0" />
        ) : (
          <>
            <div
              ref={scrollerRef}
              data-testid="skyline-scroller"
              className="absolute inset-0 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg outline-offset-2 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-accent"
              tabIndex={pannable ? 0 : undefined}
              role={pannable ? "group" : undefined}
              aria-label={pannable ? "Skyline panorama; scroll sideways to look around" : undefined}
            >
              <svg width={width} height={height} className="block" aria-hidden="true">
                <StaticLayer
                  model={model}
                  selected={selected}
                  plotWidth={plotWidth}
                  plotHeight={plotHeight}
                  hour12={hour12}
                />

                {sunUp && instant && (
                  <SunDot
                    x={xOf(azimuthToFraction(instant.azimuthDeg, model.centerDeg))}
                    y={yOf(instant.altitudeDeg)}
                    hidden={instant.state !== SunState.Sun}
                  />
                )}

                {reading && probe && (
                  <g>
                    <line
                      x1={xOf(probe.fraction)}
                      x2={xOf(probe.fraction)}
                      y1={MARGIN.top}
                      y2={MARGIN.top + plotHeight}
                      stroke="var(--ink)"
                    />
                    <circle
                      cx={xOf(probe.fraction)}
                      cy={yOf(reading.elevationDeg)}
                      r={3.5}
                      fill="var(--ink)"
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  </g>
                )}

                <rect
                  data-testid="skyline-hit"
                  x={MARGIN.left}
                  y={MARGIN.top}
                  width={plotWidth}
                  height={plotHeight}
                  fill="transparent"
                  className={pannable ? "cursor-grab" : "cursor-crosshair"}
                  style={{ pointerEvents: "all" }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onPointerLeave={(event) => {
                    if (event.pointerType === "mouse" && !drag.current) setProbe(null);
                  }}
                />
              </svg>
            </div>

            <ElevationAxis scale={model.scale} plotHeight={plotHeight} />

            {reading && probe && probe.floating && (
              <ChartTooltip
                x={probe.frameX}
                y={Math.min(yOf(reading.elevationDeg), yOf(reading.passage?.altitudeDeg ?? 0))}
                containerWidth={frameWidth}
                containerHeight={height}
              >
                <div className="font-semibold text-ink tabular-nums">
                  {formatBearing(reading.azimuthDeg)}
                </div>
                <div className="mt-1 tabular-nums">
                  {reading.kind ? (
                    <>
                      <strong className="font-semibold text-ink">
                        {formatAngle(reading.elevationDeg)}
                      </strong>{" "}
                      skyline {"\u2014"} {reading.kind === "terrain" ? "hill" : "building"}{" "}
                      {formatDistance(reading.distanceM)} away
                    </>
                  ) : horizon ? (
                    <>Open sky down to the horizon</>
                  ) : (
                    <>No building data</>
                  )}
                </div>
                {reading.passage && (
                  <div className="mt-1 tabular-nums">
                    {formatDate(date)}: sun here at{" "}
                    <strong className="font-semibold text-ink">
                      {formatClock(reading.passage.minute, hour12)}
                    </strong>
                    , {formatAngle(reading.passage.altitudeDeg)} up {"\u2014"}{" "}
                    {reading.passage.state === SunState.Sun
                      ? "in view"
                      : reading.passage.state === SunState.Blocked
                        ? "hidden"
                        : "outside the view"}
                  </div>
                )}
              </ChartTooltip>
            )}
          </>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs/4 font-medium text-ink-2">
        <li className="flex items-center gap-1.5">
          <LineKey color="var(--report-sun-line)" width={3} />
          Sun on {formatDate(date)}
        </li>
        <li className="flex items-center gap-1.5">
          <LineKey color="var(--report-sun-line)" width={1.25} />
          Solstices and equinox
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-[3px]"
            style={{ backgroundColor: "var(--report-skyline)" }}
          />
          Buildings
        </li>
        {model?.hasTerrain && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-[3px]"
              style={{ backgroundColor: "var(--report-terrain)" }}
            />
            Hills
          </li>
        )}
        {model && model.outside.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="report-hatch inline-block size-3 rounded-[3px] ring-1 ring-line ring-inset"
              style={{ backgroundColor: "var(--state-out)" }}
            />
            Outside the window{"\u2019"}s view
          </li>
        )}
      </ul>

      {horizon && <SectorTable horizon={horizon} />}
    </ReportCard>
  );
}

/** The one-sentence takeaway: "Tallest obstruction in the sun’s way: a building to the SSW reaching 31° up, 15 m away." */
function takeaway(
  horizon: HorizonProfile | null,
  tallest: Obstruction | null,
  open: boolean,
): string {
  if (!horizon) return "No building data: the horizon is drawn open.";
  if (open || !tallest) return "Nothing rises above the horizon where the sun passes.";
  return `Tallest obstruction in the sun\u2019s way: ${obstructionPhrase(tallest)}.`;
}

/** Elevation labels pinned to the left edge of the frame while the panorama pans under them. */
function ElevationAxis({ scale, plotHeight }: { scale: ElevationScale; plotHeight: number }) {
  return (
    <svg
      width={40}
      height={MARGIN.top + plotHeight}
      className="pointer-events-none absolute top-0 left-0"
      aria-hidden="true"
    >
      {scale.ticks.map((tick) => {
        if (tick === 0 || tick >= scale.maxDeg) return null;
        const y = MARGIN.top + plotHeight * (1 - scale.fraction(tick));
        return (
          <text
            key={tick}
            x={5}
            y={y}
            dy="0.32em"
            fontSize="12"
            fontWeight="500"
            className="report-halo fill-ink-2"
            style={{ stroke: "var(--report-sky)" }}
          >
            {tick}
            {"\u00b0"}
          </text>
        );
      })}
    </svg>
  );
}

function skylineSummary(horizon: HorizonProfile | null, hasGrid: boolean): string {
  if (!hasGrid) return "Skyline panorama, loading";
  if (!horizon) return "Sun paths over an open horizon; building data is not available.";
  const sectors = sectorSummary(horizon).filter((sector) => sector.maxElevationDeg >= 1);
  if (sectors.length === 0) return "Skyline panorama: the horizon is open in every direction.";
  const tallest = [...sectors].sort((a, b) => b.maxElevationDeg - a.maxElevationDeg).slice(0, 3);
  return `Skyline panorama with the sun’s paths. Tallest obstructions: ${tallest
    .map((sector) => `${sector.label} up to ${formatAngle(sector.maxElevationDeg)}`)
    .join(", ")}. A table of all directions follows.`;
}

function SectorTable({ horizon }: { horizon: HorizonProfile }) {
  return (
    <div className="sr-only">
      <table>
        <caption>Highest obstruction in each compass direction</caption>
        <thead>
          <tr>
            <th scope="col">Direction</th>
            <th scope="col">Skyline elevation</th>
            <th scope="col">Distance</th>
          </tr>
        </thead>
        <tbody>
          {sectorSummary(horizon).map((sector) => (
            <tr key={sector.label}>
              <th scope="row">{sector.label}</th>
              <td>{sector.kind ? formatAngle(sector.maxElevationDeg) : "Open"}</td>
              <td>{sector.kind ? formatDistance(sector.distanceM) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Layers ────────────────────────────────────────────────────────────────

function SunDot({ x, y, hidden }: { x: number; y: number; hidden: boolean }) {
  return (
    <g data-testid="sun-dot">
      <circle cx={x} cy={y} r={7} fill="var(--surface)" />
      <circle
        cx={x}
        cy={y}
        r={5}
        fill={hidden ? "var(--surface)" : "var(--state-sun)"}
        stroke="var(--report-sun-line)"
        strokeWidth={hidden ? 2 : 1.5}
      />
    </g>
  );
}

interface StaticLayerProps {
  model: SkylineModel;
  selected: (PathModel & { marks: HourMark[] }) | null;
  plotWidth: number;
  plotHeight: number;
  hour12: boolean;
}

/**
 * Sky, grid, silhouette and sun paths. Memoised: it does not re-render while
 * only the time of day (the sun dot) or the hover position changes.
 */
const StaticLayer = memo(function StaticLayer({
  model,
  selected,
  plotWidth,
  plotHeight,
  hour12,
}: StaticLayerProps) {
  const { hatchId } = useReport();
  const clipId = `clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { scale, centerDeg } = model;
  const left = MARGIN.left;
  const top = MARGIN.top;
  const base = top + plotHeight;
  const xOf = (fraction: number) => left + fraction * plotWidth;
  const yOf = (elevationDeg: number) => top + plotHeight * (1 - scale.fraction(elevationDeg));

  const pathD = (segment: PathSegment) =>
    segment.vertices
      .map(
        (v, i) => `${i === 0 ? "M" : "L"}${xOf(v.x).toFixed(1)} ${yOf(v.altitudeDeg).toFixed(1)}`,
      )
      .join("");

  const runD = (run: SkylineRun) => {
    let d = `M${xOf(run.startX).toFixed(1)} ${base}`;
    run.elevationsDeg.forEach((elevation, i) => {
      const y = yOf(elevation).toFixed(1);
      d += `L${xOf(run.startX + i * run.binWidth).toFixed(1)} ${y}`;
      d += `L${xOf(run.startX + (i + 1) * run.binWidth).toFixed(1)} ${y}`;
    });
    return `${d}L${xOf(run.startX + run.elevationsDeg.length * run.binWidth).toFixed(1)} ${base}Z`;
  };

  const peakOf = (path: PathModel) => {
    let best: SunPathPoint | null = null;
    for (const point of path.points)
      if (!best || point.altitudeDeg > best.altitudeDeg) best = point;
    return best
      ? { x: xOf(azimuthToFraction(best.azimuthDeg, centerDeg)), y: yOf(best.altitudeDeg) }
      : null;
  };

  const selectedPeak = selected ? peakOf(selected) : null;
  const references = model.references.map((path) => {
    const peak = peakOf(path);
    const collides =
      peak !== null &&
      selectedPeak !== null &&
      Math.abs(peak.y - selectedPeak.y) < 24 &&
      Math.abs(peak.x - selectedPeak.x) < 60;
    return { path, peak: collides ? null : peak };
  });

  // Hour labels: every third hour, skipping any that would crowd the last one.
  const hourLabels: { mark: HourMark; x: number; y: number }[] = [];
  for (const mark of selected?.marks ?? []) {
    if (mark.hour % 3 !== 0 || mark.altitudeDeg < 3) continue;
    const x = xOf(azimuthToFraction(mark.azimuthDeg, centerDeg));
    if (x < left + 20 || x > left + plotWidth - 20) continue;
    if (hourLabels.some((placed) => Math.abs(placed.x - x) < 44)) continue;
    hourLabels.push({ mark, x, y: yOf(mark.altitudeDeg) });
  }

  const labelClamp = (x: number, text: string) => {
    const half = (text.length * 7) / 2;
    return Math.min(Math.max(x, left + half), left + plotWidth - half);
  };

  return (
    <g fontSize="12" fontWeight="500">
      <defs>
        <clipPath id={clipId}>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx={8} />
        </clipPath>
      </defs>

      <rect
        x={left}
        y={top}
        width={plotWidth}
        height={plotHeight}
        rx={8}
        fill="var(--report-sky)"
      />

      {/* Elevation gridlines; their labels are pinned to the frame (see ElevationAxis). */}
      {scale.ticks.map((tick) => {
        if (tick === 0 || tick >= scale.maxDeg) return null;
        const y = Math.round(yOf(tick)) + 0.5;
        return (
          <line
            key={tick}
            x1={left}
            x2={left + plotWidth}
            y1={y}
            y2={y}
            stroke="var(--report-grid)"
          />
        );
      })}

      {/* Compass ticks and labels. */}
      {compassTicks(centerDeg).map((tick, i) => {
        const x = Math.round(xOf(tick.fraction)) + 0.5;
        const cardinal = tick.label.length === 1;
        return (
          <g key={i}>
            {cardinal && i > 0 && i < 8 && (
              <line x1={x} x2={x} y1={top} y2={base} stroke="var(--report-grid)" />
            )}
            <line x1={x} x2={x} y1={base} y2={base + 4} stroke="var(--report-axis)" />
            <text
              x={xOf(tick.fraction)}
              y={base + 16}
              textAnchor={i === 0 ? "start" : i === 8 ? "end" : "middle"}
              fontWeight={cardinal ? 700 : 500}
              className={cardinal ? "fill-ink" : "fill-ink-2"}
            >
              {tick.label}
            </text>
          </g>
        );
      })}

      <g clipPath={`url(#${clipId})`}>
        {/* The silhouette: one solid shape per stretch of obstruction. */}
        {model.runs.map((run) => (
          <path
            key={run.startX}
            d={runD(run)}
            fill={run.kind === "terrain" ? "var(--report-terrain)" : "var(--report-skyline)"}
          />
        ))}

        {/* Directions a window cannot see. */}
        {model.outside.map((span) => (
          <g key={span.x0}>
            <rect
              x={xOf(span.x0)}
              y={top}
              width={xOf(span.x1) - xOf(span.x0)}
              height={plotHeight}
              fill="var(--state-out)"
              fillOpacity={0.55}
            />
            <rect
              x={xOf(span.x0)}
              y={top}
              width={xOf(span.x1) - xOf(span.x0)}
              height={plotHeight}
              fill={`url(#${hatchId})`}
            />
          </g>
        ))}

        {references.map(({ path }) => (
          <SunPath key={path.key} segments={path.segments} pathD={pathD} weight="light" />
        ))}
        {selected && <SunPath segments={selected.segments} pathD={pathD} weight="bold" />}

        {/* Whole-hour ticks on the selected day's path. */}
        {selected?.marks.map((mark) => (
          <circle
            key={mark.hour}
            cx={xOf(azimuthToFraction(mark.azimuthDeg, centerDeg))}
            cy={yOf(mark.altitudeDeg)}
            r={2.25}
            fill="var(--surface)"
            stroke="var(--report-sun-line)"
            strokeWidth={1.25}
          />
        ))}
      </g>

      <line
        x1={left}
        x2={left + plotWidth}
        y1={base + 0.5}
        y2={base + 0.5}
        stroke="var(--report-axis)"
      />

      {references.map(
        ({ path, peak }) =>
          peak && (
            <text
              key={path.key}
              x={labelClamp(peak.x, path.label)}
              y={Math.max(top + 9, peak.y - 5)}
              textAnchor="middle"
              className="report-halo fill-ink-2"
              style={{ stroke: "var(--report-sky)" }}
            >
              {path.label}
            </text>
          ),
      )}
      {hourLabels.map(({ mark, x, y }) => (
        <text
          key={mark.hour}
          x={x}
          y={Math.max(top + 9, y - 7)}
          textAnchor="middle"
          className="report-halo fill-ink"
          style={{ stroke: "var(--report-sky)" }}
        >
          {formatHourTick(mark.hour * 60, hour12)}
        </text>
      ))}
      {selected && selectedPeak && (
        <text
          x={labelClamp(selectedPeak.x, selected.label)}
          y={Math.max(top + 9, selectedPeak.y - 20)}
          textAnchor="middle"
          fontWeight="600"
          className="report-halo fill-ink"
          style={{ stroke: "var(--report-sky)" }}
        >
          {selected.label}
        </text>
      )}
    </g>
  );
});

function SunPath({
  segments,
  pathD,
  weight,
}: {
  segments: PathSegment[];
  pathD: (segment: PathSegment) => string;
  weight: "light" | "bold";
}) {
  const bold = weight === "bold";
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {segments.map((segment, i) => {
        const d = pathD(segment);
        if (segment.state === SunState.Sun) {
          return (
            <path
              key={i}
              d={d}
              stroke="var(--report-sun-line)"
              strokeWidth={bold ? 3 : 1.25}
              strokeOpacity={bold ? 1 : 0.85}
            />
          );
        }
        // Hidden behind the skyline, or outside the view: a dotted "hidden line".
        return (
          <path
            key={i}
            d={d}
            stroke={
              segment.state === SunState.Blocked ? "var(--report-hidden-path)" : "var(--ink-3)"
            }
            strokeWidth={bold ? 2 : 1.25}
            strokeDasharray={bold ? "0.1 4.5" : "0.1 4"}
          />
        );
      })}
    </g>
  );
}
