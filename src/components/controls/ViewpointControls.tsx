"use client";

import { compassPoint, compassWords } from "@/components/shared/format";
import { floorName, formatMeters } from "@/components/shared/viewpoint";
import { Button } from "@/components/ui/Button";
import { MinusIcon, PlusIcon, ResetIcon, WarningIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { Slider } from "@/components/ui/Slider";
import { Switch } from "@/components/ui/Switch";
import type { ObserverMode } from "@/lib/types";
import {
  DEFAULT_OBSERVER,
  MAX_FLOOR,
  SETTINGS_LIMITS,
  floorToHeightM,
  heightMToFloor,
  selectLayers,
  selectObserver,
  useSettings,
} from "@/state";
import { FacingPicker } from "./FacingPicker";
import {
  FOV_PRESETS,
  YARD_HEIGHT_MAX_M,
  fovPreset,
  roofHeightM,
  viewConeSentence,
  type FovPreset,
} from "./viewpoint";

const MODES: readonly { value: ObserverMode; label: string }[] = [
  { value: "yard", label: "Yard / open air" },
  { value: "window", label: "Window" },
];

const HINT = "type-footnote mt-1 text-ink-2";
const GROUP = "border-t border-line pt-4";

interface ViewpointControlsProps {
  /** True when the pin sits inside a building footprint. */
  pinOnBuilding: boolean;
  /** Roof height of that building, metres, when known. */
  pinBuildingHeightM: number | null;
}

/**
 * Who is looking: a spot in the open, or a window on some floor facing some
 * way. Every control says in one line what it changes. Also home to the two
 * map layers, which belong to "how do I want to see this".
 */
export function ViewpointControls({ pinOnBuilding, pinBuildingHeightM }: ViewpointControlsProps) {
  const observer = useSettings(selectObserver);
  const layers = useSettings(selectLayers);
  const setObserver = useSettings((s) => s.setObserver);
  const setLayer = useSettings((s) => s.setLayer);

  const { mode, heightM, facingDeg, fovDeg } = observer;
  const presets = [
    { label: "Ground", heightM: 1 },
    { label: "Deck", heightM: 3 },
    { label: "Roof", heightM: roofHeightM(pinBuildingHeightM) },
  ];
  const sliderMax = Math.max(YARD_HEIGHT_MAX_M, Math.ceil(heightM / 10) * 10);
  const floor = heightMToFloor(heightM);
  const isDefault =
    mode === DEFAULT_OBSERVER.mode &&
    heightM === DEFAULT_OBSERVER.heightM &&
    facingDeg === DEFAULT_OBSERVER.facingDeg &&
    fovDeg === DEFAULT_OBSERVER.fovDeg;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="type-card-title mb-2 text-ink">Where are you standing?</h3>
        <Segmented
          label="Viewpoint type"
          options={MODES}
          value={mode}
          onChange={(next) => setObserver({ mode: next })}
          className="w-full"
        />
        <p className={HINT}>
          {mode === "yard"
            ? "Open view in every direction; the house itself and neighbours cast the shade."
            : "Only the sky the window faces counts. Put the pin on the wall the window is in."}
        </p>
      </div>

      {mode === "yard" && pinOnBuilding && (
        <p
          role="alert"
          className="flex gap-2.5 rounded-xl bg-surface-2 p-3 text-[14px] leading-5 text-ink"
        >
          <WarningIcon className="mt-px shrink-0 text-danger" />
          <span>
            The pin is on top of a building footprint, so that building is ignored. Drag the pin
            into the yard for a meaningful result.
          </span>
        </p>
      )}

      {mode === "yard" ? (
        <div className={GROUP}>
          <Slider
            label="Height above ground"
            readout={formatMeters(heightM)}
            value={Math.min(heightM, sliderMax)}
            min={0}
            max={sliderMax}
            step={0.5}
            valueText={`${formatMeters(heightM)} above ground`}
            onChange={(value) => setObserver({ heightM: value })}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Height presets">
            {presets.map((preset) => {
              const selected = heightM === preset.heightM;
              return (
                <Button
                  key={preset.label}
                  variant={selected ? "primary" : "tonal"}
                  aria-pressed={selected}
                  aria-label={`${preset.label}: ${formatMeters(preset.heightM)}`}
                  onClick={() => setObserver({ heightM: preset.heightM })}
                >
                  {preset.label}
                  <span className={`tabular-nums ${selected ? "opacity-70" : "text-ink-2"}`}>
                    {formatMeters(preset.heightM)}
                  </span>
                </Button>
              );
            })}
          </div>
          <p className={`${HINT} mt-2`}>Higher up, the sun clears more of the neighbours’ roofs.</p>
        </div>
      ) : (
        <>
          <div className={GROUP}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] leading-[22px] font-medium text-ink">Floor</h3>
                <p className="type-footnote text-ink-2 tabular-nums">
                  Eye level {formatMeters(heightM)} up
                </p>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="Floor">
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
                  className="min-w-[7.5rem] text-center text-[15px] leading-[22px] font-semibold text-ink tabular-nums"
                >
                  {floorName(floor)}
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
            <p className={HINT}>Higher floors see over more of the buildings opposite.</p>
          </div>

          <div className={GROUP}>
            <div className="flex items-center gap-4">
              <FacingPicker
                facingDeg={facingDeg}
                fovDeg={fovDeg}
                onChange={(deg) => setObserver({ facingDeg: deg })}
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] leading-[22px] font-medium text-ink">Window faces</h3>
                <p className="type-value text-ink">
                  {compassPoint(facingDeg)}{" "}
                  <span className="text-[15px] font-normal text-ink-2">{facingDeg}°</span>
                </p>
                <p className={HINT}>{viewConeSentence(observer)}</p>
              </div>
            </div>
            <Slider
              label="Facing, in degrees"
              hideLabel
              value={facingDeg}
              min={SETTINGS_LIMITS.facingDeg.min}
              max={SETTINGS_LIMITS.facingDeg.max}
              step={1}
              valueText={`${facingDeg} degrees, ${compassWords(facingDeg)}`}
              onChange={(value) => setObserver({ facingDeg: value })}
            />
          </div>

          <div className={GROUP}>
            <h3 className="mb-2 text-[15px] leading-[22px] font-medium text-ink">
              How much sky the window sees
            </h3>
            <Segmented<FovPreset>
              label="Field of view"
              options={FOV_PRESETS}
              value={fovPreset(fovDeg)}
              onChange={(value) => {
                const preset = FOV_PRESETS.find((p) => p.value === value);
                if (preset) setObserver({ fovDeg: preset.fovDeg });
              }}
              className="w-full"
            />
            <Slider
              label="Field of view, in degrees"
              hideLabel
              value={fovDeg}
              min={SETTINGS_LIMITS.fovDeg.min}
              max={SETTINGS_LIMITS.fovDeg.max}
              step={5}
              valueText={`${fovDeg} degrees`}
              onChange={(value) => setObserver({ fovDeg: value })}
            />
            <p className={`${HINT} mt-0`}>
              {fovDeg}°. A flat window sees about 180°; narrow is a deep-set window or a balcony
              with side walls, wide a bay or a corner.
            </p>
          </div>
        </>
      )}

      <div className={GROUP}>
        <h3 className="type-card-title mb-1 text-ink">On the map</h3>
        <Switch
          label="3D buildings"
          hint="Draw buildings at their real height"
          checked={layers.buildings3d}
          onChange={(value) => setLayer("buildings3d", value)}
        />
        <Switch
          label="Shadows"
          hint="Show the shade buildings cast at the selected time"
          checked={layers.shadows}
          onChange={(value) => setLayer("shadows", value)}
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          disabled={isDefault}
          onClick={() => setObserver({ ...DEFAULT_OBSERVER })}
        >
          <ResetIcon />
          Reset viewpoint
        </Button>
      </div>
    </div>
  );
}
