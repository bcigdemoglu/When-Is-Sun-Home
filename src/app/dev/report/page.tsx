"use client";

/**
 * Developer harness for the sun report: renders <SunReport> with REAL props
 * computed by the engine from the recorded Pacific Heights building fixture.
 *
 * Query parameters:
 *   lat, lng        pin (default: open ground inside the fixture area)
 *   mode            "yard" | "window"
 *   h, dir, fov     observer height (m), facing (°) and field of view (°)
 *   date, t         selected date (YYYY-MM-DD) and minute of day
 *   buildings       "fixture" (default) | "none"
 *   state           "ready" (default) | "loading" | "error" | "skeleton"
 */
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

import { SunReport } from "@/components/report/SunReport";
import {
  analyzeDay,
  analyzeYear,
  computeHorizonProfile,
  computeSunYearGrid,
  sunInstantAt,
  timeZoneAt,
  yearOfDate,
} from "@/lib/analysis";
import { parseOverpassResponse } from "@/lib/buildings/overpass";
import type { BuildingCollection, Observer, ObserverMode } from "@/lib/types";

type Query = Record<string, string | string[] | undefined>;

interface HarnessParams {
  lat: number;
  lng: number;
  observer: Observer;
  date: string;
  minute: number;
  buildings: "fixture" | "none";
  state: "ready" | "loading" | "error" | "skeleton";
}

const DEFAULTS = { lat: 37.79, lng: -122.429, date: "2026-11-14", minute: 13 * 60 };

const PRESETS: { label: string; query: string }[] = [
  { label: "Yard, ground level (SF)", query: "" },
  { label: "Yard in June", query: "date=2026-06-21&t=1080" },
  { label: "North window, 2nd floor, 120°", query: "mode=window&h=4.5&dir=0&fov=120" },
  { label: "South window, 2nd floor, 120°", query: "mode=window&h=4.5&dir=180&fov=120" },
  { label: "Pin on a building", query: "lat=37.7906&lng=-122.4294" },
  {
    label: "Sydney (no buildings)",
    query: "lat=-33.87&lng=151.21&buildings=none&date=2026-12-21&t=720",
  },
  {
    label: "Tromsø (no buildings)",
    query: "lat=69.65&lng=18.96&buildings=none&date=2026-06-21&t=720",
  },
  { label: "Buildings loading", query: "state=loading" },
  { label: "Buildings failed", query: "state=error" },
  { label: "All skeletons", query: "state=skeleton" },
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
    lat: numberParam(query.lat, DEFAULTS.lat),
    lng: numberParam(query.lng, DEFAULTS.lng),
    observer: {
      mode,
      heightM: Math.max(0, numberParam(query.h, 1.5)),
      facingDeg: numberParam(query.dir, 180),
      fovDeg: Math.min(360, Math.max(10, numberParam(query.fov, mode === "window" ? 120 : 360))),
    },
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : DEFAULTS.date,
    minute: Math.min(1439, Math.max(0, Math.round(numberParam(query.t, DEFAULTS.minute)))),
    buildings: first(query.buildings) === "none" ? "none" : "fixture",
    state: state === "loading" || state === "error" || state === "skeleton" ? state : "ready",
  };
}

const EMPTY: BuildingCollection = { type: "FeatureCollection", features: [] };

export default function ReportHarnessPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = use(searchParams);
  const params = parseQuery(query);
  // Remount on navigation so the locally held date / time start from the URL again.
  return <Harness key={JSON.stringify(params)} params={params} />;
}

function Harness({ params }: { params: HarnessParams }) {
  const { lat, lng, observer } = params;
  const [date, setDate] = useState(params.date);
  const [minute, setMinute] = useState(params.minute);
  const [fixture, setFixture] = useState<BuildingCollection | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    if (params.buildings === "none") return;
    let cancelled = false;
    fetch("/dev/report/fixture")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        setFixture(parseOverpassResponse(json));
        setFetchFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.buildings, attempt]);

  const collection = params.buildings === "none" ? EMPTY : fixture;
  const forced = retried ? "ready" : params.state;
  const status: "loading" | "ready" | "error" =
    forced === "error" || (fetchFailed && params.buildings !== "none")
      ? "error"
      : forced === "loading" || collection === null
        ? "loading"
        : "ready";

  const timeZone = useMemo(() => timeZoneAt(lat, lng), [lat, lng]);
  const year = yearOfDate(date);
  const grid = useMemo(
    () => computeSunYearGrid({ lat, lng }, { year, timeZone, stepMinutes: 5 }),
    [lat, lng, year, timeZone],
  );
  const horizon = useMemo(
    () =>
      status === "ready" && collection
        ? computeHorizonProfile({ lat, lng }, collection, observer.heightM)
        : null,
    [status, collection, lat, lng, observer.heightM],
  );
  const yearAnalysis = useMemo(
    () => analyzeYear(grid, horizon, observer),
    [grid, horizon, observer],
  );
  const dayAnalysis = useMemo(
    () => analyzeDay({ lat, lng }, date, timeZone, horizon, observer),
    [lat, lng, date, timeZone, horizon, observer],
  );
  const instant = useMemo(
    () => sunInstantAt({ lat, lng }, date, minute, timeZone, horizon, observer),
    [lat, lng, date, minute, timeZone, horizon, observer],
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
    const debug = { year: yearAnalysis, grid, day: dayAnalysis, horizon, instant, date, minute };
    (window as unknown as { __sunReport?: typeof debug }).__sunReport = debug;
  }, [yearAnalysis, grid, dayAnalysis, horizon, instant, date, minute]);

  return (
    <main className="mx-auto w-full max-w-[620px] px-3 py-4">
      <header className="mb-3 text-xs text-ink-2">
        <h1 className="text-sm font-semibold text-ink">Sun report harness</h1>
        <nav className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label="Presets">
          {PRESETS.map((preset) => (
            <Link
              key={preset.label}
              href={preset.query ? `/dev/report?${preset.query}` : "/dev/report"}
              className="underline decoration-line underline-offset-2 hover:text-ink"
            >
              {preset.label}
            </Link>
          ))}
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
        </dl>
      </header>

      <SunReport
        place={{ lat, lng, name: "Harness pin" }}
        timeZone={timeZone}
        observer={observer}
        date={date}
        minuteOfDay={minute}
        year={skeleton ? null : yearAnalysis}
        grid={skeleton ? null : grid}
        day={skeleton ? null : dayAnalysis}
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
        pinOnBuilding={containingBuildingIndex >= 0}
        onSelectDateTime={(nextDate, nextMinute) => {
          setDate(nextDate);
          if (nextMinute !== undefined) setMinute(nextMinute);
        }}
      />
    </main>
  );
}
