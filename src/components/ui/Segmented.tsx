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
  /** Smaller text and padding, for toolbars. Still 40 px tall. */
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
      className={`inline-flex h-10 rounded-lg border border-line bg-surface-2 p-0.5 ${className}`}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={`relative flex flex-1 cursor-pointer items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent ${
              compact ? "px-2.5" : "px-3.5"
            } ${checked ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
