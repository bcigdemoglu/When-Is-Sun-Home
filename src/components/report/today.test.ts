import { describe, expect, it } from "vitest";

import { SunState, type Observer } from "@/lib/types";

import { stateRuns } from "./summary";
import { syntheticDay, YARD } from "./testing";
import { dayLegendRows } from "./TodayCard";

const WINDOW: Observer = { mode: "window", heightM: 4, facingDeg: 180, fovDeg: 120 };

function rowsFor(
  runs: readonly (readonly [number, number, 0 | 1 | 2 | 3])[],
  observer: Observer = YARD,
  hour12 = true,
  hasTerrain = false,
) {
  const day = syntheticDay("2026-06-15", runs);
  const states = day.samples.map((sample) => sample.state);
  const minutes = day.samples.map((sample) => sample.minute);
  return dayLegendRows(stateRuns(states, 1, minutes), observer, hour12, hasTerrain);
}

describe("dayLegendRows", () => {
  it("lists each state with its clock ranges and its total", () => {
    const rows = rowsFor([
      [414, 551, SunState.Blocked],
      [551, 823, SunState.Sun],
      [823, 1014, SunState.Blocked],
    ]);
    expect(rows).toEqual([
      { state: SunState.Sun, label: "Direct sun", ranges: "9:11 AM – 1:43 PM", minutes: 272 },
      {
        state: SunState.Blocked,
        label: "Shaded by buildings",
        ranges: "6:54 AM – 9:11 AM, 1:43 PM – 4:54 PM",
        minutes: 328,
      },
      {
        state: SunState.Night,
        label: "Night",
        ranges: "until 6:54 AM, from 4:54 PM",
        minutes: 840,
      },
    ]);
  });

  it("uses the 24-hour clock when asked", () => {
    const rows = rowsFor([[551, 823, SunState.Sun]], YARD, false);
    expect(rows[0].ranges).toBe("09:11 – 13:43");
    expect(rows[1].ranges).toBe("until 09:11, from 13:43");
  });

  it("always lists direct sun, even when there is none", () => {
    const rows = rowsFor([[360, 1080, SunState.Blocked]]);
    expect(rows.map((row) => row.state)).toEqual([SunState.Sun, SunState.Blocked, SunState.Night]);
    expect(rows[0]).toMatchObject({ ranges: "", minutes: 0 });
  });

  it("leaves out states that do not occur", () => {
    expect(rowsFor([[0, 1440, SunState.Sun]])).toEqual([
      { state: SunState.Sun, label: "Direct sun", ranges: "all day", minutes: 1440 },
    ]);
    expect(rowsFor([]).map((row) => row.state)).toEqual([SunState.Sun, SunState.Night]);
    expect(rowsFor([])[1].ranges).toBe("all day");
  });

  it("lists out-of-view for a window, between shade and night", () => {
    const rows = rowsFor(
      [
        [360, 600, SunState.OutOfView],
        [600, 800, SunState.Sun],
        [800, 1080, SunState.OutOfView],
      ],
      WINDOW,
    );
    expect(rows.map((row) => row.label)).toEqual(["Direct sun", "Sun outside the view", "Night"]);
    expect(rows[1].ranges).toBe("6:00 AM – 10:00 AM, 1:20 PM – 6:00 PM");
  });

  it("counts the rest when a state comes in many pieces", () => {
    const rows = rowsFor([
      [360, 400, SunState.Sun],
      [400, 420, SunState.Blocked],
      [420, 480, SunState.Sun],
      [480, 500, SunState.Blocked],
      [500, 560, SunState.Sun],
      [560, 580, SunState.Blocked],
      [580, 640, SunState.Sun],
      [640, 660, SunState.Blocked],
      [660, 700, SunState.Sun],
    ]);
    expect(rows[0].ranges).toBe("6:00 AM – 6:40 AM, 7:00 AM – 8:00 AM, 8:20 AM – 9:20 AM, +2 more");
    expect(rows[0].minutes).toBe(260);
    expect(rows[1].ranges).toMatch(/, \+1 more$/);
  });

  it("names hills as blockers when terrain is in the skyline", () => {
    const rows = rowsFor([[360, 1080, SunState.Blocked]], YARD, true, true);
    expect(rows[1].label).toBe("Shaded by buildings or hills");
  });
});
