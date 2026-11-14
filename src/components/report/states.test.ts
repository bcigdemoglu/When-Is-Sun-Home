import { describe, expect, it } from "vitest";

import { SunState, type Observer, type SunInstant } from "@/lib/types";

import {
  describeInstant,
  isTerrainBlocker,
  legendStates,
  parseCssColor,
  resolveStateColors,
  STATE_META,
  stateMeta,
} from "./states";

const yard: Observer = { mode: "yard", heightM: 1.5, facingDeg: 180, fovDeg: 360 };
const window120: Observer = { mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 };

describe("state metadata", () => {
  it("is indexed by state code and never colour-only", () => {
    for (const code of Object.values(SunState)) {
      expect(STATE_META[code].code).toBe(code);
      expect(STATE_META[code].label.length).toBeGreaterThan(0);
      expect(STATE_META[code].phrase.length).toBeGreaterThan(0);
      expect(STATE_META[code].cssVar).toMatch(/^--state-/);
      expect(parseCssColor(STATE_META[code].fallback)).not.toBeNull();
    }
    expect(new Set(STATE_META.map((meta) => meta.cssVar)).size).toBe(4);
  });

  it("treats an unknown code as night", () => {
    expect(stateMeta(9).code).toBe(SunState.Night);
  });
});

describe("legendStates", () => {
  it("lists the answer first and night last", () => {
    expect(legendStates(yard)).toEqual([SunState.Sun, SunState.Blocked, SunState.Night]);
  });

  it("adds out-of-view only for a window with a limited view", () => {
    expect(legendStates(window120)).toEqual([
      SunState.Sun,
      SunState.Blocked,
      SunState.OutOfView,
      SunState.Night,
    ]);
    expect(legendStates({ mode: "window", fovDeg: 360 })).not.toContain(SunState.OutOfView);
  });
});

describe("parseCssColor", () => {
  it("parses the forms getComputedStyle returns", () => {
    expect(parseCssColor("#eda100")).toEqual([237, 161, 0]);
    expect(parseCssColor("  #EDA100 ")).toEqual([237, 161, 0]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255]);
    expect(parseCssColor("#23283aff")).toEqual([35, 40, 58]);
    expect(parseCssColor("rgb(95, 130, 198)")).toEqual([95, 130, 198]);
    expect(parseCssColor("rgb(95 130 198 / 0.5)")).toEqual([95, 130, 198]);
  });

  it("rejects anything else", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("tomato")).toBeNull();
    expect(parseCssColor("var(--state-sun)")).toBeNull();
  });
});

describe("resolveStateColors", () => {
  it("reads each state's custom property", () => {
    const values: Record<string, string> = {
      "--state-night": "#000000",
      "--state-sun": "#ffcc00",
      "--state-blocked": "rgb(1, 2, 3)",
      "--state-out": "#cccccc",
      "--report-hatch": "#999999",
    };
    const colors = resolveStateColors((name) => values[name] ?? "");
    expect(colors.rgb[SunState.Night]).toEqual([0, 0, 0]);
    expect(colors.rgb[SunState.Sun]).toEqual([255, 204, 0]);
    expect(colors.rgb[SunState.Blocked]).toEqual([1, 2, 3]);
    expect(colors.rgb[SunState.OutOfView]).toEqual([204, 204, 204]);
    expect(colors.hatch).toEqual([153, 153, 153]);
  });

  it("falls back per colour and changes its key when a colour changes", () => {
    const fallback = resolveStateColors(() => "");
    expect(fallback.rgb[SunState.Sun]).toEqual(parseCssColor(STATE_META[SunState.Sun].fallback));
    const dark = resolveStateColors((name) => (name === "--state-sun" ? "#c98500" : ""));
    expect(dark.rgb[SunState.Sun]).toEqual([201, 133, 0]);
    expect(dark.rgb[SunState.Night]).toEqual(fallback.rgb[SunState.Night]);
    expect(dark.key).not.toBe(fallback.key);
    expect(resolveStateColors(() => "").key).toBe(fallback.key);
  });
});

describe("describeInstant", () => {
  const at = (state: SunInstant["state"], blocker?: SunInstant["blocker"]): SunInstant => ({
    azimuthDeg: 200,
    altitudeDeg: state === SunState.Night ? -5 : 30,
    state,
    blocker,
  });

  it("describes each state in plain language", () => {
    expect(describeInstant(at(SunState.Sun), yard)).toBe("In direct sun");
    expect(describeInstant(at(SunState.Night), yard)).toBe("Sun is below the horizon");
    expect(describeInstant(at(SunState.OutOfView), window120)).toBe(
      "Sun is outside this window’s view",
    );
  });

  it("says what blocks the sun and how far away it is", () => {
    const building = { buildingIndex: 12, distanceM: 41.7, elevationDeg: 35 };
    expect(describeInstant(at(SunState.Blocked, building), yard)).toBe(
      "Shaded by a building 42 m away",
    );
    const hill = { buildingIndex: -2, distanceM: 1840, elevationDeg: 6 };
    expect(describeInstant(at(SunState.Blocked, hill), yard)).toBe("Shaded by a hill 1.8 km away");
    expect(describeInstant(at(SunState.Blocked), yard)).toBe("Shaded by a building");
  });

  it("classifies blocker indices", () => {
    expect(isTerrainBlocker(-2)).toBe(true);
    expect(isTerrainBlocker(-1)).toBe(false);
    expect(isTerrainBlocker(0)).toBe(false);
  });
});
