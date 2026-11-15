interface SwitchProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  className?: string;
}

/** An on/off switch on a native checkbox (`role="switch"`). */
export function Switch({ label, checked, onChange, className = "" }: SwitchProps) {
  return (
    <label
      className={`flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-ink select-none ${className}`}
    >
      <span className="relative inline-flex h-6 w-10 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="absolute inset-0 rounded-full border border-line bg-surface-2 transition-colors peer-checked:border-transparent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute left-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  );
}
