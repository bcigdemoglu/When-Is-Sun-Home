import type { ReactNode } from "react";

interface CardProps {
  /** Small uppercase heading shown above the content. */
  title?: string;
  /** Right-aligned content on the heading row (a value, a control…). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The one container style used for every panel in the app. */
export function Card({ title, aside, className = "", children }: CardProps) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {(title || aside) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title && (
            <h2 className="text-xs font-semibold tracking-wider text-ink-3 uppercase">{title}</h2>
          )}
          {aside && <div className="text-xs text-ink-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
