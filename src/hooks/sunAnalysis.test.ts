import { describe, expect, it } from "vitest";
import type { BuildingCollection } from "@/lib/types";
import { buildingIdAt, resolveDateTime, usableBuildings } from "./sunAnalysis";

const NOW = { date: "2026-11-14", minuteOfDay: 930 };

describe("resolveDateTime", () => {
  it("follows the clock when nothing is set", () => {
    expect(resolveDateTime(null, null, NOW)).toEqual({ ...NOW, isLive: true });
  });

  it("uses explicit settings and stops being live", () => {
    expect(resolveDateTime("2026-06-21", 600, NOW)).toEqual({
      date: "2026-06-21",
      minuteOfDay: 600,
      isLive: false,
    });
  });

  it("mixes a chosen date with the current time, and vice versa", () => {
    expect(resolveDateTime("2026-06-21", null, NOW)).toEqual({
      date: "2026-06-21",
      minuteOfDay: 930,
      isLive: false,
    });
    expect(resolveDateTime(null, 0, NOW)).toEqual({
      date: "2026-11-14",
      minuteOfDay: 0,
      isLive: false,
    });
  });

  it("needs the clock only for what is left to follow", () => {
    expect(resolveDateTime(null, null, null)).toBeNull();
    expect(resolveDateTime("2026-06-21", null, null)).toBeNull();
    expect(resolveDateTime("2026-06-21", 600, null)).toEqual({
      date: "2026-06-21",
      minuteOfDay: 600,
      isLive: false,
    });
  });
});

const buildings: BuildingCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "way/1", heightM: 9, heightSource: "default", levels: null, kind: "yes" },
      geometry: { type: "Polygon", coordinates: [] },
    },
  ],
};

describe("usableBuildings", () => {
  it("only trusts data that is ready for the current place", () => {
    expect(usableBuildings({ status: "ready", buildings })).toBe(buildings);
    // A neighbouring area's placeholder is shown while loading, but never measured with.
    expect(usableBuildings({ status: "loading", buildings })).toBeNull();
    expect(usableBuildings({ status: "error", buildings: null })).toBeNull();
    expect(usableBuildings({ status: "idle", buildings: null })).toBeNull();
  });
});

describe("buildingIdAt", () => {
  it("maps an index to the building's id", () => {
    expect(buildingIdAt(buildings, 0)).toBe("way/1");
  });

  it("is null for no building", () => {
    expect(buildingIdAt(buildings, -1)).toBeNull();
    expect(buildingIdAt(buildings, 5)).toBeNull();
    expect(buildingIdAt(buildings, undefined)).toBeNull();
    expect(buildingIdAt(null, 0)).toBeNull();
  });
});
