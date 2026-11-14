import { Card } from "@/components/ui/Card";
import { SunState, type Observer, type YearAnalysis } from "@/lib/types";

import {
  formatClockRange,
  formatCount,
  formatHours,
  formatHourTick,
  formatPercent,
  MONTHS_LONG,
} from "./format";
import type { TimeRange } from "./heatmap";
import type { ReportModel } from "./model";
import { SkeletonBlock, SkeletonText, StateSwatch, useReport } from "./parts";
import { stateMeta } from "./states";
import type { SeasonSummary, StateRun } from "./summary";

interface HeadlineProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  observer: Observer;
}

/** The answer in one glance: the hero number, its context, and the seasons. */
export function Headline({ year, model, observer }: HeadlineProps) {
  const title =
    observer.mode === "window" ? "Direct sun through this window" : "Direct sun on this spot";

  return (
    <Card title={title} aside={year ? String(year.year) : undefined}>
      <div aria-busy={!year || !model}>
        {year && model ? <Loaded year={year} model={model} observer={observer} /> : <Loading />}
      </div>
    </Card>
  );
}

function Loaded({
  year,
  model,
  observer,
}: {
  year: YearAnalysis;
  model: ReportModel;
  observer: Observer;
}) {
  const { annual } = year;
  const { split, best, worst } = model;
  const coneLimited = observer.mode === "window" && observer.fovDeg < 360;

  const shares = [
    { state: SunState.Sun, label: "Direct sun", hours: split.sunHours },
    { state: SunState.Blocked, label: "Shaded by buildings", hours: split.blockedHours },
    ...(coneLimited || split.outOfViewHours > 0
      ? [{ state: SunState.OutOfView, label: "Sun outside the view", hours: split.outOfViewHours }]
      : []),
  ];
  const daylight = split.daylightHours;

  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-5xl leading-none font-semibold tracking-tight text-ink">
          {formatHours(annual.avgSunHoursPerDay)}
        </span>
        <span className="text-lg font-medium text-ink">h / day</span>
        <span className="text-sm text-ink-2">of direct sun, averaged over the year</span>
      </p>

      {/* Where the daylight goes: a thin segmented bar, figures beside it. */}
      <div className="mt-4">
        <div
          className="flex h-2 gap-0.5 overflow-hidden rounded-full"
          role="img"
          aria-label={`Share of daylight hours: ${shares
            .map((s) => `${s.label} ${formatPercent(daylight > 0 ? s.hours / daylight : 0)}`)
            .join(", ")}`}
        >
          {daylight > 0 ? (
            shares.map(
              (s) =>
                s.hours > 0 && (
                  <span
                    key={s.state}
                    className={s.state === SunState.OutOfView ? "report-hatch" : ""}
                    style={{
                      flexGrow: s.hours,
                      flexBasis: 0,
                      backgroundColor: `var(${stateMeta(s.state).cssVar})`,
                    }}
                  />
                ),
            )
          ) : (
            <span className="grow bg-surface-2" />
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {shares.map((s) => (
            <li key={s.state} className="flex items-center gap-1.5">
              <StateSwatch state={s.state} />
              <span>
                <strong className="font-semibold text-ink">
                  {formatPercent(daylight > 0 ? s.hours / daylight : 0)}
                </strong>{" "}
                {s.state === SunState.Sun ? "of daylight in direct sun" : s.label.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
        <Stat
          label="Per year"
          value={`${formatCount(annual.totalSunHours)} h`}
          note="of direct sun"
        />
        <Stat
          label="Sunniest month"
          value={best ? MONTHS_LONG[best.month] : "—"}
          note={best ? `${formatHours(best.avgSunHours)} h / day` : ""}
        />
        <Stat
          label="Least sun"
          value={worst ? MONTHS_LONG[worst.month] : "—"}
          note={worst ? `${formatHours(worst.avgSunHours)} h / day` : ""}
        />
      </dl>

      <Seasons seasons={model.seasons} range={model.range} />
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">
        <span className="block truncate text-base leading-tight font-semibold text-ink">
          {value}
        </span>
        <span className="block truncate text-xs text-ink-2">{note}</span>
      </dd>
    </div>
  );
}

// ─── Seasons ───────────────────────────────────────────────────────────────

const SEASON_GRID = "grid grid-cols-[3.75rem_minmax(0,1fr)_7.25rem] items-center gap-x-3";

function Seasons({ seasons, range }: { seasons: SeasonSummary[]; range: TimeRange }) {
  const { hour12 } = useReport();
  const ticks: number[] = [];
  for (let minute = 360; minute < 1440; minute += 360) {
    if (minute > range.startMinute + 30 && minute < range.endMinute - 30) ticks.push(minute);
  }
  const span = range.endMinute - range.startMinute;

  return (
    <section className="mt-4 border-t border-line pt-3" aria-label="A typical day in each season">
      <h3 className="text-xs text-ink-3">
        A typical day in each season{" "}
        <span className="text-ink-3">
          ({formatHourTick(range.startMinute, hour12)} to {formatHourTick(range.endMinute, hour12)})
        </span>
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {seasons.map((season) => (
          <li key={season.month} className={SEASON_GRID}>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium text-ink">{season.season}</div>
              <div className="text-xs text-ink-3">{season.longLabel.slice(0, 3)}</div>
            </div>
            <StateStrip
              runs={season.typicalRuns}
              range={range}
              label={`Typical ${season.longLabel} day`}
            />
            <div className="min-w-0 text-right leading-tight">
              <div className="text-sm font-semibold text-ink tabular-nums">
                {formatHours(season.avgSunHours)} h
                <span className="font-normal text-ink-2"> / day</span>
              </div>
              <div className="text-[11px] whitespace-nowrap text-ink-2 tabular-nums">
                {typicalRangeText(season, hour12)}
              </div>
            </div>
          </li>
        ))}
        {/* Shared time axis for the four strips. */}
        <li className={SEASON_GRID} aria-hidden="true">
          <span />
          <div className="relative h-3.5 text-[10px] text-ink-3 tabular-nums">
            {ticks.map((minute) => (
              <span
                key={minute}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((minute - range.startMinute) / span) * 100}%` }}
              >
                {formatHourTick(minute, hour12)}
              </span>
            ))}
          </div>
          <span />
        </li>
      </ul>
    </section>
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
      className="relative h-3.5 overflow-hidden rounded-[4px]"
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
            className={`absolute inset-y-0 ${run.state === SunState.OutOfView ? "report-hatch" : ""}`}
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

// ─── Loading ───────────────────────────────────────────────────────────────

function Loading() {
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <SkeletonText width="5.5rem" className="text-5xl leading-none" />
        <SkeletonText width="14rem" className="text-sm" />
      </p>
      <div className="mt-4">
        <SkeletonBlock className="h-2 rounded-full" />
        <div className="mt-2 text-xs">
          <SkeletonText width="16rem" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="text-xs">
              <SkeletonText width="4rem" />
            </div>
            <div className="mt-0.5 text-base leading-tight">
              <SkeletonText width="5rem" />
            </div>
            <div className="text-xs">
              <SkeletonText width="4.5rem" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="text-xs">
          <SkeletonText width="12rem" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-[35px]" />
          ))}
          <div className="h-3.5" />
        </div>
      </div>
    </>
  );
}
