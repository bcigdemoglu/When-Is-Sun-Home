import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildingTilesOfWindow, nearWindow } from "@/components/map/canopyWindow";
import { runCanopyJob, type CanopyGrid } from "@/components/map/treeTileJob";
import {
  parseHeritageTrees,
  parseNeighborhood,
  parseStreetTreeGroups,
  parseStreetTrees,
  parseTaxlots,
} from "@/lib/trees/portland";
import {
  FRONT_MAX,
  addressFor,
  blockFor,
  buildTreeReport,
  failed,
  loading,
  none,
  ready,
  streetSide,
  treeRegion,
  type TreeInputs,
} from "./treesModel";

const FIXTURES = path.join(__dirname, "..", "..", "..", "tests", "e2e", "fixtures", "trees");
const json = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
const bytes = (name: string) => {
  const data = fs.readFileSync(path.join(FIXTURES, name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};

const HOUSE = { lat: 45.5382208, lng: -122.6257477, name: "2124 Northeast 36th Avenue, Portland" };

let nearGrid: CanopyGrid;
beforeAll(async () => {
  const window = nearWindow(HOUSE);
  nearGrid = await runCanopyJob({
    kind: "canopy",
    id: 1,
    window,
    heights: bytes("heights-near.png"),
    buildings: buildingTilesOfWindow(window).map(({ tile, frame }) => ({
      frame,
      data: bytes(`buildings-14-${tile.x}-${tile.y}.pbf`),
    })),
    labels: true,
  });
});

function inputs(overrides: Partial<TreeInputs> = {}): TreeInputs {
  return {
    place: HOUSE,
    lot: ready(parseTaxlots(json("taxlot"))[0]),
    nearby: ready(parseStreetTrees(json("nearby-trees"))),
    blockTrees: ready(parseStreetTrees(json("block-trees"))),
    blockLots: ready(parseTaxlots(json("block-lots"))),
    area: ready({
      species: parseStreetTreeGroups(json("area-species")),
      traits: parseStreetTreeGroups(json("area-traits")),
    }),
    heritage: ready(parseHeritageTrees(json("heritage"))),
    neighborhood: ready(parseNeighborhood(json("neighborhood"))),
    nearGrid: ready(nearGrid),
    areaGrid: loading,
    neighborhoodGrid: loading,
    ...overrides,
  };
}

describe("treeRegion", () => {
  it("knows where the data is", () => {
    expect(treeRegion(HOUSE)).toBe("portland");
    expect(treeRegion({ lat: 44.9429, lng: -123.0351 })).toBe("oregon"); // Salem
    expect(treeRegion({ lat: 37.7912, lng: -122.4301 })).toBe("elsewhere");
  });
});

describe("the address", () => {
  it("is the lot's own, else the place's name, and waits for the lot", () => {
    const lot = parseTaxlots(json("taxlot"))[0];
    expect(addressFor(HOUSE, ready(lot))).toEqual({
      address: { number: 2124, street: "NE 36TH AVE" },
      source: "lot",
    });
    expect(addressFor({ ...HOUSE, name: "2126 NE 36th Ave" }, ready(null))).toEqual({
      address: { number: 2126, street: "NE 36TH AVE" },
      source: "place",
    });
    expect(addressFor({ ...HOUSE, name: "2126 NE 36th Ave" }, failed)?.source).toBe("place");
    expect(addressFor(HOUSE, loading)).toBeUndefined();
    expect(addressFor({ lat: 45.5, lng: -122.6 }, ready(null))).toBeNull();
  });

  it("gives the block, or the nearest street tree's block without an address", () => {
    const nearby = ready(parseStreetTrees(json("nearby-trees")));
    expect(blockFor({ number: 2124, street: "NE 36TH AVE" }, nearby, HOUSE)).toEqual({
      street: "NE 36TH AVE",
      hundred: 2100,
    });
    expect(blockFor(null, nearby, HOUSE)?.street).toBe("NE 36TH AVE");
    expect(blockFor(null, loading, HOUSE)).toBeUndefined();
    expect(blockFor(undefined, nearby, HOUSE)).toBeUndefined();
    expect(blockFor(null, ready([]), HOUSE)).toBeNull();
  });
});

describe("buildTreeReport, at 2124 NE 36th Ave", () => {
  it("lists the street trees in front, with their laser heights", () => {
    const { front } = buildTreeReport(inputs());
    expect(front.state).toBe("ready");
    if (front.state !== "ready") return;
    expect(front.value.address).toEqual({ number: 2124, street: "NE 36TH AVE" });
    expect(front.value.addressSource).toBe("lot");
    expect(front.value.count).toBe(2);
    expect(front.value.trees.map((tree) => tree.common)).toEqual(["Norway maple", "Norway maple"]);
    for (const tree of front.value.trees) {
      expect(tree.heightFt).toBeGreaterThan(40);
      // West of the pin, across the front yard.
      expect(tree.bearingDeg).toBeGreaterThan(225);
      expect(tree.bearingDeg).toBeLessThan(315);
      expect(tree.distanceM).toBeLessThan(25);
    }
    expect(front.value.nearest).toBeNull();
  });

  it("measures the backyard behind the house", () => {
    const { backyard } = buildTreeReport(inputs());
    expect(backyard.state).toBe("ready");
    if (backyard.state !== "ready") return;
    expect(backyard.value.lotSqFt).toBe(4950);
    expect(backyard.value.canopy?.backyard.kind).toBe("ok");
    expect(backyard.value.canopy?.lot?.cover).toBeGreaterThan(0.5);
  });

  it("summarises the block, both sides of the street", () => {
    const { block } = buildTreeReport(inputs());
    expect(block.state).toBe("ready");
    if (block.state !== "ready" || !block.value) return;
    expect(block.value.block).toEqual({ street: "NE 36TH AVE", hundred: 2100 });
    expect(block.value.summary.total).toBe(2);
    expect(block.value.wires).toEqual({ under: 2, known: 2 });
    expect(block.value.sites).toEqual({ type: "Strip", widthFt: 6 });
    expect(block.value.tallestFt).toBeGreaterThan(40);
    expect(block.value.lotsCanopy.state).toBe("ready");
  });

  it("summarises the area, with the nearest heritage trees", () => {
    const { area } = buildTreeReport(inputs());
    expect(area.streetTrees.state === "ready" && area.streetTrees.value.total).toBe(967);
    expect(area.canopy).toEqual(loading);
    expect(area.neighborhood.state === "ready" && area.neighborhood.value?.name).toBe("Grant Park");
    expect(area.heritage.state).toBe("ready");
    if (area.heritage.state !== "ready") return;
    expect(area.heritage.value).toHaveLength(2);
    expect(area.heritage.value[0].distanceM).toBeLessThanOrEqual(area.heritage.value[1].distanceM);
  });

  it("says when nothing is recorded in front, and offers the nearest", () => {
    const { front } = buildTreeReport(
      inputs({
        lot: ready({
          ...parseTaxlots(json("taxlot"))[0],
          address: { number: 2130, street: "NE 36TH AVE" },
        }),
      }),
    );
    expect(front.state === "ready" && front.value.trees).toEqual([]);
    expect(front.state === "ready" && front.value.nearest?.common).toBe("Norway maple");
  });

  it("caps a big lot's list", () => {
    const tree = parseStreetTrees(json("block-trees"))[0];
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...tree,
      id: i,
      lat: tree.lat + i * 1e-5,
    }));
    const { front } = buildTreeReport(inputs({ blockTrees: ready(many) }));
    expect(front.state === "ready" && front.value.trees.length).toBe(FRONT_MAX);
    expect(front.state === "ready" && front.value.count).toBe(9);
  });

  it("gives a young tree no laser height of its own", () => {
    const tree = { ...parseStreetTrees(json("block-trees"))[0], diameterIn: 1.1 };
    const { front } = buildTreeReport(inputs({ blockTrees: ready([tree]) }));
    expect(front.state === "ready" && front.value.trees[0].heightFt).toBe("small");
  });

  it("fails quietly, part by part", () => {
    const report = buildTreeReport(
      inputs({ lot: failed, blockTrees: failed, nearby: failed, area: failed }),
    );
    expect(report.backyard).toEqual(failed);
    expect(report.area.streetTrees).toEqual(failed);
    // Without the lot the place's name still gives the address; its block's trees failed.
    expect(report.front).toEqual(failed);
    expect(report.block).toEqual(failed);
  });

  it("waits while the lot is being looked up", () => {
    const report = buildTreeReport(inputs({ lot: loading }));
    expect(report.front).toEqual(loading);
    expect(report.backyard).toEqual(loading);
    expect(report.block).toEqual(loading);
  });
});

