/**
 * What the viewpoint CONTROLS need: presets and what each setting means in a
 * sentence. (How a viewpoint is described in a few words lives in
 * `@/components/shared/viewpoint`, shared with places and sharing.)
 */
import { compassWords } from "@/components/shared/format";
import type { Observer } from "@/lib/types";
import { EYE_HEIGHT_M, SETTINGS_LIMITS } from "@/state";

/** "Roof" preset when the pin is not on a building: a typical two-storey roof. */
export const DEFAULT_ROOF_HEIGHT_M = 9;
/** Upper end of the yard height slider, metres (the store allows more). */
export const YARD_HEIGHT_MAX_M = 30;

export const FOV_PRESETS = [
  { value: "narrow", label: "Narrow", fovDeg: 90 },
  { value: "normal", label: "Normal", fovDeg: 180 },
  { value: "wide", label: "Wide", fovDeg: 270 },
] as const;
export type FovPreset = (typeof FOV_PRESETS)[number]["value"];

/** The preset a field of view is exactly, or null for something in between. */
export function fovPreset(fovDeg: number): FovPreset | null {
  return FOV_PRESETS.find((preset) => preset.fovDeg === fovDeg)?.value ?? null;
}

/** Eye height on top of the building under the pin, or of a typical roof. */
export function roofHeightM(pinBuildingHeightM: number | null): number {
  if (pinBuildingHeightM === null) return DEFAULT_ROOF_HEIGHT_M;
  return Math.min(
    SETTINGS_LIMITS.heightM.max,
    Math.round((pinBuildingHeightM + EYE_HEIGHT_M) * 2) / 2,
  );
}

/** What the facing and field of view add up to, in a sentence. */
export function viewConeSentence(observer: Pick<Observer, "facingDeg" | "fovDeg">): string {
  if (observer.fovDeg >= 360) return "The sun counts wherever it is in the sky.";
  const from = compassWords(observer.facingDeg - observer.fovDeg / 2);
  const to = compassWords(observer.facingDeg + observer.fovDeg / 2);
  if (from === to) return `The sun counts only when it is close to the ${from}.`;
  return `The sun counts while it is between the ${from} and the ${to}.`;
}
