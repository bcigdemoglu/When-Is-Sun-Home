import type { ReactNode } from "react";

interface CardProps {
  /** Heading shown above the content. */
  title?: string;
  /** Right-aligned content on the heading row (a value, a control…). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The one container style used for every panel in the app: a tone-on-tone
 * surface with a hairline — never a shadow (those are for things that float).
 */
export function Card({ title, aside, className = "", children }: CardProps) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 lg:p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="type-card-title text-ink">{title}</h2>}
          {aside && <div className="type-label text-ink-2 tabular-nums">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
