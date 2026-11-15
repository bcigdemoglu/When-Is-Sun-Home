// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatAccuracy,
  geolocationMessage,
  geolocationProblem,
  useGeolocation,
} from "./useGeolocation";

type Success = (position: {
  coords: { latitude: number; longitude: number; accuracy: number };
}) => void;
type Failure = (error: { code: number }) => void;

function stubGeolocation(run: (success: Success, failure: Failure) => void) {
  const getCurrentPosition = vi.fn((success: Success, failure: Failure) => run(success, failure));
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
});

describe("messages", () => {
  it("maps browser error codes to problems", () => {
    expect(geolocationProblem(1)).toBe("denied");
    expect(geolocationProblem(2)).toBe("unavailable");
    expect(geolocationProblem(3)).toBe("timeout");
    expect(geolocationProblem(null)).toBe("unsupported");
  });

  it("tells a blocked user where the browser keeps the setting, and always offers a way on", () => {
    expect(geolocationMessage("denied")).toMatch(/site settings/);
    for (const problem of ["denied", "unavailable", "timeout", "unsupported"] as const) {
      expect(geolocationMessage(problem)).toMatch(/address/);
    }
  });

  it("rounds accuracy sensibly", () => {
    expect(formatAccuracy(12.4)).toBe("12 m");
    expect(formatAccuracy(347)).toBe("350 m");
    expect(formatAccuracy(1840)).toBe("1.8 km");
    expect(formatAccuracy(25_000)).toBe("25 km");
  });
});

describe("useGeolocation", () => {
  it("does nothing until asked", () => {
    const getCurrentPosition = stubGeolocation(() => {});
    const { result } = renderHook(() => useGeolocation(() => {}));
    expect(result.current.state).toEqual({ status: "idle" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("reports the spot and returns to idle for a good fix", () => {
    let succeed: Success = () => {};
    stubGeolocation((success) => (succeed = success));
    const onLocated = vi.fn();
    const { result } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    expect(result.current.state).toEqual({ status: "locating" });
    act(() => succeed({ coords: { latitude: 37.79, longitude: -122.43, accuracy: 9 } }));
    expect(onLocated).toHaveBeenCalledWith({ lat: 37.79, lng: -122.43 }, 9);
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("still drops the pin for a rough fix, with a warning that says how rough", () => {
    stubGeolocation((success) => success({ coords: { latitude: 1, longitude: 2, accuracy: 347 } }));
    const onLocated = vi.fn();
    const { result } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    expect(onLocated).toHaveBeenCalledWith({ lat: 1, lng: 2 }, 347);
    expect(result.current.state).toMatchObject({ status: "imprecise", accuracyM: 347 });
    expect((result.current.state as { message: string }).message).toMatch(/350 m.*Drag the pin/);
    act(() => result.current.clear());
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("drops a late answer when something else was chosen in the meantime", () => {
    let succeed: Success = () => {};
    stubGeolocation((success) => (succeed = success));
    const onLocated = vi.fn();
    let place: object | null = null;
    const { result } = renderHook(() => useGeolocation(onLocated, { getContext: () => place }));
    act(() => result.current.locate());
    place = { lat: 1, lng: 2 }; // the person picked a search result while waiting
    act(() => succeed({ coords: { latitude: 37.79, longitude: -122.43, accuracy: 9 } }));
    expect(onLocated).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("delivers the answer when nothing changed while waiting", () => {
    let succeed: Success = () => {};
    stubGeolocation((success) => (succeed = success));
    const onLocated = vi.fn();
    const place = { lat: 1, lng: 2 };
    const { result } = renderHook(() => useGeolocation(onLocated, { getContext: () => place }));
    act(() => result.current.locate());
    act(() => succeed({ coords: { latitude: 37.79, longitude: -122.43, accuracy: 9 } }));
    expect(onLocated).toHaveBeenCalledTimes(1);
  });

  it("only honours the latest of several requests", () => {
    const pending: Success[] = [];
    stubGeolocation((success) => pending.push(success));
    const onLocated = vi.fn();
    const { result } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    act(() => result.current.locate());
    act(() => pending[0]({ coords: { latitude: 1, longitude: 1, accuracy: 5 } }));
    expect(onLocated).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "locating" });
    act(() => pending[1]({ coords: { latitude: 2, longitude: 2, accuracy: 5 } }));
    expect(onLocated).toHaveBeenCalledWith({ lat: 2, lng: 2 }, 5);
  });

  it("ignores answers and errors that arrive after it is gone", () => {
    let succeed: Success = () => {};
    let failLater: Failure = () => {};
    stubGeolocation((success, failure) => {
      succeed = success;
      failLater = failure;
    });
    const onLocated = vi.fn();
    const { result, unmount } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    unmount();
    succeed({ coords: { latitude: 1, longitude: 1, accuracy: 5 } });
    failLater({ code: 3 });
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("forgets a pending request when cleared", () => {
    let succeed: Success = () => {};
    stubGeolocation((success) => (succeed = success));
    const onLocated = vi.fn();
    const { result } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    act(() => result.current.clear());
    act(() => succeed({ coords: { latitude: 1, longitude: 1, accuracy: 5 } }));
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("explains a refusal without calling back", () => {
    stubGeolocation((_success, failure) => failure({ code: 1 }));
    const onLocated = vi.fn();
    const { result } = renderHook(() => useGeolocation(onLocated));
    act(() => result.current.locate());
    expect(onLocated).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ status: "error", problem: "denied" });
  });

  it("copes with a browser that has no geolocation, or one that throws", () => {
    const { result } = renderHook(() => useGeolocation(() => {}));
    act(() => result.current.locate());
    expect(result.current.state).toMatchObject({ status: "error", problem: "unsupported" });

    stubGeolocation(() => {
      throw new Error("blocked by policy");
    });
    act(() => result.current.locate());
    expect(result.current.state).toMatchObject({ status: "error", problem: "unsupported" });
  });
});
