/**
 * The time slider's track: a strip showing, minute by minute, what the sun is
 * doing over the selected day, so the thumb is dragged along the answer.
 */
import { SunState, type DayAnalysis, type SunStateCode } from "@/lib/types";

/** CSS colour (a design token) for each sun state. */
export const STATE_COLOR: Record<SunStateCode, string> = {
  [SunState.Night]: "var(--state-night)",
  [SunState.Sun]: "var(--state-sun)",
  [SunState.Blocked]: "var(--state-blocked)",
  [SunState.OutOfView]: "var(--state-out)",
};

export interface StateRun {
  state: SunStateCode;
  /** Wall-clock minutes, [start, end). */
  startMinute: number;
  endMinute: number;
}

/**
 * Collapse a day's samples into runs of equal state covering 0..1440.
 * Minutes without a sample (a DST gap) count as night.
 */
export function stateRuns(day: Pick<DayAnalysis, "samples" | "stepMinutes">): StateRun[] {
  const runs: StateRun[] = [];
  const push = (state: SunStateCode, startMinute: number, endMinute: number) => {
    if (endMinute <= startMinute) return;
    const last = runs[runs.length - 1];
    if (last && last.state === state && last.endMinute === startMinute) last.endMinute = endMinute;
    else runs.push({ state, startMinute, endMinute });
  };

  let cursor = 0;
  for (const sample of day.samples) {
    const start = Math.max(cursor, sample.minute);
    const end = Math.min(1440, sample.minute + day.stepMinutes);
    if (start > cursor) push(SunState.Night, cursor, start);
    push(sample.state, start, end);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1440) push(SunState.Night, cursor, 1440);
  return runs;
}

/** Width of the slider thumb, px: the thumb's centre stops half of it short of each end. */
const THUMB_PX = 24;

/**
 * CSS `background` for the time slider's track, or `undefined` without data.
 * Hard-edged colour stops per run, inset by half a thumb so a colour change
 * sits exactly where the thumb's centre is at that minute.
 */
export function dayTrackBackground(
  day: Pick<DayAnalysis, "samples" | "stepMinutes"> | null,
): string | undefined {
  if (!day || day.samples.length === 0) return undefined;
  const stops: string[] = [];
  for (const run of stateRuns(day)) {
    const from = ((run.startMinute / 1440) * 100).toFixed(2);
    const to = ((run.endMinute / 1440) * 100).toFixed(2);
    stops.push(`${STATE_COLOR[run.state]} ${from}% ${to}%`);
  }
  const edge = STATE_COLOR[SunState.Night];
  return `linear-gradient(to right, ${stops.join(", ")}) center / calc(100% - ${THUMB_PX}px) 100% no-repeat, ${edge}`;
}
