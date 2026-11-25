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
import { daylightFromGrid, keyDates as findKeyDates } from "@/components/controls/dayMenu";
import { dayTrackBackground } from "@/components/controls/dayTrack";
import { TimeBar } from "@/components/controls/TimeBar";
import { ViewpointControls } from "@/components/controls/ViewpointControls";
import { COMPASS_RADIUS, sunPathModel } from "@/components/map/compassGeometry";
import { MapControls } from "@/components/map/MapControls";
import { MapPanel } from "@/components/map/MapPanel";
import { useMapUi } from "@/components/map/mapUi";
import { SaveButton } from "@/components/places/SaveButton";
import { SavedPlaces } from "@/components/places/SavedPlaces";
import { SunSummaryHeader } from "@/components/report/SummaryHeader";
import { SunReport, type ReportSection } from "@/components/report/SunReport";
import type { BuildingDataStatus } from "@/components/report/types";
import { SearchExperience } from "@/components/search/SearchExperience";
import type { PlaceSelection } from "@/components/search/types";
import { ShareButton } from "@/components/share/ShareButton";
import { formatCoordinates } from "@/components/shared/format";
import { viewpointLabel } from "@/components/shared/viewpoint";
import { zoneAbbreviation, zoneLabel } from "@/components/shared/zone";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ArrowLeftIcon, ChevronDownIcon, PlacesIcon, ViewpointIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/Toaster";
import { readLegacyPlace } from "@/hooks/legacyPlace";
import { clearPlace, nameCurrentPlace, openSelection, pinNamedPlace } from "@/hooks/placeActions";
import { overlayIsOpen, shiftMinute, shortcutFor, usesKeysItself } from "@/hooks/shortcuts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNow } from "@/hooks/useNow";
import { usePacedValue } from "@/hooks/usePacedValue";
import { isSameSpot } from "@/hooks/sunAnalysis";
import { useSunAnalysis } from "@/hooks/useSunAnalysis";
import { summarizeYear, sunTimesFor } from "@/lib/analysis";
import {
  selectObserver,
  selectPlace,
  setLinkSummary,
  useHydrateSettings,
  useSettings,
  useUrlSync,
} from "@/state";
import {
  hydratePlaces,
  placeEntryId,
  selectSavedEntry,
  usePlaces,
  type PlaceEntry,
} from "@/state/places";
import { BottomSheet, type BottomSheetHandle, type SheetContent } from "./BottomSheet";
import { ErrorBoundary } from "./ErrorBoundary";
import { HomeScreenHint } from "./HomeScreenHint";
import { REPORT_TABS_HEIGHT, ReportTabs } from "./ReportTabs";
import type { Detent } from "./sheetGeometry";
import { StartExtras, StartIntro } from "./StartPanel";
import { toastPlacement, type SheetRest } from "./toastPlacement";
import { useSectionLink } from "./useSectionLink";

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
/** Phone: height of the sheet's sticky handle row, px (see BottomSheet). */
const SHEET_HANDLE_HEIGHT = 28;
/** Phone: where the sheet stops at "full" until the search pill has been measured, px. */
const DEFAULT_TOP_INSET = 76;

