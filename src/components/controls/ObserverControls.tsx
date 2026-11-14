"use client";

import { useId } from "react";
import { compassName, compassPoint } from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MinusIcon, PlusIcon, WarningIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { Slider } from "@/components/ui/Slider";
import { Switch } from "@/components/ui/Switch";
import type { ObserverMode } from "@/lib/types";
import {
  EYE_HEIGHT_M,
  MAX_FLOOR,
  SETTINGS_LIMITS,
  floorToHeightM,
  heightMToFloor,
  selectLayers,
  selectObserver,
  useSettings,
} from "@/state";

const MODES: readonly { value: ObserverMode; label: string }[] = [
  { value: "yard", label: "Yard / open air" },
  { value: "window", label: "Window" },
];

/** Upper end of the yard height slider, metres (the store allows more). */
export const YARD_HEIGHT_MAX_M = 30;
/** "Roof" preset when the pin is not on a building: a typical two-storey roof. */
export const DEFAULT_ROOF_HEIGHT_M = 9;

const FACINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

function formatMeters(heightM: number): string {
  return `${Number.isInteger(heightM) ? heightM : heightM.toFixed(1)} m`;
}

interface ObserverControlsProps {
  /** True when the pin sits inside a building footprint. */
  pinOnBuilding: boolean;
  /** Roof height of that building, metres, when known. */
  pinBuildingHeightM: number | null;
}

/** Who is looking: a spot in the open or a window, plus the map layer toggles. */
export function ObserverControls({ pinOnBuilding, pinBuildingHeightM }: ObserverControlsProps) {
  const observer = useSettings(selectObserver);
  const layers = useSettings(selectLayers);
  const setObserver = useSettings((s) => s.setObserver);
  const setLayer = useSettings((s) => s.setLayer);

  const { mode, heightM, facingDeg, fovDeg } = observer;
  const roofHeightM =
    pinBuildingHeightM !== null
      ? Math.min(SETTINGS_LIMITS.heightM.max, Math.round((pinBuildingHeightM + EYE_HEIGHT_M) * 2) / 2)
      : DEFAULT_ROOF_HEIGHT_M;
  const presets = [
    { label: "Ground", heightM: 1 },
    { label: "Deck", heightM: 3 },
    { label: "Roof", heightM: roofHeightM },
  ];
  const sliderMax = Math.max(YARD_HEIGHT_MAX_M, Math.ceil(heightM / 10) * 10);
  const floor = heightMToFloor(heightM);
  const floorLabelId = useId();

  return (
    <Card title="Viewpoint">
      <Segmented
        label="Viewpoint type"
        options={MODES}
        value={mode}
        onChange={(next) => setObserver({ mode: next })}
        className="w-full"
      />

      {mode === "yard" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink-2">
            Open view in every direction; the house itself and neighbours cast the shade.
          </p>
          <Slider
            label="Height above ground"
            readout={formatMeters(heightM)}
            labelExtra={
              <div className="flex gap-1.5" role="group" aria-label="Height presets">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    aria-pressed={heightM === preset.heightM}
                    aria-label={`${preset.label}: ${formatMeters(preset.heightM)}`}
                    title={formatMeters(preset.heightM)}
                    className={`px-2.5! ${heightM === preset.heightM ? "border-accent! text-accent" : ""}`}
                    onClick={() => setObserver({ heightM: preset.heightM })}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            }
            value={Math.min(heightM, sliderMax)}
            min={0}
            max={sliderMax}
            step={0.5}
            valueText={`${formatMeters(heightM)} above ground`}
            onChange={(value) => setObserver({ heightM: value })}
          />
          {pinOnBuilding && (
            <p
              role="alert"
              className="flex gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink"
            >
              <WarningIcon className="mt-0.5 shrink-0 text-danger" width={18} height={18} />
              <span>
                The pin is on top of a building footprint, so that building is ignored. Drag the pin
                into the yard for a meaningful result.
              </span>
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-2">
            Only the sky the window faces counts. Put the pin on the wall the window is in.
          </p>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-ink" id={floorLabelId}>
                Floor
              </div>
              <div className="text-xs text-ink-2">
                {floor === 1 ? "Ground floor" : `${floor - 1} above ground`} · eye level{" "}
                {formatMeters(heightM)}
              </div>
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-labelledby={floorLabelId}>
              <Button
                iconOnly
                aria-label="One floor down"
                disabled={floor <= 1}
                onClick={() => setObserver({ heightM: floorToHeightM(floor - 1) })}
              >
                <MinusIcon />
              </Button>
              <output
                aria-live="polite"
                aria-label={`Floor ${floor}`}
                className="w-9 text-center text-lg font-semibold text-ink tabular-nums"
              >
                {floor}
              </output>
              <Button
                iconOnly
                aria-label="One floor up"
                disabled={floor >= MAX_FLOOR}
                onClick={() => setObserver({ heightM: floorToHeightM(floor + 1) })}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>

          <div>
            <Slider
              label="Facing"
              readout={`${compassPoint(facingDeg)} · ${facingDeg}°`}
              value={facingDeg}
              min={SETTINGS_LIMITS.facingDeg.min}
              max={SETTINGS_LIMITS.facingDeg.max}
              step={1}
              valueText={`${facingDeg} degrees, ${compassName(facingDeg)}`}
              onChange={(value) => setObserver({ facingDeg: value })}
            />
            <div className="grid grid-cols-8 gap-1" role="group" aria-label="Facing direction">
              {FACINGS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  aria-label={`Face ${compassName(deg)}`}
                  aria-pressed={facingDeg === deg}
                  className={`h-10 rounded-lg border text-xs font-semibold transition-colors ${
                    facingDeg === deg
                      ? "border-accent bg-surface text-accent"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                  onClick={() => setObserver({ facingDeg: deg })}
                >
                  {compassPoint(deg)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Slider
              label="Field of view"
              readout={`${fovDeg}°`}
              value={fovDeg}
              min={SETTINGS_LIMITS.fovDeg.min}
              max={SETTINGS_LIMITS.fovDeg.max}
              step={5}
              valueText={`${fovDeg} degrees`}
              onChange={(value) => setObserver({ fovDeg: value })}
            />
            <p className="text-xs text-ink-2">
              A flat window sees about 180°. Use less for a deep-set window, more for a bay or corner.
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-2">
        <Switch
          label="3D buildings"
          checked={layers.buildings3d}
          onChange={(value) => setLayer("buildings3d", value)}
        />
        <Switch
          label="Shadows"
          checked={layers.shadows}
          onChange={(value) => setLayer("shadows", value)}
        />
      </div>
    </Card>
  );
}
