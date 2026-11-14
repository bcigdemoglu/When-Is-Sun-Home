/**
 * A storage backend for zustand's `persist` middleware that makes writes
 * cheap enough for slider drags and animations.
 *
 * `persist` calls `setItem` synchronously on EVERY store update. The stock
 * JSON storage answers each call with `JSON.stringify` + `localStorage.setItem`
 * (a synchronous disk-backed write on the main thread). This wrapper only
 * remembers the latest value and writes it once per `intervalMs` at most
 * (trailing edge), so 1000 updates in a burst cost one stringify and one write.
 *
 * Nothing in here throws: storage that is missing (server render), blocked
 * (Safari private mode, sandboxed iframes), full (quota) or corrupt (hand
 * edited, half written) degrades to "nothing stored" / "write skipped".
 *
 * No React, no zustand runtime import; safe to load on the server.
 */
import type { PersistStorage, StorageValue } from "zustand/middleware";

/** The slice of the Web Storage API this module needs. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ThrottledStorageOptions {
  /**
   * Returns the backing storage, or null/undefined when there is none. Called
   * on every access and allowed to throw (reading `window.localStorage` itself
   * throws when storage is blocked).
   */
  getStorage: () => StorageLike | null | undefined;
  /** Minimum time between two writes, ms. Default 500. */
  intervalMs?: number;
}

export interface ThrottledStorage<S> extends PersistStorage<S, void> {
  /** Writes the pending value now, if there is one. */
  flush(): void;
  /** Drops the pending value without writing it. Returns whether there was one. */
  cancel(): boolean;
  hasPending(): boolean;
}

export const DEFAULT_PERSIST_INTERVAL_MS = 500;

export function createThrottledStorage<S>(options: ThrottledStorageOptions): ThrottledStorage<S> {
  const intervalMs = options.intervalMs ?? DEFAULT_PERSIST_INTERVAL_MS;
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const backing = (): StorageLike | null => {
    try {
      return options.getStorage() ?? null;
    } catch {
      return null;
    }
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    const job = pending;
    pending = null;
    if (!job) return;
    try {
      backing()?.setItem(job.name, JSON.stringify(job.value));
    } catch {
      // Quota exceeded / storage blocked: the app keeps working unsaved.
    }
  };

  const cancel = () => {
    clearTimer();
    const had = pending !== null;
    pending = null;
    return had;
  };

  return {
    getItem(name) {
      try {
        const raw = backing()?.getItem(name);
        if (typeof raw !== "string") return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || !("state" in parsed)) return null;
        const { state, version } = parsed as { state: unknown; version?: unknown };
        // `state` is untrusted from here on; the store's `merge` sanitises it.
        return {
          state: state as S,
          ...(typeof version === "number" ? { version } : null),
        };
      } catch {
        return null; // corrupt JSON or blocked storage
      }
    },

    setItem(name, value) {
      // Without a backing store (server render) never start a timer.
      if (!backing()) return;
      pending = { name, value };
      if (timer === null) timer = setTimeout(flush, intervalMs);
    },

    removeItem(name) {
      if (pending?.name === name) cancel();
      try {
        backing()?.removeItem(name);
      } catch {
        // ignore
      }
    },

    flush,
    cancel,
    hasPending: () => pending !== null,
  };
}

/**
 * Calls `flush` when the page is about to go away or to the background
 * (`pagehide`, and `visibilitychange` → hidden — the only signal iOS Safari
 * reliably gives before it discards a tab). Returns a function that removes
 * the listeners.
 */
export function flushWhenPageHides(flush: () => void, win: Window = window): () => void {
  const onPageHide = () => flush();
  const onVisibilityChange = () => {
    if (win.document.visibilityState === "hidden") flush();
  };
  win.addEventListener("pagehide", onPageHide);
  win.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    win.removeEventListener("pagehide", onPageHide);
    win.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
