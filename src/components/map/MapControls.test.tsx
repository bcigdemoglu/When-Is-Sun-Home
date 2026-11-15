// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapControls } from "./MapControls";
import { useMapUi } from "./mapUi";

beforeEach(() => {
  useMapUi.setState({
    ready: true,
    tilted: true,
    wantsTilt: true,
    bearing: 0,
    command: null,
    commandSeq: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("MapControls", () => {
  it("offers locate and 3D on a phone, and nothing else until the map is rotated", () => {
    render(<MapControls variant="fabs" hasPlace />);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tilted 3D view/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /north up/ })).not.toBeInTheDocument();

    act(() => useMapUi.getState().report({ bearing: 40 }));
    expect(screen.getByRole("button", { name: "Turn the map north up" })).toBeInTheDocument();
  });

  it("sends commands instead of touching the map", async () => {
    render(<MapControls variant="full" hasPlace />);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(useMapUi.getState().command).toEqual({ type: "zoom", delta: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(useMapUi.getState().command).toEqual({ type: "zoom", delta: -1 });
    await userEvent.click(screen.getByRole("button", { name: "Centre the map on the pin" }));
    expect(useMapUi.getState().command).toEqual({ type: "recenter" });
    await userEvent.click(screen.getByRole("button", { name: /Tilted 3D view/ }));
    expect(useMapUi.getState().command).toEqual({ type: "tilt", tilted: false });
    expect(useMapUi.getState().wantsTilt).toBe(false);
    expect(useMapUi.getState().commandSeq).toBe(4);
  });

  it("only zooms on the start screen, which has its own Use my location", () => {
    render(<MapControls variant="full" hasPlace={false} />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use my location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /3D view/ })).not.toBeInTheDocument();
  });

  it("waits for the map before its buttons do anything", () => {
    useMapUi.setState({ ready: false });
    render(<MapControls variant="full" hasPlace />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /3D view/ })).toBeDisabled();
    // Finding yourself does not need the map.
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
  });
});
