import { describe, expect, it } from "vitest";
import type { BuildingCollection, BuildingFeature } from "@/lib/types";
import { buildingsNear } from "./mapData";

const CENTER = { lat: 37.79, lng: -122.43 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180));

/** A square building `size` metres wide whose south-west corner is at (eastM, northM). */
function square(id: string, eastM: number, northM: number, size = 10): BuildingFeature {
  const x0 = CENTER.lng + eastM * M_LNG;
  const y0 = CENTER.lat + northM * M_LAT;
  const x1 = x0 + size * M_LNG;
  const y1 = y0 + size * M_LAT;
  return {
    type: "Feature",
    properties: { id, heightM: 9, heightSource: "default", levels: null, kind: "yes" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    },
  };
}

function ids(collection: BuildingCollection): string[] {
  return collection.features.map((feature) => feature.properties.id);
}

describe("buildingsNear", () => {
  const buildings: BuildingCollection = {
    type: "FeatureCollection",
    features: [
      square("near", 20, 20),
      square("edge", 245, 0),
      square("far", 300, 0),
      square("around-pin", -500, -500, 1000),
      square("diagonal-out", 200, 200),
    ],
  };

  it("keeps buildings whose footprint reaches into the radius", () => {
    expect(ids(buildingsNear(buildings, CENTER, 250))).toEqual(["near", "edge", "around-pin"]);
  });

  it("keeps the source order and the feature objects", () => {
    const near = buildingsNear(buildings, CENTER, 250);
    expect(near.features[0]).toBe(buildings.features[0]);
  });

  it("handles multipolygons and empty input", () => {
    const multi: BuildingFeature = {
      type: "Feature",
      properties: { id: "multi", heightM: 5, heightSource: "tagged", levels: 2, kind: "house" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          square("a", 900, 900).geometry.coordinates as number[][][],
          square("b", 10, 10).geometry.coordinates as number[][][],
        ],
      },
    };
    expect(
      ids(buildingsNear({ type: "FeatureCollection", features: [multi] }, CENTER, 250)),
    ).toEqual(["multi"]);
    expect(
      buildingsNear({ type: "FeatureCollection", features: [] }, CENTER, 250).features,
    ).toEqual([]);
  });
});
