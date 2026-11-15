import { describe, expect, it } from "vitest";

import type { HorizonProfile, Observer } from "@/lib/types";

import { syntheticHorizon, syntheticYear, YARD, type SyntheticSun } from "./testing";
import {
  buildVerdict,
  classifyVerdict,
  monthRangePhrase,
  verdictFacts,
  type VerdictOptions,
} from "./verdict";

/**
 * The toy sun of `testing.ts` is up 06:00–18:00 and sweeps from due east (90°)
 * at sunrise to due west (270°) at sunset, so a wall over a range of azimuths
 * hides a fixed part of every day: 15° of azimuth = one hour.
 */
const wallWhere = (blocked: (azimuth: number) => boolean, elevation = 85) =>
  syntheticHorizon((azimuth) => (blocked(azimuth) ? elevation : 0));

const NORTH: VerdictOptions = { lat: 40, mode: "yard", hour12: true };

function verdictOf(
  sun: SyntheticSun,
  horizon: HorizonProfile | null,
  observer: Observer = YARD,
  options: Partial<VerdictOptions> = {},
) {
  const { year } = syntheticYear(sun, horizon, observer);
  return buildVerdict(year, { ...NORTH, mode: observer.mode, ...options });
}

describe("monthRangePhrase", () => {
  it("words a set of months", () => {
    expect(monthRangePhrase([])).toBe("");
    expect(monthRangePhrase([5])).toBe("in June");
    expect(monthRangePhrase([5, 6])).toBe("in June and July");
    expect(monthRangePhrase([3, 4, 5, 6, 7, 8])).toBe("from April to September");
    expect(monthRangePhrase([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe("all year");
  });

  it("wraps over New Year", () => {
    expect(monthRangePhrase([10, 11, 0])).toBe("from November to January");
    expect(monthRangePhrase([11, 0])).toBe("in December and January");
  });

  it("names the longest run when the months are not contiguous", () => {
    expect(monthRangePhrase([1, 4, 5, 6, 9])).toBe("from May to July");
  });
});

describe("verdictFacts", () => {
  it("measures shares, the morning share and typical times", () => {
    // Sun 06:00–15:00, then a wall to the west.
    const { year } = syntheticYear(
      {},
      wallWhere((azimuth) => azimuth >= 225),
    );
    const facts = verdictFacts(year);
    expect(facts.avgSunHours).toBeCloseTo(9, 5);
    expect(facts.sunFraction).toBeCloseTo(0.75, 5);
    expect(facts.blockedFraction).toBeCloseTo(0.25, 5);
    expect(facts.outOfViewFraction).toBe(0);
    // 6 of the 9 sunny hours fall before the middle of the day (noon).
    expect(facts.morningShare).toBeCloseTo(6 / 9, 5);
    expect(facts.firstMinute).toBe(360);
    expect(facts.lastMinute).toBe(900);
    expect(facts.months).toHaveLength(12);
    expect(facts.months[0]).toMatchObject({ dawnMinute: 360, duskMinute: 1080 });
  });

  it("is neutral when there is no sun at all", () => {
    const { year } = syntheticYear(
      {},
      wallWhere(() => true),
    );
    const facts = verdictFacts(year);
    expect(facts.avgSunHours).toBe(0);
    expect(facts.morningShare).toBe(0.5);
    expect(facts.firstMinute).toBeNull();
  });
});

describe("classification", () => {
  const summer = (day: number) => day >= 90 && day < 273; // 1 April – 30 September

  const table: [string, SyntheticSun, HorizonProfile | null, string][] = [
    ["nothing in the way", {}, null, "open"],
    ["a wall all round", {}, wallWhere(() => true), "none"],
    ["shade from 15:00 on", {}, wallWhere((az) => az >= 225), "morning"],
    ["shade until 09:00", {}, wallWhere((az) => az < 135), "afternoon"],
    ["shade from 16:30 on", {}, wallWhere((az) => az >= 247.5), "bright"],
    ["sun only 11:30–12:30", {}, wallWhere((az) => az < 172.5 || az >= 187.5), "mostly-shaded"],
    ["sun only 10:00–13:30", {}, wallWhere((az) => az < 150 || az >= 202.5), "part-day"],
    [
      "a 40° skyline, low winter sun",
      { peakDeg: (day) => (summer(day) ? 70 : 20) },
      wallWhere(() => true, 40),
      "seasonal",
    ],
  ];

  it.each(table)("%s → %s", (_name, sun, horizon, kind) => {
    const { year } = syntheticYear(sun, horizon);
    expect(classifyVerdict(verdictFacts(year))).toBe(kind);
  });

  it("checks the patterns in a fixed order", () => {
    // Sun 06:00–07:00 only: a morning spot by share, but too little to be called one.
    const { year } = syntheticYear(
      {},
      wallWhere((az) => az >= 105),
    );
    expect(classifyVerdict(verdictFacts(year))).toBe("mostly-shaded");
  });
});

describe("wording", () => {
  const summer = (day: number) => day >= 90 && day < 273;

  it("open sky", () => {
    expect(verdictOf({}, null).sentences).toEqual([
      "Open sky: direct sun whenever the sun is up, all year.",
      "About 12.0 h a day in every month.",
    ]);
  });

  it("open sky with long summer days", () => {
    const verdict = verdictOf(
      { riseMinute: (d) => (summer(d) ? 300 : 420), setMinute: (d) => (summer(d) ? 1260 : 1020) },
      null,
    );
    expect(verdict.sentences[1]).toBe("16.0 h a day in April, 10.0 h in January.");
  });

  it("no sun at all", () => {
    expect(
      verdictOf(
        {},
        wallWhere(() => true),
      ).text,
    ).toBe("No direct sun at any time of year. Buildings hide the sun whenever it is up.");
    expect(
      verdictOf(
        {},
        wallWhere(() => true),
        YARD,
        { hasTerrain: true },
      ).sentences[1],
    ).toBe("Buildings and hills hide the sun whenever it is up.");
  });

  it("a morning-sun and an afternoon-sun spot, in clock times", () => {
    expect(
      verdictOf(
        {},
        wallWhere((az) => az >= 225),
      ).sentences,
    ).toEqual(["A morning-sun spot: direct sun until about 3 PM most of the year, shade after."]);
    expect(
      verdictOf(
        {},
        wallWhere((az) => az < 135),
      ).sentences,
    ).toEqual([
      "An afternoon-sun spot: direct sun from about 9 AM most of the year, shade before.",
    ]);
  });

  it("follows the locale's clock", () => {
    expect(
      verdictOf(
        {},
        wallWhere((az) => az >= 225),
        YARD,
        { hour12: false },
      ).sentences[0],
    ).toBe("A morning-sun spot: direct sun until about 15:00 most of the year, shade after.");
  });

  it("bright all year", () => {
    expect(
      verdictOf(
        {},
        wallWhere((az) => az >= 247.5),
      ).sentences,
    ).toEqual([
      "Bright all year: at least 10.5 h of direct sun a day, even in January.",
      "From sunrise to about 4:30 PM, all year.",
    ]);
  });

  it("mostly shaded, with the hour it is not", () => {
    expect(
      verdictOf(
        {},
        wallWhere((az) => az < 172.5 || az >= 187.5),
      ).sentences,
    ).toEqual(["Mostly shaded.", "Direct sun only from about 11:30 AM to 12:30 PM."]);
  });

  it("part of the day, and what takes the rest", () => {
    expect(
      verdictOf(
        {},
        wallWhere((az) => az < 150 || az >= 202.5),
      ).sentences,
    ).toEqual([
      "Direct sun from about 10 AM to 1:30 PM, all year.",
      "Buildings take 71% of the daylight.",
    ]);
  });

  it("a sunny season and a dark one, by month name", () => {
    const verdict = verdictOf(
      { peakDeg: (d) => (summer(d) ? 70 : 20) },
      wallWhere(() => true, 40),
    );
    expect(verdict.kind).toBe("seasonal");
    expect(verdict.sentences[0]).toMatch(
      /^Sunny from April to September: up to \d\.\d h a day in April\.$/,
    );
    expect(verdict.sentences[1]).toBe("Almost none from October to March.");
  });

  it("names summer first, whichever hemisphere it is in", () => {
    // Short days in June (08:00–16:00), long ones otherwise; sun between the walls only.
    const sun: SyntheticSun = {
      riseMinute: (day) => (day >= 151 && day < 181 ? 480 : 360),
      setMinute: (day) => (day >= 151 && day < 181 ? 960 : 1080),
    };
    const walls = wallWhere((az) => az < 150 || az >= 202.5);
    expect(verdictOf(sun, walls).sentences[0]).toBe(
      "Direct sun from about 10:30 AM to 1 PM in June, and 10 AM to 1:30 PM in December.",
    );
    expect(verdictOf(sun, walls, YARD, { lat: -35 }).sentences[0]).toBe(
      "Direct sun from about 10 AM to 1:30 PM in December, and 10:30 AM to 1 PM in June.",
    );
  });

  it("says when direct sun comes and goes", () => {
    // Sun 06:00–09:00 and 15:00–18:00, with the middle of the day behind a wall.
    const verdict = verdictOf(
      {},
      wallWhere((az) => az >= 135 && az < 225),
    );
    expect(verdict.kind).toBe("bright");
    expect(verdict.sentences[1]).toBe("On and off between sunrise and sunset, all year.");
  });
});

describe("windows", () => {
  const facing = (facingDeg: number, fovDeg: number): Observer => ({
    mode: "window",
    heightM: 4,
    facingDeg,
    fovDeg,
  });

  it("a window the sun never enters", () => {
    expect(verdictOf({}, null, facing(0, 90)).sentences).toEqual([
      "This window gets no direct sun at any time of year.",
      "The sun never comes into its view.",
    ]);
  });

  it("a window that is always blocked", () => {
    expect(
      verdictOf(
        {},
        wallWhere(() => true),
        facing(180, 180),
      ).sentences,
    ).toEqual([
      "This window gets no direct sun at any time of year.",
      "Buildings hide the sun whenever it is up.",
    ]);
  });

  it("a morning-sun window", () => {
    // Facing east, 90° wide: the sun is in view 06:00–09:00.
    expect(verdictOf({}, null, facing(90, 90)).sentences[0]).toBe(
      "A morning-sun window: direct sun until about 9 AM most of the year, shade after.",
    );
  });

  it("a narrow south window: when, and how much of the day is out of view", () => {
    const verdict = verdictOf({}, null, facing(180, 50));
    expect(verdict.kind).toBe("part-day");
    expect(verdict.sentences).toEqual([
      "This window gets direct sun from about 10:30 AM to 1:30 PM, all year.",
      "For 75% of the daylight the sun is outside its view.",
    ]);
  });

  it("a mostly-dark window", () => {
    expect(verdictOf({}, null, facing(180, 14)).sentences[0]).toBe(
      "This window is mostly out of the sun.",
    );
  });
});

describe("polar edge cases", () => {
  // No sun in December and almost all of January; no night in June and July.
  const polar: SyntheticSun = {
    lat: 70,
    riseMinute: (day) => (day < 30 || day >= 334 ? 720 : day >= 151 && day < 212 ? 0 : 360),
    setMinute: (day) => (day < 30 || day >= 334 ? 720 : day >= 151 && day < 212 ? 1440 : 1080),
  };

  it("says when the sun does not set and when it does not rise", () => {
    const verdict = verdictOf(polar, null, YARD, { lat: 70 });
    expect(verdict.kind).toBe("open");
    expect(verdict.sentences).toEqual([
      "Open sky: direct sun whenever the sun is up, all year.",
      "The sun does not set in June and July, and does not rise in December and January.",
    ]);
  });

  it("describes midnight sun and polar night behind a skyline too", () => {
    // A wall to the west: half of every day is lost, whatever its length.
    const verdict = verdictOf(
      polar,
      wallWhere((az) => az >= 180),
      YARD,
      { lat: 70 },
    );
    expect(verdict.kind).toBe("seasonal");
    expect(verdict.sentences[1]).toBe("Almost none in December and January.");
  });
});
