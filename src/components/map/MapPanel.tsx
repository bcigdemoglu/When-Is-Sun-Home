"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import { SearchBox } from "@/components/search/SearchBox";
import { Button } from "@/components/ui/Button";
import { pinSpot, pinSuggestion } from "@/hooks/placeActions";
import type { SunAnalysis } from "@/hooks/useSunAnalysis";
import type { Place } from "@/lib/types";

function MapLoading() {
  return (
    <div
      role="status"
      aria-label="Loading the map"
      className="h-full w-full bg-surface-2 motion-safe:animate-pulse"
    />
  );
}

// MapLibre needs a browser (WebGL, workers): never render it on the server.
const SunMap = dynamic(() => import("./SunMap"), { ssr: false, loading: MapLoading });

function MapUnavailable({ onRetry }: { onRetry(): void }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-2 p-6 pt-20 text-center"
    >
      <p className="text-base font-semibold text-ink">The map can’t be shown</p>
      <p className="max-w-sm text-sm text-ink-2">
        This browser or device couldn’t start the 3D map (WebGL). You can still search for an
        address above, and the sun report keeps working.
      </p>
      <Button onClick={onRetry}>Try the map again</Button>
    </div>
  );
}

interface MapPanelProps {
  place: Place | null;
  analysis: SunAnalysis | null;
}

/**
 * The map with the search box floating over it. The map sits behind its own
 * error boundary: if WebGL is missing or dies, this panel says so and the rest
 * of the app carries on.
 */
export function MapPanel({ place, analysis }: MapPanelProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const buildingStatus = analysis ? analysis.buildings.status : "idle";

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-2">
      {failed ? (
        <MapUnavailable onRetry={retry} />
      ) : (
        <ErrorBoundary key={attempt} fallback={() => <MapUnavailable onRetry={retry} />}>
          <SunMap
            place={place}
            buildings={analysis ? analysis.buildings.buildings : null}
            day={analysis ? analysis.day : null}
            instant={analysis ? analysis.instant : null}
            blockerBuildingId={analysis ? analysis.blockerBuildingId : null}
            pinBuildingId={analysis ? analysis.pinBuildingId : null}
            onPlacePin={pinSpot}
            onFatalError={() => setFailed(true)}
          />
        </ErrorBoundary>
      )}

      <div className="absolute top-2.5 left-2.5 z-20 w-[min(22rem,calc(100%-4.25rem))]">
        <SearchBox bias={place} onSelect={pinSuggestion} />
        {buildingStatus === "loading" && (
          <p
            aria-hidden="true"
            className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-md"
          >
            <span className="h-3 w-3 rounded-full border-2 border-line border-t-accent motion-safe:animate-spin" />
            Loading buildings…
          </p>
        )}
        {buildingStatus === "error" && (
          <p
            aria-hidden="true"
            className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-danger bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-md"
          >
            No building data: shade is not shown
          </p>
        )}
      </div>
    </div>
  );
}