describe("outside Portland", () => {
  it("asks nothing of the city, and has only the canopy in Oregon", () => {
    const salem = { lat: 44.9429, lng: -123.0351 };
    const report = buildTreeReport(
      inputs({ place: salem, lot: none, nearby: none, blockTrees: none, area: none }),
    );
    expect(report.region).toBe("oregon");
    expect(report.front).toEqual(none);
    expect(report.backyard).toEqual(none);
    expect(report.block).toEqual(none);
    expect(report.area.streetTrees).toEqual(none);
    expect(report.area.canopy).toEqual(loading);
  });

  it("has nothing at all beyond Oregon", () => {
    const report = buildTreeReport(inputs({ place: { lat: 37.7912, lng: -122.4301 } }));
    expect(report.region).toBe("elsewhere");
    expect(report.area.canopy).toEqual(none);
    expect(report.front).toEqual(none);
  });
});

describe("streetSide", () => {
  it("is the middle of the trees in front, else the nearest tree on the street", () => {
    const trees = parseStreetTrees(json("block-trees"));
    const middle = streetSide(trees, ready(trees), null, HOUSE);
    expect(middle?.lng).toBeCloseTo((trees[0].lng + trees[1].lng) / 2);
    const nearest = streetSide([], ready(trees), { number: 2130, street: "NE 36TH AVE" }, HOUSE);
    expect(nearest).not.toBeNull();
    expect(streetSide([], ready(trees), { number: 1, street: "SE OAK ST" }, HOUSE)).toBeNull();
    expect(streetSide([], loading, { number: 2130, street: "NE 36TH AVE" }, HOUSE)).toBeNull();
  });
});
