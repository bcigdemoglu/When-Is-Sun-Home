import { describe, expect, it } from "vitest";
import { parseListingLink, type ListingLink } from "@/lib/geocode/listingLink";
import type { PlaceSuggestion } from "@/lib/geocode/photon";
import type { PlaceEntry } from "@/state/places";
import {
  SUBMIT_MODE_NOTE,
  buildSections,
  coordinatesSuggestion,
  entryMatches,
  firstMatch,
  flattenRows,
  highlightParts,
  listingNotFoundNote,
  noAddressMessage,
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

describe("submit mode", () => {
  const build = (query: string, suggestions: PlaceSuggestion[] = []) =>
    buildSections({ query, saved: SAVED, recent: RECENT, suggestions, awaitingSubmit: true });

  it("offers one “search for …” row, with the explanation, under the matching places", () => {
    const sections = build("  pacific ");
    expect(sections.map((section) => section.id)).toEqual(["actions", "recent", "submit"]);
    const submit = sections.at(-1)!;
    expect(submit).toMatchObject({ title: "Addresses", note: SUBMIT_MODE_NOTE });
    expect(submit.rows).toEqual([{ kind: "submit", key: "submit", query: "pacific" }]);
    expect(SUBMIT_MODE_NOTE).toBe(
      "Live suggestions are unavailable right now. Press Enter to search.",
    );
  });

  it("has nothing to submit below three characters or for coordinates", () => {
    expect(build("pa").some((section) => section.id === "submit")).toBe(false);
    expect(build("").some((section) => section.id === "submit")).toBe(false);
    const coordinates = build("37.79, -122.43");
    expect(coordinates.at(-1)).toMatchObject({ id: "suggestions", title: "Coordinates" });
  });

  it("the search row is not a place: Enter's first match and the result count skip it", () => {
    const sections = build("zzz street");
    expect(firstMatch(sections, "zzz street")).toBeNull();
    expect(resultCountLabel(sections)).toBe("0 results");
    expect(firstMatch(build("oak ave"), "oak ave")).toMatchObject({ kind: "saved" });
  });
});

describe("a listing link in the field", () => {
  const ZILLOW =
    "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/";
  const ADDRESS = "2220 Clay St San Francisco, CA 94115";
  const listing = parseListingLink(ZILLOW) as ListingLink;
  const HOUSE: PlaceSuggestion = {
    id: "W9",
    lat: 37.79143,
    lng: -122.43044,
    name: "2220 Clay Street, San Francisco",
    label: "2220 Clay Street",
    detail: "San Francisco",
  };
  const sectionsFor = (input: Partial<Parameters<typeof buildSections>[0]>) =>
    buildSections({
      query: ZILLOW,
      saved: SAVED,
      recent: RECENT,
      suggestions: [],
      listing,
      ...input,
    });

  it("shows nothing of its own while the address is being looked up", () => {
    expect(sectionsFor({}).map((section) => section.id)).toEqual(["actions"]);
  });

  it("puts the results under a heading that says where they are from, with the address", () => {
    const sections = sectionsFor({ suggestions: [HOUSE], listingSettled: true });
    expect(sections.map((section) => section.id)).toEqual(["actions", "suggestions"]);
    expect(sections[1]).toMatchObject({ title: "From this Zillow link", note: ADDRESS });
    // The results, then the way to change the address as text.
    expect(sections[1].rows).toEqual([
      { kind: "suggestion", key: "suggestion:W9", suggestion: HOUSE, coordinates: false },
      { kind: "edit", key: "edit", address: ADDRESS },
    ]);
  });

  it("lists every result once, including a place that is already saved", () => {
    // Saved places are matched against the field's text — a link matches none,
    // so a result at a saved spot must not be dropped as “already listed”.
    const atSavedSpot: PlaceSuggestion = { ...HOUSE, id: "W10", lat: 10, lng: 1 };
    const rows = sectionsFor({
      suggestions: [atSavedSpot, HOUSE, HOUSE],
      listingSettled: true,
    })[1].rows;
    expect(rows.map((row) => row.key)).toEqual(["suggestion:W10", "suggestion:W9", "edit"]);
  });

  it("says so when nothing was found, with the address shown and one row to edit it", () => {
    const sections = sectionsFor({ listingSettled: true });
    expect(sections[1]).toMatchObject({
      id: "suggestions",
      title: "From this Zillow link",
      note: listingNotFoundNote(ADDRESS),
    });
    expect(sections[1].note).toContain(`“${ADDRESS}”`);
    expect(sections[1].rows).toEqual([{ kind: "edit", key: "edit", address: ADDRESS }]);
    // Not a place: Enter and the result count skip it.
    expect(firstMatch(sections, ZILLOW)).toBeNull();
    expect(resultCountLabel(sections)).toBe("0 results");
  });

  it("has no rows of its own for a link without an address (the list says why instead)", () => {
    const zpidOnly = parseListingLink("https://www.zillow.com/homedetails/15075413_zpid/");
    expect(
      sectionsFor({ listing: zpidOnly, listingSettled: true }).map((section) => section.id),
    ).toEqual(["actions"]);
  });

  it("offers to search for the address — not for the link — while suggestions cannot arrive live", () => {
    const sections = sectionsFor({ awaitingSubmit: true });
    expect(sections[1]).toMatchObject({
      id: "submit",
      title: "From this Zillow link",
      note: SUBMIT_MODE_NOTE,
      rows: [{ kind: "submit", key: "submit", query: ADDRESS }],
    });
  });

  it("words each kind of link without an address its own way, always with the way out", () => {
    const message = (text: string) => {
      const link = parseListingLink(text);
      if (link?.kind !== "no-address") throw new Error(`has an address: ${text}`);
      return noAddressMessage(link);
    };
    expect(message("https://www.zillow.com/homedetails/15075413_zpid/")).toBe(
      "This Zillow link doesn’t include the address. Copy the link from the listing’s Share button, or type the address.",
    );
    expect(message("https://redf.in/WW4UwK")).toMatch(
      /^This Redfin short link doesn’t show the address\. .* or type the address\.$/,
    );
    expect(message("https://www.zillow.com/b/-Ck8zhs")).toMatch(
      /^This Zillow link is for a whole building .* Type the building’s street address instead\.$/,
    );
  });
});

describe("the clipboard row", () => {
  it("comes third, after “Choose on the map”, and only where the clipboard can be read", () => {
    const rows = (canPaste: boolean) =>
      flattenRows(
        buildSections({ query: "", saved: [], recent: [], suggestions: [], canPaste }),
      ).map((row) => row.kind);
    expect(rows(true)).toEqual(["location", "map", "paste"]);
    expect(rows(false)).toEqual(["location", "map"]);
  });
});
