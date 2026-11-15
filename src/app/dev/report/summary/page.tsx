"use client";

/**
 * Contact sheet: <SunSummaryHeader> in every state it can be in, each in a
 * frame as wide as the phone sheet's content (358 px). Real engine output.
 */
import Link from "next/link";
import { useMemo } from "react";

import { SunSummaryHeader } from "@/components/report/SummaryHeader";
import type { SunSummaryHeaderProps } from "@/components/report/types";
import type { BuildingCollection, Observer } from "@/lib/types";

import "../harness.css";
import {
  analyzeScenarioDay,
  DEFAULT_PIN,
  EMPTY_BUILDINGS,
  skylineFor,
  useFixtureBuildings,
  YARD,
  type Scenario,
} from "../scenario";

const SF = { ...DEFAULT_PIN, observer: YARD, buildings: "fixture" as const, ridgeDeg: 0 };
const TROMSO = { lat: 69.65, lng: 18.96, observer: YARD, buildings: "none" as const, ridgeDeg: 0 };
const SOUTH_WINDOW: Observer = { mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 };

interface Case {
  label: string;
  scenario: Scenario;
  isLive?: boolean;
  buildingsStatus?: SunSummaryHeaderProps["buildingsStatus"];
  skeleton?: boolean;
}

const CASES: Case[] = [
  { label: "In sun, now", scenario: { ...SF, date: "2026-11-14", minute: 12 * 60 } },
  {
    label: "In sun, not now",
    scenario: { ...SF, date: "2026-06-21", minute: 15 * 60 + 40 },
    isLive: false,
  },
  {
    label: "Shaded by a building, sun returns",
    scenario: { ...SF, date: "2026-11-14", minute: 8 * 60 },
  },
  {
    label: "Shaded by a building, no more sun",
    scenario: { ...SF, date: "2026-11-14", minute: 15 * 60 },
  },
  {
    label: "Shaded, not now",
    scenario: { ...SF, date: "2026-11-14", minute: 8 * 60 + 30 },
    isLive: false,
  },
  {
    label: "Behind a hill (made-up ridge)",
    scenario: { ...SF, buildings: "none", ridgeDeg: 35, date: "2026-12-21", minute: 11 * 60 },
  },
  { label: "Night, before sunrise", scenario: { ...SF, date: "2026-11-14", minute: 5 * 60 } },
  { label: "Night, after sunset", scenario: { ...SF, date: "2026-11-14", minute: 21 * 60 } },
  {
    label: "Night, not now",
    scenario: { ...SF, date: "2026-11-14", minute: 23 * 60 },
    isLive: false,
  },
  {
    label: "Window: sun outside the view",
    scenario: { ...SF, observer: SOUTH_WINDOW, date: "2026-06-21", minute: 10 * 60 },
  },
  { label: "Polar day", scenario: { ...TROMSO, date: "2026-06-21", minute: 12 * 60 } },
  { label: "Polar night", scenario: { ...TROMSO, date: "2026-12-21", minute: 12 * 60 } },
  {
    label: "Buildings loading (provisional)",
    scenario: { ...SF, date: "2026-11-14", minute: 12 * 60 },
    buildingsStatus: "loading",
  },
  {
    label: "Buildings failed",
    scenario: { ...SF, date: "2026-11-14", minute: 12 * 60 },
    buildingsStatus: "error",
  },
  {
    label: "Analysis not ready (skeleton)",
    scenario: { ...SF, date: "2026-11-14", minute: 12 * 60 },
    skeleton: true,
  },
];

export default function SummaryStatesPage() {
  const fixture = useFixtureBuildings(true);
  return (
    <div className="harness-theme min-h-screen">
      <main className="mx-auto w-full max-w-[820px] px-4 py-4">
        <header className="mb-3 text-xs text-ink-2">
          <h1 className="text-sm font-semibold text-ink">Summary header states</h1>
          <Link href="/dev/report" className="underline decoration-line underline-offset-2">
            Back to the report harness
          </Link>
        </header>
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="summary-states">
          {CASES.map((item) => (
            <li key={item.label} className="w-[390px] max-w-full">
              <p className="mb-1 text-[11px] font-medium text-ink-2">{item.label}</p>
              <div className="rounded-[20px] border border-line bg-surface px-4 py-3">
                <StateCase item={item} collection={fixture.collection} />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function StateCase({ item, collection }: { item: Case; collection: BuildingCollection | null }) {
  const { scenario } = item;
  const buildings = scenario.buildings === "none" ? EMPTY_BUILDINGS : collection;
  const unshaded = item.buildingsStatus === "loading" || item.buildingsStatus === "error";
  const result = useMemo(() => {
    if (!buildings) return null;
    return analyzeScenarioDay(scenario, unshaded ? null : skylineFor(scenario, buildings));
  }, [scenario, buildings, unshaded]);
  const waiting = item.skeleton || !result;
  return (
    <SunSummaryHeader
      date={scenario.date}
      minuteOfDay={scenario.minute}
      isLive={item.isLive ?? true}
      day={waiting ? null : result.day}
      instant={waiting ? null : result.instant}
      year={null}
      buildingsStatus={item.buildingsStatus ?? (buildings ? "ready" : "loading")}
    />
  );
}
