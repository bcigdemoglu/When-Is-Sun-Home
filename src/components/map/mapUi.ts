"use client";

/**
 * The thin line between the map and the buttons around it. The map itself
 * (MapLibre, loaded lazily) lives in `SunMap`; the buttons live in the shell.
 * They meet here: buttons send commands, the map reports what it shows.
 */
import { create } from "zustand";

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
  /** Compass bearing of "up" on the map, whole degrees; 0 = north up. */
  bearing: number;
  /** The latest command and a counter that changes with every one. */
  command: MapCommand | null;
  commandSeq: number;
  insets: MapInsets;
  send(command: MapCommand): void;
  setInsets(insets: MapInsets): void;
  /** For the map only. */
  report(view: Partial<Pick<MapUiState, "ready" | "tilted" | "bearing">>): void;
}

export const useMapUi = create<MapUiState>((set, get) => ({
  ready: false,
  tilted: false,
  wantsTilt: true,
  bearing: 0,
  command: null,
  commandSeq: 0,
  insets: { top: 0, bottom: 0 },
  send: (command) =>
    set({
      command,
      commandSeq: get().commandSeq + 1,
      ...(command.type === "tilt" ? { wantsTilt: command.tilted } : {}),
    }),
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
