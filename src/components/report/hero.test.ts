import { describe, expect, it } from "vitest";

import { includedText } from "./Hero";
import type { BuildingDataStatus } from "./types";

const buildings = (total: number | null): BuildingDataStatus => ({
  status: "ready",
  stats: total === null ? null : { total, tagged: total, levels: 0, default: 0 },
  onRetry: () => {},
});

describe("includedText: what the estimate includes, in one line", () => {
  it("names the buildings and the hills when both are in", () => {
    expect(includedText(buildings(384), "ready", true)).toBe(
      "Estimate: includes shade from 384 nearby buildings and the hills around, but not trees, fences or clouds.",
    );
    // Hills found in the skyline count even if the status prop was not passed.
    expect(includedText(buildings(1), "idle", true)).toBe(
      "Estimate: includes shade from 1 nearby building and the hills around, but not trees, fences or clouds.",
    );
  });

  it("leaves the hills out while terrain is loading or was not asked for", () => {
    for (const terrain of ["idle", "loading"] as const) {
      expect(includedText(buildings(384), terrain, false)).toBe(
        "Estimate: includes shade from 384 nearby buildings, but not trees, fences or clouds.",
      );
    }
  });

  it("says outright that hills are missing when terrain failed", () => {
    expect(includedText(buildings(384), "error", false)).toBe(
      "Estimate: includes shade from 384 nearby buildings, but not hills, trees, fences or clouds.",
    );
    expect(includedText(buildings(0), "error", false)).toBe(
      "Estimate: no buildings were found nearby; hills, trees, fences and clouds are not included.",
    );
  });

  it("handles a place without buildings", () => {
    expect(includedText(buildings(0), "ready", false)).toBe(
      "Estimate: no buildings nearby; includes shade from the hills around, but not trees, fences or clouds.",
    );
    expect(includedText(buildings(0), "idle", false)).toBe(
      "Estimate: no buildings were found nearby, so nothing blocks the sun here.",
    );
  });

  it("copes with a missing count", () => {
    expect(includedText(buildings(null), "ready", false)).toBe(
      "Estimate: includes shade from nearby buildings and the hills around, but not trees, fences or clouds.",
    );
  });
});
