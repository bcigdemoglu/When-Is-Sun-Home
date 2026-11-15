import { useId } from "react";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** Names the group for assistive tech. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Tighter padding, for toolbars. Same height. */
  compact?: boolean;
  className?: string;
}

/**
 * A segmented control built on native radio buttons, so arrow keys, focus and
 * screen readers work the way people expect from a radio group.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  compact = false,
  className = "",
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex h-11 rounded-lg border border-line bg-surface-2 ${className}`}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          // The label is the touch target (the full 42 px); the pill inside it is the look.
          <label key={option.value} className="group flex flex-1 cursor-pointer p-0.5 select-none">
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
            />
            <span
              className={`flex flex-1 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent ${
                compact ? "px-2.5" : "px-3.5"
              } ${checked ? "bg-surface text-ink shadow-sm" : "text-ink-2 group-hover:text-ink"}`}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
