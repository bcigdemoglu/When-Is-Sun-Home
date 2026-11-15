import { describe, expect, it } from "vitest";

import { SunState, type Observer } from "@/lib/types";

import {
  azimuthToFraction,
  buildPathSegments,
  compassTicks,
  createElevationScale,
  fractionToAzimuth,
  hourMarks,
  maxSunAltitude,
  obstructionKind,
  outsideViewSpans,
  panoramaCenter,
  referenceDays,
  sectorSummary,
  skylineRuns,
  sunPassageAt,
  sunPathForDay,
  type SunPathPoint,
} from "./skyline";
import { syntheticGrid, syntheticHorizon, YARD } from "./testing";

describe("compass axis", () => {
  it("centres the panorama on the sunny side of the sky", () => {
    expect(panoramaCenter(37.8)).toBe(180);
    expect(panoramaCenter(-33.9)).toBe(0);
  });

  it("runs N → E → S → W → N in the northern hemisphere", () => {
    expect(azimuthToFraction(0, 180)).toBe(0);
    expect(azimuthToFraction(90, 180)).toBe(0.25);
    expect(azimuthToFraction(180, 180)).toBe(0.5);
    expect(azimuthToFraction(270, 180)).toBe(0.75);
    expect(
      compassTicks(180)
        .map((tick) => tick.label)
        .join(" "),
    ).toBe("N NE E SE S SW W NW N");
  });

  it("runs S → W → N → E → S in the southern hemisphere", () => {
    expect(azimuthToFraction(180, 0)).toBe(0);
    expect(azimuthToFraction(270, 0)).toBe(0.25);
    expect(azimuthToFraction(0, 0)).toBe(0.5);
    expect(azimuthToFraction(90, 0)).toBe(0.75);
    expect(
      compassTicks(0)
        .map((tick) => tick.label)
        .join(" "),
    ).toBe("S SW W NW N NE E SE S");
  });

  it("inverts", () => {
    for (const center of [0, 180]) {
      for (const azimuth of [0, 12.5, 90, 179.9, 180, 270, 359]) {
        expect(fractionToAzimuth(azimuthToFraction(azimuth, center), center)).toBeCloseTo(
          azimuth,
          9,
        );
      }
    }
  });
});

