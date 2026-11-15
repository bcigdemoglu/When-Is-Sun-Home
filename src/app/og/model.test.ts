import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { PlaceSummary } from "@/lib/types";
import { DEFAULT_SETTINGS, type Settings } from "@/state/schema";
import { buildShareUrl } from "@/state/urlCodec";
import {
  ogCardFromParams,
  ogImagePath,
  placeLabel,
  renderableText,
  shareMetadataFromParams,
  toUrlSearchParams,
} from "./model";

const NOW = new Date(2026, 5, 15, 12);
const S = "1.1t1i401u9.00011p3a3j3h3i3f2e0d0000.2p2z3a3n3x423z3q3f322s2m";
const SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 6.5,
  sunFraction: 0.54,
  totalSunHours: 2385,
  monthlySunHours: [0, 0.1, 6.1, 11.8, 12.7, 12.5, 12.6, 12.3, 8.6, 1.3, 0, 0],
  monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
  bestMonth: 4,
  worstMonth: 0,
};
const PLACE_QUERY = "lat=37.7912&lng=-122.4301&n=2550+Pacific+Ave,+San+Francisco";

const card = (query: string) => ogCardFromParams(new URLSearchParams(query), NOW);
const meta = (query: string) => shareMetadataFromParams(new URLSearchParams(query), NOW);

describe("toUrlSearchParams", () => {
  test("takes the first value of each key and skips what is not a string", () => {
    const params = toUrlSearchParams({ lat: "1", lng: ["2", "3"], n: undefined, s: [] });
    expect(params.toString()).toBe("lat=1&lng=2");
    expect(toUrlSearchParams(undefined).toString()).toBe("");
    expect(toUrlSearchParams(null).toString()).toBe("");
  });
});

