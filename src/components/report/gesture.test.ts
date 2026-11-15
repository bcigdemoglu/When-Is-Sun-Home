import { describe, expect, it } from "vitest";

import {
  gestureInput,
  IDLE_GESTURE,
  isFingerPointer,
  reduceGesture,
  type GestureAction,
  type GestureInput,
  type GestureState,
} from "./gesture";

type Step = [GestureInput["type"], number, number, number];

/** Feed a sequence of [type, x, y, time] events; return every action and the final state. */
function run(steps: Step[], pointerType = "touch") {
  let state: GestureState = IDLE_GESTURE;
  const actions: GestureAction[] = [];
  for (const [type, x, y, time] of steps) {
    const result = reduceGesture(state, { type, x, y, time, pointerType });
    state = result.state;
    actions.push(result.action);
  }
  return { actions, state };
}

describe("touch", () => {
  it("a tap commits: down and up in place, quickly", () => {
    const { actions, state } = run([
      ["down", 100, 200, 0],
      ["up", 100, 200, 120],
    ]);
    expect(actions).toEqual(["none", "tap"]);
    expect(state).toBe(IDLE_GESTURE);
  });

  it("a tap may wobble a few pixels", () => {
    expect(
      run([
        ["down", 100, 200, 0],
        ["move", 103, 204, 40],
        ["move", 105, 195, 80],
        ["up", 105, 196, 150],
      ]).actions,
    ).toEqual(["none", "none", "none", "tap"]);
  });

  it("a long press is not a tap", () => {
    expect(
      run([
        ["down", 100, 200, 0],
        ["up", 100, 200, 501],
      ]).actions,
    ).toEqual(["none", "discard"]);
    expect(
      run([
        ["down", 100, 200, 0],
        ["up", 100, 200, 500],
      ]).actions,
    ).toEqual(["none", "tap"]);
  });

  it("a horizontal scrub previews and commits nothing", () => {
    const { actions, state } = run([
      ["down", 100, 200, 0],
      ["move", 104, 200, 20],
      ["move", 112, 201, 40],
      ["move", 160, 215, 80],
      ["move", 230, 260, 160], // once scrubbing, drifting down does not turn it into a scroll
      ["up", 230, 260, 200],
    ]);
    expect(actions).toEqual(["none", "none", "scrub", "scrub", "scrub", "end"]);
    expect(actions).not.toContain("tap");
    expect(state.phase).toBe("idle");
  });

  it("a vertical move is the page's: discard at once, ignore the rest", () => {
    const { actions } = run([
      ["down", 100, 200, 0],
      ["move", 101, 206, 20],
      ["move", 102, 215, 40],
      ["move", 150, 320, 80], // even if it later drifts sideways
      ["up", 150, 320, 120],
    ]);
    expect(actions).toEqual(["none", "none", "discard", "none", "discard"]);
    expect(actions).not.toContain("tap");
    expect(actions).not.toContain("scrub");
  });

  it("a diagonal takes the larger component; a tie goes to the chart", () => {
    expect(
      run([
        ["down", 0, 0, 0],
        ["move", 9, 12, 20],
      ]).actions[1],
    ).toBe("discard");
    expect(
      run([
        ["down", 0, 0, 0],
        ["move", 12, 9, 20],
      ]).actions[1],
    ).toBe("scrub");
    expect(
      run([
        ["down", 0, 0, 0],
        ["move", 10, 10, 20],
      ]).actions[1],
    ).toBe("scrub");
  });

  it("a cancelled gesture commits nothing, wherever it had got to", () => {
    // The browser took the gesture over for scrolling before any move reached us.
    expect(
      run([
        ["down", 100, 200, 0],
        ["cancel", 100, 200, 30],
      ]).actions,
    ).toEqual(["none", "discard"]);
    // Cancelled in the middle of a scrub.
    const scrub = run([
      ["down", 100, 200, 0],
      ["move", 140, 200, 30],
      ["cancel", 140, 200, 60],
    ]);
    expect(scrub.actions).toEqual(["none", "scrub", "discard"]);
    expect(scrub.state).toBe(IDLE_GESTURE);
    // A stray up after the cancel is nothing.
    expect(reduceGesture(scrub.state, { type: "up", x: 0, y: 0, time: 90 }).action).toBe("none");
  });

  it("a pen behaves like a finger", () => {
    expect(
      run(
        [
          ["down", 0, 0, 0],
          ["move", 2, 30, 20],
          ["up", 2, 30, 40],
        ],
        "pen",
      ).actions,
    ).toEqual(["none", "discard", "discard"]);
  });

  it("honours custom thresholds", () => {
    const touch = { pointerType: "touch" };
    const state = reduceGesture(IDLE_GESTURE, {
      type: "down",
      x: 0,
      y: 0,
      time: 0,
      ...touch,
    }).state;
    expect(
      reduceGesture(state, { type: "move", x: 15, y: 0, time: 10, ...touch }, { slop: 20 }).action,
    ).toBe("none");
    expect(
      reduceGesture(state, { type: "up", x: 0, y: 0, time: 300, ...touch }, { tapMs: 200 }).action,
    ).toBe("discard");
  });
});

describe("mouse", () => {
  it("a click commits however long the button is held", () => {
    expect(
      run(
        [
          ["down", 100, 200, 0],
          ["up", 100, 200, 5000],
        ],
        "mouse",
      ).actions,
    ).toEqual(["none", "tap"]);
  });

  it("a drag is never a scroll, and releasing it is still a click", () => {
    expect(
      run(
        [
          ["down", 100, 200, 0],
          ["move", 101, 240, 50],
          ["move", 180, 260, 100],
          ["up", 180, 260, 150],
        ],
        "mouse",
      ).actions,
    ).toEqual(["none", "scrub", "scrub", "tap"]);
  });

  it("moving without a button down is nothing to the reducer", () => {
    expect(
      reduceGesture(IDLE_GESTURE, { type: "move", x: 5, y: 5, time: 0, pointerType: "mouse" }),
    ).toEqual({ state: IDLE_GESTURE, action: "none" });
    expect(reduceGesture(IDLE_GESTURE, { type: "cancel", x: 0, y: 0, time: 0 }).action).toBe(
      "none",
    );
  });
});

describe("pointer kinds", () => {
  it("treats fingers and pens as touching, everything else as pointing", () => {
    expect(isFingerPointer({ pointerType: "touch" })).toBe(true);
    expect(isFingerPointer({ pointerType: "pen" })).toBe(true);
    expect(isFingerPointer({ pointerType: "mouse" })).toBe(false);
    expect(isFingerPointer({})).toBe(false);
    // An unknown device gets the mouse rules: a press and release is a click.
    expect(
      run(
        [
          ["down", 0, 0, 0],
          ["up", 0, 0, 9000],
        ],
        "",
      ).actions,
    ).toEqual(["none", "tap"]);
  });
});

describe("gestureInput", () => {
  it("reads what the reducer needs from a pointer event", () => {
    expect(
      gestureInput("down", { clientX: 12, clientY: 34, timeStamp: 56, pointerType: "touch" }),
    ).toEqual({ type: "down", x: 12, y: 34, time: 56, pointerType: "touch" });
  });
});
