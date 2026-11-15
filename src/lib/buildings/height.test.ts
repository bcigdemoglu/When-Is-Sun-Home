import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_HEIGHT_BY_KIND,
  FALLBACK_HEIGHT_M,
  buildingKind,
  defaultHeightForKind,
  estimateHeight,
  parseLengthMeters,
  parseLevels,
} from "./height";

describe("parseLengthMeters", () => {
  test.each([
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    [" 12 ", 12],
    ["12m", 12],
    ["12 m", 12],
    ["12 M", 12],
    ["7.5 metres", 7.5],
    ["7 meters", 7],
    [".5", 0.5],
    ["1000", 1000],
  ])("metres: %j → %d", (raw, expected) => {
    expect(parseLengthMeters(raw)).toBeCloseTo(expected, 10);
  });

  test.each([
    ["35'", 35 * 0.3048],
    ["40 ft", 40 * 0.3048],
    ["40ft", 40 * 0.3048],
    ["40 feet", 40 * 0.3048],
    ["40 FT", 40 * 0.3048],
    ["1 foot", 0.3048],
    ["12.5 ft", 12.5 * 0.3048],
    ["12'6\"", 12.5 * 0.3048],
    ["12' 6\"", 12.5 * 0.3048],
    ["12'6", 12.5 * 0.3048],
    ["12 ft 6 in", 12.5 * 0.3048],
    ["12'0\"", 12 * 0.3048],
  ])("feet: %j → %d m", (raw, expected) => {
    expect(parseLengthMeters(raw)).toBeCloseTo(expected, 10);
  });

  test.each([
    [undefined],
    [""],
    ["   "],
    ["yes"],
    ["tall"],
    ["-5"],
    ["-5 m"],
    ["0"],
    ["0.0"],
    ["0 ft"],
    ["1001"],
    ["4000 ft"],
    ["12 m high"],
    ["12;15"],
    ["12-15"],
    ["~12"],
    ["1e3"],
    ["NaN"],
    ["Infinity"],
    ["12 km"],
    ["'"],
    ["m"],
  ])("rejects %j", (raw) => {
    expect(parseLengthMeters(raw)).toBeNull();
  });

  test("a value in feet is not read as metres (the old parseFloat bug)", () => {
    expect(parseLengthMeters("35'")).toBeCloseTo(10.668, 3);
    expect(parseLengthMeters("40 ft")).toBeCloseTo(12.192, 3);
  });

  test("never returns a non-positive or absurd height", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const meters = parseLengthMeters(raw);
        return meters === null || (meters > 0 && meters <= 1000);
      }),
    );
  });

  test("round-trips plain metre values", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (centimetres) => {
        const meters = centimetres / 100;
        expect(parseLengthMeters(meters.toFixed(2))).toBeCloseTo(meters, 9);
        expect(parseLengthMeters(`${meters.toFixed(2)} m`)).toBeCloseTo(meters, 9);
        expect(parseLengthMeters(meters.toFixed(2).replace(".", ","))).toBeCloseTo(meters, 9);
      }),
    );
  });
});

describe("parseLevels", () => {
  test.each([
    ["2", 2],
    ["2.5", 2.5],
    ["2,5", 2.5],
    [" 3 ", 3],
    ["200", 200],
  ])("%j → %d", (raw, expected) => {
    expect(parseLevels(raw)).toBe(expected);
  });

  test.each([[undefined], [""], ["0"], ["-1"], ["201"], ["two"], ["2;3"], ["2-3"], ["2 floors"]])(
    "rejects %j",
    (raw) => {
      expect(parseLevels(raw)).toBeNull();
    },
  );
});

