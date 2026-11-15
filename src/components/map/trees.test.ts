import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OWN_LAYER_PREFIX } from "./mapData";
import { TREE_CLASS_MIN_FT } from "./treeRaster";
import {
  TREES_ATTRIBUTION,
  TREES_BOUNDS,
  TREES_ELSEWHERE_HINT,
  TREES_PROTOCOL,
  TREES_SOURCE_ID,
  TREES_SWITCH_HINT,
  TREE_HEIGHTS_SERVICE,
  TREE_LEGEND_LABELS,
  TREE_LEGEND_RANGES,
  TREE_MAX_ZOOM,
  TREE_MIN_ZOOM,
  TREE_RETRY_WAITS_MS,
  TREE_TILE_SIZE,
  hasTreeHeights,
  parseTreeTileUrl,
  showsTrees,
  surveyFromIdentify,
  surveyFromName,
  tileBoundsMercator,
  treeHeightsUrl,
  treeLook,
  treeSurveyLine,
  treeSurveyUrl,
  treeSurveyWords,
  treeTileTemplate,
  treesSwitchHint,
  type TreeLook,
} from "./trees";

const PORTLAND = { lat: 45.5385, lng: -122.6265 };
const SAN_FRANCISCO = { lat: 37.7912, lng: -122.4301 };

/** The address MapLibre asks for: the template with a tile's numbers in it. */
const asked = (look: TreeLook, z: number, x: number, y: number) =>
  treeTileTemplate(look)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

describe("the Trees source", () => {
  it("is one of the app's own layers, under a scheme of its own", () => {
    expect(TREES_SOURCE_ID.startsWith(OWN_LAYER_PREFIX)).toBe(true);
    expect(treeTileTemplate("map-light").startsWith(`${TREES_PROTOCOL}://`)).toBe(true);
  });

  it("credits the state's lidar programme, with a link", () => {
    expect(TREES_ATTRIBUTION).toContain("Tree heights: ");
    expect(TREES_ATTRIBUTION).toContain(">Oregon DOGAMI lidar</a>");
    expect(TREES_ATTRIBUTION).toContain(
      'href="https://www.oregon.gov/dogami/lidar/Pages/index.aspx"',
    );
    expect(TREES_ATTRIBUTION).toContain('rel="noopener"');
  });

  it("asks for 512 px pictures from the building tiles' zoom to the survey's own resolution", () => {
    expect(TREE_TILE_SIZE).toBe(512);
    expect(TREE_MIN_ZOOM).toBe(14);
    expect(TREE_MAX_ZOOM).toBe(16);
  });

  it("gives a failed picture two more tries", () => {
    expect(TREE_RETRY_WAITS_MS).toEqual([2_000, 10_000]);
  });
});

describe("treeLook", () => {
  it("goes by what lies under the trees", () => {
    expect(treeLook(false, false)).toBe("map-light");
    expect(treeLook(false, true)).toBe("map-dark");
    // A photo is the same photo in both colour schemes.
    expect(treeLook(true, false)).toBe("photo");
    expect(treeLook(true, true)).toBe("photo");
  });

  it("is part of the address: another look is another set of pictures", () => {
    const addresses = (["map-light", "map-dark", "photo"] as const).map(treeTileTemplate);
    expect(new Set(addresses).size).toBe(3);
  });
});

describe("parseTreeTileUrl", () => {
  it("reads back what MapLibre asks for", () => {
    expect(parseTreeTileUrl(asked("photo", 16, 10444, 23435))).toEqual({
      z: 16,
      x: 10444,
      y: 23435,
      look: "photo",
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 18 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        fc.constantFrom<TreeLook>("map-light", "map-dark", "photo"),
        (z, u, v, look) => {
          const tile = { z, x: Math.floor(u * 2 ** z), y: Math.floor(v * 2 ** z) };
          expect(parseTreeTileUrl(asked(look, tile.z, tile.x, tile.y))).toEqual({ ...tile, look });
        },
      ),
    );
  });

  it("refuses everything else", () => {
    for (const url of [
      "",
      "https://gis.dogami.oregon.gov/x",
      "tree-heights://heights/16/10444/23435",
      "tree-heights://heights/16/10444/23435?look=rainbow",
      "tree-heights://heights/16/10444/23435?look=photo&x=1",
      "tree-heights://heights/16/-1/23435?look=photo",
      "tree-heights://heights/2/4/0?look=photo", // no such column at zoom 2
      "tree-heights://heights/2/0/4?look=photo",
      "tree-heights://heights/99/0/0?look=photo",
      "tree-heights://elsewhere/16/10444/23435?look=photo",
      "usgs-detail://heights/16/10444/23435?look=photo",
    ]) {
      expect(parseTreeTileUrl(url), url).toBeNull();
    }
  });
});

