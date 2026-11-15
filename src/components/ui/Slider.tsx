import { useId, type CSSProperties, type ReactNode } from "react";

interface SliderProps {
  label: string;
  /** Hide the label visually (it still names the slider for assistive tech). */
  hideLabel?: boolean;
  /** Shown to the right of the label, e.g. "3:42 PM". */
  readout?: ReactNode;
  /** Extra controls on the label row (presets, …), between label and readout. */
  labelExtra?: ReactNode;
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
  labelExtra,
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
  const grab = onGrab ? () => onGrab() : undefined;

  return (
    <div className={className}>
      <div
        className={
          hideLabel && readout === undefined && labelExtra === undefined
            ? "sr-only"
            : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        }
      >
        <label
          htmlFor={id}
          className={hideLabel ? "sr-only" : "text-[15px] leading-[22px] font-medium text-ink"}
        >
          {label}
        </label>
        {labelExtra}
        {readout !== undefined && (
          <span className="ml-auto text-[15px] leading-[22px] text-ink-2 tabular-nums">{readout}</span>
        )}
      </div>
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
        onPointerDown={grab}
        onKeyDown={grab}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}
