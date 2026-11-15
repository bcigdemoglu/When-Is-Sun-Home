// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { shallowEqual, useShallowStable } from "./useShallowStable";

afterEach(() => {
  cleanup();
});

describe("shallowEqual", () => {
  it("compares own fields by identity", () => {
    const list = [1];
    expect(shallowEqual({ a: 1, list }, { a: 1, list })).toBe(true);
    expect(shallowEqual({ a: 1, list }, { a: 1, list: [1] })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: NaN }, { a: NaN })).toBe(true);
  });
});

describe("useShallowStable", () => {
  it("keeps the first object while the fields stay the same", () => {
    const data = { rows: [] };
    const { result, rerender } = renderHook(({ status }) => useShallowStable({ status, data }), {
      initialProps: { status: "ready" },
    });
    const first = result.current;
    rerender({ status: "ready" });
    rerender({ status: "ready" });
    expect(result.current).toBe(first);
  });

  it("hands out the new object as soon as a field changes, and then keeps that one", () => {
    const { result, rerender } = renderHook(
      ({ status, source }: { status: string; source?: string }) =>
        useShallowStable(source === undefined ? { status } : { status, source }),
      { initialProps: { status: "loading" } as { status: string; source?: string } },
    );
    const loading = result.current;
    rerender({ status: "ready", source: "tiles" });
    expect(result.current).toEqual({ status: "ready", source: "tiles" });
    expect(result.current).not.toBe(loading);
    const ready = result.current;
    rerender({ status: "ready", source: "tiles" });
    expect(result.current).toBe(ready);
  });
});