describe("treeHeightsUrl", () => {
  it("asks the state's canopy-height service for one tile's picture, by its bounds", () => {
    const url = new URL(treeHeightsUrl({ z: 16, x: 10444, y: 23435 }));
    expect(url.origin + url.pathname).toBe(`${TREE_HEIGHTS_SERVICE}/exportImage`);
    expect(url.hostname).toBe("gis.dogami.oregon.gov");
    expect(url.pathname).toContain("/lidar/CANOPY_HEIGHT_MODEL_MOSAIC/ImageServer/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      bbox: "-13651041.756,5706482.784,-13650430.259,5707094.280",
      bboxSR: "3857",
      imageSR: "3857",
      size: "512,512",
      // 8-bit feet with a real alpha channel, a height never blended with its neighbour's.
      format: "png32",
      pixelType: "U8",
      interpolation: "RSP_NearestNeighbor",
      f: "image",
    });
  });

  it("is the whole world at zoom 0", () => {
    expect(tileBoundsMercator({ z: 0, x: 0, y: 0 }).map((value) => Math.round(value))).toEqual([
      -20037508, -20037508, 20037508, 20037508,
    ]);
  });

  it("gives neighbouring tiles bounds that meet exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 18 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (z, x, y) => {
          const [west, south, east, north] = tileBoundsMercator({ z, x, y });
          expect(tileBoundsMercator({ z, x: x + 1, y })[0]).toBe(east);
          expect(tileBoundsMercator({ z, x, y: y + 1 })[3]).toBe(south);
          // …and are square (to well under a millimetre).
          expect(east - west).toBeCloseTo(north - south, 4);
        },
      ),
    );
  });

  it("covers the place the tile is of", () => {
    // 16/10444/23435 is the tile over NE 36th Avenue, Portland.
    const R = 20037508.342789244;
    const x = (PORTLAND.lng * R) / 180;
    const y = (Math.log(Math.tan(((90 + PORTLAND.lat) * Math.PI) / 360)) * R) / Math.PI;
    const [west, south, east, north] = tileBoundsMercator({ z: 16, x: 10444, y: 23435 });
    expect(x).toBeGreaterThan(west);
    expect(x).toBeLessThan(east);
    expect(y).toBeGreaterThan(south);
    expect(y).toBeLessThan(north);
  });
});

describe("hasTreeHeights", () => {
  it("says yes all over Oregon, and on the Washington bank of the Columbia", () => {
    const places: Record<string, [number, number]> = {
      Portland: [45.5385, -122.6265],
      Beaverton: [45.4871, -122.8037],
      Eugene: [44.0462, -123.0926],
      Bend: [44.0582, -121.3153],
      Ashland: [42.1946, -122.7095],
      Brookings: [42.0526, -124.2839],
      Astoria: [46.1879, -123.8313],
      "Ontario, on the Idaho line": [44.0266, -116.9629],
      "Vancouver, Washington": [45.6387, -122.6615],
    };
    for (const [name, [lat, lng]] of Object.entries(places)) {
      expect(hasTreeHeights({ lat, lng }), name).toBe(true);
    }
  });

  it("says no everywhere else", () => {
    const places: Record<string, [number, number]> = {
      "San Francisco": [37.7912, -122.4301],
      Seattle: [47.6062, -122.3321],
      Boise: [43.615, -116.2023],
      Redding: [40.5865, -122.3917],
      Manhattan: [40.758, -73.9855],
      Istanbul: [41.0082, 28.9784],
      "the same latitude in Japan": [45.5, 141.9],
      "null island": [0, 0],
    };
    for (const [name, [lat, lng]] of Object.entries(places)) {
      expect(hasTreeHeights({ lat, lng }), name).toBe(false);
    }
  });

  it("copes with longitudes that were dragged round the world, and with junk", () => {
    expect(hasTreeHeights({ lat: 45.5385, lng: -122.6265 + 360 })).toBe(true);
    expect(hasTreeHeights({ lat: 45.5385, lng: -122.6265 - 720 })).toBe(true);
    expect(hasTreeHeights({ lat: NaN, lng: -122 })).toBe(false);
    expect(hasTreeHeights({ lat: 45, lng: Infinity })).toBe(false);
  });

  it("is the box MapLibre is told to stay inside", () => {
    const [west, south, east, north] = TREES_BOUNDS;
    expect(hasTreeHeights({ lat: (south + north) / 2, lng: (west + east) / 2 })).toBe(true);
    expect(hasTreeHeights({ lat: north + 0.01, lng: west + 1 })).toBe(false);
    expect(hasTreeHeights({ lat: south + 1, lng: east + 0.01 })).toBe(false);
  });
});

