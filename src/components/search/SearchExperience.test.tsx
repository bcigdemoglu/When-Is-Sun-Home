// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "@/components/ui/toast";
import type { PlaceSuggestion } from "@/lib/geocode/photon";
import type { UsePlaceSearchResult } from "@/lib/geocode/usePlaceSearch";
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { usePlaces } from "@/state/places";
import { SearchExperience } from "./SearchExperience";
import type { SearchExperienceProps } from "./types";

const YARD: Observer = { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 };
const WINDOW: Observer = { mode: "window", heightM: 4.5, facingDeg: 90, fovDeg: 120 };
const ELM: Place = { lat: 37.75, lng: -122.43, name: "412 Elm Street, Noe Valley" };
const OAK: Place = { lat: 37.76, lng: -122.44, name: "7 Oak Avenue, Pacific Heights" };
const MARINA: Place = { lat: 37.8, lng: -122.45, name: "Marina Boulevard, San Francisco" };
const PIER: Place = { lat: 37.81, lng: -122.41, name: "Pier 39, San Francisco" };

const SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 6.4,
  sunFraction: 0.52,
  totalSunHours: 2336,
  monthlySunHours: [1.2, 2.5, 4.4, 6.8, 8.6, 9.8, 9.5, 8.1, 6.2, 4.1, 2, 1.2],
  monthlyDaylightHours: [9.8, 10.8, 12, 13.2, 14.3, 14.8, 14.5, 13.6, 12.4, 11.2, 10.1, 9.5],
  bestMonth: 5,
  worstMonth: 0,
};

const SUGGESTIONS: PlaceSuggestion[] = [
  {
    id: "W1",
    lat: 37.79,
    lng: -122.43,
    name: "2550 Pacific Avenue, San Francisco, CA",
    label: "2550 Pacific Avenue",
    detail: "San Francisco, CA",
  },
  {
    id: "W2",
    lat: 36.6,
    lng: -121.9,
    name: "Pacific Grove",
    label: "Pacific Grove",
    detail: "",
  },
];

let searchResult: (query: string) => UsePlaceSearchResult;
const searchSubmit = vi.fn();
const searchRetry = vi.fn();
const searchedFor: string[] = [];

vi.mock("@/lib/geocode/usePlaceSearch", () => ({
  PLACE_SEARCH_MIN_LENGTH: 3,
  usePlaceSearch: (query: string) => {
    searchedFor.push(query);
    return searchResult(query);
  },
}));

function result(partial: Partial<UsePlaceSearchResult>): UsePlaceSearchResult {
  return {
    suggestions: [],
    status: "idle",
    error: null,
    isFetching: false,
    isStale: false,
    mode: "live",
    awaitingSubmit: false,
    submit: searchSubmit,
    retry: searchRetry,
    ...partial,
  };
}

type Success = (position: { coords: Partial<GeolocationCoordinates> }) => void;
type Failure = (error: { code: number }) => void;
let geoCalls: { success: Success; failure: Failure }[] = [];

function mockGeolocation() {
  geoCalls = [];
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success: Success, failure: Failure) => {
        geoCalls.push({ success, failure });
      },
    },
  });
}

/** Two saved places (the first with sun hours) and two recents. */
function seedPlaces() {
  const places = usePlaces.getState();
  places.save(ELM, WINDOW, SUMMARY, "Elm St backyard");
  places.save(OAK, YARD, null);
  places.recordVisit(PIER, YARD, null);
  places.recordVisit(MARINA, YARD, { ...SUMMARY, avgSunHoursPerDay: 9.5 });
}

let queryClient: QueryClient;

function setup(props: Partial<SearchExperienceProps> = {}) {
  const onSelect = vi.fn();
  const onChooseOnMap = vi.fn();
  const onClear = vi.fn();
  const user = userEvent.setup();
  queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <button type="button">Before</button>
      <SearchExperience
        variant="overlay"
        place={null}
        onSelect={onSelect}
        onChooseOnMap={onChooseOnMap}
        onClear={onClear}
        {...props}
      />
      <input aria-label="Another field" />
    </QueryClientProvider>,
  );
  return { onSelect, onChooseOnMap, onClear, user, view };
}

