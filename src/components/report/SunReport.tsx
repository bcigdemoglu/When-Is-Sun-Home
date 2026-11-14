"use client";

import { useId, useMemo } from "react";

import { BuildingStatus } from "./BuildingStatus";
import { DailyHoursChart } from "./DailyHoursChart";
import { DayPanel } from "./DayPanel";
import { Headline } from "./Headline";
import { useHour12 } from "./hooks";
import { MethodNote } from "./MethodNote";
import { buildReportModel } from "./model";
import { MonthlyBars } from "./MonthlyBars";
import { HatchDefs, ReportContext } from "./parts";
import "./report.css";
import { SkylineChart } from "./SkylineChart";
import type { SunReportProps } from "./types";
import { YearHeatmap } from "./YearHeatmap";

/**
 * The sun report: how much direct sun a spot gets, when, and why.
 *
 * Purely presentational. Sections, top to bottom: building-data status,
 * headline, selected day, year heat map, daily hours, monthly averages,
 * skyline, method note. Every analysis prop may be `null` (still computing):
 * the section then shows a skeleton of exactly its final size.
 *
 * Palette note — the sun-state colours are overridden in `report.css` with
 * values checked by the data-viz palette validator (sun and blocked pass the
 * full categorical gate; out-of-view and night are deliberately neutral, and
 * all four stay apart under colour-vision-deficiency simulation).
 */
export function SunReport({
  place,
  timeZone,
  observer,
  date,
  minuteOfDay,
  year,
  grid,
  day,
  horizon,
  instant,
  buildings,
  pinOnBuilding,
  onSelectDateTime,
}: SunReportProps) {
  const hour12 = useHour12();
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const context = useMemo(() => ({ hour12, hatchId }), [hour12, hatchId]);

  // Derived once per analysis; scrubbing the time of day never re-runs this.
  const lat = place.lat;
  const model = useMemo(() => (year ? buildReportModel(year, lat) : null), [year, lat]);

  const hasTerrain = useMemo(
    () => horizon !== null && horizon.blockerIndex.some((index) => index < -1),
    [horizon],
  );

  return (
    <ReportContext.Provider value={context}>
      <div className="sun-report @container flex flex-col gap-3 text-ink">
        <HatchDefs id={hatchId} />
        <BuildingStatus buildings={buildings} pinOnBuilding={pinOnBuilding} />
        <Headline year={year} model={model} observer={observer} lat={lat} hasTerrain={hasTerrain} />
        <DayPanel
          date={date}
          minuteOfDay={minuteOfDay}
          day={day}
          instant={instant}
          observer={observer}
          onSelectDateTime={onSelectDateTime}
        />
        <YearHeatmap
          year={year}
          model={model}
          grid={grid}
          horizon={horizon}
          hasTerrain={hasTerrain}
          date={date}
          minuteOfDay={minuteOfDay}
          observer={observer}
          onSelectDateTime={onSelectDateTime}
        />
        <DailyHoursChart
          year={year}
          model={model}
          date={date}
          onSelectDateTime={onSelectDateTime}
        />
        <MonthlyBars year={year} model={model} date={date} onSelectDateTime={onSelectDateTime} />
        <SkylineChart
          grid={grid}
          horizon={horizon}
          observer={observer}
          date={date}
          instant={instant}
        />
        <MethodNote
          buildings={buildings}
          observer={observer}
          hasTerrain={hasTerrain}
          pinOnBuilding={pinOnBuilding}
          stepMinutes={year?.stepMinutes ?? null}
          timeZone={timeZone}
        />
      </div>
    </ReportContext.Provider>
  );
}
