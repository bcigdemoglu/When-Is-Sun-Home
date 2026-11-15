import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMapUi } from "./mapUi";

beforeEach(() => {
  useMapUi.setState({
    ready: false,
    tilted: false,
    wantsTilt: true,
    bearing: 0,
    command: null,
    commandSeq: 0,
    insets: { top: 0, bottom: 0 },
  });
});

describe("useMapUi", () => {
  it("numbers commands so the same one can be sent twice", () => {
    useMapUi.getState().send({ type: "zoom", delta: 1 });
    useMapUi.getState().send({ type: "zoom", delta: 1 });
    expect(useMapUi.getState().commandSeq).toBe(2);
    expect(useMapUi.getState().command).toEqual({ type: "zoom", delta: 1 });
  });

  it("remembers the 2D / 3D choice separately from what the camera shows", () => {
    useMapUi.getState().send({ type: "tilt", tilted: false });
    expect(useMapUi.getState().wantsTilt).toBe(false);
    // The map reports its own pitch; that never overrides the choice.
    useMapUi.getState().report({ tilted: true });
    expect(useMapUi.getState().wantsTilt).toBe(false);
    expect(useMapUi.getState().tilted).toBe(true);
  });

  it("does not notify when nothing changed", () => {
    const listener = vi.fn();
    const unsubscribe = useMapUi.subscribe(listener);
    useMapUi.getState().setInsets({ top: 0, bottom: 0 });
    useMapUi.getState().report({ bearing: 0, tilted: false });
    expect(listener).not.toHaveBeenCalled();
    useMapUi.getState().setInsets({ top: 76, bottom: 236 });
    useMapUi.getState().report({ bearing: 12 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
