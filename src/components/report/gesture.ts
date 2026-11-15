/**
 * Telling a tap from a scrub from a scroll, for charts that live inside a
 * scrolling sheet. Pure: a reducer over pointer events.
 *
 * The rule the charts follow on touch: a finger that MOVES is reading (the
 * chart previews what is under it), a finger that TAPS is choosing (the chart
 * commits a selection), and a finger that moves vertically is scrolling the
 * page (the chart does nothing — with `touch-action: pan-y` the browser takes
 * the gesture over and sends `pointercancel`).
 */

export type GesturePhase =
  /** No pointer is down. */
  | "idle"
  /** Down, and not moved further than the slop: still a possible tap. */
  | "pressed"
  /** Moving sideways along the chart. */
  | "scrubbing"
  /** Moving up or down: the page's gesture, not the chart's. */
  | "scrolling";

export interface GestureState {
  phase: GesturePhase;
  startX: number;
  startY: number;
  /** Timestamp of the press, milliseconds. */
  startTime: number;
  /** A mouse has no scroll gesture and no accidental taps: it is treated more simply. */
  mouse: boolean;
}

export const IDLE_GESTURE: GestureState = {
  phase: "idle",
  startX: 0,
  startY: 0,
  startTime: 0,
  mouse: false,
};

export interface GestureInput {
  type: "down" | "move" | "up" | "cancel";
  x: number;
  y: number;
  /** Timestamp, milliseconds (e.g. `event.timeStamp`). */
  time: number;
  pointerType?: string;
}

/**
 * What the chart should do about an event:
 *  - "scrub"   show a preview of what is under the pointer
 *  - "tap"     commit a selection at the pointer
 *  - "end"     a scrub finished: drop the preview, commit nothing
 *  - "discard" the gesture was not for the chart (scroll, cancel, long press):
 *              drop any preview, commit nothing
 *  - "none"    nothing
 */
export type GestureAction = "none" | "scrub" | "tap" | "end" | "discard";

export interface GestureOptions {
  /** Movement (px) within which a press is still a tap. */
  slop?: number;
  /** Longest press (ms) that still counts as a tap. */
  tapMs?: number;
}

/** Fingers and pens touch the screen; anything else (a mouse, or an unknown device) points at it. */
export function isFingerPointer(source: { pointerType?: string }): boolean {
  return source.pointerType === "touch" || source.pointerType === "pen";
}

export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 500;

export function reduceGesture(
  state: GestureState,
  input: GestureInput,
  options: GestureOptions = {},
): { state: GestureState; action: GestureAction } {
  const slop = options.slop ?? TAP_SLOP_PX;
  const tapMs = options.tapMs ?? TAP_MAX_MS;

  switch (input.type) {
    case "down":
      return {
        state: {
          phase: "pressed",
          startX: input.x,
          startY: input.y,
          startTime: input.time,
          mouse: !isFingerPointer(input),
        },
        action: "none",
      };

    case "move": {
      if (state.phase === "scrubbing") return { state, action: "scrub" };
      if (state.phase !== "pressed") return { state, action: "none" };
      const dx = Math.abs(input.x - state.startX);
      const dy = Math.abs(input.y - state.startY);
      if (Math.max(dx, dy) < slop) return { state, action: "none" };
      // A mouse drag is never a scroll; a finger's first clear direction decides.
      if (state.mouse || dx >= dy)
        return { state: { ...state, phase: "scrubbing" }, action: "scrub" };
      return { state: { ...state, phase: "scrolling" }, action: "discard" };
    }

    case "up": {
      let action: GestureAction = "none";
      if (state.phase === "pressed") {
        action = state.mouse || input.time - state.startTime <= tapMs ? "tap" : "discard";
      } else if (state.phase === "scrubbing") {
        // Releasing a mouse button is a click wherever it has wandered.
        action = state.mouse ? "tap" : "end";
      } else if (state.phase === "scrolling") {
        action = "discard";
      }
      return { state: IDLE_GESTURE, action };
    }

    default:
      return { state: IDLE_GESTURE, action: state.phase === "idle" ? "none" : "discard" };
  }
}

/** The fields of a DOM / React pointer event the reducer needs. */
export function gestureInput(
  type: GestureInput["type"],
  event: { clientX: number; clientY: number; timeStamp: number; pointerType?: string },
): GestureInput {
  return {
    type,
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
    pointerType: event.pointerType,
  };
}
