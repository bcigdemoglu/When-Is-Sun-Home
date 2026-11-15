import { describe, expect, it } from "vitest";
import { SunState, type DaySample, type SunStateCode } from "@/lib/types";
import {
  daylightEnds,
  pointString,
  polarPoint,
  rimPoint,
  sunPathModel,
  sunPathRuns,
  wedgePath,
} from "./compassGeometry";

function sample(minute: number, state: SunStateCode, altitudeDeg = 30, azimuthDeg = 90): DaySample {
  return { minute, state, altitudeDeg, azimuthDeg };
}

describe("polar projection", () => {
  it("puts north up and east to the right", () => {
    expect(rimPoint(0, 100)).toEqual({ x: 0, y: -100 });
    expect(rimPoint(90, 100).x).toBeCloseTo(100);
    expect(rimPoint(90, 100).y).toBeCloseTo(0);
    expect(rimPoint(180, 100).y).toBeCloseTo(100);
    expect(rimPoint(270, 100).x).toBeCloseTo(-100);
  });

  it("maps the zenith to the centre and the horizon to the rim", () => {
    const zenith = polarPoint(123, 90, 100);
    expect(zenith.x).toBeCloseTo(0);
    expect(zenith.y).toBeCloseTo(0);
    expect(polarPoint(90, 0, 100).x).toBeCloseTo(100);
    expect(polarPoint(90, 45, 100).x).toBeCloseTo(50);
    // Below the horizon clamps to the rim rather than leaving the diagram.
    expect(polarPoint(90, -10, 100).x).toBeCloseTo(100);
  });
});

describe("sunPathRuns", () => {
  it("returns nothing for a day without sun", () => {
    expect(
      sunPathRuns([sample(0, SunState.Night, -5), sample(1, SunState.Night, -4)], 100),
    ).toEqual([]);
  });

  it("splits the path where the state changes and keeps the runs connected", () => {
    const samples: DaySample[] = [];
    for (let m = 0; m < 30; m++) {
      const state = m < 5 ? SunState.Night : m < 15 ? SunState.Blocked : SunState.Sun;
      samples.push(sample(m, state, m < 5 ? -1 : m, 90 + m));
    }
    const runs = sunPathRuns(samples, 100, 4);
    expect(runs.map((run) => run.state)).toEqual([SunState.Blocked, SunState.Sun]);
    const lastOfFirst = runs[0].d.split("L").pop();
    const firstOfSecond = runs[1].d.slice(1).split("L")[0];
    expect(lastOfFirst).toBe(firstOfSecond);
  });

  it("thins the points but keeps both ends of a run", () => {
    const samples: DaySample[] = [];
    for (let m = 0; m <= 100; m++) samples.push(sample(m, SunState.Sun, 10 + m / 10, 90 + m / 2));
    const [run] = sunPathRuns(samples, 100, 10);
    const points = run.d.slice(1).split("L");
    expect(points.length).toBeLessThan(15);
    expect(points.length).toBeGreaterThan(8);
    expect(points[points.length - 1]).toBe(pointString(polarPoint(140, 20, 100)));
  });

  it("does not bridge a gap in time", () => {
    const samples = [
      sample(100, SunState.Sun, 5, 100),
      sample(101, SunState.Sun, 5, 101),
      sample(102, SunState.Sun, 5, 102),
      // an hour is missing (DST) …
      sample(200, SunState.Sun, 5, 120),
      sample(201, SunState.Sun, 5, 121),
    ];
    expect(sunPathRuns(samples, 100, 1)).toHaveLength(2);
  });

  it("produces only finite coordinates", () => {
    const samples: DaySample[] = [];
    for (let m = 0; m < 1440; m++) {
      const altitude = 60 * Math.sin(((m - 360) / 720) * Math.PI);
      const state =
        altitude > 0 ? (m % 200 < 100 ? SunState.Sun : SunState.OutOfView) : SunState.Night;
      samples.push(sample(m, state, altitude, (m / 4) % 360));
    }
    for (const run of sunPathRuns(samples, 100)) {
      expect(run.d).toMatch(/^M[-\d.,L]+$/);
    }
  });
});

describe("daylightEnds", () => {
  it("finds the first and last daylight samples", () => {
    const samples = [
      sample(0, SunState.Night, -3),
      sample(1, SunState.Blocked, 1),
      sample(2, SunState.Sun, 2),
      sample(3, SunState.Night, -1),
    ];
    expect(daylightEnds(samples).first?.minute).toBe(1);
    expect(daylightEnds(samples).last?.minute).toBe(2);
    expect(daylightEnds([])).toEqual({ first: null, last: null });
  });
});

describe("wedgePath", () => {
  it("draws a pie slice centred on the facing direction", () => {
    expect(wedgePath(180, 180, 100)).toBe("M0,0L100,0A100,100 0 0 1 -100,0Z");
  });

  it("uses the large arc beyond 180° and a full circle at 360°", () => {
    expect(wedgePath(0, 270, 100)).toContain(" 0 1 1 ");
    expect(wedgePath(0, 360, 100)).toMatch(/^M0,-100A/);
  });
});

describe("sunPathModel", () => {
  it("bundles the path with the sunrise and sunset marks", () => {
    const samples = [
      sample(0, SunState.Night, -3),
      sample(1, SunState.Blocked, 1, 80),
      sample(2, SunState.Sun, 2, 81),
      sample(3, SunState.Sun, 1, 82),
      sample(4, SunState.Night, -1),
    ];
    const model = sunPathModel({ samples, sunriseMinute: 0.6, sunsetMinute: 3.4 }, 100);
    expect(model.runs.map((run) => run.state)).toEqual([SunState.Blocked, SunState.Sun]);
    expect(model.rise).toEqual({ azimuthDeg: 80, minute: 0.6 });
    expect(model.set).toEqual({ azimuthDeg: 82, minute: 3.4 });
  });

  it("labels no sunrise or sunset when there is none (polar day), but still draws the path", () => {
    const up: DaySample[] = [];
    for (let m = 0; m < 1440; m += 10) up.push(sample(m, SunState.Sun, 5, (m / 4) % 360));
    const model = sunPathModel({ samples: up, sunriseMinute: null, sunsetMinute: null }, 100);
    expect(model.runs.length).toBeGreaterThan(0);
    expect(model.rise).toBeNull();
    expect(model.set).toBeNull();
    // A date that starts in daylight and only has a sunset keeps just that one.
    const evening = sunPathModel({ samples: up, sunriseMinute: null, sunsetMinute: 40.5 }, 100);
    expect(evening.rise).toBeNull();
    expect(evening.set?.minute).toBe(40.5);
    expect(
      sunPathModel(
        { samples: [sample(0, SunState.Night, -5)], sunriseMinute: null, sunsetMinute: null },
        100,
      ),
    ).toEqual({ runs: [], rise: null, set: null });
  });
});