describe("ogCardFromParams", () => {
  test("a full share link: label, viewpoint and the numbers", () => {
    expect(card(`${PLACE_QUERY}&m=w&h=4.5&dir=200&s=${S}`)).toEqual({
      kind: "place",
      label: "2550 Pacific Ave",
      viewpoint: "Window · 2nd floor · facing S",
      summary: SUMMARY,
    });
  });

  test("a place without a (valid) summary: the generic place card", () => {
    const expected = {
      kind: "place",
      label: "2550 Pacific Ave",
      viewpoint: "Backyard · ground level",
      summary: null,
    };
    expect(card(PLACE_QUERY)).toEqual(expected);
    expect(card(`${PLACE_QUERY}&s=garbage`)).toEqual(expected);
    expect(card(`${PLACE_QUERY}&s=${S.toUpperCase()}`)).toEqual(expected);
    expect(card(`${PLACE_QUERY}&s=${S.replace("1t", "5k")}`)).toEqual(expected);
  });

  test("no place: the brand card, whatever else is there", () => {
    expect(card("")).toEqual({ kind: "brand" });
    expect(card(`s=${S}`)).toEqual({ kind: "brand" });
    expect(card("lat=abc&lng=2&n=x")).toEqual({ kind: "brand" });
    expect(card("lat=1")).toEqual({ kind: "brand" });
  });

  test("absurd values are clamped by the codec, not passed on", () => {
    const wild = card("lat=9999&lng=-9999&m=w&h=1e9&dir=99999&fov=-4");
    expect(wild).toEqual({
      kind: "place",
      label: "90.0000° N, 81.0000° E",
      // h=1e9 is not a plain number (ignored); 99999° is 279° — west
      viewpoint: "Window · ground floor · facing W",
      summary: null,
    });
    expect(card("lat=1&lng=2&m=w&h=99999")).toMatchObject({
      viewpoint: "Window · 100th floor · facing S",
    });
  });

  test("an old-format link still gets its place card", () => {
    expect(card("lat=37.7912&lng=-122.4301&n=Home&z=15&t=720&d=172&f=3&dir=90")).toEqual({
      kind: "place",
      label: "Home",
      viewpoint: "Window · 3rd floor · facing E",
      summary: null,
    });
  });

  test("never throws; a card is always something the renderer can draw", () => {
    const key = fc.constantFrom("lat", "lng", "n", "d", "t", "m", "h", "dir", "fov", "s", "v", "f");
    const value = fc.oneof(
      fc.string(),
      fc.string({ unit: "binary", maxLength: 300 }),
      fc.double().map(String),
      fc.constantFrom("37.79", "-122.43", "w", S, "2026-06-21", "🏠 東京", "x".repeat(500)),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(key, value), { maxLength: 12 }), (pairs) => {
        const result = ogCardFromParams(new URLSearchParams(pairs), NOW);
        if (result.kind === "brand") return;
        expect(result.label.length).toBeGreaterThan(0);
        expect(Array.from(result.label).length).toBeLessThanOrEqual(30);
        expect(renderableText(result.label)).toBe(result.label);
        expect(renderableText(result.viewpoint)).toBe(result.viewpoint);
        if (result.summary) expect(result.summary.monthlySunHours).toHaveLength(12);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("placeLabel / renderableText", () => {
  test("the first component of the name, truncated", () => {
    expect(placeLabel({ lat: 1, lng: 2, name: "Elm St backyard, San Francisco" })).toBe(
      "Elm St backyard",
    );
    const long = placeLabel({ lat: 1, lng: 2, name: "A very long saved name for this backyard" });
    expect(long).toBe("A very long saved name for th…");
    expect(Array.from(long)).toHaveLength(30);
  });

  test("no name: the coordinates", () => {
    expect(placeLabel({ lat: 37.7912, lng: -122.4301 })).toBe("37.7912° N, 122.4301° W");
    expect(placeLabel({ lat: -33.87, lng: 151.21, name: ", Sydney" })).toBe(
      "33.8700° S, 151.2100° E",
    );
  });

  test("keeps what the bundled font can draw (accents, Cyrillic, Vietnamese)", () => {
    for (const name of [
      "Kadıköy Çay Bahçesi",
      "Champs-Élysées",
      "Тверская 7",
      "Phố Huế",
      "O’Farrell St",
    ]) {
      expect(placeLabel({ lat: 1, lng: 2, name })).toBe(name);
    }
  });

  test("drops what it cannot draw, so no fallback font is ever fetched", () => {
    expect(renderableText("🏠 home")).toBe("home");
    expect(renderableText("Café")).toBe("Café"); // composed first
    expect(renderableText("東京都千代田区")).toBe("");
    expect(placeLabel({ lat: 1, lng: 2, name: "🏠 Home" })).toBe("Home");
    // mostly undrawable: the coordinates say more than the leftovers
    expect(placeLabel({ lat: 35.68, lng: 139.76, name: "東京都千代田区 1" })).toBe(
      "35.6800° N, 139.7600° E",
    );
    expect(placeLabel({ lat: 35.68, lng: 139.76, name: "東京" })).toBe("35.6800° N, 139.7600° E");
  });
});

describe("ogImagePath", () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    place: { lat: 37.7912, lng: -122.4301, name: "Home" },
    date: "2026-06-21",
    minuteOfDay: 600,
    observer: { mode: "window", heightM: 4.5, facingDeg: 90, fovDeg: 120 },
    layers: { buildings3d: false, shadows: false },
  };

  test("carries what the card shows — not the date, time or layers", () => {
    expect(ogImagePath(settings, SUMMARY)).toBe(
      `/og?lat=37.79120&lng=-122.43010&n=Home&m=w&h=4.5&dir=90&fov=120&s=${S}&v=1`,
    );
    expect(ogImagePath(settings, null)).toBe(
      "/og?lat=37.79120&lng=-122.43010&n=Home&m=w&h=4.5&dir=90&fov=120&v=1",
    );
  });

  test("the same spot seen on different days shares one image", () => {
    const other = { ...settings, date: "2026-12-21", minuteOfDay: 60 };
    expect(ogImagePath(other, SUMMARY)).toBe(ogImagePath(settings, SUMMARY));
  });

  test("the image route reads back exactly the card the page describes", () => {
    const path = ogImagePath(settings, SUMMARY);
    expect(ogCardFromParams(new URLSearchParams(path.slice(path.indexOf("?"))), NOW)).toEqual({
      kind: "place",
      label: "Home",
      viewpoint: "Window · 2nd floor · facing E",
      summary: SUMMARY,
    });
  });
});

describe("shareMetadataFromParams", () => {
  test("with a summary: the answer in the title and the description", () => {
    expect(meta(`${PLACE_QUERY}&d=2026-06-21&t=0930&s=${S}`)).toEqual({
      title: "2550 Pacific Ave: 6.5 h of direct sun a day · When Is Sun Home?",
      description:
        "6.5 h of direct sun on an average day (12.7 h in May, none in January). 54% of possible daylight. A clear-sky estimate from building and terrain data. Open the link for the full year, hour by hour.",
      imagePath: `/og?lat=37.79120&lng=-122.43010&n=2550+Pacific+Ave%2C+San+Francisco&s=${S}&v=1`,
      imageAlt:
        "2550 Pacific Ave: 6.5 h of direct sun on an average day (12.7 h in May, none in January).",
    });
  });

  test("without a summary: no number, still the place", () => {
    const result = meta(`${PLACE_QUERY}&s=nope`);
    expect(result?.title).toBe(
      "2550 Pacific Ave: when does it get direct sun? · When Is Sun Home?",
    );
    expect(result?.description).toMatch(/^See when this spot gets direct sun/);
    expect(result?.imagePath).not.toContain("&s=");
  });

  test("an unnamed place is 'This spot'", () => {
    expect(meta(`lat=37.7912&lng=-122.4301&s=${S}`)?.title).toBe(
      "This spot: 6.5 h of direct sun a day · When Is Sun Home?",
    );
  });

  test("a spot that never gets sun", () => {
    const none = "1.000000000.000000000000000000000000.2p2z3a3n3x423z3q3f322s2m";
    const result = meta(`${PLACE_QUERY}&m=w&h=4.5&dir=0&s=${none}`);
    expect(result?.title).toBe("2550 Pacific Ave: no direct sun · When Is Sun Home?");
    expect(result?.description).toContain("window · 2nd floor · facing n");
  });

  test("no place: null, so the site's default metadata applies", () => {
    expect(meta("")).toBeNull();
    expect(meta(`s=${S}`)).toBeNull();
    expect(meta("lat=abc&lng=1")).toBeNull();
    expect(meta("fov=90&d=2026-06-21")).toBeNull();
  });

  test("the title keeps non-Latin names (only the image is limited by its font)", () => {
    expect(meta("lat=35.68&lng=139.76&n=東京都千代田区")?.title).toBe(
      "東京都千代田区: when does it get direct sun? · When Is Sun Home?",
    );
  });

  test("a link built by the Share button is described by its own numbers", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      place: { lat: 37.7912, lng: -122.4301, name: "Elm St backyard" },
    };
    const url = new URL(buildShareUrl(settings, "https://sun.example/", { summary: SUMMARY }));
    const result = shareMetadataFromParams(url.searchParams, NOW);
    expect(result?.title).toBe("Elm St backyard: 6.5 h of direct sun a day · When Is Sun Home?");
    expect(result?.imagePath).toBe(ogImagePath(settings, SUMMARY));
  });

  test("never throws", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom("lat", "lng", "n", "s", "m", "h", "d"),
            fc.string({ unit: "binary" }),
          ),
          { maxLength: 8 },
        ),
        (pairs) => {
          const result = shareMetadataFromParams(new URLSearchParams(pairs), NOW);
          if (result) {
            expect(result.title).toContain("When Is Sun Home?");
            expect(result.imagePath.startsWith("/og?")).toBe(true);
            expect(result.title.length).toBeLessThan(140);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
