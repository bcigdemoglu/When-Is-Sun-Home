// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledValue } from "./useThrottledValue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(initial: number, intervalMs = 50) {
  return renderHook(({ value }) => useThrottledValue(value, intervalMs), {
    initialProps: { value: initial },
  });
}

describe("useThrottledValue", () => {
  it("starts with the value it is given", () => {
    expect(setup(1).result.current).toBe(1);
  });

  it("delivers a change after a quiet spell on the next task", () => {
    const { result, rerender } = setup(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ value: 2 });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(2);
  });

  it("emits during a stream of changes, at most once per interval", () => {
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ value }) => {
        const throttled = useThrottledValue(value, 50);
        if (seen[seen.length - 1] !== throttled) seen.push(throttled);
        return throttled;
      },
      { initialProps: { value: 0 } },
    );
    // 60 changes, 5 ms apart: 300 ms in all.
    for (let value = 1; value <= 60; value++) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(5);
      });
    }
    // Not every value got through …
    expect(seen.length).toBeLessThanOrEqual(9);
    // … but it kept moving during the stream (a debounce would have shown nothing yet) …
    expect(seen.length).toBeGreaterThanOrEqual(5);
    // … and the last value always arrives.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(60);
  });

  it("delivers the latest value, not the one that armed the timer", () => {
    const { result, rerender } = setup(0, 100);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ value: 1 });
    act(() => {
      vi.advanceTimersByTime(0); // 1 goes out; the next emit is 100 ms away
    });
    rerender({ value: 2 });
    rerender({ value: 3 });
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(3);
  });

  it("clears its timer on unmount", () => {
    const { rerender, unmount } = setup(0, 100);
    rerender({ value: 1 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
