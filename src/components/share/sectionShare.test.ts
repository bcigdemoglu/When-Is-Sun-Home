import { describe, expect, test } from "vitest";

import { REPORT_SECTIONS } from "@/components/report/sections";
import type { PlaceSummary } from "@/lib/types";
import { shareText } from "@/state";

import { sectionShareText, treesShareText } from "./sectionShare";

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

const section = (slug: string) => REPORT_SECTIONS.find((s) => s.slug === slug)!;

describe("treesShareText", () => {
  test("names the place", () => {
    expect(treesShareText("2124 NE 36th Ave, Portland")).toEqual({
      title: "Trees at 2124 NE 36th Ave, Portland",
      text: "Street trees, backyard canopy and the trees around 2124 NE 36th Ave, Portland:",
    });
  });

  test("tidies the name the way the sun text does", () => {
    expect(treesShareText("  Elm St\n backyard ").title).toBe("Trees at Elm St backyard");
  });

  test("an unnamed pin is 'this spot'", () => {
    const expected = {
      title: "Trees at this spot",
      text: "Street trees, backyard canopy and the trees around this spot:",
    };
    expect(treesShareText("")).toEqual(expected);
    expect(treesShareText("   ")).toEqual(expected);
  });
});

describe("sectionShareText", () => {
  test("Trees has its own words, whatever the sun numbers", () => {
    expect(sectionShareText(section("trees"), "Elm St", SUMMARY)).toEqual(treesShareText("Elm St"));
    expect(sectionShareText(section("trees"), "", null).title).toBe("Trees at this spot");
  });

  test.each(["sun-hours", "today", "year", "skyline", "about"])(
    "%s says what the report says",
    (slug) => {
      expect(sectionShareText(section(slug), "Elm St", SUMMARY)).toEqual(
        shareText("Elm St", SUMMARY),
      );
      expect(sectionShareText(section(slug), "", null)).toEqual(shareText("", null));
    },
  );

  test("no section: the report's own words", () => {
    expect(sectionShareText(null, "Elm St", SUMMARY)).toEqual(shareText("Elm St", SUMMARY));
    expect(sectionShareText(undefined, "", null).title).toBe(
      "This spot: see when this spot gets direct sun",
    );
  });
});
