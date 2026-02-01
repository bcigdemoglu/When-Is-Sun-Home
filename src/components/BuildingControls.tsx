"use client";

import type { BuildingFeature } from "@/lib/overpass";

const COMPASS_LABELS: Record<number, string> = {
  0: "N", 10: "N", 20: "N", 30: "NE", 40: "NE", 50: "NE",
  60: "NE", 70: "E", 80: "E", 90: "E", 100: "E", 110: "E",
  120: "SE", 130: "SE", 140: "SE", 150: "SE", 160: "S", 170: "S",
  180: "S", 190: "S", 200: "S", 210: "SW", 220: "SW", 230: "SW",
  240: "SW", 250: "W", 260: "W", 270: "W", 280: "W", 290: "W",
  300: "NW", 310: "NW", 320: "NW", 330: "NW", 340: "N", 350: "N",
};

function compassLabel(deg: number): string {
  return COMPASS_LABELS[deg] ?? "";
}

interface BuildingControlsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  userFloor: number;
  onFloorChange: (floor: number) => void;
  pinBuilding: BuildingFeature | null;
  isLoading: boolean;
  blockageEnabled: boolean;
  onBlockageToggle: (enabled: boolean) => void;
  shadowsEnabled: boolean;
  onShadowsToggle: (enabled: boolean) => void;
  pinDirection: number;
  onDirectionChange: (direction: number) => void;
  pinFov: number;
  onFovChange: (fov: number) => void;
}

export default function BuildingControls({
  enabled,
  onToggle,
  userFloor,
  onFloorChange,
  pinBuilding,
  isLoading,
  blockageEnabled,
  onBlockageToggle,
  shadowsEnabled,
  onShadowsToggle,
  pinDirection,
  onDirectionChange,
  pinFov,
  onFovChange,
}: BuildingControlsProps) {
  const maxFloors = pinBuilding ? pinBuilding.properties.levels : 20;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white/90 p-4 shadow-md backdrop-blur dark:bg-zinc-800/90">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Buildings
        </h3>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-zinc-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-500 peer-checked:after:translate-x-full dark:bg-zinc-600" />
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Your Floor</span>
              <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                Floor {userFloor}
                {pinBuilding && ` of ${pinBuilding.properties.levels}`}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={maxFloors}
              value={userFloor}
              onChange={(e) => onFloorChange(parseInt(e.target.value))}
              className="sun-slider w-full"
            />
            <div className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
              Elevation: ~{((userFloor - 1) * 3).toFixed(0)}m above ground
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Direction</span>
              <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                {pinDirection}° ({compassLabel(pinDirection)})
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={350}
              step={10}
              value={pinDirection}
              onChange={(e) => onDirectionChange(parseInt(e.target.value))}
              className="sun-slider w-full"
            />
            <div className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
              The direction you face from your window
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Field of View</span>
              <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                {pinFov}°
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={360}
              step={10}
              value={pinFov}
              onChange={(e) => onFovChange(parseInt(e.target.value))}
              className="sun-slider w-full"
            />
            <div className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
              How wide you can see from your window
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Sun Blockage</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={blockageEnabled}
                onChange={(e) => onBlockageToggle(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-zinc-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-500 peer-checked:after:translate-x-full dark:bg-zinc-600" />
            </label>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Shadows</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={shadowsEnabled}
                onChange={(e) => onShadowsToggle(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-zinc-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-500 peer-checked:after:translate-x-full dark:bg-zinc-600" />
            </label>
          </div>

          {pinBuilding && (
            <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-700">
              <div className="font-medium text-zinc-700 dark:text-zinc-300">
                {pinBuilding.properties.name || "Building at pin"}
              </div>
              <div className="text-zinc-500 dark:text-zinc-400">
                Height: {pinBuilding.properties.height}m ({pinBuilding.properties.levels} floors)
                <span className="ml-1 text-[10px]">
                  ({pinBuilding.properties.heightSource === "measured"
                    ? "measured"
                    : pinBuilding.properties.heightSource === "estimated"
                    ? "est. from levels"
                    : "estimated"})
                </span>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-amber-500" />
              Loading buildings...
            </div>
          )}

          <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Building heights may be estimated. Data from OpenStreetMap.
          </div>
        </>
      )}
    </div>
  );
}