describe("showsTrees", () => {
  it("needs the switch on AND a place that can have tree heights", () => {
    expect(showsTrees(true, PORTLAND, null)).toBe(true);
    expect(showsTrees(false, PORTLAND, null)).toBe(false);
    expect(showsTrees(true, SAN_FRANCISCO, null)).toBe(false);
  });

  it("goes by the pinned place when there is one, else by the middle of the map", () => {
    expect(showsTrees(true, SAN_FRANCISCO, PORTLAND)).toBe(false);
    expect(showsTrees(true, PORTLAND, SAN_FRANCISCO)).toBe(true);
    expect(showsTrees(true, null, PORTLAND)).toBe(true);
    expect(showsTrees(true, null, SAN_FRANCISCO)).toBe(false);
    expect(showsTrees(true, null, null)).toBe(false);
  });
});

describe("what the switch says", () => {
  it("says what the layer is, and that it is not in the numbers", () => {
    expect(treesSwitchHint(PORTLAND)).toBe(TREES_SWITCH_HINT);
    expect(treesSwitchHint(null)).toBe(TREES_SWITCH_HINT);
    expect(TREES_SWITCH_HINT).toBe(
      "Measured tree heights, Oregon only. Not counted in the sun hours",
    );
  });

  it("says so where there are none", () => {
    expect(treesSwitchHint(SAN_FRANCISCO)).toBe(TREES_ELSEWHERE_HINT);
    expect(TREES_ELSEWHERE_HINT).toBe(
      "Tree heights are only available in Oregon. Not counted in the sun hours",
    );
  });

  it("never claims the trees are counted", () => {
    for (const hint of [TREES_SWITCH_HINT, TREES_ELSEWHERE_HINT]) {
      expect(hint).toContain("Not counted in the sun hours");
    }
  });
});

describe("the legend", () => {
  it("names each class by the height it begins at, in feet", () => {
    expect(TREE_LEGEND_LABELS).toEqual(["10", "20", "35", "50", "70", "100+"]);
    expect(TREE_LEGEND_LABELS).toHaveLength(TREE_CLASS_MIN_FT.length);
  });

  it("spells the classes out for a screen reader", () => {
    expect(TREE_LEGEND_RANGES).toEqual([
      "10 to 20 feet",
      "20 to 35 feet",
      "35 to 50 feet",
      "50 to 70 feet",
      "70 to 100 feet",
      "100 feet and more",
    ]);
  });
});

