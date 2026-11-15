/**
 * Browser facts the report needs, as hooks that are safe during server
 * rendering and never set state synchronously inside an effect.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Size of an element's content box, tracked with a ResizeObserver.
 * Returns a ref callback and the size (`null` until first measured).
 */
export function useElementSize<T extends Element>(): [
  (element: T | null) => void,
  ElementSize | null,
] {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize | null>(null);

  useEffect(() => {
    if (!element) return;
    const update = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((previous) =>
        previous && previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    if (typeof ResizeObserver === "undefined") {
      const frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        update(rect.width, rect.height);
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) update(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size];
}

// The 12 / 24-hour preference is app-wide: one hook, shared with the shell.
export { useHour12 } from "@/components/shared/useHour12";

function subscribeColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  query?.addEventListener("change", onChange);
  // A theme toggle would flip an attribute or class on <html>.
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(onChange);
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  return () => {
    query?.removeEventListener("change", onChange);
    observer?.disconnect();
  };
}

function colorSchemeSnapshot(): string {
  const dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  return `${dark ? "dark" : "light"}|${root.className}|${root.getAttribute("data-theme") ?? ""}`;
}

/**
 * A value that changes whenever the colour scheme might have changed, so
 * canvas code knows to re-read CSS custom properties.
 */
export function useColorSchemeKey(): string {
  return useSyncExternalStore(subscribeColorScheme, colorSchemeSnapshot, () => "light||");
}

function subscribePixelRatio(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Zooming and moving between screens both fire `resize`.
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useDevicePixelRatio(): number {
  return useSyncExternalStore(
    subscribePixelRatio,
    () => window.devicePixelRatio || 1,
    () => 1,
  );
}
