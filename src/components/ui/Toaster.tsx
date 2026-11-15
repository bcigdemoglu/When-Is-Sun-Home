"use client";

import { useToasts } from "./toast";

/**
 * Renders the toasts raised with `showToast` (see `toast.ts`). The parent
 * positions it; announcements are polite so they never interrupt.
 */
export function Toaster({ className = "" }: { className?: string }) {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none flex flex-col items-center gap-2 lg:items-start ${className}`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex min-h-11 max-w-[min(26rem,calc(100vw-2rem))] items-center gap-3 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-sm text-surface shadow-float motion-safe:animate-[toast-in_0.2s_ease-out]"
        >
          <span className="min-w-0 py-1">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="h-8 shrink-0 rounded-full px-3 text-sm font-semibold text-accent-fill hover:bg-surface/10"
              onClick={() => {
                toast.action?.onAction();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <span className="w-2.5" />
          )}
        </div>
      ))}
    </div>
  );
}