describe("which survey the heights are from", () => {
  /** The service's answer at NE 36th Avenue, Portland (trimmed to what is read). */
  const PORTLAND_ANSWER = {
    objectId: 0,
    name: "Pixel",
    value: "7.37999",
    catalogItems: {
      objectIdFieldName: "OBJECTID",
      features: [
        { attributes: { OBJECTID: 420, Name: "OLC_METRO_2014_CANOPY_OGIC_2011", ZOrder: 2014 } },
        {
          attributes: {
            OBJECTID: 369,
            Name: "COLUMBIA_RIVER_2010_USACE_CANOPY_UTM10N_VERTICAL_FEET",
            ZOrder: 2010,
          },
        },
        { attributes: { OBJECTID: 376, Name: "OLC_WILLAMETTE_VALLEY_2009_CANOPY_OGIC_HARN" } },
        { attributes: { OBJECTID: 1, Name: "Ov_i07_L05_R00000016_C0000001B.tif", Category: 2 } },
      ],
    },
    catalogItemVisibilities: [1, 0, 0, 0],
  };

  it("asks the same service one small question about the spot", () => {
    const url = new URL(treeSurveyUrl({ lat: 45.538512345, lng: -122.626498765 }));
    expect(url.origin + url.pathname).toBe(`${TREE_HEIGHTS_SERVICE}/identify`);
    expect(JSON.parse(url.searchParams.get("geometry") ?? "")).toEqual({
      x: -122.6265,
      y: 45.53851,
      spatialReference: { wkid: 4326 },
    });
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(url.searchParams.get("returnCatalogItems")).toBe("true");
    // Not the outlines of every survey: those are megabytes.
    expect(url.searchParams.get("returnGeometry")).toBe("false");
    expect(url.searchParams.get("f")).toBe("json");
  });

  it("reads the survey that is on top at the spot", () => {
    expect(surveyFromIdentify(PORTLAND_ANSWER, 2026)).toEqual({ year: 2014, name: "OLC Metro" });
    // The one on top is the one marked visible, wherever it stands in the list.
    expect(
      surveyFromIdentify({ ...PORTLAND_ANSWER, catalogItemVisibilities: [0, 0, 1, 0] }, 2026),
    ).toEqual({ year: 2009, name: "OLC Willamette Valley" });
  });

  it("is null where the service has nothing, or says something unexpected", () => {
    const nothing = {
      value: "NoData",
      catalogItems: { objectIdFieldName: "OBJECTID", features: [] },
      catalogItemVisibilities: [],
    };
    expect(surveyFromIdentify(nothing)).toBeNull();
    for (const answer of [
      null,
      undefined,
      "error",
      42,
      {},
      { error: { code: 400 } },
      { catalogItems: {}, catalogItemVisibilities: [1] },
      { catalogItems: { features: "x" }, catalogItemVisibilities: [1] },
      { catalogItems: { features: [null] }, catalogItemVisibilities: [1] },
      { catalogItems: { features: [{ attributes: { Name: 7 } }] }, catalogItemVisibilities: [1] },
      // Visible, but an overview picture without a year: not a survey to name.
      { ...PORTLAND_ANSWER, catalogItemVisibilities: [0, 0, 0, 1] },
      { ...PORTLAND_ANSWER, catalogItemVisibilities: "1,0,0,0" },
    ]) {
      expect(surveyFromIdentify(answer, 2026), JSON.stringify(answer)).toBeNull();
    }
  });

  it("reads project and year from a picture's name", () => {
    const cases: [string, { year: number; name: string } | null][] = [
      ["OLC_METRO_2014_CANOPY_OGIC_2011", { year: 2014, name: "OLC Metro" }],
      ["OLC_HOOD_TO_COAST_2007_CANOPY_OGIC_HARN", { year: 2007, name: "OLC Hood to Coast" }],
      ["LOWER_COLUMBIA_2005_PSLC_CANOPY_OGIC_HARN", { year: 2005, name: "Lower Columbia" }],
      ["OLC_DESCHUTES_2011_CANOPY_OGIC_HARN", { year: 2011, name: "OLC Deschutes" }],
      ["OLC_HARNEY_3DEP_2018_CANOPY_OGIC_2011", { year: 2018, name: "OLC Harney 3DEP" }],
      ["CLATSOP_2015_ODF_CANOPY_OGIC_2011", { year: 2015, name: "Clatsop" }],
      ["2019_CANOPY", { year: 2019, name: "" }],
      ["Ov_i07_L05_R00000016_C0000001B.tif", null],
      ["CANOPY", null],
      ["", null],
      // A year nobody flew a laser, or one that has not come yet, is a typing mistake.
      ["OLD_1985_CANOPY", null],
      ["LATER_2099_CANOPY", null],
    ];
    for (const [name, expected] of cases) {
      expect(surveyFromName(name, 2026), name).toEqual(expected);
    }
  });

  it("says how old the heights are, or that it depends", () => {
    expect(treeSurveyLine({ year: 2014, name: "OLC Metro" })).toBe(
      "Laser survey, 2014 (OLC Metro)",
    );
    expect(treeSurveyLine({ year: 2019, name: "" })).toBe("Laser survey, 2019");
    expect(treeSurveyLine(null)).toBe("Laser surveys; the year varies by area");
  });

  it("gives the line in the two pieces a narrow legend may break it into", () => {
    expect(treeSurveyWords({ year: 2017, name: "Willamette River Bathy" })).toEqual([
      "Laser survey, 2017",
      "(Willamette River Bathy)",
    ]);
    expect(treeSurveyWords({ year: 2019, name: "" })).toEqual(["Laser survey, 2019", null]);
    expect(treeSurveyWords(null)).toEqual(["Laser surveys; the year varies by area", null]);
  });
});
