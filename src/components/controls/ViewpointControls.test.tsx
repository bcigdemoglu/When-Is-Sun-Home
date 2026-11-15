// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_OBSERVER, floorToHeightM, useSettings } from "@/state";
import { ViewpointControls } from "./ViewpointControls";

beforeEach(() => {
  useSettings.getState().reset();
});

afterEach(() => {
  cleanup();
});

function setup(props: Partial<Parameters<typeof ViewpointControls>[0]> = {}) {
  const user = userEvent.setup();
  render(<ViewpointControls pinOnBuilding={false} pinBuildingHeightM={null} {...props} />);
  return { user };
}

const observer = () => useSettings.getState().observer;

describe("ViewpointControls", () => {
  it("starts in yard mode with the height slider and its explanation", () => {
    setup();
    expect(screen.getByRole("radio", { name: "Yard / open air" })).toBeChecked();
    expect(screen.getByText(/Open view in every direction/)).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Height above ground" });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "30");
    expect(slider).toHaveAttribute("step", "0.5");
    expect(slider).toHaveValue(String(DEFAULT_OBSERVER.heightM));
    expect(slider).toHaveAttribute("aria-valuetext", "1 m above ground");
    expect(screen.queryByRole("group", { name: "Facing direction" })).not.toBeInTheDocument();
  });

  it("writes slider changes to the store", () => {
    setup();
    fireEvent.change(screen.getByRole("slider", { name: "Height above ground" }), {
      target: { value: "12.5" },
    });
    expect(observer().heightM).toBe(12.5);
    expect(screen.getByRole("slider", { name: "Height above ground" })).toHaveAttribute(
      "aria-valuetext",
      "12.5 m above ground",
    );
  });

  it("applies named height presets and marks the active one", async () => {
    const { user } = setup();
    expect(screen.getByRole("button", { name: "Ground: 1 m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Deck: 3 m" }));
    expect(observer().heightM).toBe(3);
    expect(screen.getByRole("button", { name: "Deck: 3 m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: /^Roof/ }));
    expect(observer().heightM).toBe(9);
  });

  it("puts the Roof preset on top of the building under the pin", async () => {
    const { user } = setup({ pinOnBuilding: true, pinBuildingHeightM: 12.2 });
    await user.click(screen.getByRole("button", { name: /^Roof/ }));
    expect(observer().heightM).toBe(13.5);
  });

  it("warns when the pin is on a building, in yard mode only", async () => {
    const { user } = setup({ pinOnBuilding: true, pinBuildingHeightM: 8 });
    expect(screen.getByRole("alert")).toHaveTextContent(/pin is on top of a building footprint/);
    await user.click(screen.getByRole("radio", { name: "Window" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not warn when the pin is in the open", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switches to window mode with floor, facing and field-of-view controls", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    expect(observer().mode).toBe("window");
    expect(screen.queryByRole("slider", { name: "Height above ground" })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Facing, in degrees" })).toHaveAttribute(
      "max",
      "359",
    );
    const fov = screen.getByRole("slider", { name: "Field of view, in degrees" });
    expect(fov).toHaveAttribute("min", "10");
    expect(fov).toHaveAttribute("max", "360");
  });

  it("steps floors by name and stops at the ground floor", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    const down = screen.getByRole("button", { name: "One floor down" });
    const up = screen.getByRole("button", { name: "One floor up" });
    expect(down).toBeDisabled();
    expect(screen.getByText("Ground floor")).toBeInTheDocument();

    await user.click(up);
    expect(observer().heightM).toBe(floorToHeightM(2));
    expect(screen.getByText("2nd floor")).toBeInTheDocument();
    await user.click(up);
    expect(observer().heightM).toBe(floorToHeightM(3));
    expect(screen.getByText("3rd floor")).toBeInTheDocument();
    expect(screen.getByText(/Eye level 7.5 m above ground/)).toBeInTheDocument();
    expect(down).toBeEnabled();
    await user.click(down);
    expect(observer().heightM).toBe(floorToHeightM(2));
  });

  it("points the window with the compass and fine-tunes with the slider", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    const compass = screen.getByRole("group", { name: "Facing direction" });
    expect(within(compass).getAllByRole("button")).toHaveLength(8);
    expect(within(compass).getByRole("button", { name: "Face south" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(compass).getByRole("button", { name: "Face north-west" }));
    expect(observer().facingDeg).toBe(315);
    expect(within(compass).getByRole("button", { name: "Face north-west" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const facing = screen.getByRole("slider", { name: "Facing, in degrees" });
    fireEvent.change(facing, { target: { value: "92" } });
    expect(observer().facingDeg).toBe(92);
    expect(facing).toHaveAttribute("aria-valuetext", "92 degrees, east");
    // Off a preset: no compass button claims it.
    expect(
      within(compass)
        .getAllByRole("button")
        .every((button) => button.getAttribute("aria-pressed") === "false"),
    ).toBe(true);
  });

  it("says in words which part of the sky counts", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    expect(screen.getByText(/between the east and the west/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Narrow" }));
    expect(screen.getByText(/between the south-east and the south-west/)).toBeInTheDocument();
  });

  it("sets the field of view with presets or the slider", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    expect(screen.getByRole("radio", { name: "Normal" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Wide" }));
    expect(observer().fovDeg).toBe(270);
    await user.click(screen.getByRole("radio", { name: "Narrow" }));
    expect(observer().fovDeg).toBe(90);

    const fov = screen.getByRole("slider", { name: "Field of view, in degrees" });
    fireEvent.change(fov, { target: { value: "140" } });
    expect(observer().fovDeg).toBe(140);
    expect(fov).toHaveAttribute("aria-valuetext", "140 degrees");
    expect(screen.getByRole("radio", { name: "Narrow" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Normal" })).not.toBeChecked();
  });

  it("toggles the map layers", async () => {
    const { user } = setup();
    const buildings = screen.getByRole("switch", { name: /3D buildings/ });
    const shadows = screen.getByRole("switch", { name: /Shadows/ });
    expect(buildings).toBeChecked();
    await user.click(buildings);
    expect(useSettings.getState().layers).toEqual({ buildings3d: false, shadows: true });
    await user.click(shadows);
    expect(useSettings.getState().layers).toEqual({ buildings3d: false, shadows: false });
    expect(shadows).not.toBeChecked();
  });

  it("resets the viewpoint, and only offers to when there is something to reset", async () => {
    const { user } = setup();
    const reset = screen.getByRole("button", { name: /Reset viewpoint/ });
    expect(reset).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Window" }));
    await user.click(screen.getByRole("button", { name: "One floor up" }));
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(observer()).toEqual(DEFAULT_OBSERVER);
    expect(reset).toBeDisabled();
  });

  it("keeps a height above the slider's range reachable", () => {
    useSettings.getState().setObserver({ heightM: 47 });
    setup();
    const slider = screen.getByRole("slider", { name: "Height above ground" });
    expect(slider).toHaveAttribute("max", "50");
    expect(slider).toHaveValue("47");
  });
});
