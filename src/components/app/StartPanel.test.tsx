// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "@/state";
import { StartExtras, StartIntro } from "./StartPanel";

vi.mock("@/lib/geocode/photon", () => ({ reverseGeocode: vi.fn(async () => null) }));
vi.mock("@/components/places/SavedPlaces", () => ({
  SavedPlaces: () => <div data-testid="saved-places" />,
}));

function stubGeolocation(
  run: (
    success: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    failure: (e: { code: number }) => void,
  ) => void,
) {
  const getCurrentPosition = vi.fn(run);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

beforeEach(() => {
  useSettings.getState().reset();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
});

describe("StartIntro", () => {
  it("asks the question and offers the two ways in, without touching geolocation", () => {
    const getCurrentPosition = stubGeolocation(() => {});
    render(<StartIntro onEnterAddress={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Where do you want sun?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enter an address" })).toBeEnabled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("hands over to the search for an address", async () => {
    const onEnterAddress = vi.fn();
    render(<StartIntro onEnterAddress={onEnterAddress} />);
    await userEvent.click(screen.getByRole("button", { name: "Enter an address" }));
    expect(onEnterAddress).toHaveBeenCalledTimes(1);
  });

  it("drops the pin where the device is", async () => {
    stubGeolocation((success) =>
      success({ coords: { latitude: 37.79, longitude: -122.43, accuracy: 8 } }),
    );
    render(<StartIntro onEnterAddress={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(useSettings.getState().place).toEqual({ lat: 37.79, lng: -122.43 });
  });

  it("ignores a fix that arrives after another place was chosen", async () => {
    let succeed: (p: {
      coords: { latitude: number; longitude: number; accuracy: number };
    }) => void = () => {};
    stubGeolocation((success) => (succeed = success));
    render(<StartIntro onEnterAddress={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    // Meanwhile the person taps the map (or picks a search result).
    act(() => useSettings.getState().setPlace({ lat: 48.85, lng: 2.35, name: "Paris" }));
    act(() => succeed({ coords: { latitude: 37.79, longitude: -122.43, accuracy: 8 } }));
    expect(useSettings.getState().place).toEqual({ lat: 48.85, lng: 2.35, name: "Paris" });
  });

  it("shows that it is looking, and cannot be pressed twice", async () => {
    stubGeolocation(() => {});
    render(<StartIntro onEnterAddress={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    const button = screen.getByRole("button", { name: "Finding you…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("explains a refusal next to the way round it", async () => {
    stubGeolocation((_success, failure) => failure({ code: 1 }));
    render(<StartIntro onEnterAddress={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/site settings.*enter an address/i);
    expect(useSettings.getState().place).toBeNull();
    expect(screen.getByRole("button", { name: "Enter an address" })).toBeEnabled();
  });
});

describe("StartExtras", () => {
  it("lists earlier places and offers an example", async () => {
    render(<StartExtras onOpen={() => {}} />);
    expect(screen.getByTestId("saved-places")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See an example" }));
    expect(useSettings.getState().place?.name).toMatch(/^Example/);
  });
});
