import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { SunState, type Observer, type SunStateCode, type YearAnalysis } from "@/lib/types";

import {
  formatClockRange,
  formatCount,
  formatHours,
  formatHourTick,
  formatPercent,
  MONTHS_LONG,
  MONTHS_SHORT,
} from "./format";
import type { TimeRange } from "./heatmap";
import type { ReportModel } from "./model";
import { SkeletonBlock, SkeletonText, StateSwatch, useReport } from "./parts";
import { stateMeta } from "./states";
import {
  hemisphereOf,
  SEASON_MONTHS,
  seasonOfMonth,
  type SeasonSummary,
  type StateRun,
} from "./summary";

interface HeadlineProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  observer: Observer;
  /** Latitude of the place: decides which months are summer. */
  lat: number;
}

/**
 * The answer in one glance: the hero number, where the daylight goes, the
 * best and worst months, and a typical day in each season.
 *
 * While the analysis is loading the same layout is rendered with placeholders
 * in place of the numbers, so nothing moves when they arrive.
 */
export function Headline({ year, model, observer, lat }: HeadlineProps) {
  const data = year && model ? { year, model } : null;
  const annual = data?.year.annual;
  const split = data?.model.split;
  const coneLimited = observer.mode === "window" && observer.fovDeg < 360;
  const anySun = annual ? annual.totalSunHours > 0 : false;

  const shares: { state: SunStateCode; label: string; hours: number | null }[] = [
    { state: SunState.Sun, label: "of daylight in direct sun", hours: split?.sunHours ?? null },
    { state: SunState.Blocked, label: "shaded by buildings", hours: split?.blockedHours ?? null },
  ];
  if (coneLimited || (split && split.outOfViewHours > 0)) {
    shares.push({
      state: SunState.OutOfView,
      label: "sun outside the view",
      hours: split?.outOfViewHours ?? null,
    });
  }
  const daylight = split?.daylightHours ?? 0;
  const share = (hours: number | null) => (hours !== null && daylight > 0 ? hours / daylight : 0);

  return (
    <Card
      title={
        observer.mode === "window" ? "Direct sun through this window" : "Direct sun on this spot"
      }
      aside={year ? String(year.year) : undefined}
    >
      <div aria-busy={!data}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          {annual ? (
            <span className="text-5xl leading-none font-semibold tracking-tight text-ink">
              {formatHours(annual.avgSunHoursPerDay)}
            </span>
          ) : (
            <SkeletonText width="5.5rem" className="text-5xl leading-none" />
          )}
          <span className="text-lg font-medium text-ink">h / day</span>
          <span className="text-sm text-ink-2">of direct sun, averaged over the year</span>
        </p>

        {/* Where the daylight goes: a thin segmented bar, figures beside it. */}
        <div className="mt-4">
          {split ? (
            <div
              className="flex h-2 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`Share of daylight hours: ${shares
                .map((s) => `${formatPercent(share(s.hours))} ${s.label}`)
                .join(", ")}`}
            >
              {daylight > 0 ? (
                shares.map(
                  (s) =>
                    s.hours !== null &&
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
          ) : (
            <SkeletonBlock className="h-2 rounded-full" />
          )}
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {shares.map((s) => (
              <li key={s.state} className="flex items-center gap-1.5">
                <StateSwatch state={s.state} />
                <span>
                  {s.hours !== null ? (
                    <strong className="font-semibold text-ink">
                      {formatPercent(share(s.hours))}
                    </strong>
                  ) : (
                    <SkeletonText width="1.75rem" />
                  )}{" "}
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat
            label="Per year"
            value={annual ? `${formatCount(annual.totalSunHours)} h` : null}
            note="of direct sun"
          />
          <Stat
            label="Sunniest month"
            value={data ? monthName(data.model.best?.month, anySun) : null}
            note={data ? monthNote(data.model.best?.avgSunHours, anySun) : null}
          />
          <Stat
            label="Least sun"
            value={data ? monthName(data.model.worst?.month, anySun) : null}
            note={data ? monthNote(data.model.worst?.avgSunHours, anySun) : null}
          />
        </dl>

        <Seasons seasons={model?.seasons ?? null} range={model?.range ?? null} lat={lat} />
      </div>
    </Card>
  );
}

function monthName(month: number | undefined, anySun: boolean): string {
  return month !== undefined && anySun ? MONTHS_LONG[month] : "—";
}

function monthNote(avgSunHours: number | undefined, anySun: boolean): string {
  return avgSunHours !== undefined && anySun
    ? `${formatHours(avgSunHours)} h / day`
    : "no direct sun";
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note: string | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">
        <span className="block truncate text-base leading-tight font-semibold text-ink">
          {value ?? <SkeletonText width="4.5rem" />}
        </span>
        <span className="block truncate text-xs text-ink-2">
          {note ?? <SkeletonText width="4rem" />}
        </span>
      </dd>
    </div>
  );
}

// ─── Seasons ───────────────────────────────────────────────────────────────

/**
 * Narrow: name and figures on one line, the strip full width below.
 * Wide: name | strip | figures in one row.
 */
const SEASON_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @md:grid-cols-[3.75rem_minmax(0,1fr)_7.25rem]";
const SEASON_STRIP = "order-3 col-span-2 @md:order-none @md:col-span-1";

function Seasons({
  seasons,
  range,
  lat,
}: {
  seasons: SeasonSummary[] | null;
  range: TimeRange | null;
  lat: number;
}) {
  const { hour12 } = useReport();
  const hemisphere = hemisphereOf(lat);
  const ticks: number[] = [];
  if (range) {
    for (let minute = 360; minute < 1440; minute += 360) {
      if (minute > range.startMinute + 30 && minute < range.endMinute - 30) ticks.push(minute);
    }
  }
  const span = range ? range.endMinute - range.startMinute : 1;

  return (
    <section className="mt-4 border-t border-line pt-3" aria-label="A typical day in each season">
      <h3 className="text-xs text-ink-3">
        A typical day in each season
        {range &&
          ` (${formatHourTick(range.startMinute, hour12)} to ${formatHourTick(range.endMinute, hour12)})`}
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {SEASON_MONTHS.map((month, i) => {
          const season = seasons?.[i] ?? null;
          return (
            <li key={month} className={SEASON_GRID}>
              <div className="flex min-w-0 items-baseline gap-1.5 leading-tight @md:block">
                <div className="truncate text-sm font-medium text-ink">
                  {seasonOfMonth(month, hemisphere)}
                </div>
                <div className="text-xs text-ink-3">{MONTHS_SHORT[month]}</div>
              </div>
              <div className={SEASON_STRIP}>
                {season && range ? (
                  <StateStrip
                    runs={season.typicalRuns}
                    range={range}
                    label={`Typical ${season.longLabel} day`}
                  />
                ) : (
                  <SkeletonBlock className="h-3.5 rounded-[4px]" />
                )}
              </div>
              <div className="flex min-w-0 items-baseline gap-2 text-right leading-tight @md:block">
                <SeasonFigure className="text-sm font-semibold text-ink">
                  {season ? (
                    <>
                      {formatHours(season.avgSunHours)} h
                      <span className="font-normal text-ink-2"> / day</span>
                    </>
                  ) : (
                    <SkeletonText width="4rem" />
                  )}
                </SeasonFigure>
                <SeasonFigure className="text-[11px] text-ink-2">
                  {season ? typicalRangeText(season, hour12) : <SkeletonText width="6.5rem" />}
                </SeasonFigure>
              </div>
            </li>
          );
        })}
        {/* Shared time axis for the four strips. */}
        <li className={SEASON_GRID} aria-hidden="true">
          <span className="hidden @md:block" />
          <div className={`relative h-3.5 text-[10px] text-ink-3 tabular-nums ${SEASON_STRIP}`}>
            {range &&
              ticks.map((minute) => (
                <span
                  key={minute}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((minute - range.startMinute) / span) * 100}%` }}
                >
                  {formatHourTick(minute, hour12)}
                </span>
              ))}
          </div>
          <span className="hidden @md:block" />
        </li>
      </ul>
    </section>
  );
}

function SeasonFigure({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`whitespace-nowrap tabular-nums ${className}`}>{children}</div>;
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
