// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinuteClock, useNow } from "./useNow";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNow", () => {
  it("gives the wall-clock date and minute in the place's zone, not the machine's", () => {
    // 2026-07-01 06:30:20 UTC = 23:30 on 30 June in Los Angeles, 15:30 on 1 July in Tokyo.
    vi.setSystemTime(new Date("2026-07-01T06:30:20Z"));
    expect(renderHook(() => useNow("America/Los_Angeles")).result.current).toEqual({
      date: "2026-06-30",
      minuteOfDay: 23 * 60 + 30,
    });
    expect(renderHook(() => useNow("Asia/Tokyo")).result.current).toEqual({
      date: "2026-07-01",
      minuteOfDay: 15 * 60 + 30,
    });
  });

  it("follows daylight saving time", () => {
    vi.setSystemTime(new Date("2026-01-15T20:00:00Z")); // PST = UTC−8
    expect(renderHook(() => useNow("America/Los_Angeles")).result.current?.minuteOfDay).toBe(720);
    vi.setSystemTime(new Date("2026-07-15T20:00:00Z")); // PDT = UTC−7
    expect(renderHook(() => useNow("America/Los_Angeles")).result.current?.minuteOfDay).toBe(780);
  });

  it("ticks on the minute, and only then", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:40Z"));
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useNow("Etc/GMT");
    });
    expect(result.current).toEqual({ date: "2026-07-01", minuteOfDay: 720 });
    const rendersAtStart = renders;

    act(() => {
      vi.advanceTimersByTime(15_000); // 12:00:55
    });
    expect(result.current?.minuteOfDay).toBe(720);
    expect(renders).toBe(rendersAtStart);

    act(() => {
      vi.advanceTimersByTime(6_000); // 12:01:01
    });
    expect(result.current?.minuteOfDay).toBe(721);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current?.minuteOfDay).toBe(723);
  });

  it("rolls over to the next day at midnight in the zone", () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:30Z"));
    const { result } = renderHook(() => useNow("Etc/GMT"));
    expect(result.current).toEqual({ date: "2026-12-31", minuteOfDay: 1439 });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(result.current).toEqual({ date: "2027-01-01", minuteOfDay: 0 });
  });

  it("keeps the same object while the minute has not changed", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:10Z"));
    const { result, rerender } = renderHook(() => useNow("Etc/GMT"));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("catches up when a hidden tab becomes visible again", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:10Z"));
    const { result } = renderHook(() => useNow("Etc/GMT"));
    // The tab slept: the clock moved on but no timer fired.
    vi.setSystemTime(new Date("2026-07-01T15:30:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current?.minuteOfDay).toBe(15 * 60 + 30);
  });

  it("is null without a zone or for a zone the runtime does not know", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:10Z"));
    expect(renderHook(() => useNow(null)).result.current).toBeNull();
    expect(renderHook(() => useNow("Not/AZone")).result.current).toBeNull();
  });

  it("stops its timer on unmount", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:10Z"));
    const { unmount } = renderHook(() => useNow("Etc/GMT"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders nothing time-dependent on the server (hydration-safe)", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:10Z"));
    function Probe() {
      const clock = useMinuteClock();
      const now = useNow("Etc/GMT");
      return <span>{`${String(clock)}|${String(now)}`}</span>;
    }
    expect(renderToString(<Probe />)).toContain("null|null");
  });
});
