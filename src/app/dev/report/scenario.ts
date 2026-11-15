/**
 * Shared by the report harness pages: turning a pin / observer / date into
 * the REAL props the report components take, computed by the engine from the
 * recorded Pacific Heights building fixture.
 */
import { useEffect, useState } from "react";

import {
  analyzeDay,
  computeHorizonProfile,
  computeSunYearGrid,
  sunInstantAt,
  timeZoneAt,
  yearOfDate,
} from "@/lib/analysis";
import { parseOverpassResponse } from "@/lib/buildings/overpass";
import type {
  BuildingCollection,
  DayAnalysis,
  HorizonProfile,
  Observer,
  SunInstant,
  SunYearGrid,
} from "@/lib/types";

export const DEFAULT_PIN = { lat: 37.79, lng: -122.429 };

export const YARD: Observer = { mode: "yard", heightM: 1.5, facingDeg: 180, fovDeg: 360 };

export const EMPTY_BUILDINGS: BuildingCollection = { type: "FeatureCollection", features: [] };

export interface Scenario {
  lat: number;
  lng: number;
  observer: Observer;
  date: string;
  minute: number;
  buildings: "fixture" | "none";
  /** Height (degrees) of a made-up ridge to the south, marked as terrain; 0 = none. */
  ridgeDeg: number;
}

/** A synthetic ridge between SE and SW, wherever it tops the buildings. */
export function withDemoRidge(horizon: HorizonProfile, peakDeg: number): HorizonProfile {
  const elevationDeg = Float32Array.from(horizon.elevationDeg);
  const blockerIndex = Int32Array.from(horizon.blockerIndex);
  const blockerDistanceM = Float32Array.from(horizon.blockerDistanceM);
  for (let bin = 0; bin < horizon.binCount; bin++) {
    const azimuth = ((bin + 0.5) * 360) / horizon.binCount;
    if (azimuth < 140 || azimuth > 220) continue;
    const ridge = peakDeg * Math.sin(((azimuth - 140) / 80) * Math.PI) ** 0.7;
    if (ridge > elevationDeg[bin]) {
      elevationDeg[bin] = ridge;
      blockerIndex[bin] = -2;
      blockerDistanceM[bin] = 2400;
    }
  }
  return { ...horizon, elevationDeg, blockerIndex, blockerDistanceM };
}

export type FixtureState =
  | { status: "loading"; collection: null }
  | { status: "ready"; collection: BuildingCollection }
  | { status: "error"; collection: null };

/** Fetch and parse the building fixture once (again whenever `attempt` changes). */
export function useFixtureBuildings(enabled: boolean, attempt = 0): FixtureState {
  const [state, setState] = useState<FixtureState>({ status: "loading", collection: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/dev/report/fixture")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json: unknown) => {
        if (!cancelled) setState({ status: "ready", collection: parseOverpassResponse(json) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", collection: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);
  return state;
}

export function skylineFor(
  scenario: Scenario,
  collection: BuildingCollection | null,
): HorizonProfile | null {
  if (!collection) return null;
  const profile = computeHorizonProfile(
    { lat: scenario.lat, lng: scenario.lng },
    collection,
    scenario.observer.heightM,
  );
  return scenario.ridgeDeg > 0 ? withDemoRidge(profile, scenario.ridgeDeg) : profile;
}

export interface DayResult {
  timeZone: string;
  day: DayAnalysis;
  instant: SunInstant;
}

/** The selected day and instant (cheap: one day at 1-minute steps). */
export function analyzeScenarioDay(scenario: Scenario, horizon: HorizonProfile | null): DayResult {
  const place = { lat: scenario.lat, lng: scenario.lng };
  const timeZone = timeZoneAt(scenario.lat, scenario.lng);
  return {
    timeZone,
    day: analyzeDay(place, scenario.date, timeZone, horizon, scenario.observer),
    instant: sunInstantAt(
      place,
      scenario.date,
      scenario.minute,
      timeZone,
      horizon,
      scenario.observer,
    ),
  };
}

export function sunGridFor(lat: number, lng: number, date: string): SunYearGrid {
  return computeSunYearGrid(
    { lat, lng },
    { year: yearOfDate(date), timeZone: timeZoneAt(lat, lng), stepMinutes: 5 },
  );
}
