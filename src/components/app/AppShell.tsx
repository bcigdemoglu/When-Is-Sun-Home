"use client";

import { useEffect, useState } from "react";
import { ObserverControls } from "@/components/controls/ObserverControls";
import { TimeScrubber } from "@/components/controls/TimeScrubber";
import { MapPanel } from "@/components/map/MapPanel";
import { SunReport } from "@/components/report/SunReport";
import type { BuildingDataStatus } from "@/components/report/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { readLegacyPlace } from "@/hooks/legacyPlace";
import { useSunAnalysis, type SunAnalysis } from "@/hooks/useSunAnalysis";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { selectPlace, useHydrateSettings, useSettings, useUrlSync } from "@/state";
import { EmptyState } from "./EmptyState";
import { ErrorBoundary } from "./ErrorBoundary";
import { PlaceHeader } from "./PlaceHeader";

/**
 * How often the report is handed new numbers while something is being dragged
 * or animated, ms. The map and the controls update on every tick; the report
 * (a tall column of charts) follows at this pace and catches up exactly when
 * the movement stops.
 */
const REPORT_THROTTLE_MS = 50;

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

function ReportSection({ analysis }: { analysis: SunAnalysis }) {
  const { status, stats, refetch } = analysis.buildings;
  const buildings: BuildingDataStatus = { status, stats, onRetry: refetch };
  // While the buildings load, the numbers are for an open sky: visibly provisional.
  const provisional = status === "loading" || status === "idle";

  return (
    <div
      aria-busy={provisional}
      className={`transition-opacity ${provisional ? "opacity-60" : ""}`}
    >
      <ErrorBoundary
        fallback={(_error, reset) => (
          <Card title="Sun report">
            <p className="text-sm text-ink-2">
              The report couldn’t be drawn. The map and the controls still work.
            </p>
            <Button className="mt-3" onClick={reset}>
              Try again
            </Button>
          </Card>
        )}
      >
        <SunReport
          place={analysis.place}
          timeZone={analysis.timeZone}
          observer={analysis.observer}
          date={analysis.date}
          minuteOfDay={analysis.minuteOfDay}
          year={analysis.year}
          grid={analysis.grid}
          day={analysis.day}
          horizon={analysis.horizon}
          instant={analysis.instant}
          buildings={buildings}
          pinOnBuilding={analysis.pinOnBuilding}
          onSelectDateTime={selectDateTime}
        />
      </ErrorBoundary>
    </div>
  );
}

function Workspace() {
  const place = useSettings(selectPlace);
  const analysis = useSunAnalysis();
  const reportAnalysis = useThrottledValue(analysis, REPORT_THROTTLE_MS);

  const pinBuildingHeightM =
    analysis && analysis.horizon && analysis.horizon.containingBuildingIndex >= 0
      ? (analysis.buildings.buildings?.features[analysis.horizon.containingBuildingIndex]
          ?.properties.heightM ?? null)
      : null;

  return (
    <div className={LAYOUT}>
      <div className="flex flex-col lg:h-full lg:min-h-0">
        <div className={MAP_AREA}>
          <MapPanel place={place} analysis={analysis} />
        </div>
        {analysis && (
          <TimeScrubber
            className="rounded-none! border-x-0! border-b-0! px-3! py-2.5! lg:px-4!"
            timeZone={analysis.timeZone}
            date={analysis.date}
            minuteOfDay={analysis.minuteOfDay}
            isLive={analysis.isLive}
            day={analysis.day}
          />
        )}
      </div>

      <main className={SIDE_PANEL}>
        {analysis ? (
          <>
            <PlaceHeader
              place={analysis.place}
              timeZone={analysis.timeZone}
              date={analysis.date}
              minuteOfDay={analysis.minuteOfDay}
              buildings={analysis.buildings}
            />
            <ObserverControls
              pinOnBuilding={analysis.pinOnBuilding}
              pinBuildingHeightM={pinBuildingHeightM}
            />
            {reportAnalysis && <ReportSection analysis={reportAnalysis} />}
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
