"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { keyDates as findKeyDates } from "@/components/controls/dayMenu";
import { dayTrackBackground } from "@/components/controls/dayTrack";
import { TimeBar } from "@/components/controls/TimeBar";
import { viewpointSummary } from "@/components/controls/viewpoint";
import { ViewpointControls } from "@/components/controls/ViewpointControls";
import { COMPASS_RADIUS, sunPathModel } from "@/components/map/compassGeometry";
import { MapControls } from "@/components/map/MapControls";
import { MapPanel } from "@/components/map/MapPanel";
import { useMapUi } from "@/components/map/mapUi";
import { SaveButton } from "@/components/places/SaveButton";
import { SavedPlaces } from "@/components/places/SavedPlaces";
import { SunSummaryHeader } from "@/components/report/SummaryHeader";
import { SunReport } from "@/components/report/SunReport";
import type { BuildingDataStatus } from "@/components/report/types";
import { SearchExperience } from "@/components/search/SearchExperience";
import type { PlaceSelection } from "@/components/search/types";
import { ShareButton } from "@/components/share/ShareButton";
import { formatCoordinates, zoneAbbreviation, zoneLabel } from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ArrowLeftIcon, ChevronDownIcon, PlacesIcon, ViewpointIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/Toaster";
import { readLegacyPlace } from "@/hooks/legacyPlace";
import { clearPlace, openSelection, pinNamedPlace } from "@/hooks/placeActions";
import { shiftMinute, shortcutFor, usesKeysItself } from "@/hooks/shortcuts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNow } from "@/hooks/useNow";
import { usePacedValue } from "@/hooks/usePacedValue";
import { useSunAnalysis } from "@/hooks/useSunAnalysis";
import { summarizeYear } from "@/lib/analysis";
import { selectObserver, selectPlace, useHydrateSettings, useSettings, useUrlSync } from "@/state";
import {
  hydratePlaces,
  placeEntryId,
  selectSavedEntry,
  usePlaces,
  type PlaceEntry,
} from "@/state/places";
import { BottomSheet, type BottomSheetHandle } from "./BottomSheet";
import { ErrorBoundary } from "./ErrorBoundary";
import { StartExtras, StartIntro } from "./StartPanel";

/**
 * The report (a tall column of charts) is the most expensive thing to redraw.
 * While something is dragged or animated it gets new numbers at most 20 times
 * a second, and less often when a redraw turns out to be slow, so it can never
 * hold the sliders or the map back. It always ends on the final value.
 */
const REPORT_PACING = { minIntervalMs: 50, loadFactor: 3, allowanceMs: 40 };

/** A place counts as "looked at" once it has been on screen this long, ms. */
const RECORD_VISIT_DELAY_MS = 1200;

/** Desktop: the floating time bar's height plus its margins, px. */
const DESKTOP_TIMEBAR_CLEARANCE = 96;
/** Phone: where the sheet stops at "full" until the search pill has been measured, px. */
const DEFAULT_TOP_INSET = 76;

const ROOT = "relative h-dvh overflow-hidden lg:grid lg:grid-cols-[440px_minmax(0,1fr)]";
const MAP_AREA = "fixed inset-0 lg:relative lg:inset-auto lg:col-start-2 lg:row-start-1 lg:h-dvh";
const PANEL =
  "relative z-10 col-start-1 row-start-1 flex h-dvh min-w-0 flex-col border-r border-line bg-page";

/**
 * Hand over to the search experience, whichever form it has right now: a text
 * field to focus (desktop), or a pill to press that opens the full-screen
 * search (phones).
 */
function openSearch(container: HTMLElement | null): void {
  if (!container) return;
  const field = container.querySelector<HTMLInputElement>("input");
  if (field) field.focus();
  else container.querySelector<HTMLButtonElement>("button")?.click();
}

function selectDateTime(date: string, minuteOfDay?: number): void {
  const settings = useSettings.getState();
  if (minuteOfDay === undefined) settings.setDate(date);
  else settings.setDateTime(date, minuteOfDay);
}

