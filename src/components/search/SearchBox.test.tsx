// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceSuggestion } from "@/lib/geocode/photon";
import type { UsePlaceSearchResult } from "@/lib/geocode/usePlaceSearch";
import { SearchBox } from "./SearchBox";

const SUGGESTIONS: PlaceSuggestion[] = [
  { id: "W1", lat: 37.79, lng: -122.43, name: "A", label: "2550 Pacific Avenue", detail: "San Francisco, CA" },
  { id: "W2", lat: 37.8, lng: -122.44, name: "B", label: "Pacific Heights", detail: "San Francisco, CA" },
  { id: "W3", lat: 36.6, lng: -121.9, name: "C", label: "Pacific Grove", detail: "" },
];

let searchResult: (query: string) => UsePlaceSearchResult;

vi.mock("@/lib/geocode/usePlaceSearch", () => ({
  usePlaceSearch: (query: string) => searchResult(query),
}));

function result(partial: Partial<UsePlaceSearchResult>): UsePlaceSearchResult {
  return {
    suggestions: [],
    status: "idle",
    error: null,
    isFetching: false,
    isStale: false,
    ...partial,
  };
}

beforeEach(() => {
  searchResult = (query) =>
    query.trim().length < 3
      ? result({})
      : result({ status: "ready", suggestions: SUGGESTIONS });
});

afterEach(() => {
  cleanup();
});

function setup() {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(<SearchBox onSelect={onSelect} />);
  const input = screen.getByRole("combobox", { name: /search/i });
  return { onSelect, user, input };
}

describe("SearchBox", () => {
  it("is a collapsed combobox until there is something to show", async () => {
    const { user, input } = setup();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    await user.type(input, "pa");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists suggestions with label and detail and links them to the input", async () => {
    const { user, input } = setup();
    await user.type(input, "pacific");
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("2550 Pacific Avenue");
    expect(options[0]).toHaveTextContent("San Francisco, CA");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("moves the active option with the arrow keys, wrapping at both ends", async () => {
    const { user, input } = setup();
    await user.type(input, "pacific");
    const options = screen.getAllByRole("option");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2].id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2].id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    // Focus never leaves the text field.
    expect(input).toHaveFocus();
  });

  it("selects the active option with Enter, then clears and closes", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "pacific");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1]);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects the first suggestion on Enter when nothing is highlighted", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "pacific{Enter}");
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0]);
  });

  it("does not select a stale suggestion on Enter", async () => {
    searchResult = () => result({ status: "loading", suggestions: SUGGESTIONS, isStale: true });
    const { user, input, onSelect } = setup();
    await user.type(input, "pacific{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects on click", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "pacific");
    await user.click(screen.getByText("Pacific Grove"));
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[2]);
  });

  it("closes on Escape, keeps the text, and clears it on a second Escape", async () => {
    const { user, input } = setup();
    await user.type(input, "pacific");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("pacific");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("reopens with the arrow keys after Escape", async () => {
    const { user, input } = setup();
    await user.type(input, "pacific");
    await user.keyboard("{Escape}{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows loading, empty and error states", async () => {
    searchResult = () => result({ status: "loading" });
    const { user, input } = setup();
    await user.type(input, "pacific");
    expect(screen.getByRole("status")).toHaveTextContent("Searching");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    cleanup();

    searchResult = () => result({ status: "ready" });
    const second = setup();
    await second.user.type(second.input, "zzzzzz");
    expect(screen.getByRole("status")).toHaveTextContent("No places found");
    cleanup();

    searchResult = () => result({ status: "error", error: new Error("boom") });
    const third = setup();
    await third.user.type(third.input, "pacific");
    expect(screen.getByRole("status")).toHaveTextContent(/isn’t available/);
  });

  it("has a clear button that empties the field and returns focus", async () => {
    const { user, input } = setup();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
    await user.type(input, "pacific");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when focus leaves the widget", async () => {
    const { user, input } = setup();
    await user.type(input, "pacific");
    await user.tab();
    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
