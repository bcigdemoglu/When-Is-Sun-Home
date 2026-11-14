/**
 * The four sun states as the report shows them: names, colours and the plain
 * language used in legends, tooltips and the status line.
 */
import { SunState, type Observer, type SunInstant, type SunStateCode } from "@/lib/types";

import { formatDistance } from "./format";

export type Rgb = readonly [number, number, number];

export interface StateMeta {
  code: SunStateCode;
  /** Short legend label. */
  label: string;
  /** Sentence fragment for tooltips: "In direct sun". */
  phrase: string;
  /** CSS custom property that carries the colour. */
  cssVar: string;
  /** Used when the custom property cannot be read (tests, very old browsers). */
  fallback: string;
}

/** Indexed by SunStateCode. */
export const STATE_META: readonly StateMeta[] = [
  {
    code: SunState.Night,
    label: "Night",
    phrase: "Night — sun below the horizon",
    cssVar: "--state-night",
    fallback: "#23283a",
  },
  {
    code: SunState.Sun,
    label: "Direct sun",
    phrase: "In direct sun",
    cssVar: "--state-sun",
    fallback: "#eda100",
  },
  {
    code: SunState.Blocked,
    label: "Shaded by buildings",
    phrase: "Shaded by a building",
    cssVar: "--state-blocked",
    fallback: "#5f82c6",
  },
  {
    code: SunState.OutOfView,
    label: "Sun outside the view",
    phrase: "Sun is up, but outside this window’s view",
    cssVar: "--state-out",
    fallback: "#cfcdc5",
  },
];

export function stateMeta(code: number): StateMeta {
  return STATE_META[code] ?? STATE_META[SunState.Night];
}

/**
 * States that get a legend entry, in reading order (the answer first, night
 * last). Out-of-view only exists for a window, so a yard never lists it.
 */
export function legendStates(observer: Pick<Observer, "mode" | "fovDeg">): SunStateCode[] {
  const coneLimited = observer.mode === "window" && observer.fovDeg < 360;
  return coneLimited
    ? [SunState.Sun, SunState.Blocked, SunState.OutOfView, SunState.Night]
    : [SunState.Sun, SunState.Blocked, SunState.Night];
}

/** Legend / prose name of the Blocked state, depending on what can block. */
export function blockedLabel(hasTerrain: boolean): string {
  return hasTerrain ? "Shaded by buildings or hills" : "Shaded by buildings";
}

/**
 * Tooltip phrase for a state. For Blocked, `blockerIndex` (the skyline's
 * blocker in the sun's direction, if known) tells a hill from a building.
 */
export function statePhrase(code: number, blockerIndex?: number): string {
  if (code === SunState.Blocked && blockerIndex !== undefined && isTerrainBlocker(blockerIndex)) {
    return "Shaded by a hill";
  }
  return stateMeta(code).phrase;
}

// ─── Colours ───────────────────────────────────────────────────────────────

/** Parse "#rgb", "#rrggbb" or "rgb(r, g, b)" / "rgb(r g b)"; `null` otherwise. */
export function parseCssColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  let match = /^#([0-9a-f]{3})$/.exec(text);
  if (match) {
    const [r, g, b] = match[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(text);
  if (match) {
    const hex = match[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (match) {
    const channel = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s))));
    return [channel(match[1]), channel(match[2]), channel(match[3])];
  }
  return null;
}

export interface StateColors {
  /** RGB per SunStateCode, for painting pixels. */
  rgb: readonly Rgb[];
  /** Ink for the out-of-view hatch. */
  hatch: Rgb;
  /** Changes whenever any colour does. */
  key: string;
}

const HATCH_VAR = "--report-hatch";
const HATCH_FALLBACK = "#b7b5ad";

/**
 * Resolve the state colours through `read` (normally
 * `getComputedStyle(el).getPropertyValue`), falling back per colour.
 */
export function resolveStateColors(read: (cssVar: string) => string): StateColors {
  const rgb = STATE_META.map(
    (meta) => parseCssColor(read(meta.cssVar)) ?? (parseCssColor(meta.fallback) as Rgb),
  );
  const hatch = parseCssColor(read(HATCH_VAR)) ?? (parseCssColor(HATCH_FALLBACK) as Rgb);
  const key = [...rgb, hatch].map((c) => c.join(",")).join("|");
  return { rgb, hatch, key };
}

// ─── Plain-language status ─────────────────────────────────────────────────

/** `blockerIndex` semantics: >= 0 a building, -1 nothing, < -1 terrain. */
export function isTerrainBlocker(blockerIndex: number): boolean {
  return blockerIndex < -1;
}

/** One line describing what the sun is doing at the selected instant. */
export function describeInstant(instant: SunInstant, observer: Pick<Observer, "mode">): string {
  switch (instant.state) {
    case SunState.Sun:
      return "In direct sun";
    case SunState.Blocked: {
      const blocker = instant.blocker;
      const what = blocker && isTerrainBlocker(blocker.buildingIndex) ? "a hill" : "a building";
      const distance =
        blocker && blocker.distanceM > 0 ? ` ${formatDistance(blocker.distanceM)} away` : "";
      return `Shaded by ${what}${distance}`;
    }
    case SunState.OutOfView:
      return observer.mode === "window"
        ? "Sun is outside this window’s view"
        : "Sun is outside the view";
    default:
      return "Sun is below the horizon";
  }
}
