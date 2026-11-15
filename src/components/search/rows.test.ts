import { describe, expect, it } from "vitest";
import type { PlaceSuggestion } from "@/lib/geocode/photon";
import type { PlaceEntry } from "@/state/places";
import {
  buildSections,
  coordinatesSuggestion,
  entryMatches,
  firstMatch,
  flattenRows,
  highlightParts,
  resultCountLabel,
} from "./rows";

function entry(lat: number, name: string, label: string, saved: boolean): PlaceEntry {
  return {
    id: `${lat.toFixed(5)},1.00000`,
    place: { lat, lng: 1, name },
    observer: { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
    label,
    summary: null,
    savedAt: saved ? 1 : null,
    visitedAt: 1,
  };
}

const SAVED = [
  entry(10, "12 Elm St, Springfield", "Elm St backyard", true),
  entry(11, "7 Oak Ave, Springfield", "7 Oak Ave", true),
];
const RECENT = [entry(12, "Pacific Heights, San Francisco", "Pacific Heights", false)];
const SUGGESTIONS: PlaceSuggestion[] = [
  { id: "W1", lat: 20, lng: 1, name: "A", label: "2550 Pacific Avenue", detail: "San Francisco" },
  // The same spot as the recent above.
  { id: "W2", lat: 12, lng: 1, name: "B", label: "Pacific Heights", detail: "San Francisco" },
  { id: "W1", lat: 20, lng: 1, name: "A", label: "2550 Pacific Avenue", detail: "Duplicate" },
];

const kinds = (query: string, suggestions: PlaceSuggestion[] = []) =>
  flattenRows(buildSections({ query, saved: SAVED, recent: RECENT, suggestions })).map(
    (row) => row.kind,
  );

describe("buildSections", () => {
  it("lists location, map, saved, then recent when nothing is typed", () => {
    const sections = buildSections({ query: "", saved: SAVED, recent: RECENT, suggestions: [] });
    expect(sections.map((section) => section.id)).toEqual(["actions", "saved", "recent"]);
    expect(sections.map((section) => section.title)).toEqual([null, "Saved", "Recent"]);
    expect(kinds("")).toEqual(["location", "map", "saved", "saved", "recent"]);
  });

  it("leaves out empty sections", () => {
    const sections = buildSections({ query: "", saved: [], recent: [], suggestions: [] });
    expect(sections.map((section) => section.id)).toEqual(["actions"]);
  });

  it("filters saved and recent places by what was typed, keeping the two actions", () => {
    expect(kinds("elm")).toEqual(["location", "map", "saved"]);
    expect(kinds("SPRING")).toEqual(["location", "map", "saved", "saved"]);
    expect(kinds("pacific")).toEqual(["location", "map", "recent"]);
    expect(kinds("zzz")).toEqual(["location", "map"]);
  });

  it("adds addresses after three characters, below the matching places, without repeats", () => {
    expect(kinds("pa", SUGGESTIONS)).toEqual(["location", "map", "recent"]);
    const sections = buildSections({
      query: "pacific",
      saved: SAVED,
      recent: RECENT,
      suggestions: SUGGESTIONS,
    });
    expect(sections.map((section) => section.id)).toEqual(["actions", "recent", "suggestions"]);
    const addresses = sections[2].rows;
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({ kind: "suggestion", coordinates: false });
  });

  it("turns typed coordinates into a single, clearly labelled row", () => {
    const sections = buildSections({
      query: " 37.79, -122.43 ",
      saved: SAVED,
      recent: RECENT,
      suggestions: SUGGESTIONS,
    });
    const last = sections.at(-1)!;
    expect(last.title).toBe("Coordinates");
    expect(last.rows).toHaveLength(1);
    expect(last.rows[0]).toMatchObject({
      kind: "suggestion",
      coordinates: true,
      suggestion: {
        lat: 37.79,
        lng: -122.43,
        label: "37.7900° N, 122.4300° W",
        detail: "Go to these coordinates",
      },
    });
    expect(coordinatesSuggestion("12 elm st")).toBeNull();
    expect(coordinatesSuggestion("95, 10")).toBeNull();
  });
});

describe("entryMatches", () => {
  it("matches the label or the address, ignoring case", () => {
    expect(entryMatches(SAVED[0], "BACKYARD")).toBe(true);
    expect(entryMatches(SAVED[0], "springfield")).toBe(true);
    expect(entryMatches(SAVED[0], "oak")).toBe(false);
    expect(entryMatches(SAVED[0], "  ")).toBe(true);
  });
});

describe("firstMatch", () => {
  it("is the first place row, never one of the actions, and nothing without a query", () => {
    const build = (query: string) =>
      buildSections({ query, saved: SAVED, recent: RECENT, suggestions: SUGGESTIONS });
    expect(firstMatch(build(""), "")).toBeNull();
    expect(firstMatch(build("oak"), "oak")).toMatchObject({ kind: "saved" });
    expect(firstMatch(build("2550"), "2550")).toMatchObject({ kind: "suggestion" });
    expect(firstMatch(build("qq"), "qq")).toBeNull();
  });
});

describe("highlightParts", () => {
  const marked = (text: string, query: string) =>
    highlightParts(text, query)
      .map((part) => (part.match ? `[${part.text}]` : part.text))
      .join("");

  it("marks every typed word, case-insensitively", () => {
    expect(marked("2550 Pacific Avenue", "2550 pac")).toBe("[2550] [Pac]ific Avenue");
    expect(marked("Pacific Heights", "PACIFIC")).toBe("[Pacific] Heights");
    expect(marked("Elm St", "oak")).toBe("Elm St");
  });

  it("copes with regex characters, empty input and repeated words", () => {
    expect(marked("St. (John's) Road", "(john's)")).toBe("St. [(John's)] Road");
    expect(marked("a.b", ".")).toBe("a[.]b");
    expect(highlightParts("", "x")).toEqual([]);
    expect(highlightParts("Elm", "  ")).toEqual([{ text: "Elm", match: false }]);
    expect(marked("Papa", "pa pa")).toBe("[Pa][pa]");
    expect(marked("Pacific", "pa pacific")).toBe("[Pacific]");
  });

  it("always gives back the whole text", () => {
    for (const query of ["a", "e l m", "st, elm", "12"]) {
      const text = "12 Elm Street, Elmwood";
      expect(
        highlightParts(text, query)
          .map((part) => part.text)
          .join(""),
      ).toBe(text);
    }
  });
});

describe("resultCountLabel", () => {
  it("counts places, not the two actions", () => {
    const build = (query: string) =>
      buildSections({ query, saved: SAVED, recent: RECENT, suggestions: SUGGESTIONS });
    const none = (query: string) =>
      buildSections({ query, saved: SAVED, recent: RECENT, suggestions: [] });
    expect(resultCountLabel(none("elm"))).toBe("1 result");
    expect(resultCountLabel(build("pacific"))).toBe("2 results");
    expect(resultCountLabel(none("zzz"))).toBe("0 results");
  });
});
