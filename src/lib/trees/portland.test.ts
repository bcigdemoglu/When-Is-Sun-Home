import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TAXLOT_FIELDS,
  addressLabel,
  areaStreetTreesUrl,
  blockLabel,
  blockOf,
  blockStreetTreesUrl,
  blockTaxlotsUrl,
  blockWhere,
  familyOf,
  genusOf,
  heritageTreesUrl,
  inBlock,
  inPortland,
  isDeciduous,
  isEvergreen,
  isGenusOnly,
  isoDateOfEpoch,
  nearbyStreetTreesUrl,
  neighborhoodUrl,
  offsetOf,
  parseHeritageTrees,
  parseNeighborhood,
  parseStreetAddress,
  parseStreetTreeGroups,
  parseStreetTrees,
  parseTaxlots,
  sameAddress,
  speciesFlags,
  splitSpecies,
  streetLabel,
  taxlotUrl,
  titleCase,
} from "./portland";

const FIXTURES = path.join(__dirname, "..", "..", "..", "tests", "e2e", "fixtures", "trees");
const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

/** 2124 NE 36th Ave, Portland: the owner's test house. */
const HOUSE = { lat: 45.5382208, lng: -122.6257477 };

describe("where the city's records are", () => {
  it("is the City of Portland, and nowhere else", () => {
    expect(inPortland(HOUSE)).toBe(true);
    expect(inPortland({ lat: 45.5152, lng: -122.6784 })).toBe(true); // downtown
    expect(inPortland({ lat: 37.7912, lng: -122.4301 })).toBe(false); // San Francisco
    expect(inPortland({ lat: 44.9429, lng: -123.0351 })).toBe(false); // Salem, Oregon
  });

  it("asks only the city's own host, never an Esri one", () => {
    const block = { street: "NE 36TH AVE", hundred: 2100 };
    const urls = [
      nearbyStreetTreesUrl(HOUSE),
      blockStreetTreesUrl(block),
      areaStreetTreesUrl(HOUSE, "species"),
      areaStreetTreesUrl(HOUSE, "traits"),
      heritageTreesUrl(HOUSE),
      taxlotUrl(HOUSE),
      blockTaxlotsUrl(block),
      neighborhoodUrl(HOUSE),
    ];
    for (const url of urls) {
      expect(new URL(url).hostname).toBe("www.portlandmaps.com");
      expect(url).not.toMatch(/arcgis\.com|arcgisonline/);
      expect(new URL(url).searchParams.get("f")).toBe("json");
    }
  });

  it("never asks the lot lines for anything but the site address and the lot area (privacy)", () => {
    expect(TAXLOT_FIELDS).toBe("SITEADDR,A_T_SQFT");
    for (const url of [
      taxlotUrl(HOUSE),
      blockTaxlotsUrl({ street: "NE 36TH AVE", hundred: 2100 }),
    ]) {
      const params = new URL(url).searchParams;
      expect(params.get("outFields")).toBe("SITEADDR,A_T_SQFT");
      expect(url).not.toMatch(/OWNER|SALE/i);
    }
  });

  it("counts an area's trees in two groupings, without paging", () => {
    const species = new URL(areaStreetTreesUrl(HOUSE, "species")).searchParams;
    expect(species.get("groupByFieldsForStatistics")).toBe("SPECIES");
    expect(species.get("distance")).toBe("400");
    expect(species.get("resultOffset")).toBeNull();
    const statistics = JSON.parse(species.get("outStatistics") ?? "[]");
    expect(
      statistics.map((s: { outStatisticFieldName: string }) => s.outStatisticFieldName),
    ).toEqual(["n", "d0", "d1", "d2", "d3", "dsum", "dmax"]);
    expect(statistics[1].onStatisticField).toBe("CASE WHEN DIAMETER < 6 THEN 1 ELSE 0 END");
    const traits = new URL(areaStreetTreesUrl(HOUSE, "traits")).searchParams;
    expect(traits.get("groupByFieldsForStatistics")).toBe("MATURE_SIZE,FUNCTIONAL_TYPE,Condition");
  });
});

