import { describe, expect, it } from "vitest";
import type { StreetTree, StreetTreeGroup } from "@/lib/types";
import {
  diameterClassOf,
  groupsOfTrees,
  plantingSites,
  summarizeStreetTrees,
  tenTwentyThirty,
  wiresCount,
} from "./metrics";

const group = (species: string, count: number, extra: Partial<StreetTreeGroup> = {}) => ({
  species,
  matureSize: "",
  functionalType: "",
  condition: "",
  count,
  diameterClasses: [0, 0, 0, 0] as [number, number, number, number],
  diameterSumIn: 0,
  diameterMaxIn: 0,
  ...extra,
});

const tree = (extra: Partial<StreetTree>): StreetTree => ({
  id: 1,
  lat: 45.5,
  lng: -122.6,
  address: "2124 NE 36TH AVE",
  scientific: "Acer platanoides",
  common: "Norway maple",
  diameterIn: 20,
  condition: "Good",
  matureSize: "Medium",
  functionalType: "Broadleaf deciduous",
  wires: "None",
  siteType: "Strip",
  siteWidthFt: 6,
  neighborhood: "GRANT PARK",
  inventoried: "2024-06-25",
  ...extra,
});

describe("diameterClassOf", () => {
  it("puts trunks into 0–6, 6–12, 12–24 and 24+ inches", () => {
    expect([0.5, 5.9, 6, 11.9, 12, 23.9, 24, 63].map(diameterClassOf)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });
});

describe("tenTwentyThirty", () => {
  it("passes a diverse planting", () => {
    const groups = [
      group("Acer rubrum - red maple", 10),
      group("Quercus rubra - red oak", 10),
      ...[
        "Tilia cordata - littleleaf linden",
        "Ginkgo biloba - ginkgo",
        "Zelkova serrata - zelkova",
      ].flatMap((name) => [group(name, 10)]),
      group("Liriodendron tulipifera - tulip tree", 10),
      group("Cercis canadensis - eastern redbud", 10),
      group("Nyssa sylvatica - black tupelo", 10),
      group("Styrax japonicus - Japanese snowbell", 10),
      group("Carpinus betulus - European hornbeam", 10),
    ];
    const rule = tenTwentyThirty(groups);
    expect(rule.basis).toBe(100);
    expect(rule.species.top?.share).toBeCloseTo(0.1);
    expect(rule.species.pass).toBe(true);
    expect(rule.genus.pass).toBe(true);
    expect(rule.family.pass).toBe(true);
    expect(rule.pass).toBe(true);
  });

  it("fails on too many of one genus or family, and says which", () => {
    const rule = tenTwentyThirty([
      group("Acer platanoides - Norway maple", 9),
      group("Acer rubrum - red maple", 9),
      group("Acer spp. - maple", 9),
      group("Quercus rubra - red oak", 9),
      group("Ginkgo biloba - ginkgo", 64),
    ]);
    // A genus-only name counts for its genus and family, not as a species.
    expect(rule.basis).toBe(100);
    expect(rule.species.top).toMatchObject({ name: "Ginkgo biloba", common: "ginkgo" });
    expect(rule.species.pass).toBe(false);
    expect(rule.genus.top).toMatchObject({ name: "Ginkgo", count: 64 });
    expect(rule.family.top?.name).toBe("Ginkgoaceae");
    expect(rule.pass).toBe(false);
  });

  it("leaves unknown trees out of the shares", () => {
    const rule = tenTwentyThirty([group("Unknown", 50), group("Acer rubrum - red maple", 5)]);
    expect(rule.basis).toBe(5);
    expect(rule.genus.top?.share).toBe(1);
  });

  it("says nothing without identified trees", () => {
    const rule = tenTwentyThirty([group("Unknown", 3)]);
    expect(rule.species.top).toBeNull();
    expect(rule.pass).toBe(false);
  });
});

describe("summarizeStreetTrees", () => {
  it("summarises a list of trees", () => {
    const trees = [
      tree({ id: 1, diameterIn: 27.7, condition: "Good", wires: "High voltage" }),
      tree({ id: 2, diameterIn: 30.3, condition: "Fair", wires: "Other" }),
      tree({
        id: 3,
        scientific: "Pseudotsuga menziesii",
        common: "Douglas-fir",
        diameterIn: 4,
        condition: "Poor",
        matureSize: "Large",
        functionalType: "Coniferous evergreen",
        siteType: "Cutout",
        siteWidthFt: 4,
      }),
    ];
    const summary = summarizeStreetTrees(groupsOfTrees(trees));
    expect(summary.total).toBe(3);
    expect(summary.species[0]).toMatchObject({ name: "Acer platanoides", count: 2 });
    expect(summary.species[0].share).toBeCloseTo(2 / 3);
    expect(summary.diameterClasses).toEqual([1, 0, 0, 2]);
    expect(summary.averageDiameterIn).toBeCloseTo((27.7 + 30.3 + 4) / 3);
    expect(summary.largestDiameterIn).toBe(30.3);
    expect(summary.largeShare).toBeCloseTo(1 / 3);
    expect(summary.deciduousShare).toBeCloseTo(2 / 3);
    expect(summary.evergreenShare).toBeCloseTo(1 / 3);
    expect(summary.condition).toEqual([
      { name: "Good", count: 1 },
      { name: "Fair", count: 1 },
      { name: "Poor", count: 1 },
    ]);
    expect(wiresCount(trees)).toEqual({ under: 2, known: 3 });
    expect(plantingSites(trees)).toEqual({ type: "Strip", widthFt: 6 });
  });

  it("takes an area's species and traits from two groupings", () => {
    const species = [
      group("Acer platanoides - Norway maple", 6, {
        diameterClasses: [1, 1, 2, 2],
        diameterSumIn: 90,
        diameterMaxIn: 40,
      }),
      group("Unknown", 4, { diameterClasses: [4, 0, 0, 0], diameterSumIn: 10, diameterMaxIn: 3 }),
    ];
    const traits = [
      group("", 7, {
        matureSize: "Large",
        functionalType: "Broadleaf deciduous",
        condition: "Good",
      }),
      group("", 3, {
        matureSize: "Small",
        functionalType: "Coniferous evergreen",
        condition: "Dead",
      }),
    ];
    const summary = summarizeStreetTrees(species, traits);
    expect(summary.total).toBe(10);
    expect(summary.species.map((entry) => entry.name)).toEqual(["Acer platanoides", "Unknown"]);
    expect(summary.measured).toBe(10);
    expect(summary.averageDiameterIn).toBe(10);
    expect(summary.largestDiameterIn).toBe(40);
    expect(summary.largeShare).toBeCloseTo(0.7);
    expect(summary.deciduousShare).toBeCloseTo(0.7);
    expect(summary.condition).toEqual([
      { name: "Good", count: 7 },
      { name: "Dead", count: 3 },
    ]);
  });

  it("puts Unknown last among equals and has nulls for nothing known", () => {
    const summary = summarizeStreetTrees([
      group("Unknown", 2),
      group("Acer rubrum - red maple", 2),
    ]);
    expect(summary.species.map((entry) => entry.name)).toEqual(["Acer rubrum", "Unknown"]);
    expect(summary.averageDiameterIn).toBeNull();
    expect(summary.largeShare).toBeNull();
    expect(summary.deciduousShare).toBeNull();
    expect(summary.condition).toEqual([{ name: "Not recorded", count: 4 }]);
  });
});
