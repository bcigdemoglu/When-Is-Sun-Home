import { useId, useMemo } from "react";

import type { DayAnalysis, Observer, YearAnalysis } from "@/lib/types";

import {
  formatCount,
  formatDate,
  formatDuration,
  formatHours,
  formatPercent,
  MONTHS_LONG,
} from "./format";
import { dayIndexInYear } from "./heatmap";
import type { ReportModel } from "./model";
import { Eyebrow, Glyph, SkeletonText, useReport } from "./parts";
import type { BuildingDataStatus, SunReportProps } from "./types";
import { composeVerdict, verdictFacts } from "./verdict";

interface HeroProps {
  year: YearAnalysis | null;
  model: ReportModel | null;
  day: DayAnalysis | null;
  date: string;
  observer: Observer;
  lat: number;
  hasTerrain: boolean;
  buildings: BuildingDataStatus;
  terrain: NonNullable<SunReportProps["terrain"]>;
  pinOnBuilding: boolean;
}

/**
 * The answer for the year: the average day as one big number, a verdict in
 * plain words, and three figures to compare places by. The state of the
 * building data lives here too — a quiet line when all is well, the verdict's
 * place when it is not.
 */
export function Hero({
  year,
  model,
  day,
  date,
  observer,
  lat,
  hasTerrain,
  buildings,
  terrain,
  pinOnBuilding,
}: HeroProps) {
  const { hour12 } = useReport();
  const headingId = useId();
  const isWindow = observer.mode === "window";

  // Until building data is in, every figure describes an open sky.
  const checking = buildings.status === "loading" || buildings.status === "idle";
  const failed = buildings.status === "error";
  const unshaded = checking || failed;

  const verdict = useMemo(() => {
    if (!year || !model) return null;
    return composeVerdict(verdictFacts(year, model.details), {
      lat,
      mode: observer.mode,
      hour12,
      hasTerrain,
    });
  }, [year, model, lat, observer.mode, hour12, hasTerrain]);

  const annual = year?.annual ?? null;
  const anySun = annual ? annual.totalSunHours > 0 : false;
  // The selected day: the 1-minute analysis when it is for this date, else the year grid's row.
  const dayIndex = year ? dayIndexInYear(year, date) : null;
  const daySun =
    day && day.date === date
      ? { sun: day.sunMinutes, daylight: day.daylightMinutes }
      : year && dayIndex !== null
        ? { sun: year.days[dayIndex].sunMinutes, daylight: year.days[dayIndex].daylightMinutes }
        : null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={!year || !model}
      className="report-section rounded-[20px] border border-line bg-surface p-4"
    >
      <h2 id={headingId}>
        <Eyebrow>
          {isWindow ? "Sun through this window" : "Direct sun"} {"·"} average day
        </Eyebrow>
      </h2>

      <p className="mt-2 flex items-baseline gap-2 text-ink">
        {annual ? (
          <span className="text-[64px]/[64px] font-semibold tracking-[-0.03em] tabular-nums">
            {unshaded && <span className="font-medium text-ink-2">{"≈ "}</span>}
            {formatHours(annual.avgSunHoursPerDay)}
          </span>
        ) : (
          <SkeletonText width="7rem" className="text-[64px]/[64px]" />
        )}
        <span className="text-[28px]/[32px] font-medium">h</span>
      </p>

      <p className="mt-1 min-h-[22px] text-[15px]/[22px] text-ink-2">
        {!annual ? (
          <SkeletonText width="12rem" />
        ) : unshaded ? (
          <>
            before shading {"·"} {year?.year} estimate
          </>
        ) : (
          <>
            <strong className="font-semibold text-ink">{formatPercent(annual.sunFraction)}</strong>{" "}
            of possible daylight {"·"} {formatCount(annual.totalSunHours)} h a year
          </>
        )}
      </p>

      {failed ? (
        <div role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3">
          <p className="text-[15px]/[22px] text-ink">
            <strong className="font-semibold">Couldn{"’"}t load building heights.</strong> Showing
            sun without shading for now, so real sun hours will be lower.
          </p>
          <button
            type="button"
            onClick={buildings.onRetry}
            className="mt-2 inline-flex h-11 cursor-pointer items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-3 min-h-[128px]">
          <p className="text-[20px]/[26px] font-medium text-ink">
            {verdict && !checking ? (
              verdict.sentences[0]
            ) : (
              <>
                <SkeletonText width="100%" />
                <SkeletonText width="62%" />
              </>
            )}
          </p>
          <p className="mt-1.5 text-[15px]/[22px] text-ink-2">
            {verdict && !checking ? (
              verdict.sentences[1]
            ) : checking && annual ? (
              <span className="flex items-start gap-2 text-ink" role="status">
                <Glyph name="loading" className="mt-px text-ink-2" />
                <span>
                  <strong className="font-semibold">Checking nearby buildings{"…"}</strong> For now
                  the numbers assume an open sky.
                </span>
              </span>
            ) : (
              <SkeletonText width="85%" />
            )}
          </p>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 border-t border-line pt-3">
        <Tile
          label="Best month"
          value={
            !model || checking
              ? null
              : anySun && model.best
                ? `${formatHours(model.best.avgSunHours)} h`
                : "—"
          }
          note={model?.best && anySun ? MONTHS_LONG[model.best.month] : "no direct sun"}
          ready={Boolean(model) && !checking}
        />
        <Tile
          label="Least sun"
          value={
            !model || checking
              ? null
              : anySun && model.worst
                ? `${formatHours(model.worst.avgSunHours)} h`
                : "—"
          }
          note={model?.worst && anySun ? MONTHS_LONG[model.worst.month] : "no direct sun"}
          ready={Boolean(model) && !checking}
          divided
        />
        <Tile
          label={formatDate(date)}
          value={daySun && !checking ? formatDuration(daySun.sun) : null}
          note="direct sun"
          ready={Boolean(daySun) && !checking}
          divided
        />
      </dl>

      {/* Always rendered, so the card keeps its height while buildings load. */}
      <p role={unshaded ? undefined : "status"} className="mt-3 min-h-4 text-xs/4 text-ink-3">
        {!unshaded && (
          <>
            {includedText(buildings, terrain, hasTerrain)}
            {pinOnBuilding && " The pin is on a building: that building itself is ignored."}
          </>
        )}
      </p>
    </section>
  );
}

/** "Includes shade from 384 nearby buildings and the hills around." */
function includedText(
  buildings: BuildingDataStatus,
  terrain: HeroProps["terrain"],
  hasTerrain: boolean,
): string {
  const total = buildings.stats?.total ?? null;
  const hills = terrain === "ready" || hasTerrain ? " and the hills around" : "";
  if (total === 0) {
    return hills
      ? "No buildings nearby; shade from the hills around is included."
      : "No buildings were found nearby, so nothing blocks the sun here.";
  }
  const count =
    total === null
      ? "nearby buildings"
      : `${formatCount(total)} nearby ${total === 1 ? "building" : "buildings"}`;
  return `Includes shade from ${count}${hills}.`;
}

function Tile({
  label,
  value,
  note,
  ready,
  divided = false,
}: {
  label: string;
  value: string | null;
  note: string;
  ready: boolean;
  divided?: boolean;
}) {
  return (
    <div className={`min-w-0 ${divided ? "border-l border-line pl-3" : "pr-3"}`}>
      <dt className="truncate text-xs/4 font-medium text-ink-2">{label}</dt>
      <dd>
        <span className="mt-0.5 block truncate text-lg/[22px] font-semibold whitespace-nowrap text-ink tabular-nums">
          {value ?? <SkeletonText width="3.5rem" />}
        </span>
        <span className="block truncate text-xs/4 text-ink-2">
          {ready ? note : <SkeletonText width="3rem" />}
        </span>
      </dd>
    </div>
  );
}