const pill = () => screen.getByRole("button", { name: /^search an address/i });
const field = () => screen.getByRole<HTMLInputElement>("combobox", { name: "Search an address" });
const optionNames = () =>
  screen.getAllByRole("option").map((option) => option.textContent?.replace(/\s+/g, " ").trim());

beforeEach(() => {
  localStorage.clear();
  usePlaces.setState({ saved: [], recent: [] });
  useToasts.setState({ toasts: [] });
  searchedFor.length = 0;
  searchSubmit.mockReset();
  searchRetry.mockReset();
  searchResult = (query) =>
    query.trim().length < 3 ? result({}) : result({ status: "ready", suggestions: SUGGESTIONS });
  mockGeolocation();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchExperience — overlay (phones)", () => {
  it("is an idle pill with the placeholder until tapped", () => {
    setup();
    expect(pill()).toHaveTextContent("Search an address");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear this place" })).not.toBeInTheDocument();
    // Nothing is searched (or even subscribed to) while idle.
    expect(searchedFor).toEqual([]);
  });

  it("shows the place in the pill, with a clear button that forgets it", async () => {
    const { user, onClear } = setup({ place: OAK });
    expect(pill()).toHaveTextContent("7 Oak Avenue, Pacific Heights");
    await user.click(screen.getByRole("button", { name: "Clear this place" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls a saved place by the name the user gave it, and a bare pin by its coordinates", () => {
    seedPlaces();
    const { view } = setup({ place: { lat: ELM.lat, lng: ELM.lng } });
    expect(pill()).toHaveTextContent("Elm St backyard");
    view.unmount();
    setup({ place: { lat: -33.87, lng: 151.21 } });
    expect(pill()).toHaveTextContent("33.8700° S, 151.2100° E");
  });

  it("opens a full-screen modal dialog with the field focused and the page locked", async () => {
    const { user } = setup();
    await user.click(pill());
    const dialog = screen.getByRole("dialog", { name: "Find a place" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toBe(document.body);
    expect(field()).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    const input = field();
    expect(input).toHaveAttribute("enterkeyhint", "search");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocapitalize", "words");
    expect(input).toHaveAttribute("inputmode", "search");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
  });

  it("starts with the current place selected in the field, and the start list under it", async () => {
    seedPlaces();
    const { user } = setup({ place: OAK });
    await user.click(pill());
    const input = field();
    expect(input).toHaveValue("7 Oak Avenue");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    // The prefilled text is not a query: nothing is filtered or searched.
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(searchedFor.every((query) => query === "")).toBe(true);
    // Typing replaces it.
    await user.keyboard("elm");
    expect(input).toHaveValue("elm");
  });

  it("lists location, map, saved, then recent — in that order", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    expect(optionNames()).toEqual([
      "Use my current locationFind the spot you’re standing on",
      "Choose on the mapTap the exact spot — a yard, a balcony, a window",
      "Elm St backyard412 Elm Street, Noe Valley6.4 h",
      "7 Oak AvenuePacific Heights—",
      "Marina BoulevardSan Francisco9.5 h",
      "Pier 39San Francisco—",
    ]);
    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label") ?? "")).toEqual([
      "Find a spot",
      "",
      "",
    ]);
    expect(screen.getByRole("group", { name: "Saved" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Recent" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Elm St backyard, 412 Elm Street, Noe Valley, 6.4 hours of direct sun on an average day",
      }),
    ).toBeInTheDocument();
  });

  it("closes with Escape and with the back arrow, returning focus to the pill", async () => {
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pill()).toHaveFocus();
    expect(document.body.style.overflow).toBe("");

    await user.click(pill());
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pill()).toHaveFocus();
  });

  it("restores whatever overflow the page had before", async () => {
    document.body.style.overflow = "clip";
    const { user } = setup();
    await user.click(pill());
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = "";
  });

  it("keeps Tab inside the dialog", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    const dialog = screen.getByRole("dialog");
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    await user.tab({ shift: true });
    // Wrapped to the last control in the dialog.
    expect(screen.getByRole("button", { name: /remove pier 39/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("shows the clear button only when there is text, and clearing keeps the field focused", async () => {
    const { user } = setup();
    await user.click(pill());
    expect(screen.queryByRole("button", { name: "Clear search text" })).not.toBeInTheDocument();
    await user.keyboard("pacific");
    await user.click(screen.getByRole("button", { name: "Clear search text" }));
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search text" })).not.toBeInTheDocument();
  });

  it("filters saved and recent places as the user types and hides the rest", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("el");
    expect(optionNames()).toEqual([
      "Use my current locationFind the spot you’re standing on",
      "Choose on the mapTap the exact spot — a yard, a balcony, a window",
      "Elm St backyard412 Elm Street, Noe Valley6.4 h",
    ]);
    expect(screen.getByText("Keep typing to search addresses.")).toBeInTheDocument();
    await user.clear(field());
    await user.keyboard("SAN FRAN");
    expect(optionNames().slice(2, 4)).toEqual([
      "Marina BoulevardSan Francisco9.5 h",
      "Pier 39San Francisco—",
    ]);
  });

  it("puts live suggestions under the matching places, with the typed part in bold", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("pac");
    expect(optionNames()).toEqual([
      "Use my current locationFind the spot you’re standing on",
      "Choose on the mapTap the exact spot — a yard, a balcony, a window",
      "7 Oak AvenuePacific Heights—",
      "2550 Pacific AvenueSan Francisco, CA",
      "Pacific Grove",
    ]);
    expect(screen.getByRole("group", { name: "Addresses" })).toBeInTheDocument();
    const option = screen.getByRole("option", { name: /2550 pacific avenue/i });
    const bold = Array.from(option.querySelectorAll(".font-semibold")).map((el) => el.textContent);
    expect(bold).toEqual(["Pac"]);
    expect(screen.getByRole("status")).toHaveTextContent("3 results");
  });

  it("does not search below three characters", async () => {
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("pa");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(searchedFor.at(-1)).toBe("pa");
  });

  it("moves through every row with the arrow keys, wrapping, and Enter picks the highlighted one", async () => {
    seedPlaces();
    const { user, onSelect } = setup();
    await user.click(pill());
    const input = field();
    expect(input).not.toHaveAttribute("aria-activedescendant");
    const options = screen.getAllByRole("option");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[5].id);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2].id);
    expect(input).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: ELM,
      observer: WINDOW,
      source: "saved",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pill()).toHaveFocus();
  });

  it("Enter with nothing highlighted picks the first match — a saved place before an address", async () => {
    seedPlaces();
    const first = setup();
    await first.user.click(pill());
    await first.user.keyboard("pac{Enter}");
    expect(first.onSelect).toHaveBeenCalledExactlyOnceWith({
      place: OAK,
      observer: YARD,
      source: "saved",
    });
    first.view.unmount();

    const second = setup();
    await second.user.click(pill());
    await second.user.keyboard("2550{Enter}");
    expect(second.onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43, name: "2550 Pacific Avenue, San Francisco, CA" },
      source: "search",
    });
  });

  it("Enter does nothing with an empty field, and never picks an address from an earlier query", async () => {
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("{Enter}");
    searchResult = () => result({ status: "loading", suggestions: SUGGESTIONS, isStale: true });
    await user.keyboard("pacific{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // …but an explicit highlight is a deliberate choice.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("the highlight does not survive a change of query", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(field()).toHaveAttribute("aria-activedescendant");
    await user.keyboard("e");
    expect(field()).not.toHaveAttribute("aria-activedescendant");
  });

  it("tapping a recent place reopens it with its observer", async () => {
    seedPlaces();
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.click(screen.getByRole("option", { name: /marina boulevard/i }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: MARINA,
      observer: YARD,
      source: "recent",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("typed coordinates give one labelled row and select without a name", async () => {
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("37.79, -122.43");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[2]).toHaveTextContent("37.7900° N, 122.4300° W");
    expect(options[2]).toHaveTextContent("Go to these coordinates");
    expect(screen.getByRole("group", { name: "Coordinates" })).toBeInTheDocument();
    // No geocoder request for something that is not an address.
    expect(searchedFor.at(-1)).toBe("");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43 },
      source: "coordinates",
    });
  });

  it("“Choose on the map” closes search and tells the app", async () => {
    const { user, onChooseOnMap, onSelect } = setup();
    await user.click(pill());
    await user.click(screen.getByRole("option", { name: /choose on the map/i }));
    expect(onChooseOnMap).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes one recent with its × or Shift+Delete, and all with Clear", async () => {
    seedPlaces();
    const { user } = setup();
    await user.click(pill());
    await user.click(screen.getByRole("button", { name: "Remove Pier 39 from recent places" }));
    expect(usePlaces.getState().recent.map((entry) => entry.label)).toEqual(["Marina Boulevard"]);
    expect(screen.queryByRole("option", { name: /pier 39/i })).not.toBeInTheDocument();
    expect(field()).toHaveFocus();

    usePlaces.getState().recordVisit(PIER, YARD, null);
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: /marina/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Shift>}{Delete}{/Shift}");
    expect(usePlaces.getState().recent.map((entry) => entry.label)).toEqual(["Pier 39"]);

    await user.click(screen.getByRole("button", { name: "Clear recent places" }));
    expect(usePlaces.getState().recent).toEqual([]);
    expect(screen.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
    expect(usePlaces.getState().saved).toHaveLength(2);
  });

  it("shows skeleton rows while the first results load", async () => {
    searchResult = (query) => (query.length < 3 ? result({}) : result({ status: "loading" }));
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("lombard");
    expect(screen.getByTestId("search-skeleton")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("keeps earlier results (dimmed) instead of skeletons while a new query loads", async () => {
    searchResult = (query) =>
      query.length < 3
        ? result({})
        : result({ status: "loading", suggestions: SUGGESTIONS, isStale: true });
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("pacific");
    expect(screen.queryByTestId("search-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Addresses" })).toHaveClass("opacity-60");
  });

  it("says so inline when nothing matches, and keeps the two ways out", async () => {
    searchResult = (query) => (query.length < 3 ? result({}) : result({ status: "ready" }));
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("qzxv");
    expect(screen.getByText(/check the spelling/i)).toHaveTextContent(
      "No address matches “qzxv”. Check the spelling, or choose the spot on the map.",
    );
    expect(optionNames()).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("No address matches qzxv");
  });

  it("does not claim “no address matches” while a saved place does", async () => {
    seedPlaces();
    searchResult = (query) => (query.length < 3 ? result({}) : result({ status: "ready" }));
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("elm st");
    expect(screen.queryByText(/check the spelling/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 result");
  });

  it("offers “Try again” when the search fails, and keeps saved places usable", async () => {
    seedPlaces();
    searchResult = (query) =>
      query.length < 3 ? result({}) : result({ status: "error", error: new Error("offline") });
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("oak");
    expect(screen.getByText("Couldn’t search — check your connection.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(searchRetry).toHaveBeenCalledTimes(1);
    expect(field()).toHaveFocus();
    await user.click(screen.getByRole("option", { name: /7 oak avenue/i }));
    expect(onSelect).toHaveBeenCalledWith({ place: OAK, observer: YARD, source: "saved" });
  });

  it("treats “loading” while offline as a failed search", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    searchResult = (query) => (query.length < 3 ? result({}) : result({ status: "loading" }));
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("lombard");
    expect(screen.queryByTestId("search-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  describe("use my current location", () => {
    const row = () => screen.getByRole("option", { name: /use my current location/i });

    it("never asks before the row is chosen", async () => {
      const { user } = setup();
      await user.click(pill());
      expect(geoCalls).toHaveLength(0);
      expect(row()).toHaveTextContent("Find the spot you’re standing on");
    });

    it("says “Finding you…”, then selects the spot and closes", async () => {
      const { user, onSelect } = setup();
      await user.click(pill());
      await user.click(row());
      expect(geoCalls).toHaveLength(1);
      expect(row()).toHaveTextContent("Finding you…");
      expect(row()).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Finding you…");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      act(() =>
        geoCalls[0].success({ coords: { latitude: 37.7, longitude: -122.4, accuracy: 12 } }),
      );
      expect(onSelect).toHaveBeenCalledExactlyOnceWith({
        place: { lat: 37.7, lng: -122.4 },
        source: "location",
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(useToasts.getState().toasts).toEqual([]);
    });

    it("works from the keyboard too", async () => {
      const { user } = setup();
      await user.click(pill());
      await user.keyboard("{ArrowDown}{Enter}");
      expect(geoCalls).toHaveLength(1);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("warns when the fix is rough", async () => {
      const { user, onSelect } = setup();
      await user.click(pill());
      await user.click(row());
      act(() => geoCalls[0].success({ coords: { latitude: 1, longitude: 2, accuracy: 350 } }));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(useToasts.getState().toasts[0].message).toMatch(/accurate to about 350 m/);
    });

    it("explains a denied permission in place and keeps search usable", async () => {
      seedPlaces();
      const { user, onSelect } = setup();
      await user.click(pill());
      await user.click(row());
      act(() => geoCalls[0].failure({ code: 1 }));
      expect(row()).toHaveTextContent(
        "Location is off for this site — allow it in your browser’s site settings, then try again",
      );
      expect(screen.getByRole("status")).toHaveTextContent(/location is off for this site/i);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getAllByRole("option")).toHaveLength(6);
    });

    it("offers a retry when the position is unavailable or slow", async () => {
      const { user, onSelect } = setup();
      await user.click(pill());
      await user.click(row());
      act(() => geoCalls[0].failure({ code: 2 }));
      expect(row()).toHaveTextContent("Couldn’t find you just now — tap to try again");
      await user.click(row());
      expect(geoCalls).toHaveLength(2);
      expect(row()).toHaveTextContent("Finding you…");
      act(() => geoCalls[1].failure({ code: 3 }));
      expect(row()).toHaveTextContent("That took too long — tap to try again");
      await user.click(row());
      act(() => geoCalls[2].success({ coords: { latitude: 5, longitude: 6, accuracy: 10 } }));
      expect(onSelect).toHaveBeenCalledWith({ place: { lat: 5, lng: 6 }, source: "location" });
    });

    it("says when the browser cannot share a location at all", async () => {
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
      const { user } = setup();
      await user.click(pill());
      await user.click(row());
      expect(row()).toHaveTextContent(/this browser can’t share its location/i);
    });

    it("ignores a position that arrives after search was closed", async () => {
      const { user, onSelect } = setup();
      await user.click(pill());
      await user.click(row());
      await user.keyboard("{Escape}");
      act(() => geoCalls[0].success({ coords: { latitude: 1, longitude: 2, accuracy: 10 } }));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});

describe("SearchExperience — submit mode (live suggestions unavailable)", () => {
  const NOTE = "Live suggestions are unavailable right now. Press Enter to search.";
  const awaiting = (query: string) =>
    query.trim().length < 3
      ? result({ mode: "submit" })
      : result({ mode: "submit", awaitingSubmit: true });
  const searchRow = () => screen.getByRole("option", { name: /^search for /i });

  it("says so under the field and offers a Search row; the two actions stay", async () => {
    searchResult = awaiting;
    const { user } = setup();
    await user.click(pill());
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    await user.keyboard("lombard st");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(optionNames()).toEqual([
      "Use my current locationFind the spot you’re standing on",
      "Choose on the mapTap the exact spot — a yard, a balcony, a window",
      "Search for “lombard st”Look this address up",
    ]);
    expect(searchRow()).toHaveAccessibleName("Search for lombard st");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Suggestions as you type are unavailable. Press Enter to search.",
    );
    expect(screen.queryByTestId("search-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(searchSubmit).not.toHaveBeenCalled();
  });

  it("is not offered for one or two characters", async () => {
    searchResult = awaiting;
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("lo");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.getByText("Keep typing to search addresses.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(searchSubmit).not.toHaveBeenCalled();
  });

  it("Enter searches for the typed text — once — and search stays open", async () => {
    searchResult = awaiting;
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("lombard st{Enter}");
    expect(searchSubmit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it("Enter searches even when a saved place matches (it says “Press Enter to search”)", async () => {
    seedPlaces();
    searchResult = awaiting;
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("oak avenue{Enter}");
    expect(searchSubmit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    // The saved place is still listed, above the Search row, and can be picked.
    expect(optionNames().slice(2)).toEqual([
      "7 Oak AvenuePacific Heights—",
      "Search for “oak avenue”Look this address up",
    ]);
    await user.click(screen.getByRole("option", { name: /7 oak avenue/i }));
    expect(onSelect).toHaveBeenCalledWith({ place: OAK, observer: YARD, source: "saved" });
  });

  it("tapping the Search row does the same, for phones whose Enter key is easy to miss", async () => {
    searchResult = awaiting;
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("lombard st");
    await user.click(searchRow());
    expect(searchSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it("the Search row is reachable with the arrow keys", async () => {
    searchResult = awaiting;
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("lombard st{ArrowUp}");
    expect(searchRow()).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(searchSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows skeleton rows while the submitted search runs, then its results like any others", async () => {
    searchResult = () => result({ mode: "submit", status: "loading", isFetching: true });
    const first = setup();
    await first.user.click(pill());
    await first.user.keyboard("pacific");
    expect(screen.getByTestId("search-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    first.view.unmount();

    searchResult = (query) =>
      query.length < 3
        ? result({ mode: "submit" })
        : result({ mode: "submit", status: "ready", suggestions: SUGGESTIONS });
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("pacific");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Addresses" })).toBeInTheDocument();
    // With results on screen, Enter picks the first one again.
    await user.keyboard("{Enter}");
    expect(searchSubmit).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43, name: "2550 Pacific Avenue, San Francisco, CA" },
      source: "search",
    });
  });

  it("both services down: the inline error with Try again, and still no dead end", async () => {
    searchResult = (query) =>
      query.length < 3
        ? result({ mode: "submit" })
        : result({ mode: "submit", status: "error", error: new Error("HTTP 503") });
    const { user, onChooseOnMap } = setup();
    await user.click(pill());
    await user.keyboard("pacific");
    expect(screen.getByText("Couldn’t search — check your connection.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(searchRetry).toHaveBeenCalledTimes(1);
    expect(optionNames()).toHaveLength(2);
    await user.click(screen.getByRole("option", { name: /choose on the map/i }));
    expect(onChooseOnMap).toHaveBeenCalledTimes(1);
  });

  it("coordinates need no service in any mode", async () => {
    searchResult = awaiting;
    const { user, onSelect } = setup();
    await user.click(pill());
    await user.keyboard("37.79, -122.43");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43 },
      source: "coordinates",
    });
    expect(searchSubmit).not.toHaveBeenCalled();
  });

  it("works the same in the desktop drop-down", async () => {
    searchResult = awaiting;
    const { user } = setup({ variant: "panel" });
    await user.click(field());
    await user.keyboard("lombard st");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(searchSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(searchRow());
    expect(searchSubmit).toHaveBeenCalledTimes(2);
    expect(field()).toHaveFocus();
  });
});

describe("SearchExperience — attribution", () => {
  it("credits the services and OpenStreetMap under address results, with same-tab links", async () => {
    const { user } = setup();
    await user.click(pill());
    expect(screen.queryByTestId("search-attribution")).not.toBeInTheDocument();
    await user.keyboard("pacific");
    const line = screen.getByTestId("search-attribution");
    expect(line).toHaveTextContent("Search by Photon / Nominatim · © OpenStreetMap contributors");
    const links = within(line).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Photon", "https://photon.komoot.io"],
      ["Nominatim", "https://nominatim.org"],
      ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
    ]);
    for (const link of links) expect(link).not.toHaveAttribute("target");
    // The links are part of the dialog's tab order.
    expect(screen.getByRole("dialog")).toContainElement(line);
  });

  it("is not shown for saved places, coordinates, or an empty result", async () => {
    seedPlaces();
    searchResult = (query) => (query.length < 3 ? result({}) : result({ status: "ready" }));
    const { user } = setup();
    await user.click(pill());
    await user.keyboard("elm st");
    expect(screen.queryByTestId("search-attribution")).not.toBeInTheDocument();
    await user.clear(field());
    await user.keyboard("37.79, -122.43");
    expect(screen.queryByTestId("search-attribution")).not.toBeInTheDocument();
  });
});

describe("SearchExperience — panel (desktop)", () => {
  const panel = (props: Partial<SearchExperienceProps> = {}) =>
    setup({ variant: "panel", ...props });

  it("is a collapsed combobox until focused, then lists the start rows in place", async () => {
    seedPlaces();
    const { user } = panel();
    const input = field();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(input);
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(within(listbox).getAllByRole("option")).toHaveLength(6);
    // Not an overlay: the page behind stays scrollable.
    expect(document.body.style.overflow).toBe("");
  });

  it("drives the listbox from the field with ↑ ↓ Enter", async () => {
    seedPlaces();
    const { user, onSelect } = panel();
    await user.click(field());
    await user.keyboard("pac");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(field()).toHaveAttribute("aria-activedescendant", options[3].id);
    expect(options[3]).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43, name: "2550 Pacific Avenue, San Francisco, CA" },
      source: "search",
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field()).not.toHaveFocus();
  });

  it("highlights the row under the mouse", async () => {
    seedPlaces();
    const { user } = panel();
    await user.click(field());
    const option = screen.getByRole("option", { name: /7 oak avenue/i });
    await user.hover(option);
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", option.id);
  });

  it("Escape closes the list first, then gives back the place's name", async () => {
    const { user } = panel({ place: OAK });
    const input = field();
    expect(input).toHaveValue("7 Oak Avenue, Pacific Heights");
    await user.click(input);
    await user.keyboard("elm");
    expect(input).toHaveValue("elm");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("elm");
    expect(input).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("7 Oak Avenue, Pacific Heights");
    // The arrow keys bring the list back.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("selects the place's name on focus so typing replaces it", async () => {
    const { user } = panel({ place: OAK });
    await user.tab();
    await user.tab();
    const input = field();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await user.keyboard("m");
    expect(input).toHaveValue("m");
  });

  it("closes and forgets the draft when focus leaves", async () => {
    const { user } = panel({ place: OAK });
    await user.click(field());
    await user.keyboard("zz");
    await user.click(screen.getByRole("textbox", { name: "Another field" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field()).toHaveValue("7 Oak Avenue, Pacific Heights");
  });

  it("stays open while focus moves to a control inside the list", async () => {
    seedPlaces();
    const { user } = panel();
    await user.click(field());
    await user.tab();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear recent places" })).toHaveFocus();
  });

  it("the ⓧ forgets the current place and leaves the field ready for the next address", async () => {
    const { user, onClear } = panel({ place: OAK });
    await user.click(screen.getByRole("button", { name: "Clear this place" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
  });

  it("while typing, the ⓧ only clears the text", async () => {
    const { user, onClear } = panel({ place: OAK });
    await user.click(field());
    await user.keyboard("pacific");
    await user.click(screen.getByRole("button", { name: "Clear search text" }));
    expect(onClear).not.toHaveBeenCalled();
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
  });

  it("“/” focuses the field from anywhere on the page", async () => {
    const { user } = panel();
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.keyboard("/");
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue("");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-keyshortcuts", "/");
  });

  it("“/” is left alone while typing in another field or with a modifier", async () => {
    const { user } = panel();
    const other = screen.getByRole("textbox", { name: "Another field" });
    await user.click(other);
    await user.keyboard("a/b");
    expect(other).toHaveValue("a/b");
    expect(other).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.keyboard("{Control>}/{/Control}");
    expect(field()).not.toHaveFocus();
  });

  it("“/” typed into the search field itself is just a character", async () => {
    const { user } = panel();
    await user.click(field());
    await user.keyboard("1/2 main");
    expect(field()).toHaveValue("1/2 main");
  });

  it("“/” does not pull focus out of a modal dialog", async () => {
    const { user, view } = panel();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    const inside = document.createElement("button");
    modal.appendChild(inside);
    view.container.appendChild(modal);
    inside.focus();
    await user.keyboard("/");
    expect(inside).toHaveFocus();
  });

  it("uses the location row like the overlay does, and closes on success", async () => {
    const { user, onSelect } = panel();
    await user.click(field());
    const row = screen.getByRole("option", { name: /use my current location/i });
    await user.click(row);
    expect(row).toHaveTextContent("Finding you…");
    act(() => geoCalls[0].success({ coords: { latitude: 3, longitude: 4, accuracy: 20 } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 3, lng: 4 },
      source: "location",
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("“Choose on the map” and saved places work from the drop-down", async () => {
    seedPlaces();
    const { user, onChooseOnMap, onSelect } = panel();
    await user.click(field());
    await user.click(screen.getByRole("option", { name: /choose on the map/i }));
    expect(onChooseOnMap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(field());
    await user.click(screen.getByRole("option", { name: /elm st backyard/i }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: ELM,
      observer: WINDOW,
      source: "saved",
    });
  });

  it("announces result counts politely only while open", async () => {
    seedPlaces();
    const { user } = panel();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");
    await user.click(field());
    await user.keyboard("pac");
    expect(status).toHaveTextContent("3 results");
  });
});