describe("estimateHeight", () => {
  test("an explicit height wins and is reported as tagged", () => {
    expect(estimateHeight({ building: "yes", height: "21.3", "building:levels": "2" })).toEqual({
      heightM: 21.3,
      heightSource: "tagged",
      levels: 2,
    });
  });

  test("accepts building:height and est_height, in that order of preference", () => {
    expect(estimateHeight({ building: "yes", "building:height": "40 ft" }).heightM).toBeCloseTo(
      12.192,
      3,
    );
    expect(estimateHeight({ building: "yes", est_height: "9" })).toMatchObject({
      heightM: 9,
      heightSource: "tagged",
    });
    expect(
      estimateHeight({ building: "yes", est_height: "9", "building:height": "11", height: "10" })
        .heightM,
    ).toBe(10);
    expect(
      estimateHeight({ building: "yes", est_height: "9", "building:height": "11" }).heightM,
    ).toBe(11);
  });

  test("an unusable height tag falls through to levels", () => {
    expect(estimateHeight({ building: "office", height: "tall", "building:levels": "4" })).toEqual({
      heightM: 12.5,
      heightSource: "levels",
      levels: 4,
    });
  });

  test("levels: 3 m per storey plus a flat-roof allowance", () => {
    expect(estimateHeight({ building: "apartments", "building:levels": "5" })).toEqual({
      heightM: 15.5,
      heightSource: "levels",
      levels: 5,
    });
    expect(estimateHeight({ building: "yes", "building:levels": "1" }).heightM).toBe(3.5);
  });

  test.each(["house", "detached", "semidetached_house", "terrace", "residential"])(
    "levels: pitched-roof allowance for %s",
    (building) => {
      expect(estimateHeight({ building, "building:levels": "2" })).toEqual({
        heightM: 7.5,
        heightSource: "levels",
        levels: 2,
      });
    },
  );

  test("levels: roof:levels replaces the allowance", () => {
    expect(
      estimateHeight({ building: "house", "building:levels": "2", "roof:levels": "1" }).heightM,
    ).toBe(9);
    expect(
      estimateHeight({ building: "office", "building:levels": "10", "roof:levels": "2" }).heightM,
    ).toBe(36);
    // roof:levels=0 says nothing about the roof's height; keep the allowance.
    expect(
      estimateHeight({ building: "house", "building:levels": "2", "roof:levels": "0" }).heightM,
    ).toBe(7.5);
  });

  test("fractional levels", () => {
    expect(estimateHeight({ building: "yes", "building:levels": "2.5" })).toEqual({
      heightM: 8,
      heightSource: "levels",
      levels: 2.5,
    });
  });

  test("min_height and building:min_level are ignored", () => {
    expect(
      estimateHeight({ building: "yes", height: "20", min_height: "15", "building:min_level": "5" })
        .heightM,
    ).toBe(20);
  });

  test.each([
    ["house", 7],
    ["detached", 7],
    ["semidetached_house", 7],
    ["bungalow", 5],
    ["terrace", 8],
    ["residential", 8],
    ["apartments", 14],
    ["hotel", 15],
    ["garage", 3],
    ["garages", 3],
    ["carport", 3],
    ["shed", 3],
    ["hut", 3],
    ["roof", 3],
    ["greenhouse", 3],
    ["commercial", 10],
    ["retail", 8],
    ["office", 14],
    ["industrial", 9],
    ["warehouse", 9],
    ["school", 10],
    ["hospital", 15],
    ["public", 10],
    ["civic", 10],
    ["church", 12],
    ["cathedral", 20],
    ["yes", 7],
    ["some_unknown_value", 7],
  ])("default for building=%s is %d m", (building, expected) => {
    expect(estimateHeight({ building })).toEqual({
      heightM: expected,
      heightSource: "default",
      levels: null,
    });
  });

  test("the default is never the old 3 m box for ordinary buildings", () => {
    expect(FALLBACK_HEIGHT_M).toBeGreaterThanOrEqual(6);
    expect(estimateHeight({ building: "yes" }).heightM).toBeGreaterThanOrEqual(6);
    expect(estimateHeight({}).heightM).toBe(FALLBACK_HEIGHT_M);
  });

  test("the building value is matched case-insensitively and trimmed", () => {
    expect(estimateHeight({ building: " Apartments " }).heightM).toBe(14);
    expect(buildingKind({ building: " Apartments " })).toBe("apartments");
    expect(buildingKind({})).toBe("yes");
  });

  test("object prototype names are not table entries", () => {
    expect(defaultHeightForKind("constructor")).toBe(FALLBACK_HEIGHT_M);
    expect(defaultHeightForKind("toString")).toBe(FALLBACK_HEIGHT_M);
  });

  test("every table entry is a plausible height", () => {
    for (const [kind, height] of Object.entries(DEFAULT_HEIGHT_BY_KIND)) {
      expect(height, kind).toBeGreaterThanOrEqual(3);
      expect(height, kind).toBeLessThanOrEqual(30);
      expect(kind).toBe(kind.toLowerCase());
    }
  });

  test("always yields a positive, finite height", () => {
    const tagValue = fc.oneof(fc.string(), fc.constantFrom("3", "12 ft", "0", "-4", "house", "x"));
    fc.assert(
      fc.property(
        fc.record(
          {
            building: tagValue,
            height: tagValue,
            "building:height": tagValue,
            est_height: tagValue,
            "building:levels": tagValue,
            "roof:levels": tagValue,
          },
          { requiredKeys: [] },
        ),
        (tags) => {
          const { heightM, heightSource, levels } = estimateHeight(tags);
          expect(Number.isFinite(heightM)).toBe(true);
          expect(heightM).toBeGreaterThan(0);
          expect(heightM).toBeLessThanOrEqual(1000);
          expect(["tagged", "levels", "default"]).toContain(heightSource);
          if (heightSource === "levels") expect(levels).not.toBeNull();
        },
      ),
    );
  });
});