describe("addresses", () => {
  it("reads every spelling of one address alike", () => {
    const expected = { number: 2124, street: "NE 36TH AVE" };
    expect(parseStreetAddress("2124 NE 36TH AVE, PORTLAND, OR, 97212")).toEqual(expected);
    expect(parseStreetAddress("2124 NE 36TH AVE ")).toEqual(expected);
    expect(parseStreetAddress("2124 Northeast 36th Avenue, Portland")).toEqual(expected);
    expect(parseStreetAddress("2124 N.E. 36th Ave.")).toEqual(expected);
  });

  it("is null without a house number and a street", () => {
    expect(parseStreetAddress("Northeast 36th Avenue, Portland")).toBeNull();
    expect(parseStreetAddress("2124")).toBeNull();
    expect(parseStreetAddress("")).toBeNull();
    expect(parseStreetAddress(undefined)).toBeNull();
  });

  it("matches the same house only", () => {
    const a = parseStreetAddress("2124 NE 36TH AVE, PORTLAND, OR, 97212");
    expect(sameAddress(a, parseStreetAddress("2124 Northeast 36th Avenue"))).toBe(true);
    expect(sameAddress(a, parseStreetAddress("2126 NE 36TH AVE"))).toBe(false);
    expect(sameAddress(a, parseStreetAddress("2124 NW 36TH AVE"))).toBe(false);
    expect(sameAddress(a, null)).toBe(false);
  });

  it("finds the hundred-block, both sides of the street", () => {
    const block = blockOf({ number: 2124, street: "NE 36TH AVE" });
    expect(block).toEqual({ street: "NE 36TH AVE", hundred: 2100 });
    expect(inBlock(parseStreetAddress("2199 NE 36TH AVE"), block)).toBe(true);
    expect(inBlock(parseStreetAddress("2101 NE 36TH AVE"), block)).toBe(true);
    expect(inBlock(parseStreetAddress("2245 NE 36TH AVE"), block)).toBe(false);
    expect(inBlock(parseStreetAddress("2124 NE 37TH AVE"), block)).toBe(false);
    expect(blockLabel(block)).toBe("2100 block of NE 36th Ave");
  });

  it("writes a block as an SQL test that nothing can break out of", () => {
    expect(blockWhere("Address", { street: "NE 36TH AVE", hundred: 2100 }, ",%")).toBe(
      "Address LIKE '21__ NE 36TH AVE,%'",
    );
    expect(blockWhere("SITEADDR", { street: "SE OAK ST", hundred: 0 }, "%")).toBe(
      "SITEADDR LIKE '_ SE OAK ST%' OR SITEADDR LIKE '__ SE OAK ST%'",
    );
    expect(blockWhere("Address", { street: "X' OR '1'='1", hundred: 100 }, "%")).toBe(
      "Address LIKE '1__ X OR 11%'",
    );
  });

  it("labels streets as people write them", () => {
    expect(streetLabel("NE 36TH AVE")).toBe("NE 36th Ave");
    expect(streetLabel("SE MARTIN LUTHER KING JR BLVD")).toBe("SE Martin Luther King Jr Blvd");
    expect(addressLabel({ number: 2124, street: "NE 36TH AVE" })).toBe("2124 NE 36th Ave");
    expect(titleCase("GRANT PARK")).toBe("Grant Park");
    expect(titleCase("ST. JOHNS")).toBe("St. Johns");
  });
});

describe("species", () => {
  it("splits the inventory's names", () => {
    expect(splitSpecies("Acer platanoides - Norway maple")).toEqual({
      scientific: "Acer platanoides",
      common: "Norway maple",
    });
    expect(splitSpecies("Unknown")).toEqual({ scientific: "", common: "Unknown" });
    expect(splitSpecies("Prunus (cherry species and cultivars) - cherry").scientific).toBe(
      "Prunus (cherry species and cultivars)",
    );
  });

  it("finds genus and family, and knows a genus-only name", () => {
    expect(genusOf("Acer platanoides")).toBe("Acer");
    expect(genusOf("")).toBe("");
    expect(familyOf("Acer")).toBe("Sapindaceae");
    expect(familyOf("Quercus")).toBe("Fagaceae");
    expect(familyOf("Nonexistentus")).toBe("");
    expect(isGenusOnly("Acer spp.")).toBe(true);
    expect(isGenusOnly("Prunus (cherry species and cultivars)")).toBe(true);
    expect(isGenusOnly("Acer platanoides")).toBe(false);
  });

  it("knows the city's native and nuisance flags", () => {
    expect(speciesFlags("Acer platanoides")).toEqual({ native: false, nuisance: true });
    expect(speciesFlags("Acer macrophyllum")).toEqual({ native: true, nuisance: false });
    expect(speciesFlags("Pseudotsuga menziesii")?.native).toBe(true);
    expect(speciesFlags("Not a tree")).toBeNull();
  });

  it("tells deciduous from evergreen, conifers included", () => {
    expect(isDeciduous("Broadleaf deciduous")).toBe(true);
    expect(isDeciduous("Coniferous deciduous")).toBe(true);
    expect(isEvergreen("Coniferous evergreen")).toBe(true);
    expect(isDeciduous("")).toBe(false);
    expect(isEvergreen("")).toBe(false);
  });
});

