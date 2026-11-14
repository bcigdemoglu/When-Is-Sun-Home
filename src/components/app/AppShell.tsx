"use client";

import { useEffect, useMemo, useState } from "react";
import { dayTrackBackground } from "@/components/controls/dayTrack";
import { ObserverControls } from "@/components/controls/ObserverControls";
import { TimeScrubber } from "@/components/controls/TimeScrubber";
import { COMPASS_RADIUS, sunPathModel } from "@/components/map/compassGeometry";
import { MapPanel } from "@/components/map/MapPanel";
import { SunReport } from "@/components/report/SunReport";
import type { BuildingDataStatus } from "@/components/report/types";
import { zoneAbbreviation, zoneLabel } from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { readLegacyPlace } from "@/hooks/legacyPlace";
import { usePacedValue } from "@/hooks/usePacedValue";
import { useSunAnalysis } from "@/hooks/useSunAnalysis";
import { selectPlace, useHydrateSettings, useSettings, useUrlSync } from "@/state";
import { EmptyState } from "./EmptyState";
import { ErrorBoundary } from "./ErrorBoundary";
import { PlaceHeader } from "./PlaceHeader";

/**
 * The report (a tall column of charts) is the most expensive thing to redraw.
 * While something is dragged or animated it gets new numbers at most 20 times
 * a second, and less often when a redraw turns out to be slow, so it can never
 * hold the sliders or the map back. It always ends on the final value.
 */
const REPORT_PACING = { minIntervalMs: 50, loadFactor: 3, allowanceMs: 40 };

/** Two columns on desktop, one scrolling page on phones. */
const LAYOUT =
  "lg:grid lg:h-dvh lg:grid-cols-[minmax(45%,1fr)_minmax(0,600px)] lg:overflow-hidden";
const MAP_AREA = "relative h-[45svh] min-h-72 lg:h-auto lg:min-h-0 lg:flex-1";
const SIDE_PANEL =
  "min-w-0 space-y-3 p-3 lg:h-full lg:overflow-y-auto lg:border-l lg:border-line lg:p-4";

function selectDateTime(date: string, minuteOfDay?: number): void {
  const settings = useSettings.getState();
  if (minuteOfDay === undefined) settings.setDate(date);
  else settings.setDateTime(date, minuteOfDay);
}

/** What the page looks like before the saved settings are known. */
function ShellSkeleton() {
  return (
    <div className={LAYOUT} role="status" aria-label="Loading">
      <div className="flex flex-col lg:h-full lg:min-h-0">
        <div className={`${MAP_AREA} bg-surface-2 motion-safe:animate-pulse`} />
      </div>
      <div className={SIDE_PANEL}>
        <div className="h-44 rounded-xl border border-line bg-surface" />
        <div className="h-60 rounded-xl border border-line bg-surface" />
        <div className="h-96 rounded-xl border border-line bg-surface" />
      </div>
    </div>
  );
}

function reportFailed(_error: unknown, reset: () => void) {
  return (
    <Card title="Sun report">
      <p className="text-sm text-ink-2">
        The report couldn’t be drawn. The map and the controls still work.
      </p>
      <Button className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}

function Workspace() {
  const place = useSettings(selectPlace);
  const analysis = useSunAnalysis();
  const report = usePacedValue(analysis, REPORT_PACING);
  const reportStatus = report ? report.buildings.status : "idle";
  const reportStats = report ? report.buildings.stats : null;
  const reportRetry = report ? report.buildings.refetch : null;
  const reportBuildings = useMemo<BuildingDataStatus>(
    () => ({ status: reportStatus, stats: reportStats, onRetry: reportRetry ?? (() => {}) }),
    [reportStatus, reportStats, reportRetry],
  );
  // While the buildings load, the numbers are for an open sky: visibly provisional.
  const provisional = reportStatus === "loading" || reportStatus === "idle";

  // Small, stable values for everything that redraws on a slider tick: the
  // day's analysis itself (1440 samples) only travels to the report.
  const day = analysis ? analysis.day : null;
  const track = useMemo(() => dayTrackBackground(day), [day]);
  const sunPath = useMemo(() => (day ? sunPathModel(day, COMPASS_RADIUS) : null), [day]);
  const zone = analysis
    ? zoneAbbreviation(analysis.timeZone, analysis.date, analysis.minuteOfDay)
    : "";
  const zoneText = analysis
    ? zoneLabel(analysis.timeZone, analysis.date, analysis.minuteOfDay)
    : "";

  const pinBuildingHeightM =
    analysis && analysis.horizon && analysis.horizon.containingBuildingIndex >= 0
      ? (analysis.buildings.buildings?.features[analysis.horizon.containingBuildingIndex]
          ?.properties.heightM ?? null)
      : null;

  return (
    <div className={LAYOUT}>
      <div className="flex flex-col lg:h-full lg:min-h-0">
        <div className={MAP_AREA}>
          <MapPanel
            place={place}
            buildings={analysis ? analysis.buildings.buildings : null}
            buildingStatus={analysis ? analysis.buildings.status : "idle"}
            sunPath={sunPath}
            instant={analysis ? analysis.instant : null}
            blockerBuildingId={analysis ? analysis.blockerBuildingId : null}
            pinBuildingId={analysis ? analysis.pinBuildingId : null}
          />
        </div>
        {analysis && (
          <TimeScrubber
            className="rounded-none! border-x-0! border-b-0! px-3! py-2.5! lg:px-4!"
            timeZone={analysis.timeZone}
            zone={zone}
            date={analysis.date}
            minuteOfDay={analysis.minuteOfDay}
            isLive={analysis.isLive}
            track={track}
            sunriseMinute={day ? day.sunriseMinute : null}
            sunsetMinute={day ? day.sunsetMinute : null}
          />
        )}
      </div>

      <main className={SIDE_PANEL}>
        {analysis ? (
          <>
            <PlaceHeader
              place={analysis.place}
              timeZone={analysis.timeZone}
              zoneLabel={zoneText}
              buildings={analysis.buildings}
            />
            <ObserverControls
              pinOnBuilding={analysis.pinOnBuilding}
              pinBuildingHeightM={pinBuildingHeightM}
            />
            {report && (
              <div
                aria-busy={provisional}
                className={`transition-opacity ${provisional ? "opacity-60" : ""}`}
              >
                <ErrorBoundary fallback={reportFailed}>
                  <SunReport
                    place={report.place}
                    timeZone={report.timeZone}
                    observer={report.observer}
                    date={report.date}
                    minuteOfDay={report.minuteOfDay}
                    year={report.year}
                    grid={report.grid}
                    day={report.day}
                    horizon={report.horizon}
                    instant={report.instant}
                    buildings={reportBuildings}
                    pinOnBuilding={report.pinOnBuilding}
                    onSelectDateTime={selectDateTime}
                  />
                </ErrorBoundary>
              </div>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

/**
 * The client root: loads the saved settings (storage, then URL), keeps the
 * address bar in step, and shows a skeleton until that is done so the server
 * markup and the first client render always match.
 */
export function AppShell() {
  // Read the old app's saved place during the first render, before the
  // hydration effect below deletes its storage key.
  const [legacyPlace] = useState(readLegacyPlace);
  const hydrated = useHydrateSettings();
  useUrlSync();

  useEffect(() => {
    if (!hydrated || !legacyPlace) return;
    const settings = useSettings.getState();
    if (settings.place === null) settings.setPlace(legacyPlace);
  }, [hydrated, legacyPlace]);

  if (!hydrated) return <ShellSkeleton />;
  return <Workspace />;
}
