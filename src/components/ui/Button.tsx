import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * - "primary": the one main action — an ink pill.
 * - "tonal":   everything else that should read as a button (inset fill).
 * - "outline": a quiet button on a surface (hairline).
 * - "ghost":   text only, until hovered.
 */
type Variant = "primary" | "tonal" | "outline" | "ghost";
/**
 * Height in px: 44 (default), 56 (the start screen's two big actions), 36
 * (dense rows), 32 (an icon tucked into a title row — give it a 44 px hit
 * area of its own, e.g. `relative before:absolute before:-inset-1.5`).
 */
type Size = "md" | "lg" | "sm" | "xs";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: Variant;
  size?: Size;
  /** Round button for a lone icon. Give it an `aria-label`. */
  iconOnly?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-surface border-transparent hover:opacity-90 active:opacity-80",
  tonal: "bg-surface-2 text-ink border-transparent hover:brightness-[0.97] active:brightness-95",
  outline: "bg-surface text-ink border-line hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
};

const SIZES: Record<Size, { box: string; icon: string; pad: string }> = {
  xs: { box: "h-8 text-[13px]", icon: "w-8", pad: "px-2.5" },
  sm: { box: "h-9 text-[13px]", icon: "w-9", pad: "px-3" },
  md: { box: "h-11 text-sm", icon: "w-11", pad: "px-4" },
  lg: { box: "h-14 text-base", icon: "w-14", pad: "px-6" },
};

/** Every button in the app: a pill, at least 44 px tall so it is easy to hit on a phone. */
export function Button({
  variant = "tonal",
  size = "md",
  iconOnly = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const s = SIZES[size];
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-medium whitespace-nowrap transition-[background-color,opacity,filter] select-none disabled:cursor-not-allowed disabled:opacity-50 ${s.box} ${
        iconOnly ? s.icon : s.pad
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