describe("answers", () => {
  it("reads the street trees of a block", () => {
    const trees = parseStreetTrees(fixture("block-trees"));
    expect(trees).toHaveLength(2);
    const [first] = trees;
    expect(first).toMatchObject({
      address: "2124 NE 36TH AVE",
      scientific: "Acer platanoides",
      common: "Norway maple",
      condition: expect.any(String),
      matureSize: "Medium",
      functionalType: "Broadleaf deciduous",
      siteType: "Strip",
      siteWidthFt: 6,
      neighborhood: "GRANT PARK",
      inventoried: expect.stringMatching(/^2024-\d\d-\d\d$/),
    });
    expect(trees.map((tree) => tree.diameterIn).sort()).toEqual([27.7, 30.3]);
    expect(trees.map((tree) => tree.wires).sort()).toEqual(["High voltage", "Other"]);
  });

  it("reads an inventory date as the calendar date it names", () => {
    expect(isoDateOfEpoch(1719273600000)).toBe("2024-06-25");
    expect(isoDateOfEpoch(null)).toBeNull();
    expect(isoDateOfEpoch("x")).toBeNull();
  });

  it("fails quietly on an error answer, so the query can say it could not load", () => {
    expect(() => parseStreetTrees({ error: { code: 400, message: "Invalid query" } })).toThrow(
      /Invalid query/,
    );
    expect(() => parseStreetTrees("<html>")).toThrow();
  });

  it("reads grouped counts, and refuses an answer that may have been cut short", () => {
    const groups = parseStreetTreeGroups(fixture("area-species"));
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(967);
    const maple = groups.find((group) => group.species.startsWith("Acer platanoides"));
    expect(maple?.count).toBe(93);
    expect(maple?.diameterClasses.reduce((a, b) => a + b, 0)).toBe(93);
    const traits = parseStreetTreeGroups(fixture("area-traits"));
    expect(traits.reduce((sum, group) => sum + group.count, 0)).toBe(967);
    const full = { features: Array.from({ length: 200 }, () => ({ attributes: { n: 1 } })) };
    expect(() => parseStreetTreeGroups(full)).toThrow(/Too many/);
  });

  it("reads lots: address, area and outline only", () => {
    const [lot] = parseTaxlots(fixture("taxlot"));
    expect(lot.address).toEqual({ number: 2124, street: "NE 36TH AVE" });
    expect(lot.areaSqFt).toBe(4950);
    expect(lot.rings[0].length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(lot).sort()).toEqual(["address", "areaSqFt", "rings"]);
    const blockLots = parseTaxlots(fixture("block-lots"));
    expect(blockLots.length).toBeGreaterThan(0);
  });

  it("reads heritage trees and the neighborhood", () => {
    const heritage = parseHeritageTrees(fixture("heritage"));
    expect(heritage.length).toBeGreaterThan(0);
    expect(heritage[0]).toMatchObject({ common: expect.any(String), heightFt: expect.any(Number) });
    const hood = parseNeighborhood(fixture("neighborhood"));
    expect(hood?.name).toBe("Grant Park");
    expect(hood?.rings[0].length).toBeGreaterThan(3);
    expect(parseNeighborhood({ features: [] })).toBeNull();
  });
});

describe("offsetOf", () => {
  it("gives distance and compass bearing", () => {
    const west = offsetOf(HOUSE, { lat: HOUSE.lat, lng: HOUSE.lng - 0.0002 });
    expect(west.distanceM).toBeCloseTo(15.6, 0);
    expect(west.bearingDeg).toBeCloseTo(270, 0);
    const north = offsetOf(HOUSE, { lat: HOUSE.lat + 0.0001, lng: HOUSE.lng });
    expect(north.distanceM).toBeCloseTo(11.1, 0);
    expect(north.bearingDeg).toBeCloseTo(0, 0);
  });
});
