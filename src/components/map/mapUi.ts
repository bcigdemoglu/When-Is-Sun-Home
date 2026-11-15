"use client";

/**
 * The thin line between the map and the buttons around it. The map itself
 * (MapLibre, loaded lazily) lives in `SunMap`; the buttons live in the shell.
 * They meet here: buttons send commands, the map reports what it shows.
 */
import { create } from "zustand";

/** localStorage key that remembers the Satellite choice in this browser. */
export const SATELLITE_STORAGE_KEY = "sun-home:map-satellite:v1";

/** The remembered Satellite choice; off when there is none or storage cannot be read. */
export function readSatelliteChoice(): boolean {
  try {
    return globalThis.localStorage?.getItem(SATELLITE_STORAGE_KEY) === "1";
  } catch {
    // Private mode, storage disabled: there is simply nothing remembered.
    return false;
  }
}

function writeSatelliteChoice(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(SATELLITE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // The choice still holds for this visit.
  }
}

export type MapCommand =
  | { type: "zoom"; delta: number }
  | { type: "north" }
  | { type: "recenter" }
  | { type: "tilt"; tilted: boolean };

/** Space (px) on each side of the map that other things cover. */
export interface MapInsets {
  top: number;
  bottom: number;
}

interface MapUiState {
  /** True once the map has loaded and takes commands. */
  ready: boolean;
  /** Whether the camera is tilted right now (the "3D" view). */
  tilted: boolean;
  /** The person's choice of 2D / 3D, applied whenever the camera flies to a place. */
  wantsTilt: boolean;
  /**
   * The person's choice of the Satellite view (aerial photos), remembered in
   * this browser. Off until `hydrate()` has read it. Whether the map really
   * draws photos also depends on where it is: see `showsImagery`.
   */
  satellite: boolean;
  /** Compass bearing of "up" on the map, whole degrees; 0 = north up. */
  bearing: number;
  /** The latest command and a counter that changes with every one. */
  command: MapCommand | null;
  commandSeq: number;
  insets: MapInsets;
  send(command: MapCommand): void;
  setInsets(insets: MapInsets): void;
  /** Choose or leave the Satellite view, and remember it. */
  setSatellite(on: boolean): void;
  /** Read what this browser remembers. Call once, after the page has mounted. */
  hydrate(): void;
  /** For the map only. */
  report(view: Partial<Pick<MapUiState, "ready" | "tilted" | "bearing">>): void;
}

export const useMapUi = create<MapUiState>((set, get) => ({
  ready: false,
  tilted: false,
  wantsTilt: true,
  satellite: false,
  bearing: 0,
  command: null,
  commandSeq: 0,
  insets: { top: 0, bottom: 0 },
  send: (command) => {
    // Asking for the tilted 3D view is asking to leave the (top-down) photos.
    const leavesSatellite = command.type === "tilt" && command.tilted && get().satellite;
    if (leavesSatellite) writeSatelliteChoice(false);
    set({
      command,
      commandSeq: get().commandSeq + 1,
      ...(command.type === "tilt" ? { wantsTilt: command.tilted } : {}),
      ...(leavesSatellite ? { satellite: false } : {}),
    });
  },
  setSatellite: (on) => {
    writeSatelliteChoice(on);
    if (get().satellite !== on) set({ satellite: on });
  },
  hydrate: () => {
    const satellite = readSatelliteChoice();
    if (get().satellite !== satellite) set({ satellite });
  },
  setInsets: (insets) => {
    const current = get().insets;
    if (current.top !== insets.top || current.bottom !== insets.bottom) set({ insets });
  },
  report: (view) => {
    const current = get();
    const changed = (Object.keys(view) as (keyof typeof view)[]).some(
      (key) => view[key] !== undefined && view[key] !== current[key],
    );
    if (changed) set(view);
  },
}));
