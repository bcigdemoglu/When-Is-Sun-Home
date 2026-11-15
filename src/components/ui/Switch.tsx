interface SwitchProps {
  label: string;
  /** A second, quieter line under the label. */
  hint?: string;
  checked: boolean;
  onChange(checked: boolean): void;
  className?: string;
}

/** An on/off switch on a native checkbox (`role="switch"`): a full-width row, label first. */
export function Switch({ label, hint, checked, onChange, className = "" }: SwitchProps) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 select-none ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-[15px] leading-[22px] text-ink">{label}</span>
        {hint && <span className="type-footnote block text-ink-2">{hint}</span>}
      </span>
      <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="absolute inset-0 rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors peer-checked:bg-ink peer-checked:shadow-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute left-0.5 h-6 w-6 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
