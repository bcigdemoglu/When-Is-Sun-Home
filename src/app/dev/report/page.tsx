"use client";

/**
 * Developer harness for the sun report: renders <SunSummaryHeader> and
 * <SunReport> with REAL props computed by the engine from the recorded
 * Pacific Heights building fixture, in a column as wide as the app's sheet.
 *
 * Query parameters:
 *   w               column width in px: 390 (phone sheet, default), 440 (desktop panel), …
 *   lat, lng        pin (default: open ground inside the fixture area)
 *   mode            "yard" | "window"
 *   h, dir, fov     observer height (m), facing (°) and field of view (°)
 *   date, t         selected date (YYYY-MM-DD) and minute of day
 *   live            "0" shows the summary header as "not now" (default "1")
 *   buildings       "fixture" (default) | "none"
 *   state           "ready" (default) | "loading" | "error" | "skeleton"
 *   terrain         "demo" adds a made-up ridge to the south, marked as terrain
 *
 * Every `onSelectDateTime` call is appended to `window.__selectCalls` (date, minute,
 * origin), so a browser test can tell a selection from a scroll.
 *
 * /dev/report/summary shows the summary header in every state side by side.
 */
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

import { SunSummaryHeader } from "@/components/report/SummaryHeader";
import { REPORT_SECTIONS, SunReport } from "@/components/report/SunReport";
import type { SelectionOrigin } from "@/components/report/types";
import { analyzeYear, timeZoneAt } from "@/lib/analysis";
import type { ObserverMode } from "@/lib/types";

import {
  analyzeScenarioDay,
  DEFAULT_PIN,
  EMPTY_BUILDINGS,
  skylineFor,
  sunGridFor,
  useFixtureBuildings,
  type Scenario,
} from "./scenario";

type Query = Record<string, string | string[] | undefined>;

interface HarnessParams extends Scenario {
  width: number;
  live: boolean;
  state: "ready" | "loading" | "error" | "skeleton";
}

const DEFAULTS = { date: "2026-11-14", minute: 13 * 60 };

const PRESETS: { label: string; query: string }[] = [
  { label: "Yard (SF)", query: "" },
  { label: "Yard in June", query: "date=2026-06-21&t=1080" },
  { label: "North window", query: "mode=window&h=4.5&dir=0&fov=120" },
  { label: "South window", query: "mode=window&h=4.5&dir=180&fov=120" },
  { label: "Pin on a building", query: "lat=37.7906&lng=-122.4294" },
  { label: "Sydney", query: "lat=-33.87&lng=151.21&buildings=none&date=2026-12-21&t=720" },
  { label: "Tromsø", query: "lat=69.65&lng=18.96&buildings=none&date=2026-06-21&t=720" },
  { label: "Made-up hill", query: "terrain=demo&date=2026-12-21&t=720" },
  { label: "Buildings loading", query: "state=loading" },
  { label: "Buildings failed", query: "state=error" },
  { label: "All skeletons", query: "state=skeleton" },
];