describe("elevation scale", () => {
  it("gives the 0–40° band most of the height when the sun climbs high", () => {
    const scale = createElevationScale(81);
    expect(scale.maxDeg).toBe(90);
    expect(scale.stretched).toBe(true);
    expect(scale.fraction(0)).toBe(0);
    expect(scale.fraction(90)).toBe(1);
    expect(scale.fraction(40)).toBeGreaterThan(0.6);
    expect(scale.fraction(40)).toBeLessThan(0.65);
    // The lowest 10° alone get a quarter of the height.
    expect(scale.fraction(10)).toBeGreaterThan(0.25);
    expect(scale.ticks).toEqual([0, 10, 20, 30, 40, 60, 90]);
  });

  it("is smooth, monotonic and clamps", () => {
    const scale = createElevationScale(70);
    expect(scale.maxDeg).toBe(70);
    let previous = -1;
    let previousStep = Infinity;
    for (let deg = 0; deg <= scale.maxDeg; deg += 1) {
      const value = scale.fraction(deg);
      expect(value).toBeGreaterThan(previous);
      // Steps only ever shrink: no kink anywhere on the way up.
      if (deg > 0) {
        expect(value - previous).toBeLessThanOrEqual(previousStep + 1e-12);
        previousStep = value - previous;
      }
      previous = value;
    }
    expect(scale.fraction(-5)).toBe(0);
    expect(scale.fraction(120)).toBe(1);
    expect(scale.ticks).toEqual([0, 10, 20, 30, 40, 60]);
  });

  it("stays linear when nothing rises much above 40°", () => {
    const scale = createElevationScale(49.8);
    expect(scale.maxDeg).toBe(50);
    expect(scale.stretched).toBe(false);
    expect(scale.fraction(25)).toBe(0.5);
    expect(scale.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(createElevationScale(12).maxDeg).toBe(40);
    expect(createElevationScale(NaN).maxDeg).toBe(90);
  });

  it("knows how high the noon sun gets", () => {
    expect(maxSunAltitude(37.79)).toBeCloseTo(75.65, 2);
    expect(maxSunAltitude(-33.87)).toBeCloseTo(79.57, 2);
    expect(maxSunAltitude(10)).toBe(90);
  });
});

describe("sunPathForDay", () => {
  const grid = syntheticGrid(); // up 06:00–18:00, east → west, 30-minute slots

  it("returns the daylight samples plus both horizon crossings", () => {
    const path = sunPathForDay(grid, 0, null, YARD);
    // 24 daylight slots + sunrise + sunset.
    expect(path).toHaveLength(26);
    expect(path[0].altitudeDeg).toBe(0);
    expect(path[0].minute).toBeGreaterThan(5 * 60 + 45);
    expect(path[0].minute).toBeLessThan(6 * 60 + 15);
    expect(path[1].minute).toBe(6 * 60 + 15);
    expect(path[path.length - 1].altitudeDeg).toBe(0);
    expect(path.every((point) => point.altitudeDeg >= 0)).toBe(true);
    const minutes = path.map((point) => point.minute);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("classifies each sample against the skyline and the view cone", () => {
    const wall = syntheticHorizon((azimuth) => (azimuth >= 225 ? 85 : 0));
    const blocked = sunPathForDay(grid, 0, wall, YARD);
    expect(blocked.find((p) => p.minute === 12 * 60 + 15)?.state).toBe(SunState.Sun);
    expect(blocked.find((p) => p.minute === 15 * 60 + 15)?.state).toBe(SunState.Blocked);

    const east: Observer = { mode: "window", heightM: 1.5, facingDeg: 90, fovDeg: 90 };
    const windowed = sunPathForDay(grid, 0, null, east);
    expect(windowed.find((p) => p.minute === 7 * 60 + 15)?.state).toBe(SunState.Sun);
    expect(windowed.find((p) => p.minute === 15 * 60 + 15)?.state).toBe(SunState.OutOfView);
  });

  it("is empty for a day without sun or outside the grid", () => {
    const dark = syntheticGrid({ riseMinute: () => 720, setMinute: () => 720 });
    expect(sunPathForDay(dark, 0, null, YARD)).toEqual([]);
    expect(sunPathForDay(grid, -1, null, YARD)).toEqual([]);
    expect(sunPathForDay(grid, 400, null, YARD)).toEqual([]);
  });
});

describe("buildPathSegments", () => {
  const point = (
    minute: number,
    azimuthDeg: number,
    altitudeDeg: number,
    state = 1,
  ): SunPathPoint => ({
    minute,
    azimuthDeg,
    altitudeDeg,
    state: state as SunPathPoint["state"],
  });

  it("keeps an unbroken path as one polyline", () => {
    const segments = buildPathSegments(
      [point(0, 90, 0), point(5, 100, 5), point(10, 110, 9)],
      180,
      5,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].state).toBe(SunState.Sun);
    expect(segments[0].vertices.map((v) => v.x)).toEqual([0.25, 100 / 360, 110 / 360]);
  });

  it("starts a new polyline where the state changes, meeting halfway", () => {
    const segments = buildPathSegments(
      [point(0, 100, 10), point(5, 110, 20), point(10, 120, 30, 2), point(15, 130, 40, 2)],
      180,
      5,
    );
    expect(segments.map((s) => s.state)).toEqual([SunState.Sun, SunState.Blocked]);
    const joint = { x: 115 / 360, altitudeDeg: 25 };
    expect(segments[0].vertices[segments[0].vertices.length - 1]).toEqual(joint);
    expect(segments[1].vertices[0]).toEqual(joint);
  });

  it("breaks at the azimuth wrap-around and extends both pieces to the edges", () => {
    // Northern-hemisphere panorama (edges at north): the midnight sun passes 350° → 10°.
    const segments = buildPathSegments(
      [point(0, 340, 4), point(5, 350, 3), point(10, 10, 5), point(15, 20, 6)],
      180,
      5,
    );
    expect(segments).toHaveLength(2);
    const first = segments[0].vertices;
    const second = segments[1].vertices;
    expect(first[first.length - 1].x).toBe(1);
    expect(first[first.length - 1].altitudeDeg).toBeCloseTo(4, 9);
    expect(second[0].x).toBe(0);
    expect(second[0].altitudeDeg).toBeCloseTo(4, 9);
    expect(second[1].x).toBeCloseTo(10 / 360, 9);
    // No polyline spans the plot.
    for (const segment of segments) {
      for (let i = 1; i < segment.vertices.length; i++) {
        expect(Math.abs(segment.vertices[i].x - segment.vertices[i - 1].x)).toBeLessThan(0.5);
      }
    }
  });

  it("wraps the other way too (southern-hemisphere panorama, edges at south)", () => {
    const segments = buildPathSegments([point(0, 170, 8), point(5, 190, 10)], 0, 5);
    expect(segments).toHaveLength(2);
    expect(segments[0].vertices[1].x).toBe(1);
    expect(segments[0].vertices[1].altitudeDeg).toBeCloseTo(9, 9);
    expect(segments[1].vertices[0].x).toBe(0);
    expect(segments[1].vertices[0].altitudeDeg).toBeCloseTo(9, 9);
  });

  it("breaks where samples are not consecutive in time", () => {
    const segments = buildPathSegments(
      [point(0, 100, 1), point(5, 101, 2), point(120, 140, 2), point(125, 141, 1)],
      180,
      5,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].vertices).toHaveLength(2);
  });

  it("drops stray single points", () => {
    expect(buildPathSegments([point(0, 100, 1)], 180, 5)).toEqual([]);
    expect(buildPathSegments([], 180, 5)).toEqual([]);
  });
});

describe("hourMarks", () => {
  it("marks whole hours while the sun is up, between the neighbouring samples", () => {
    const grid = syntheticGrid();
    const marks = hourMarks(grid, 0);
    expect(marks.map((mark) => mark.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const noon = marks.find((mark) => mark.hour === 12)!;
    expect(noon.azimuthDeg).toBeCloseTo(180, 4);
    expect(noon.altitudeDeg).toBeGreaterThan(49);
    expect(hourMarks(grid, 999)).toEqual([]);
  });
});

describe("sunPassageAt", () => {
  const grid = syntheticGrid();
  const path = sunPathForDay(grid, 0, null, YARD);

  it("interpolates when the sun passes a direction", () => {
    // East → west over 06:00–18:00: due south at noon, south-west at 15:00.
    const south = sunPassageAt(path, 180, grid.stepMinutes);
    expect(south?.minute).toBeCloseTo(720, 3);
    expect(south?.altitudeDeg).toBeGreaterThan(49);
    expect(sunPassageAt(path, 225, grid.stepMinutes)?.minute).toBeCloseTo(900, 3);
    expect(sunPassageAt(path, 225, grid.stepMinutes)?.state).toBe(SunState.Sun);
  });

  it("returns null where the sun never goes", () => {
    expect(sunPassageAt(path, 0, grid.stepMinutes)).toBeNull();
    expect(sunPassageAt(path, 300, grid.stepMinutes)).toBeNull();
    expect(sunPassageAt([], 180, grid.stepMinutes)).toBeNull();
  });

  it("does not bridge a gap in the path", () => {
    const sparse = [path[2], path[20]];
    expect(sunPassageAt(sparse, 180, grid.stepMinutes)).toBeNull();
  });
});

describe("referenceDays", () => {
  it("gives the solstices and the equinox as day indices", () => {
    expect(referenceDays(2026).map((day) => [day.key, day.dayIndex])).toEqual([
      ["june", 171],
      ["equinox", 78],
      ["december", 354],
    ]);
    expect(referenceDays(2028)[0].dayIndex).toBe(172);
  });
});

describe("skyline silhouette", () => {
  it("groups obstructed directions into runs, left to right", () => {
    const horizon = syntheticHorizon((azimuth) =>
      azimuth >= 90 && azimuth < 100 ? 20 : azimuth >= 200 && azimuth < 201 ? 35 : 0,
    );
    const runs = skylineRuns(horizon, 180);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ kind: "building", startX: 0.25, binWidth: 1 / 720 });
    expect(runs[0].elevationsDeg).toHaveLength(20);
    expect(runs[1].startX).toBeCloseTo(200 / 360, 9);
    expect(runs[1].elevationsDeg).toEqual([35, 35]);
  });

  it("re-centres for the southern hemisphere", () => {
    const horizon = syntheticHorizon((azimuth) => (azimuth >= 350 || azimuth < 10 ? 15 : 0));
    // Centred on south the obstruction is cut in two by the edges…
    expect(skylineRuns(horizon, 180)).toHaveLength(2);
    // …centred on north it is one run in the middle.
    const runs = skylineRuns(horizon, 0);
    expect(runs).toHaveLength(1);
    expect(runs[0].startX).toBeCloseTo(170 / 360, 9);
    expect(runs[0].elevationsDeg).toHaveLength(40);
  });

  it("separates terrain from buildings", () => {
    const horizon = syntheticHorizon(
      (azimuth) => (azimuth >= 100 && azimuth < 120 ? 10 : 0),
      (azimuth) => (azimuth < 110 ? -2 : 7),
    );
    expect(skylineRuns(horizon, 180).map((run) => run.kind)).toEqual(["terrain", "building"]);
    expect(obstructionKind(-2)).toBe("terrain");
    expect(obstructionKind(-7)).toBe("terrain");
    expect(obstructionKind(0)).toBe("building");
  });

  it("condenses the skyline to eight compass sectors", () => {
    const horizon = syntheticHorizon(
      (azimuth) => (azimuth >= 170 && azimuth < 190 ? 30 : 0),
      () => 3,
      55,
    );
    const sectors = sectorSummary(horizon);
    expect(sectors.map((sector) => sector.label)).toEqual([
      "N",
      "NE",
      "E",
      "SE",
      "S",
      "SW",
      "W",
      "NW",
    ]);
    expect(sectors[4]).toEqual({
      label: "S",
      maxElevationDeg: 30,
      distanceM: 55,
      kind: "building",
    });
    expect(sectors[0]).toEqual({ label: "N", maxElevationDeg: 0, distanceM: 0, kind: null });
  });
});

describe("outsideViewSpans", () => {
  it("is empty for a yard or an all-round window", () => {
    expect(outsideViewSpans(YARD, 180)).toEqual([]);
    expect(outsideViewSpans({ mode: "window", facingDeg: 0, fovDeg: 360 }, 180)).toEqual([]);
  });

  it("shades both sides of a view cone in the middle of the panorama", () => {
    const spans = outsideViewSpans({ mode: "window", facingDeg: 180, fovDeg: 120 }, 180);
    expect(spans).toHaveLength(2);
    expect(spans[0].x0).toBe(0);
    expect(spans[0].x1).toBeCloseTo(120 / 360, 9);
    expect(spans[1].x0).toBeCloseTo(240 / 360, 9);
    expect(spans[1].x1).toBe(1);
  });

  it("shades the middle when the view cone straddles the edges", () => {
    const spans = outsideViewSpans({ mode: "window", facingDeg: 0, fovDeg: 120 }, 180);
    expect(spans).toHaveLength(1);
    expect(spans[0].x0).toBeCloseTo(60 / 360, 9);
    expect(spans[0].x1).toBeCloseTo(300 / 360, 9);
  });
});