function reportFailed(_error: unknown, reset: () => void) {
  return (
    <Card title="Sun report">
      <p className="type-body text-ink-2">
        The report couldn’t be drawn. The map and the controls still work.
      </p>
      <Button className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}

/** What the page looks like before the saved settings are known. */
function ShellSkeleton() {
  return (
    <div className={ROOT} role="status" aria-label="Loading">
      <div className={`${MAP_AREA} bg-surface-2`} />
      <div className="fixed inset-x-0 bottom-0 h-[42dvh] rounded-t-sheet bg-surface shadow-sheet lg:hidden" />
      <div className={`${PANEL} max-lg:hidden`}>
        <div className="border-b border-line bg-surface px-6 py-4">
          <div className="h-12 rounded-full bg-surface-2" />
        </div>
        <div className="space-y-3 px-6 py-5">
          <div className="h-40 rounded-card border border-line bg-surface" />
          <div className="h-72 rounded-card border border-line bg-surface" />
        </div>
      </div>
    </div>
  );
}

function PlacesButton({ onClick, expanded }: { onClick(): void; expanded: boolean }) {
  const count = usePlaces((state) => state.saved.length);
  return (
    <button
      type="button"
      aria-label={count > 0 ? `Saved places (${count})` : "Saved places"}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-float hover:bg-surface-2 lg:shadow-none"
      onClick={onClick}
    >
      <PlacesIcon />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] leading-none font-semibold text-surface tabular-nums"
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Workspace() {
  const isDesktop = useIsDesktop();
  const place = useSettings(selectPlace);
  const liveObserver = useSettings(selectObserver);
  const analysis = useSunAnalysis();
  const report = usePacedValue(analysis, REPORT_PACING);

  const sheetRef = useRef<BottomSheetHandle>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLElement>(null);
  const timeBarRef = useRef<HTMLDivElement>(null);

  const [placesOpen, setPlacesOpen] = useState(false);
  const [viewpointOpen, setViewpointOpen] = useState(false);
  const [topInset, setTopInset] = useState(DEFAULT_TOP_INSET);
  const [peek, setPeek] = useState(0);

  // ── Report inputs (paced) ───────────────────────────────────────────────
  const reportStatus = report ? report.buildings.status : "idle";
  const reportStats = report ? report.buildings.stats : null;
  const reportRetry = report ? report.buildings.refetch : null;
  const reportBuildings = useMemo<BuildingDataStatus>(
    () => ({ status: reportStatus, stats: reportStats, onRetry: reportRetry ?? (() => {}) }),
    [reportStatus, reportStats, reportRetry],
  );

  // ── Small, stable values for everything that redraws on a slider tick ───
  // (the day's analysis itself — 1440 samples — only travels to the report)
  const day = analysis ? analysis.day : null;
  const year = analysis ? analysis.year : null;
  const timeZone = analysis ? analysis.timeZone : null;
  const track = useMemo(() => dayTrackBackground(day), [day]);
  const sunPath = useMemo(() => (day ? sunPathModel(day, COMPASS_RADIUS) : null), [day]);
  const keyDates = useMemo(() => (year ? findKeyDates(year) : null), [year]);
  const now = useNow(timeZone);
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

  // ── Saved / recent places ───────────────────────────────────────────────
  useEffect(() => {
    hydratePlaces();
  }, []);
  // Headline numbers are only worth keeping once the buildings are in them.
  const measuredYear = analysis && !analysis.isUnobstructed ? analysis.year : null;
  const summary = useMemo(
    () => (measuredYear ? summarizeYear(measuredYear) : null),
    [measuredYear],
  );
  const analysedPlace = analysis ? analysis.place : null;
  const analysedObserver = analysis ? analysis.observer : null;
  useEffect(() => {
    if (!analysedPlace || !analysedObserver) return;
    // Once per place / viewpoint, and again when its numbers arrive.
    const timer = setTimeout(
      () => usePlaces.getState().recordVisit(analysedPlace, analysedObserver, summary),
      RECORD_VISIT_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [analysedPlace, analysedObserver, summary]);
  const savedEntry = usePlaces((state) => selectSavedEntry(state, place));
  const activeId = place ? placeEntryId(place) : null;
  const placeLabel = place
    ? (savedEntry?.label ?? place.name ?? formatCoordinates(place.lat, place.lng))
    : "";

  // ── Navigation between places ───────────────────────────────────────────
  const lat = place ? place.lat : null;
  const lng = place ? place.lng : null;
  useEffect(() => {
    // A new place: show it. The sheet steps back to let the map through.
    sheetRef.current?.snapTo("peek");
  }, [lat, lng]);

  const focusSearch = () => openSearch(searchRef.current);
  const onSelect = (selection: PlaceSelection) => {
    openSelection(selection);
    setPlacesOpen(false);
    sheetRef.current?.snapTo("peek");
  };
  const onChooseOnMap = () => {
    sheetRef.current?.snapTo("peek");
    showToast("Tap the map where you want the pin");
  };
  const onOpenEntry = (entry: PlaceEntry) => {
    pinNamedPlace(entry.place, entry.observer);
    setPlacesOpen(false);
    sheetRef.current?.snapTo("peek");
  };
  // A tap in the report (a day in the heat map, say): go there, and on a
  // phone get the sheet out of the way so the map shows that moment.
  const onSelectDateTime = useCallback((date: string, minuteOfDay?: number) => {
    selectDateTime(date, minuteOfDay);
    sheetRef.current?.snapTo("peek");
  }, []);

  // ── Keyboard: ← → move the time, / focuses the search ───────────────────
  const currentMinute = analysis ? analysis.minuteOfDay : null;
  const minuteRef = useRef(currentMinute);
  useEffect(() => {
    minuteRef.current = currentMinute;
  }, [currentMinute]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event, usesKeysItself(event.target));
      if (!action) return;
      if (action.type === "focus-search") {
        event.preventDefault();
        openSearch(searchRef.current);
      } else if (minuteRef.current !== null) {
        event.preventDefault();
        useSettings.getState().setMinuteOfDay(shiftMinute(minuteRef.current, action.deltaMinutes));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── What covers the map (so the camera and its controls keep clear) ─────
  const hasTimeBar = analysis !== null;
  useEffect(() => {
    if (isDesktop) {
      useMapUi.getState().setInsets({ top: 0, bottom: hasTimeBar ? DESKTOP_TIMEBAR_CLEARANCE : 0 });
    }
  }, [isDesktop, hasTimeBar]);
  useEffect(() => {
    // The search pill: the sheet stops just below it, and so do the map's own corners.
    const bar = topBarRef.current;
    if (isDesktop || !bar) return;
    const measure = () => {
      const pill = bar.firstElementChild;
      const bottom = (pill ?? bar).getBoundingClientRect().bottom;
      // (An open search takeover may fill the screen: never take that for the pill.)
      if (bottom > 0 && bottom < 160) setTopInset(Math.round(bottom) + 8);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isDesktop]);
  const onSheetSettle = useCallback(
    (visibleHeight: number) => {
      const timeBar = timeBarRef.current ? timeBarRef.current.offsetHeight : 0;
      // Beyond half the screen the map is mostly hidden: no point chasing the sheet further.
      const covered = Math.min(visibleHeight, Math.round(window.innerHeight * 0.55));
      useMapUi.getState().setInsets({ top: topInset, bottom: timeBar + covered });
    },
    [topInset],
  );

  const cssVariables: Record<string, string> = isDesktop
    ? { "--map-inset-bottom": hasTimeBar ? `${DESKTOP_TIMEBAR_CLEARANCE}px` : "0px" }
    : {
        "--timebar": hasTimeBar ? "calc(64px + var(--safe-bottom))" : "0px",
        "--map-inset-top": `${topInset}px`,
        "--map-inset-bottom": `calc(var(--timebar) + ${peek}px)`,
      };
  const rootStyle = cssVariables as CSSProperties;

  // ── Pieces shared by both layouts ───────────────────────────────────────
  const search = (
    <SearchExperience
      variant={isDesktop ? "panel" : "overlay"}
      place={place}
      onSelect={onSelect}
      onChooseOnMap={onChooseOnMap}
      onClear={clearPlace}
    />
  );
  const timeBar = analysis && (
    <TimeBar
      variant={isDesktop ? "floating" : "docked"}
      className={isDesktop ? "pointer-events-auto w-full max-w-[720px]" : ""}
      zoneLabel={zoneText}
      zone={zone}
      date={analysis.date}
      minuteOfDay={analysis.minuteOfDay}
      isLive={analysis.isLive}
      today={now ? now.date : null}
      nowMinute={now ? now.minuteOfDay : null}
      track={track}
      sunriseMinute={day ? day.sunriseMinute : null}
      sunsetMinute={day ? day.sunsetMinute : null}
      sunState={analysis.instant ? analysis.instant.state : null}
      keyDates={keyDates}
    />
  );
  const summaryHeader = analysis && (
    <SunSummaryHeader
      date={analysis.date}
      minuteOfDay={analysis.minuteOfDay}
      isLive={analysis.isLive}
      day={analysis.day}
      instant={analysis.instant}
      year={analysis.year}
      buildingsStatus={analysis.buildings.status}
    />
  );
  const sunReport = report && (
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
        terrain={report.terrainStatus}
        pinOnBuilding={report.pinOnBuilding}
        onSelectDateTime={onSelectDateTime}
      />
    </ErrorBoundary>
  );
  const viewpoint = analysis && (
    <ViewpointControls
      pinOnBuilding={analysis.pinOnBuilding}
      pinBuildingHeightM={pinBuildingHeightM}
    />
  );
  const actions = (variant: "pill" | "icon") =>
    place && (
      <>
        <SaveButton place={place} observer={liveObserver} summary={summary} variant={variant} />
        <ShareButton place={place} label={placeLabel} summary={summary} variant={variant} />
      </>
    );

  return (
    <div className={ROOT} style={rootStyle}>
      <div className={MAP_AREA}>
        <MapPanel
          place={place}
          buildings={analysis ? analysis.buildings.buildings : null}
          buildingStatus={analysis ? analysis.buildings.status : "idle"}
          buildingCount={
            analysis && analysis.buildings.stats ? analysis.buildings.stats.total : null
          }
          buildingsFetching={analysis ? analysis.buildings.isFetching : false}
          onRetryBuildings={analysis ? analysis.buildings.refetch : null}
          sunPath={sunPath}
          instant={analysis ? analysis.instant : null}
          blockerBuildingId={analysis ? analysis.blockerBuildingId : null}
          pinBuildingId={analysis ? analysis.pinBuildingId : null}
        />
        {isDesktop && (
          <>
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center">
              {timeBar}
            </div>
            <MapControls
              variant="full"
              hasPlace={place !== null}
              className="absolute right-4 bottom-[calc(var(--map-inset-bottom,0px)+16px)] z-10"
            />
            <Toaster className="absolute bottom-[calc(var(--map-inset-bottom,0px)+16px)] left-4 z-30" />
          </>
        )}
      </div>

      {isDesktop ? (
        <aside className={PANEL}>
          <div className="relative z-20 flex shrink-0 items-start gap-2 border-b border-line bg-surface px-6 py-4">
            <div ref={searchRef} className="min-w-0 flex-1">
              {search}
            </div>
            <PlacesButton expanded={placesOpen} onClick={() => setPlacesOpen((open) => !open)} />
          </div>
          <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {placesOpen ? (
              <PlacesView onBack={() => setPlacesOpen(false)}>
                <SavedPlaces activeId={activeId} onOpen={onOpenEntry} />
              </PlacesView>
            ) : analysis ? (
              <>
                <header>
                  <h1 className="type-title line-clamp-2 text-ink">{placeLabel}</h1>
                  <p className="type-label mt-1 text-ink-2">
                    <span className="tabular-nums">
                      {formatCoordinates(analysis.place.lat, analysis.place.lng)}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span title={analysis.timeZone}>{zoneText}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">{actions("pill")}</div>
                </header>
                {summaryHeader}
                <ViewpointSection summary={viewpointSummary(liveObserver)}>
                  {viewpoint}
                </ViewpointSection>
                {sunReport}
              </>
            ) : (
              <Card>
                <StartIntro onEnterAddress={focusSearch} />
                <div className="mt-5 border-t border-line pt-4">
                  <StartExtras onOpen={onOpenEntry} />
                </div>
              </Card>
            )}
          </main>
        </aside>
      ) : (
        <>
          <header
            ref={topBarRef}
            className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start gap-2 pt-[calc(var(--safe-top)+12px)] pr-[calc(var(--safe-right)+12px)] pl-[calc(var(--safe-left)+12px)]"
          >
            <div ref={searchRef} className="pointer-events-auto min-w-0 flex-1">
              {search}
            </div>
            <div className="pointer-events-auto">
              <PlacesButton expanded={placesOpen} onClick={() => setPlacesOpen(true)} />
            </div>
          </header>

          {analysis ? (
            <BottomSheet
              key="place"
              ref={sheetRef}
              label="Sun report"
              topInset={topInset}
              halfRatio={0.5}
              onSettle={onSheetSettle}
              onPeekChange={setPeek}
              fabs={<MapControls variant="fabs" hasPlace />}
              header={
                <div className="px-4 pb-3">
                  <h1 className="sr-only">{placeLabel}</h1>
                  {summaryHeader}
                  <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
                    {actions("pill")}
                    <Button
                      variant="tonal"
                      aria-haspopup="dialog"
                      aria-label={`Viewpoint: ${viewpointSummary(liveObserver)}. Change`}
                      onClick={() => setViewpointOpen(true)}
                    >
                      <ViewpointIcon />
                      {viewpointSummary(liveObserver)}
                    </Button>
                  </div>
                </div>
              }
            >
              <main className="space-y-3 px-3 pb-6">{sunReport}</main>
            </BottomSheet>
          ) : (
            <BottomSheet
              key="start"
              ref={sheetRef}
              label="Get started"
              topInset={topInset}
              halfRatio={null}
              onSettle={onSheetSettle}
              onPeekChange={setPeek}
              header={
                <main className="px-5 pt-1 pb-[calc(1.25rem+var(--safe-bottom))]">
                  <StartIntro onEnterAddress={focusSearch} />
                </main>
              }
            >
              <div className="px-5 pb-8">
                <StartExtras onOpen={onOpenEntry} />
              </div>
            </BottomSheet>
          )}

          {timeBar && (
            <div ref={timeBarRef} className="fixed inset-x-0 bottom-0 z-30">
              {timeBar}
            </div>
          )}
          <Toaster className="fixed inset-x-4 bottom-[calc(var(--timebar)+12px)] z-50" />

          <Dialog open={viewpointOpen} onClose={() => setViewpointOpen(false)} title="Viewpoint">
            {viewpoint}
          </Dialog>
          <Dialog open={placesOpen} onClose={() => setPlacesOpen(false)} title="Places" hideTitle>
            <SavedPlaces activeId={activeId} onOpen={onOpenEntry} />
          </Dialog>
        </>
      )}
    </div>
  );
}

/** Desktop: the saved places take over the panel, with a way back. */
function PlacesView({ onBack, children }: { onBack(): void; children: ReactNode }) {
  return (
    <section aria-label="Places">
      <Button variant="ghost" className="-ml-3 mb-2" onClick={onBack}>
        <ArrowLeftIcon />
        Back
      </Button>
      {children}
    </section>
  );
}

/** Desktop: the viewpoint controls fold away under a one-line summary. */
function ViewpointSection({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-card border border-line bg-surface">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          className="flex min-h-14 w-full items-center gap-3 rounded-card px-5 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <ViewpointIcon className="shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1">
            <span className="type-card-title block text-ink">Viewpoint</span>
            <span className="type-label block truncate text-ink-2">{summary}</span>
          </span>
          <ChevronDownIcon
            className={`shrink-0 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      {open && <div className="border-t border-line p-5">{children}</div>}
    </section>
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
