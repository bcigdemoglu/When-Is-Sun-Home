import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Square button for a lone icon. Give it an `aria-label`. */
  iconOnly?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border-transparent hover:opacity-90",
  secondary: "bg-surface text-ink border-line hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
};

/** Every button in the app: at least 40 px tall, so it is easy to hit on a phone. */
export function Button({
  variant = "secondary",
  iconOnly = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50 ${
        iconOnly ? "w-10" : "px-3"
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
