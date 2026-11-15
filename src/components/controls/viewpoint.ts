/** Words for the viewpoint (the "observer"): what the pill says, what each control means. */
import { compassName, compassPoint } from "@/components/shared/format";
import type { Observer } from "@/lib/types";
import { EYE_HEIGHT_M, SETTINGS_LIMITS, heightMToFloor } from "@/state";

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

/** "1 m", "4.5 m". */
export function formatMeters(heightM: number): string {
  return `${Number.isInteger(heightM) ? heightM : heightM.toFixed(1)} m`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** Floor 1 is the ground floor; above it floors are counted the way a lift does: 2nd, 3rd … */
export function floorName(floor: number): string {
  return floor <= 1 ? "Ground floor" : `${ordinal(Math.round(floor))} floor`;
}

/** Eye height on top of the building under the pin, or of a typical roof. */
export function roofHeightM(pinBuildingHeightM: number | null): number {
  if (pinBuildingHeightM === null) return DEFAULT_ROOF_HEIGHT_M;
  return Math.min(
    SETTINGS_LIMITS.heightM.max,
    Math.round((pinBuildingHeightM + EYE_HEIGHT_M) * 2) / 2,
  );
}

/** The viewpoint in a few words, for the pill that opens its controls. */
export function viewpointSummary(observer: Observer): string {
  if (observer.mode === "yard") {
    return observer.heightM <= 1.5
      ? "Yard · ground"
      : `Yard · ${formatMeters(observer.heightM)} up`;
  }
  const floor = floorName(heightMToFloor(observer.heightM)).toLowerCase();
  return `Window · ${floor} · ${compassPoint(observer.facingDeg)}`;
}

/** What the facing and field of view add up to, in a sentence. */
export function viewConeSentence(observer: Pick<Observer, "facingDeg" | "fovDeg">): string {
  if (observer.fovDeg >= 360) return "The sun counts wherever it is in the sky.";
  const from = compassName(observer.facingDeg - observer.fovDeg / 2);
  const to = compassName(observer.facingDeg + observer.fovDeg / 2);
  if (from === to) return `The sun counts only when it is close to the ${from}.`;
  return `The sun counts while it is between the ${from} and the ${to}.`;
}