const WIDTHS = [
  { label: "390 phone", value: 390 },
  { label: "440 panel", value: 440 },
  { label: "620 wide", value: 620 },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberParam(value: string | string[] | undefined, fallback: number): number {
  const text = first(value);
  const parsed = text === undefined || text === "" ? NaN : Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseQuery(query: Query): HarnessParams {
  const mode: ObserverMode = first(query.mode) === "window" ? "window" : "yard";
  const date = first(query.date);
  const state = first(query.state);
  return {
    width: Math.min(1200, Math.max(320, Math.round(numberParam(query.w, 390)))),
    lat: numberParam(query.lat, DEFAULT_PIN.lat),
    lng: numberParam(query.lng, DEFAULT_PIN.lng),
    observer: {
      mode,
      heightM: Math.max(0, numberParam(query.h, 1.5)),
      facingDeg: numberParam(query.dir, 180),
      fovDeg: Math.min(360, Math.max(10, numberParam(query.fov, mode === "window" ? 120 : 360))),
    },
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : DEFAULTS.date,
    minute: Math.min(1439, Math.max(0, Math.round(numberParam(query.t, DEFAULTS.minute)))),
    live: first(query.live) !== "0",
    buildings: first(query.buildings) === "none" ? "none" : "fixture",
    state: state === "loading" || state === "error" || state === "skeleton" ? state : "ready",
    ridgeDeg: first(query.terrain) === "demo" ? 16 : 0,
  };
}

interface SelectionCall {
  date: string;
  minute: number | undefined;
  origin: SelectionOrigin | undefined;
}

/** Keep a log of selections on `window` for browser tests and the console. */
function recordSelection(call: SelectionCall): void {
  const target = window as unknown as { __selectCalls?: SelectionCall[] };
  (target.__selectCalls ??= []).push(call);
}

export default function ReportHarnessPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = use(searchParams);
  const params = parseQuery(query);
  // Remount on navigation so the locally held date / time start from the URL again.
  return <Harness key={JSON.stringify(params)} params={params} />;
}

function Harness({ params }: { params: HarnessParams }) {
  const { lat, lng, observer, ridgeDeg } = params;
  const [date, setDate] = useState(params.date);
  const [minute, setMinute] = useState(params.minute);
  const [attempt, setAttempt] = useState(0);
  const [retried, setRetried] = useState(false);
  const fixture = useFixtureBuildings(params.buildings !== "none", attempt);

  const collection = params.buildings === "none" ? EMPTY_BUILDINGS : fixture.collection;
  const forced = retried ? "ready" : params.state;
  const status: "loading" | "ready" | "error" =
    forced === "error" || (fixture.status === "error" && params.buildings !== "none")
      ? "error"
      : forced === "loading" || collection === null
        ? "loading"
        : "ready";

  const timeZone = useMemo(() => timeZoneAt(lat, lng), [lat, lng]);
  const year = date.slice(0, 4);
  const grid = useMemo(() => sunGridFor(lat, lng, `${year}-01-01`), [lat, lng, year]);
  const horizon = useMemo(
    () =>
      status === "ready"
        ? skylineFor(
            { lat, lng, observer, date: "", minute: 0, buildings: "fixture", ridgeDeg },
            collection,
          )
        : null,
    [status, collection, lat, lng, observer, ridgeDeg],
  );
  const yearAnalysis = useMemo(
    () => analyzeYear(grid, horizon, observer),
    [grid, horizon, observer],
  );
  const { day, instant } = useMemo(
    () =>
      analyzeScenarioDay(
        { lat, lng, observer, date, minute, buildings: "fixture", ridgeDeg },
        horizon,
      ),
    [lat, lng, observer, date, minute, ridgeDeg, horizon],
  );

  const stats = useMemo(() => {
    if (status !== "ready" || !collection) return null;
    const counts = { total: collection.features.length, tagged: 0, levels: 0, default: 0 };
    for (const feature of collection.features) counts[feature.properties.heightSource]++;
    return counts;
  }, [status, collection]);

  const skeleton = forced === "skeleton";
  const containingBuildingIndex = horizon?.containingBuildingIndex ?? -1;

  // Lets a console / Playwright session compare what is drawn with the data.
  useEffect(() => {
    const debug = { year: yearAnalysis, grid, day, horizon, instant, date, minute };
    (window as unknown as { __sunReport?: typeof debug }).__sunReport = debug;
  }, [yearAnalysis, grid, day, horizon, instant, date, minute]);

  const link = (query: string, width = params.width) => {
    const all = [query, width === 390 ? "" : `w=${width}`].filter(Boolean).join("&");
    return all ? `/dev/report?${all}` : "/dev/report";
  };

  return (
    <div className="min-h-screen bg-page text-ink">
      <main className="mx-auto w-full px-4 py-4" style={{ maxWidth: params.width }}>
        <header className="mb-3 text-xs text-ink-2">
          <h1 className="text-sm font-semibold text-ink">Sun report harness</h1>
          <nav className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label="Presets">
            {PRESETS.map((preset) => (
              <Link
                key={preset.label}
                href={link(preset.query)}
                className="underline decoration-line underline-offset-2 hover:text-ink"
              >
                {preset.label}
              </Link>
            ))}
          </nav>
          <nav className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label="Widths and views">
            {WIDTHS.map((width) => (
              <Link
                key={width.value}
                href={link("", width.value)}
                className="underline decoration-line underline-offset-2 hover:text-ink"
              >
                {width.label}
              </Link>
            ))}
            <Link
              href="/dev/report/summary"
              className="underline decoration-line underline-offset-2 hover:text-ink"
            >
              Summary header states
            </Link>
          </nav>
          <dl
            className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px]"
            data-testid="harness-info"
          >
            <dt>pin</dt>
            <dd>
              {lat}, {lng} ({timeZone})
            </dd>
            <dt>observer</dt>
            <dd>
              {observer.mode}, {observer.heightM} m
              {observer.mode === "window" &&
                `, facing ${observer.facingDeg}°, fov ${observer.fovDeg}°`}
            </dd>
            <dt>selected</dt>
            <dd>
              {date} minute {minute}
            </dd>
            <dt>buildings</dt>
            <dd>
              {status}
              {stats ? ` (${stats.total})` : ""}, containingBuildingIndex: {containingBuildingIndex}
            </dd>
            <dt>anchors</dt>
            <dd>{REPORT_SECTIONS.map((section) => `#${section.id}`).join(" ")}</dd>
          </dl>
        </header>

        {/* Where the shell puts it: the top of the sheet, above the action pills. */}
        <div
          className="mb-3 rounded-[20px] border border-line bg-surface px-4 py-3"
          data-testid="summary-frame"
        >
          <SunSummaryHeader
            date={date}
            minuteOfDay={minute}
            isLive={params.live}
            day={skeleton ? null : day}
            instant={skeleton ? null : instant}
            year={skeleton ? null : yearAnalysis}
            buildingsStatus={status}
          />
        </div>

        <SunReport
          place={{ lat, lng, name: "Harness pin" }}
          timeZone={timeZone}
          observer={observer}
          date={date}
          minuteOfDay={minute}
          year={skeleton ? null : yearAnalysis}
          grid={skeleton ? null : grid}
          day={skeleton ? null : day}
          horizon={skeleton ? null : horizon}
          instant={skeleton ? null : instant}
          buildings={{
            status,
            stats,
            onRetry: () => {
              setRetried(true);
              setAttempt((n) => n + 1);
            },
          }}
          terrain={ridgeDeg > 0 ? "ready" : "idle"}
          pinOnBuilding={containingBuildingIndex >= 0}
          onSelectDateTime={(nextDate, nextMinute, origin) => {
            recordSelection({ date: nextDate, minute: nextMinute, origin });
            setDate(nextDate);
            if (nextMinute !== undefined) setMinute(nextMinute);
          }}
        />
      </main>
    </div>
  );
}
