import { describe, expect, it } from "vitest";
import {
  NEIGHBORHOOD_MAX_BUILDING_TILES,
  areaWindow,
  buildingTilesOfWindow,
  canopyWindowUrl,
  metresPerPixel,
  nearWindow,
  neighborhoodWindow,
  windowAround,
  windowAroundBounds,
  windowBoundsMercator,
  windowPixel,
} from "./canopyWindow";
import { tileBoundsMercator } from "./trees";

const HOUSE = { lat: 45.5382208, lng: -122.6257477 };

describe("canopy windows", () => {
  it("centre on the spot, on the map tiles' own pixel grid", () => {
    const window = windowAround(HOUSE, 16, 384);
    const { x, y } = windowPixel(window, HOUSE);
    expect(Math.abs(x - 192)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - 192)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(window.x0) && Number.isInteger(window.y0)).toBe(true);
  });

  it("know their ground resolution: a zoom-16 pixel is 0.84 m in Portland", () => {
    expect(metresPerPixel(nearWindow(HOUSE))).toBeCloseTo(0.837, 2);
    expect(metresPerPixel(areaWindow(HOUSE))).toBeCloseTo(1.674, 2);
    // The area window holds a 400 m circle with room.
    expect(areaWindow(HOUSE).size * metresPerPixel(areaWindow(HOUSE))).toBeGreaterThan(800);
  });

  it("line up with a map tile when they cover exactly one", () => {
    const tile = { z: 16, x: 10444, y: 23436 };
    const window = { z: 16, x0: tile.x * 512, y0: tile.y * 512, size: 512 };
    expect(windowBoundsMercator(window)).toEqual(tileBoundsMercator(tile));
  });

  it("ask the same service as the map layer, for their own bounds and size", () => {
    const url = canopyWindowUrl(nearWindow(HOUSE));
    expect(url).toMatch(
      /^https:\/\/gis\.dogami\.oregon\.gov\/arcgis\/rest\/services\/lidar\/CANOPY_HEIGHT_MODEL_MOSAIC\/ImageServer\/exportImage\?bbox=[-\d.,]+&bboxSR=3857&imageSR=3857&size=384,384&format=png32&pixelType=U8&interpolation=RSP_NearestNeighbor&f=image$/,
    );
  });

  it("find the building tiles they overlap, with the frame of each", () => {
    // Inside one building tile.
    const inside = { z: 16, x0: 2611 * 2048 + 100, y0: 5858 * 2048 + 100, size: 256 };
    expect(buildingTilesOfWindow(inside)).toEqual([
      { tile: { z: 14, x: 2611, y: 5858 }, frame: { scale: 2048, offsetX: 100, offsetY: 100 } },
    ]);
    // Across a corner: four tiles; a footprint unit of 1 in the first lands 100 px in.
    const corner = { z: 16, x0: 2612 * 2048 - 100, y0: 5859 * 2048 - 100, size: 200 };
    const tiles = buildingTilesOfWindow(corner);
    expect(tiles.map(({ tile }) => `${tile.x}/${tile.y}`)).toEqual([
      "2611/5858",
      "2612/5858",
      "2611/5859",
      "2612/5859",
    ]);
    expect(1 * tiles[0].frame.scale - tiles[0].frame.offsetX).toBe(100);
    expect(0 * tiles[3].frame.scale - tiles[3].frame.offsetX).toBe(100);
  });

  it("fit a box at the finest zoom that holds it", () => {
    const box = [
      { lat: 45.53, lng: -122.635 },
      { lat: 45.545, lng: -122.615 },
    ];
    const window = windowAroundBounds(box, { maxSize: 1024, maxZoom: 16, minZoom: 12 });
    expect(window?.z).toBe(15);
    for (const corner of box) {
      const { x, y } = windowPixel(window!, corner);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(window!.size);
      expect(y).toBeLessThanOrEqual(window!.size);
    }
    expect(windowAroundBounds([], { maxSize: 10, maxZoom: 16, minZoom: 12 })).toBeNull();
  });

  it("measure a neighborhood only when it is small enough", () => {
    const small = [
      [
        { lat: 45.532, lng: -122.636 },
        { lat: 45.532, lng: -122.615 },
        { lat: 45.545, lng: -122.615 },
        { lat: 45.545, lng: -122.636 },
      ],
    ];
    const window = neighborhoodWindow(small);
    expect(window?.z).toBe(14);
    expect(buildingTilesOfWindow(window!).length).toBeLessThanOrEqual(
      NEIGHBORHOOD_MAX_BUILDING_TILES,
    );
    // Forest Park sized: too big.
    const huge = [
      [
        { lat: 45.5, lng: -122.9 },
        { lat: 45.65, lng: -122.7 },
      ],
    ];
    expect(neighborhoodWindow(huge)).toBeNull();
  });
});
