import { describe, expect, it } from "vitest";
import { SunState, type DaySample, type SunStateCode } from "@/lib/types";
import { dayTrackBackground, stateRuns } from "./dayTrack";

function samples(states: (m: number) => SunStateCode, skip?: (m: number) => boolean): DaySample[] {
  const out: DaySample[] = [];
  for (let minute = 0; minute < 1440; minute++) {
    if (skip?.(minute)) continue;
    out.push({ minute, state: states(minute), azimuthDeg: 0, altitudeDeg: 0 });
  }
  return out;
}

describe("stateRuns", () => {
  it("collapses samples into runs covering the whole day", () => {
    const day = {
      stepMinutes: 1,
      samples: samples((m) =>
        m < 400 ? SunState.Night : m < 500 ? SunState.Blocked : m < 1000 ? SunState.Sun : SunState.Night,
      ),
    };
    expect(stateRuns(day)).toEqual([
      { state: SunState.Night, startMinute: 0, endMinute: 400 },
      { state: SunState.Blocked, startMinute: 400, endMinute: 500 },
      { state: SunState.Sun, startMinute: 500, endMinute: 1000 },
      { state: SunState.Night, startMinute: 1000, endMinute: 1440 },
    ]);
  });

  it("fills a DST gap with night and still ends at 1440", () => {
    const day = {
      stepMinutes: 1,
      samples: samples(
        () => SunState.Sun,
        (m) => m >= 120 && m < 180,
      ),
    };
    const runs = stateRuns(day);
    expect(runs).toEqual([
      { state: SunState.Sun, startMinute: 0, endMinute: 120 },
      { state: SunState.Night, startMinute: 120, endMinute: 180 },
      { state: SunState.Sun, startMinute: 180, endMinute: 1440 },
    ]);
  });

  it("honours a coarser step", () => {
    const day = {
      stepMinutes: 720,
      samples: [
        { minute: 0, state: SunState.Night, azimuthDeg: 0, altitudeDeg: -1 },
        { minute: 720, state: SunState.OutOfView, azimuthDeg: 0, altitudeDeg: 1 },
      ],
    };
    expect(stateRuns(day)).toEqual([
      { state: SunState.Night, startMinute: 0, endMinute: 720 },
      { state: SunState.OutOfView, startMinute: 720, endMinute: 1440 },
    ]);
  });
});

describe("dayTrackBackground", () => {
  it("is undefined without data", () => {
    expect(dayTrackBackground(null)).toBeUndefined();
    expect(dayTrackBackground({ stepMinutes: 1, samples: [] })).toBeUndefined();
  });

  it("uses design tokens with hard stops in percent of the day", () => {
    const day = {
      stepMinutes: 1,
      samples: samples((m) => (m >= 360 && m < 1080 ? SunState.Sun : SunState.Night)),
    };
    const background = dayTrackBackground(day);
    expect(background).toContain("var(--state-night) 0.00% 25.00%");
    expect(background).toContain("var(--state-sun) 25.00% 75.00%");
    expect(background).toContain("var(--state-night) 75.00% 100.00%");
    expect(background).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