// `overflow: clip`, not `hidden`: a hidden box can still be scrolled by script
// (`scrollIntoView` on something inside it), which would shove the whole app up.
const ROOT = "relative h-dvh overflow-clip lg:grid lg:grid-cols-[440px_minmax(0,1fr)]";
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
  const pacedAnalysis = usePacedValue(analysis, REPORT_PACING);
  // Pacing is for ticks at ONE place. A new place is shown at once: the report
  // must never sit under a new title with the previous place's numbers.
  const report = isSameSpot(pacedAnalysis, analysis) ? pacedAnalysis : analysis;

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
  const timeZone = analysis ? analysis.timeZone : null;
  const track = useMemo(() => dayTrackBackground(day), [day]);
  const sunPath = useMemo(() => (day ? sunPathModel(day, COMPASS_RADIUS) : null), [day]);
  // Solstices depend on the place and the year only — i.e. on the sun grid,
  // which (unlike the year analysis) does not change while a viewpoint slider
  // is dragged.
  const grid = analysis ? analysis.grid : null;
  const keyDates = useMemo(() => {
    if (!grid) return null;
    const { lat, lng, timeZone: zoneOfGrid } = grid;
    return findKeyDates({ year: grid.year, days: daylightFromGrid(grid) }, (date) => {
      const { sunriseMinute, sunsetMinute } = sunTimesFor(lat, lng, date, zoneOfGrid);
      return sunriseMinute !== null && sunsetMinute !== null && sunsetMinute > sunriseMinute
        ? sunsetMinute - sunriseMinute
        : null;
    });
  }, [grid]);
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
  // Headline numbers are only worth keeping once they are final: buildings
  // in, and the ground elevations in (or known not to be coming).
  const measuredYear = analysis && analysis.isSettled ? analysis.year : null;
  const summary = useMemo(
    () => (measuredYear ? summarizeYear(measuredYear) : null),
    [measuredYear],
  );
  // The address bar carries the same numbers, so a link shared from it (Safari's
  // share button, copy and paste) previews with the place's sun hours.
  useEffect(() => {
    setLinkSummary(summary);
    return () => setLinkSummary(null);
  }, [summary]);
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
  // The place's REAL name — its saved label, else its address — or "" when it
  // has none. Sharing gets exactly this: an unnamed pin must not travel under
  // its coordinates as if they were a name (the recipient's app would then
  // never look the address up). On screen, coordinates stand in.
  const placeName = place ? (savedEntry?.label ?? place.name ?? "") : "";
  const placeLabel = place ? placeName || formatCoordinates(place.lat, place.lng) : "";

  // ── Navigation between places ───────────────────────────────────────────
  const lat = place ? place.lat : null;
  const lng = place ? place.lng : null;
  useEffect(() => {
    // A new place: show it. The sheet steps back to let the map through.
    sheetRef.current?.snapTo("peek");
  }, [lat, lng]);

  // A section link (`/?…#trees`): the report opens scrolled to that section —
  // on phones with the sheet at full. Runs once, after the snap to peek above.
  const isDesktopRef = useRef(isDesktop);
  useEffect(() => {
    isDesktopRef.current = isDesktop;
  }, [isDesktop]);
  const canJumpToSection = useCallback(
    () => isDesktopRef.current || sheetRef.current?.isMeasured() === true,
    [],
  );
  useSectionLink({
    hasPlace: place !== null,
    canJump: canJumpToSection,
    settled: analysis ? analysis.isSettled : false,
  });

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
  // A tap in the report (a day in the heat map, say) goes to that moment. The
  // sheet stays where it is: someone exploring the charts keeps their place,
  // and the report's own cards update around the selection.
  const onSelectDateTime = useCallback((date: string, minuteOfDay?: number) => {
    selectDateTime(date, minuteOfDay);
  }, []);

  // ── Keyboard: ← → move the time, / focuses the search ───────────────────
  const currentMinute = analysis ? analysis.minuteOfDay : null;
  const minuteRef = useRef(currentMinute);
  useEffect(() => {
    minuteRef.current = currentMinute;
  }, [currentMinute]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const busy = usesKeysItself(event.target) || overlayIsOpen(document);
      const action = shortcutFor(event, busy);
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
  const [sheetRest, setSheetRest] = useState<SheetRest | null>(null);
  const onSheetSettle = useCallback(
    (visibleHeight: number, detent: Detent) => {
      const timeBar = timeBarRef.current ? timeBarRef.current.offsetHeight : 0;
      // Beyond half the screen the map is mostly hidden: no point chasing the sheet further.
      const covered = Math.min(visibleHeight, Math.round(window.innerHeight * 0.55));
      // (The map ends at the time bar's top edge, so only the sheet covers it.)
      useMapUi.getState().setInsets({ top: topInset, bottom: covered });
      // The toasts rest just above the sheet's edge (see `toastPlacement`).
      const height = Math.round(visibleHeight);
      const roomAbove = Math.round(window.innerHeight - topInset - timeBar - visibleHeight);
      setSheetRest((previous) =>
        previous &&
        previous.height === height &&
        previous.detent === detent &&
        previous.roomAbove === roomAbove
          ? previous
          : { height, detent, roomAbove },
      );
    },
    [topInset],
  );

  // Report jump tabs: where they stick, and where a section comes to rest below them.
  const tabsTop = isDesktop ? 0 : topInset + SHEET_HANDLE_HEIGHT;
  const anchorOffset = tabsTop + REPORT_TABS_HEIGHT + 12;

  const cssVariables: Record<string, string> = isDesktop
    ? {
        "--map-inset-bottom": hasTimeBar ? `${DESKTOP_TIMEBAR_CLEARANCE}px` : "0px",
        "--report-anchor-offset": `${anchorOffset}px`,
      }
    : {
        "--report-anchor-offset": `${anchorOffset}px`,
        "--timebar": hasTimeBar ? "calc(64px + var(--safe-bottom))" : "0px",
        "--map-inset-top": `${topInset}px`,
        // The map ends where the time bar begins: only the sheet covers it.
        "--map-inset-bottom": `${peek}px`,
      };
  const rootStyle = cssVariables as CSSProperties;
  // The toasts can be rendered outside this tree (inside an open dialog), so
  // the one measurement they need lives on the document itself.
  useEffect(() => {
    const spot = toastPlacement({
      isDesktop,
      hasTimeBar,
      desktopClearance: DESKTOP_TIMEBAR_CLEARANCE,
      sheet: sheetRest,
      // The map buttons ride on the report sheet only (the start sheet has none).
      hasFabs: hasTimeBar,
    });
    const root = document.documentElement.style;
    root.setProperty("--toast-bottom", spot.bottom);
    root.setProperty("--toast-right", spot.right);
    root.setProperty("--toast-bottom-modal", spot.modalBottom);
  }, [isDesktop, hasTimeBar, sheetRest]);

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
      className={isDesktop ? "w-full" : ""}
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
  // Each section's own share button: a link that opens the report at it.
  const renderSectionShare = useCallback(
    (section: ReportSection) =>
      place && (
        <ShareButton
          place={place}
          label={placeName}
          summary={summary}
          section={section}
          variant="icon-sm"
        />
      ),
    [place, placeName, summary],
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
        renderSectionShare={renderSectionShare}
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
        <ShareButton place={place} label={placeName} summary={summary} variant={variant} />
      </>
    );

  const map = (
    <>
      <MapPanel
        place={place}
        buildings={analysis ? analysis.buildings.buildings : null}
        buildingStatus={analysis ? analysis.buildings.status : "idle"}
        buildingCount={analysis && analysis.buildings.stats ? analysis.buildings.stats.total : null}
        buildingsFetching={analysis ? analysis.buildings.isFetching : false}
        onRetryBuildings={analysis ? analysis.buildings.refetch : null}
        sunPath={sunPath}
        instant={analysis ? analysis.instant : null}
        blockerBuildingId={analysis ? analysis.blockerBuildingId : null}
        pinBuildingId={analysis ? analysis.pinBuildingId : null}
      />
      {isDesktop && (
        <>
          {/* Exactly as wide as the card: nothing invisible lies over the map. */}
          <div className="absolute inset-x-4 bottom-4 z-10 mx-auto max-w-[720px]">{timeBar}</div>
          <MapControls
            variant="full"
            hasPlace={place !== null}
            className="absolute right-4 bottom-[calc(var(--map-inset-bottom,0px)+16px)] z-10"
          />
        </>
      )}
    </>
  );

  // Phones: what rides over the map. (Desktop has the side panel instead.)
  const sheet: SheetContent | null = isDesktop
    ? null
    : analysis
      ? {
          key: "place",
          label: "Sun report",
          halfRatio: 0.5,
          fabs: <MapControls variant="fabs" hasPlace />,
          header: (
            <div className="px-4 pb-3">
              <h1 className="sr-only">{placeLabel}</h1>
              {summaryHeader}
              <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
                {actions("pill")}
                <Button
                  variant="tonal"
                  aria-haspopup="dialog"
                  aria-label={`Viewpoint: ${viewpointLabel(liveObserver)}. Change`}
                  onClick={() => setViewpointOpen(true)}
                >
                  <ViewpointIcon />
                  {viewpointLabel(liveObserver)}
                </Button>
              </div>
            </div>
          ),
          content: (
            <>
              <ReportTabs
                stickyTop={tabsTop}
                anchorOffset={anchorOffset}
                resetKey={activeId ?? ""}
                className="bg-surface px-1"
              />
              <main className="space-y-3 px-3 pt-3 pb-6">{sunReport}</main>
            </>
          ),
        }
      : {
          key: "start",
          label: "Get started",
          halfRatio: null,
          header: (
            <main className="px-5 pt-1 pb-[calc(1.25rem+var(--safe-bottom))]">
              <StartIntro onEnterAddress={focusSearch} />
            </main>
          ),
          content: (
            <div className="px-5 pb-8">
              <StartExtras onOpen={onOpenEntry} />
            </div>
          ),
        };

  return (
    <div className={ROOT} style={rootStyle}>
      {/*
        The search pill's strip, on phones. It comes BEFORE the map and sheet in
        the document so keyboard and screen-reader order starts at the search,
        as the screen does; it stays a sibling of the sheet's scroller so the
        stylesheet can turn it solid once the sheet is up (see `.sheet-topbar`).
        A stable slot: on desktop it renders nothing, and the element after it
        keeps its identity, so the map is still created exactly once.
      */}
      {isDesktop ? null : (
        <header
          ref={topBarRef}
          className="sheet-topbar fixed inset-x-0 top-0 z-40 flex items-start gap-2 pt-[calc(var(--safe-top)+12px)] pr-[calc(var(--safe-right)+12px)] pb-2 pl-[calc(var(--safe-left)+12px)]"
        >
          <div ref={searchRef} className="min-w-0 flex-1">
            {search}
          </div>
          <PlacesButton expanded={placesOpen} onClick={() => setPlacesOpen(true)} />
        </header>
      )}

      {/*
        The map — and, on phones, the sheet that scrolls over it. One element
        in one place for every layout, so the map is created exactly once.
      */}
      <BottomSheet
        ref={sheetRef}
        map={map}
        sheet={sheet}
        topInset={topInset}
        onSettle={onSheetSettle}
        onPeekChange={setPeek}
      />

      {/*
        One toaster for everything. It lives in the top layer (and inside the
        top-most open dialog), so it is positioned against the viewport: bottom
        centre above the time bar on phones, bottom left of the map on desktop.
      */}
      <Toaster className="fixed right-[var(--toast-right,16px)] bottom-[var(--toast-bottom,12px)] left-4 data-[in-modal]:right-4 data-[in-modal]:bottom-[var(--toast-bottom-modal,12px)] lg:right-auto lg:left-[456px] lg:data-[in-modal]:right-auto" />

      {isDesktop ? (
        <aside className={PANEL}>
          <div className="relative z-20 flex shrink-0 items-start gap-2 border-b border-line bg-surface px-6 py-4">
            <div ref={searchRef} className="min-w-0 flex-1">
              {search}
            </div>
            <PlacesButton expanded={placesOpen} onClick={() => setPlacesOpen((open) => !open)} />
          </div>
          {/* No padding on the scroller itself: sticky rows stick to its very top. */}
          <main className="min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-3 py-5">
              {placesOpen ? (
                <PlacesView onBack={() => setPlacesOpen(false)}>
                  <HomeScreenHint className="mb-4" />
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
                  <ViewpointSection summary={viewpointLabel(liveObserver)}>
                    {viewpoint}
                  </ViewpointSection>
                  <ReportTabs
                    stickyTop={tabsTop}
                    anchorOffset={anchorOffset}
                    resetKey={activeId ?? ""}
                    className="-mx-6 bg-page px-3"
                  />
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
            </div>
          </main>
        </aside>
      ) : (
        <>
          {timeBar && (
            <div ref={timeBarRef} className="fixed inset-x-0 bottom-0 z-30">
              {timeBar}
            </div>
          )}

          <Dialog open={viewpointOpen} onClose={() => setViewpointOpen(false)} title="Viewpoint">
            {viewpoint}
          </Dialog>
          <Dialog open={placesOpen} onClose={() => setPlacesOpen(false)} title="Places">
            <HomeScreenHint className="mb-4" />
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

  // A pin that arrived by link (or from storage) with bare coordinates gets
  // an address label in the background, like any freshly dropped pin.
  useEffect(() => {
    if (hydrated) nameCurrentPlace();
  }, [hydrated]);

  if (!hydrated) return <ShellSkeleton />;
  return <Workspace />;
}
