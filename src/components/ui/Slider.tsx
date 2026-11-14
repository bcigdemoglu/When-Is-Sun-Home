import { useId, type CSSProperties, type PointerEvent, type ReactNode } from "react";

interface SliderProps {
  label: string;
  /** Hide the label visually (it still names the slider for assistive tech). */
  hideLabel?: boolean;
  /** Shown to the right of the label, e.g. "3:42 PM". */
  readout?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** What a screen reader announces for the value, e.g. "3:42 PM". */
  valueText: string;
  onChange(value: number): void;
  /** The user took hold of the slider (pointer or keyboard). */
  onGrab?(): void;
  /** CSS background for the track (a gradient showing what lies along it). */
  track?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A labelled native range input. It is fully controlled: every `input` event
 * goes straight to `onChange`, so whatever owns the value sees a drag as it
 * happens.
 */
export function Slider({
  label,
  hideLabel = false,
  readout,
  value,
  min,
  max,
  step = 1,
  valueText,
  onChange,
  onGrab,
  track,
  disabled = false,
  className = "",
}: SliderProps) {
  const id = useId();
  const style = track ? ({ "--range-track": track } as CSSProperties) : undefined;
  const onPointerDown = onGrab ? (_event: PointerEvent<HTMLInputElement>) => onGrab() : undefined;

  return (
    <div className={className}>
      {(!hideLabel || readout !== undefined) && (
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-medium text-ink"}>
            {label}
          </label>
          {readout !== undefined && (
            <span className="text-sm text-ink-2 tabular-nums">{readout}</span>
          )}
        </div>
      )}
      {hideLabel && readout === undefined && (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      )}
      <input
        id={id}
        type="range"
        className="range"
        style={style}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onKeyDown={onGrab ? () => onGrab() : undefined}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}
