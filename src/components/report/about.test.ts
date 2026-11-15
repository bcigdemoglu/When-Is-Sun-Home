import { describe, expect, it } from "vitest";

import { buildingStatsText, terrainText } from "./AboutCard";

describe("buildingStatsText", () => {
  it("says how many heights are in the map and how many are estimated (map tiles)", () => {
    expect(buildingStatsText({ total: 384, tagged: 329, levels: 0, default: 55 })).toBe(
      "384 buildings nearby — 329 with a mapped height, 55 estimated from their neighbours",
    );
  });

  it("still mentions floor counts when the source can tell them apart", () => {
    expect(buildingStatsText({ total: 384, tagged: 321, levels: 8, default: 55 })).toBe(
      "384 buildings nearby — 329 with a mapped height (8 of them from floor counts), 55 estimated",
    );
  });

  it("never claims a survey", () => {
    for (const stats of [
      { total: 384, tagged: 329, levels: 0, default: 55 },
      { total: 384, tagged: 321, levels: 8, default: 55 },
      { total: 5, tagged: 0, levels: 0, default: 5 },
    ]) {
      expect(buildingStatsText(stats)).not.toMatch(/survey/i);
    }
  });

  it("handles the edges", () => {
    expect(buildingStatsText({ total: 0, tagged: 0, levels: 0, default: 0 })).toBe(
      "No buildings found nearby",
    );
    expect(buildingStatsText({ total: 1, tagged: 1, levels: 0, default: 0 })).toBe(
      "1 building nearby, all with a mapped height",
    );
    expect(buildingStatsText({ total: 12, tagged: 0, levels: 0, default: 12 })).toBe(
      "12 buildings nearby, all with an estimated height",
    );
    expect(buildingStatsText({ total: 2400, tagged: 1200, levels: 0, default: 1200 })).toBe(
      "2,400 buildings nearby — 1,200 with a mapped height, 1,200 estimated from their neighbours",
    );
  });
});

describe("terrainText", () => {
  it("says what the ground data means for the numbers", () => {
    expect(terrainText("ready", false)).toMatch(/Hills and slopes .* are included/);
    expect(terrainText("idle", true)).toMatch(/are included/);
    expect(terrainText("loading", false)).toMatch(/still loading; .* flat ground is assumed/);
    expect(terrainText("error", false)).toMatch(/could not be loaded, so flat ground is assumed/);
    expect(terrainText("idle", false)).toMatch(/^Flat ground is assumed/);
  });
});
