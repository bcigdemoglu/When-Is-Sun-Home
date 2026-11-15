import { describe, expect, it } from "vitest";
import {
  DAY_LOOP_SECONDS,
  MAX_FRAME_MS,
  YEAR_LOOP_SECONDS,
  advanceDayIndex,
  advanceMinute,
  dayLoopRange,
  dayLoopSpeed,
  frameElapsedMs,
  yearLoopSpeed,
} from "./playback";

describe("dayLoopRange", () => {
  it("pads sunrise and sunset by 30 minutes", () => {
    expect(dayLoopRange(400.4, 1000.2)).toEqual({ startMinute: 370, endMinute: 1031 });
  });

  it("clamps to the calendar day", () => {
    expect(dayLoopRange(10, 1430)).toEqual({ startMinute: 0, endMinute: 1439 });
  });

  it("uses the whole day when there is no ordinary sunrise-then-sunset", () => {
    const fullDay = { startMinute: 0, endMinute: 1439 };
    expect(dayLoopRange(null, 1000)).toEqual(fullDay);
    expect(dayLoopRange(400, null)).toEqual(fullDay);
    expect(dayLoopRange(900, 20)).toEqual(fullDay); // sunset just after midnight
    expect(dayLoopRange(NaN, 1000)).toEqual(fullDay);
  });
});

describe("frameElapsedMs", () => {
  it("credits real time, capped", () => {
    expect(frameElapsedMs(1000, 1016)).toBe(16);
    expect(frameElapsedMs(1000, 9000)).toBe(MAX_FRAME_MS);
  });

  it("never goes backwards", () => {
    expect(frameElapsedMs(1000, 990)).toBe(0);
    expect(frameElapsedMs(NaN, 990)).toBe(0);
  });
});

describe("advanceMinute", () => {
  const loop = { startMinute: 360, endMinute: 1079 }; // 720 minutes long

  it("moves by speed × time, independent of the frame rate", () => {
    expect(advanceMinute(400, 1000, 60, loop)).toBeCloseTo(460);
    let position = 400;
    for (let i = 0; i < 60; i++) position = advanceMinute(position, 1000 / 60, 60, loop);
    expect(position).toBeCloseTo(460);
  });

  it("wraps from the end of the loop to its start", () => {
    expect(advanceMinute(1079, 1000, 2, loop)).toBeCloseTo(361);
    expect(advanceMinute(1079.5, 1000, 0.5, loop)).toBeCloseTo(360);
  });

  it("jumps to the start when the position is outside the loop", () => {
    expect(advanceMinute(100, 0, 60, loop)).toBe(360);
    expect(advanceMinute(1300, 1000, 60, loop)).toBeCloseTo(420);
    expect(advanceMinute(NaN, 0, 60, loop)).toBe(360);
  });

  it("always stays inside the loop, whatever the step", () => {
    let position = 360;
    for (let i = 0; i < 500; i++) {
      position = advanceMinute(position, 100, 240, loop);
      expect(position).toBeGreaterThanOrEqual(360);
      expect(position).toBeLessThan(1080);
    }
  });

  it("ignores negative time", () => {
    expect(advanceMinute(400, -50, 60, loop)).toBe(400);
  });
});

describe("advanceDayIndex", () => {
  it("moves by speed × time", () => {
    expect(advanceDayIndex(10, 500, 20, 365)).toBeCloseTo(20);
  });

  it("wraps within the same year", () => {
    expect(advanceDayIndex(364.5, 1000, 1, 365)).toBeCloseTo(0.5);
    expect(advanceDayIndex(365.5, 1000, 1, 366)).toBeCloseTo(0.5);
    const wrapped = advanceDayIndex(364.9, 100, 50, 365);
    expect(Math.floor(wrapped)).toBeLessThan(365);
  });
});

describe("loop speeds", () => {
  it("plays sunrise to sunset in about eight seconds, whatever the season", () => {
    for (const loop of [dayLoopRange(300, 1200), dayLoopRange(480, 990)]) {
      const speed = dayLoopSpeed(loop);
      let position = loop.startMinute;
      let wraps = 0;
      const frames = DAY_LOOP_SECONDS * 60;
      for (let i = 0; i < frames - 1; i++) {
        const next = advanceMinute(position, 1000 / 60, speed, loop);
        if (next < position) wraps++;
        position = next;
      }
      expect(wraps).toBe(0);
      expect(position).toBeGreaterThan(loop.endMinute - 5);
    }
  });

  it("plays a year in about fifteen seconds", () => {
    expect(yearLoopSpeed(365) * YEAR_LOOP_SECONDS).toBeCloseTo(365);
  });
});
