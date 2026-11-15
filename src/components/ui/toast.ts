import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  /** Optional single action, e.g. "Undo" or "Rename". */
  action?: { label: string; onAction: () => void };
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

/** How long a toast stays up, ms. */
export const TOAST_DURATION_MS = 3500;

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Show a short confirmation ("Link copied", "Saved as …"). Callable from
 * anywhere; the app shell renders the toasts. Only the latest two are kept.
 */
export function showToast(message: string, action?: Toast["action"]): number {
  const id = nextId++;
  useToasts.setState((state) => ({ toasts: [...state.toasts.slice(-1), { id, message, action }] }));
  if (typeof window !== "undefined") {
    window.setTimeout(() => useToasts.getState().dismiss(id), TOAST_DURATION_MS);
  }
  return id;
}
