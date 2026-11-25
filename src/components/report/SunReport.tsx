"use client";

import { useId, useMemo } from "react";

import { AboutCard } from "./AboutCard";
import { Hero } from "./Hero";
import { useHour12 } from "./hooks";
import { buildReportModel } from "./model";
import { HatchDefs, ReportContext } from "./parts";
import "./report.css";
import { SeasonsCard } from "./SeasonsCard";
import { SkylineChart } from "./SkylineChart";
import { SunHoursCard } from "./SunHoursCard";
import { TodayCard } from "./TodayCard";
import { TreesCard } from "./TreesCard";
import type { SunReportProps } from "./types";
import { YearHeatmap } from "./YearHeatmap";

export { REPORT_SECTION_IDS, REPORT_SECTIONS, type ReportSection } from "./sections";

/**
 * The sun report: how much direct sun a spot gets, when, and why.
 *
 * Purely presentational, and laid out for a phone-width column (a bottom
 * sheet, or a 440 px side panel). Cards, top to bottom: the average day with a
 * verdict, the selected day, the seasons, the year heat map, sun hours by
 * month / by day, the skyline, the trees (information only, never part of
 * the numbers; fetched only once scrolled to), and a note on method. The cards listed in
 * `REPORT_SECTIONS` carry stable ids for jump tabs.
 *
 * Every analysis prop may be `null` (still computing): cards keep their
 * titles, axes and exact size, with placeholders where the numbers will be.
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
  terrain = "idle",
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
        <Hero
          year={year}
          model={model}
          day={day}
          date={date}
          observer={observer}
          lat={lat}
          hasTerrain={hasTerrain}
          buildings={buildings}
          terrain={terrain}
          pinOnBuilding={pinOnBuilding}
        />
        <SunHoursCard
          year={year}
          model={model}
          day={day}
          date={date}
          onSelectDateTime={onSelectDateTime}
        />
        <TodayCard
          date={date}
          minuteOfDay={minuteOfDay}
          day={day}
          year={year}
          observer={observer}
          hasTerrain={hasTerrain}
          onSelectDateTime={onSelectDateTime}
        />
        <SeasonsCard model={model} lat={lat} />
        <YearHeatmap
          year={year}
          model={model}
          day={day}
          grid={grid}
          horizon={horizon}
          hasTerrain={hasTerrain}
          date={date}
          minuteOfDay={minuteOfDay}
          observer={observer}
          onSelectDateTime={onSelectDateTime}
        />
        <SkylineChart
          grid={grid}
          horizon={horizon}
          observer={observer}
          date={date}
          instant={instant}
        />
        <TreesCard place={place} />
        <AboutCard
          buildings={buildings}
          terrain={terrain}
          hasTerrain={hasTerrain}
          observer={observer}
          pinOnBuilding={pinOnBuilding}
          stepMinutes={year?.stepMinutes ?? null}
          timeZone={timeZone}
        />
      </div>
    </ReportContext.Provider>
  );
}
