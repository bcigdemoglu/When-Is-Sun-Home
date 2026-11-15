// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LINK_COPIED_MESSAGE, useListingPaste } from "@/components/search/listingPaste";
import { useToasts } from "@/components/ui/toast";
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

function stubClipboard(readText: (() => Promise<string>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: readText ? { readText } : undefined,
  });
}

beforeEach(() => {
  useSettings.getState().reset();
  useListingPaste.setState({ armed: null, handoff: null });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
  stubClipboard(undefined);
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

describe("StartIntro — paste a listing link", () => {
  const ZILLOW =
    "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/";

  it("is not offered where the browser cannot read the clipboard", () => {
    render(<StartIntro onEnterAddress={() => {}} />);
    expect(screen.queryByRole("button", { name: "Paste a listing link" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("is the third, quieter action; it never reads the clipboard until it is pressed", () => {
    const readText = vi.fn(async () => ZILLOW);
    stubClipboard(readText);
    render(<StartIntro onEnterAddress={() => {}} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Use my location",
      "Enter an address",
      "Paste a listing link",
    ]);
    expect(readText).not.toHaveBeenCalled();
  });

  it("hands a copied listing link over to the search, armed to open the house", async () => {
    stubClipboard(async () => `Check out this home! ${ZILLOW}`);
    const onEnterAddress = vi.fn();
    render(<StartIntro onEnterAddress={onEnterAddress} />);
    fireEvent.click(screen.getByRole("button", { name: "Paste a listing link" }));
    await waitFor(() =>
      expect(useListingPaste.getState().handoff).toEqual({
        text: `Check out this home! ${ZILLOW}`,
      }),
    );
    expect(useListingPaste.getState().armed).toMatchObject({ go: true });
    expect(useToasts.getState().toasts).toEqual([]);
    // Nothing is pinned here: the search finds the address.
    expect(useSettings.getState().place).toBeNull();
  });

  it("says so when no listing link was copied, and hands nothing over", async () => {
    stubClipboard(async () => "milk, eggs");
    render(<StartIntro onEnterAddress={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Paste a listing link" }));
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((toast) => toast.message)).toEqual([
        NO_LINK_COPIED_MESSAGE,
      ]),
    );
    expect(useListingPaste.getState().handoff).toBeNull();
    // The two big buttons are still the way in.
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
