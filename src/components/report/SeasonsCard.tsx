import { SunState } from "@/lib/types";

import { formatClockRange, formatHours, formatHourTick, MONTHS_LONG } from "./format";
import type { TimeRange } from "./heatmap";
import type { ReportModel } from "./model";
import { ReportCard, SkeletonBlock, SkeletonText, ValueUnit, useReport } from "./parts";
import { stateMeta } from "./states";
import {
  hemisphereOf,
  SEASON_MONTHS,
  seasonOfMonth,
  type SeasonSummary,
  type StateRun,
} from "./summary";

interface SeasonsCardProps {
  model: ReportModel | null;
  /** Latitude of the place: decides which months are summer. */
  lat: number;
}

/**
 * Four tiles, one per season: a typical day of its middle month as a slim
 * 24-hour strip, the hours of direct sun, and when they usually fall.
 */
export function SeasonsCard({ model, lat }: SeasonsCardProps) {
  const { hour12 } = useReport();
  const hemisphere = hemisphereOf(lat);
  const seasons = model?.seasons ?? null;
  const range = model?.range ?? null;

  const hours = seasons?.map((season) => season.avgSunHours) ?? [];
  const low = hours.length ? Math.min(...hours) : 0;
  const high = hours.length ? Math.max(...hours) : 0;

  return (
    <ReportCard
      title="Seasons"
      value={
        seasons ? (
          <>
            {formatHours(low) === formatHours(high)
              ? `${formatHours(high)} h`
              : `${formatHours(low)} – ${formatHours(high)} h`}
            <ValueUnit>of direct sun a day</ValueUnit>
          </>
        ) : (
          <SkeletonText width="9rem" />
        )
      }
      footnote={
        !range
          ? "Each strip is a typical day of that month."
          : range.startMinute <= 0 && range.endMinute >= 1440
            ? "Each strip is a typical day of that month, midnight to midnight."
            : `Each strip is a typical day of that month, from ${formatHourTick(range.startMinute, hour12)} to ${formatHourTick(range.endMinute, hour12)}.`
      }
      footnoteLines={2}
      busy={!model}
    >
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {SEASON_MONTHS.map((month, i) => {
          const season = seasons?.[i] ?? null;
          return (
            <li key={month} className="min-w-0 rounded-xl bg-surface-2 p-3">
              <p className="truncate text-xs/4 font-medium text-ink-2">
                <span className="text-ink">{seasonOfMonth(month, hemisphere)}</span> {"·"}{" "}
                {MONTHS_LONG[month]}
              </p>
              <p className="mt-1 text-lg/[22px] font-semibold whitespace-nowrap text-ink tabular-nums">
                {season ? (
                  <>
                    {formatHours(season.avgSunHours)} h
                    <span className="text-[13px] leading-none font-normal text-ink-2"> / day</span>
                  </>
                ) : (
                  <SkeletonText width="4.5rem" />
                )}
              </p>
              <div className="mt-2">
                {season && range ? (
                  <StateStrip
                    runs={season.typicalRuns}
                    range={range}
                    label={`Typical ${season.longLabel} day`}
                  />
                ) : (
                  <SkeletonBlock className="h-2.5 rounded-[3px] bg-surface" />
                )}
              </div>
              <p className="mt-1.5 truncate text-xs/4 text-ink-2 tabular-nums">
                {season ? typicalRangeText(season, hour12) : <SkeletonText width="6.5rem" />}
              </p>
            </li>
          );
        })}
      </ul>
    </ReportCard>
  );
}

function typicalRangeText(season: SeasonSummary, hour12: boolean): string {
  if (season.firstMinute === null || season.lastMinute === null) return "No direct sun";
  if (season.firstMinute <= 0 && season.lastMinute >= 1440) return "Sun around the clock";
  return formatClockRange(season.firstMinute, season.lastMinute, hour12);
}

/** A slim bar of state runs across a time range (HTML, so it needs no measuring). */
function StateStrip({ runs, range, label }: { runs: StateRun[]; range: TimeRange; label: string }) {
  const span = range.endMinute - range.startMinute;
  return (
    <div
      className="relative h-2.5 overflow-hidden rounded-[3px]"
      style={{ backgroundColor: "var(--state-night)" }}
      role="img"
      aria-label={label}
    >
      {runs.map((run) => {
        if (run.state === SunState.Night) return null;
        const start = Math.max(run.startMinute, range.startMinute);
        const end = Math.min(run.endMinute, range.endMinute);
        if (end <= start) return null;
        return (
          <span
            key={run.startMinute}
            className={`absolute inset-y-0 ${
              run.state === SunState.OutOfView
                ? "report-hatch"
                : run.state === SunState.Sun
                  ? "report-sun-edge"
                  : ""
            }`}
            style={{
              left: `${((start - range.startMinute) / span) * 100}%`,
              width: `${((end - start) / span) * 100}%`,
              backgroundColor: `var(${stateMeta(run.state).cssVar})`,
            }}
          />
        );
      })}
    </div>
  );
}
