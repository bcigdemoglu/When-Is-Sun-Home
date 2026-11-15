"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import { Button } from "@/components/ui/Button";
import { pinSpot } from "@/hooks/placeActions";
import type { BuildingsStatus } from "@/lib/buildings/useBuildings";
import type { BuildingCollection, Place, SunInstant } from "@/lib/types";
import type { SunPathModel } from "./compassGeometry";
import { shouldAutoRetry } from "./contextLoss";
import { useMapUi } from "./mapUi";

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
      className="flex h-full w-full flex-col items-center justify-start gap-3 bg-surface-2 px-6 pt-[calc(var(--map-inset-top,0px)+3rem)] text-center lg:justify-center lg:pt-6"
    >
      <p className="type-card-title text-ink">The map can’t be shown</p>
      <p className="max-w-sm text-sm text-ink-2">
        This browser or device couldn’t start the 3D map (WebGL). You can still search for an
        address, and the sun report keeps working.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try the map again
      </Button>
    </div>
  );
}

const NOTICE =
  "flex w-fit max-w-full items-center gap-2.5 rounded-2xl border bg-surface px-3.5 py-2 text-[13px] leading-[18px] text-ink shadow-float";

/**
 * Says, on the map, when the shade is missing: while the buildings load or
 * after they failed to load, nothing here (and no number in the report)
 * accounts for them yet.
 */
function BuildingNotice({
  status,
  count,
  fetching,
  onRetry,
}: {
  status: BuildingsStatus;
  count: number | null;
  fetching: boolean;
  onRetry: (() => void) | null;
}) {
  if (status === "loading") {
    return (
      <p role="status" className={`${NOTICE} border-line`}>
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full border-2 border-line border-t-accent motion-safe:animate-spin"
        />
        <span>
          <strong className="font-semibold">Checking nearby buildings…</strong> Sun hours are before
          shading until then.
        </span>
      </p>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className={`${NOTICE} border-danger`}>
        <span>
          <strong className="font-semibold">Couldn’t load building heights.</strong> Showing sun
          without shading for now.
        </span>
        {onRetry && (
          <Button variant="primary" onClick={onRetry} disabled={fetching}>
            {fetching ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
    );
  }
  if (status === "ready" && count === 0) {
    return (
      <p role="status" className={`${NOTICE} border-line`}>
        No buildings are mapped around this spot: an open sky is assumed.
      </p>
    );
  }
  return null;
}

// Deliberately small props: nothing here changes identity on a slider tick
// except `instant` (three numbers).
interface MapPanelProps {
  place: Place | null;
  /** Buildings to draw; may be a neighbouring area's while the real ones load. */
  buildings: BuildingCollection | null;
  buildingStatus: BuildingsStatus;
  /** How many buildings were found, once known. */
  buildingCount: number | null;
  buildingsFetching: boolean;
  onRetryBuildings: (() => void) | null;
  sunPath: SunPathModel | null;
  instant: SunInstant | null;
  blockerBuildingId: string | null;
  pinBuildingId: string | null;
}

/**
 * The map with the search box floating over it. The map sits behind its own
 * error boundary: if WebGL is missing or dies, this panel says so and the rest
 * of the app carries on.
 */
export function MapPanel({
  place,
  buildings,
  buildingStatus,
  buildingCount,
  buildingsFetching,
  onRetryBuildings,
  sunPath,
  instant,
  blockerBuildingId,
  pinBuildingId,
}: MapPanelProps) {
  // What this browser remembers of the map (the Satellite choice): read once
  // the page is up, so the first paint is the same for everybody.
  useEffect(() => useMapUi.getState().hydrate(), []);

  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  // A map lost in the background (phones drop WebGL contexts there) usually
  // works again when the page is next looked at: try once by ourselves. The
  // allowance is renewed every time a map has loaded properly.
  const mapReady = useMapUi((state) => state.ready);
  const autoRetried = useRef(false);
  useEffect(() => {
    if (mapReady) autoRetried.current = false;
  }, [mapReady]);
  useEffect(() => {
    if (!failed) return;
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      if (!shouldAutoRetry({ failed: true, visible, alreadyRetried: autoRetried.current })) return;
      autoRetried.current = true;
      setFailed(false);
      setAttempt((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [failed]);

  // How much room the notice below takes at the top of the map (0 without
  // one), for whatever the map itself puts in its top-left corner — the
  // Trees layer's legend, on phones — to sit under it instead of behind it
  // (see `.maplibregl-ctrl-top-left` in globals.css).
  const panelRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const notice = noticeRef.current;
    if (!panel || !notice || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const height = notice.offsetHeight;
      panel.style.setProperty("--map-notice", height > 0 ? `${height + 8}px` : "0px");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(notice);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={panelRef} className="relative h-full w-full overflow-hidden bg-surface-2">
      {failed ? (
        <MapUnavailable onRetry={retry} />
      ) : (
        <ErrorBoundary key={attempt} fallback={() => <MapUnavailable onRetry={retry} />}>
          <SunMap
            place={place}
            buildings={buildings}
            sunPath={sunPath}
            instant={instant}
            blockerBuildingId={blockerBuildingId}
            pinBuildingId={pinBuildingId}
            onPlacePin={pinSpot}
            onFatalError={() => setFailed(true)}
          />
        </ErrorBoundary>
      )}

      {/* Only as large as the notice itself: nothing invisible lies over the map. */}
      <div
        ref={noticeRef}
        className="absolute top-[calc(var(--map-inset-top,0px)+8px)] right-3 left-3 z-10 mx-auto w-fit lg:mx-0"
      >
        <BuildingNotice
          status={buildingStatus}
          count={buildingCount}
          fetching={buildingsFetching}
          onRetry={onRetryBuildings}
        />
      </div>
    </div>
  );
}
