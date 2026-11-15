import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { box, encodeBuildingTile } from "@/lib/buildings/testing";
import {
  NO_TREE,
  SPECK_MIN_NEIGHBOURS,
  TREE_CLASS_MIN_FT,
  classifyHeights,
  despeckle,
  footprintMarginPx,
  footprintsOfTile,
  frameInBuildingTile,
  growMask,
  paintTrees,
  rasterizeFootprints,
  renderTreePixels,
  treeClassOfFeet,
  type FootprintRings,
  type TreePalette,
} from "./treeRaster";

/** A heights picture: `feet` per pixel, row by row; a negative number is "no data". */
function heightsOf(feet: number[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(feet.length * 4);
  feet.forEach((value, i) => {
    const known = value >= 0;
    rgba.set([known ? value : 0, known ? value : 0, known ? value : 0, known ? 255 : 0], 4 * i);
  });
  return rgba;
}

/** Rows of a mask or of classes as strings, for readable expectations. */
function rows(
  values: ArrayLike<number>,
  size: number,
  mark: (value: number) => string = (value) => (value ? "#" : "."),
) {
  const out: string[] = [];
  for (let row = 0; row < size; row++) {
    let line = "";
    for (let column = 0; column < size; column++) line += mark(values[row * size + column]);
    out.push(line);
  }
  return out;
}

const classRows = (classes: Int8Array, size: number) =>
  rows(classes, size, (v) => (v < 0 ? "." : String(v)));

/** A square, in pixels, as a footprint for a frame of scale 1. */
const square = (x1: number, y1: number, x2: number, y2: number): number[] => [
  x1,
  y1,
  x2,
  y1,
  x2,
  y2,
  x1,
  y2,
];
const PIXELS = { scale: 1, offsetX: 0, offsetY: 0 };

const PALETTE: TreePalette = {
  fills: [
    [10, 0, 0, 200],
    [20, 0, 0, 200],
    [30, 0, 0, 200],
    [40, 0, 0, 200],
    [50, 0, 0, 200],
    [60, 0, 0, 200],
  ],
  edge: null,
};

describe("height classes", () => {
  it("begin at 10, 20, 35, 50, 70 and 100 feet", () => {
    expect(TREE_CLASS_MIN_FT).toEqual([10, 20, 35, 50, 70, 100]);
  });

  it("put every height in the class it reaches", () => {
    const cases: [number, number][] = [
      [0, NO_TREE],
      [9, NO_TREE],
      [9.99, NO_TREE],
      [10, 0],
      [19, 0],
      [20, 1],
      [34, 1],
      [35, 2],
      [49, 2],
      [50, 3],
      [69, 3],
      [70, 4],
      [99, 4],
      [100, 5],
      [255, 5],
      [-5, NO_TREE],
      [NaN, NO_TREE],
    ];
    for (const [feet, expected] of cases) {
      expect(treeClassOfFeet(feet), `${feet} ft`).toBe(expected);
    }
  });

  it("never go down as the height goes up", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(treeClassOfFeet(low)).toBeLessThanOrEqual(treeClassOfFeet(high));
      }),
    );
  });
});

describe("classifyHeights", () => {
  it("reads the height from the red channel", () => {
    expect([...classifyHeights(heightsOf([0, 9, 10, 20, 35, 50, 70, 100, 255]))]).toEqual([
      -1, -1, 0, 1, 2, 3, 4, 5, 5,
    ]);
  });

  it("takes a transparent pixel for 'no data', whatever its colour says", () => {
    // The service's own "nothing here" is a grey of 253 that is fully transparent.
    const rgba = new Uint8ClampedArray([253, 253, 253, 0, 80, 80, 80, 255, 80, 80, 80, 0]);
    expect([...classifyHeights(rgba)]).toEqual([NO_TREE, 4, NO_TREE]);
  });

  it("ignores a ragged end", () => {
    expect(classifyHeights(new Uint8ClampedArray([50, 50, 50, 255, 1, 2]))).toHaveLength(1);
  });
});

describe("footprintsOfTile", () => {
  it("is empty for an empty tile and for a tile without buildings", () => {
    expect(footprintsOfTile(new Uint8Array(0))).toEqual([]);
    expect(footprintsOfTile(new ArrayBuffer(0))).toEqual([]);
    const roads = encodeBuildingTile([{ polygons: [[box(0, 0, 100, 100)]] }], "transportation");
    expect(footprintsOfTile(roads)).toEqual([]);
  });

  it("gives every footprint in units of the tile, courtyards after the outline", () => {
    const tile = encodeBuildingTile([
      { polygons: [[box(1024, 2048, 2048, 3072)]] },
      { polygons: [[box(0, 0, 400, 400), box(100, 100, 300, 300)]], height: 30 },
      // Not an area: a tile's stray line is no building.
      { polygons: [[box(0, 0, 50, 50)]], type: 2 },
    ]);
    const footprints = footprintsOfTile(tile);
    expect(footprints).toHaveLength(2);
    expect(footprints[0]).toHaveLength(1);
    const xs = Array.from(footprints[0][0]).filter((_, i) => i % 2 === 0);
    const ys = Array.from(footprints[0][0]).filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0.25, 0.5]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0.5, 0.75]);
    // The second has its courtyard.
    expect(footprints[1]).toHaveLength(2);
  });

  it("keeps the parts that lie in the tile's margin, outside 0..1", () => {
    const tile = encodeBuildingTile([{ polygons: [[box(-64, 4000, 100, 4160)]] }]);
    const [[ring]] = footprintsOfTile(tile);
    expect(Math.min(...Array.from(ring))).toBeLessThan(0);
    expect(Math.max(...Array.from(ring))).toBeGreaterThan(1);
  });
});

describe("frameInBuildingTile", () => {
  it("is the tile itself at the building tiles' own zoom", () => {
    expect(frameInBuildingTile({ z: 14, x: 2611, y: 5858 }, 512, 14)).toEqual({
      buildingTile: { z: 14, x: 2611, y: 5858 },
      scale: 512,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("finds the building tile around a deeper tile, and where the picture lies in it", () => {
    // 16/10444/23435: the third column and the fourth row of 14/2611/5858's sixteen.
    expect(frameInBuildingTile({ z: 16, x: 10444 + 2, y: 23432 + 3 }, 512, 14)).toEqual({
      buildingTile: { z: 14, x: 2611, y: 5858 },
      scale: 2048,
      offsetX: 1024,
      offsetY: 1536,
    });
  });

  it("maps a point of the building tile to the same spot whichever tile shows it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 14, max: 18 }),
        fc.integer({ min: 0, max: 2 ** 14 - 1 }),
        fc.integer({ min: 0, max: 2 ** 14 - 1 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (z, x14, y14, u, v) => {
          const across = 2 ** (z - 14);
          const tile = {
            z,
            x: x14 * across + Math.floor(u * across),
            y: y14 * across + Math.floor(v * across),
          };
          const frame = frameInBuildingTile(tile, 512, 14);
          expect(frame.buildingTile).toEqual({ z: 14, x: x14, y: y14 });
          const px = u * frame.scale - frame.offsetX;
          const py = v * frame.scale - frame.offsetY;
          expect(px).toBeGreaterThanOrEqual(-1e-6);
          expect(px).toBeLessThan(512 + 1e-6);
          expect(py).toBeGreaterThanOrEqual(-1e-6);
          expect(py).toBeLessThan(512 + 1e-6);
        },
      ),
    );
  });
});

describe("rasterizeFootprints", () => {
  it("marks the pixels whose centre is inside", () => {
    const mask = rasterizeFootprints([[square(1, 1, 4, 3)]], 6, PIXELS);
    expect(rows(mask, 6)).toEqual(["......", ".###..", ".###..", "......", "......", "......"]);
  });

  it("goes by pixel centres: half a pixel is not enough, a little more is", () => {
    expect(rows(rasterizeFootprints([[square(0.6, 0, 2.4, 1)]], 3, PIXELS), 3)[0]).toBe(".#.");
    expect(rows(rasterizeFootprints([[square(0.4, 0, 2.6, 1)]], 3, PIXELS), 3)[0]).toBe("###");
  });

  it("leaves a courtyard open", () => {
    const rings: FootprintRings = [square(0, 0, 5, 5), square(2, 2, 3, 3)];
    expect(rows(rasterizeFootprints([rings], 5, PIXELS), 5)).toEqual([
      "#####",
      "#####",
      "##.##",
      "#####",
      "#####",
    ]);
  });

  it("clips what reaches beyond the picture and skips what lies outside it", () => {
    const mask = rasterizeFootprints(
      [[square(-10, -10, 2, 2)], [square(3, 3, 99, 99)], [square(50, 50, 60, 60)]],
      4,
      PIXELS,
    );
    expect(rows(mask, 4)).toEqual(["##..", "##..", "....", "...#"]);
  });

  it("places footprints by the frame", () => {
    // Units of a building tile, shown in the south-east quarter tile one zoom deeper.
    const frame = { scale: 8, offsetX: 4, offsetY: 4 };
    const mask = rasterizeFootprints([[[0.5, 0.5, 0.75, 0.5, 0.75, 0.75, 0.5, 0.75]]], 4, frame);
    expect(rows(mask, 4)).toEqual(["##..", "##..", "....", "...."]);
  });

  it("handles any shape: a triangle", () => {
    const mask = rasterizeFootprints([[[0, 0, 6, 0, 0, 6]]], 6, PIXELS);
    expect(rows(mask, 6)).toEqual(["#####.", "####..", "###...", "##....", "#.....", "......"]);
  });

  it("marks nothing for no footprints, or a footprint with no area", () => {
    expect(rasterizeFootprints([], 4, PIXELS).some(Boolean)).toBe(false);
    expect(rasterizeFootprints([[[1, 1, 3, 1]]], 4, PIXELS).some(Boolean)).toBe(false);
  });
});

describe("growMask", () => {
  it("grows every marked area by the radius, and stops at the picture's edge", () => {
    const mask = new Uint8Array(25);
    mask[2 * 5 + 2] = 1;
    expect(rows(growMask(mask, 5, 1), 5)).toEqual([".....", ".###.", ".###.", ".###.", "....."]);
    expect(rows(growMask(mask, 5, 2), 5).every((line) => line === "#####")).toBe(true);
    const corner = new Uint8Array(25);
    corner[0] = 1;
    expect(rows(growMask(corner, 5, 1), 5).slice(0, 3)).toEqual(["##...", "##...", "....."]);
  });

  it("changes nothing for a radius below one", () => {
    const mask = Uint8Array.from([0, 1, 0, 0]);
    expect(growMask(mask, 2, 0)).toBe(mask);
  });
});

describe("footprintMarginPx", () => {
  it("is about 2.5 m on the ground at every zoom, and never less than a pixel", () => {
    expect(footprintMarginPx(16, 512)).toBe(3);
    expect(footprintMarginPx(15, 512)).toBe(2);
    expect(footprintMarginPx(14, 512)).toBe(1);
    expect(footprintMarginPx(12, 512)).toBe(1);
    // A picture of half the size has pixels twice as large.
    expect(footprintMarginPx(16, 256)).toBe(2);
  });
});

describe("despeckle", () => {
  const classesOf = (lines: string[]) =>
    Int8Array.from(lines.join("").split(""), (c) => (c === "." ? NO_TREE : Number(c)));

  it("removes single pixels and thin lines, keeps what has body", () => {
    expect(SPECK_MIN_NEIGHBOURS).toBe(6);
    const before = classesOf([
      ".........",
      ".2.......",
      ".........",
      "...1111..",
      "...1111..",
      "...1111..",
      ".........",
      "333333333",
      ".........",
    ]);
    // The lone pixel goes, and so does the one-pixel line (a wire); the block
    // keeps everything but its four corners.
    expect(classRows(despeckle(before, 9), 9)).toEqual([
      ".........",
      ".........",
      ".........",
      "....11...",
      "...1111..",
      "....11...",
      ".........",
      ".........",
      ".........",
    ]);
  });

  it("takes the picture to carry on beyond its edge as it ends there", () => {
    // A line along the rim may be the first row of a crown in the next tile: it stays.
    const before = classesOf(["....", "....", "....", "4444"]);
    expect(classRows(despeckle(before, 4), 4)).toEqual(["....", "....", "....", "4444"]);
  });

  it("keeps a crown that runs off the picture whole along the edge", () => {
    const before = classesOf(["22..", "22..", "22..", "22.."]);
    expect(classRows(despeckle(before, 4), 4)).toEqual(["22..", "22..", "22..", "22.."]);
  });

  it("never adds a tree, and never changes a class", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1, max: 5 }), { minLength: 36, maxLength: 36 }),
        (cells) => {
          const before = Int8Array.from(cells);
          const after = despeckle(Int8Array.from(cells), 6);
          after.forEach((value, i) => {
            expect(value === NO_TREE || value === before[i]).toBe(true);
          });
        },
      ),
    );
  });
});

describe("paintTrees", () => {
  it("gives each class its colour and leaves the rest fully transparent", () => {
    const classes = Int8Array.from([NO_TREE, 0, 5, 2]);
    expect([...paintTrees(classes, 2, PALETTE)]).toEqual([
      ...[0, 0, 0, 0],
      ...[10, 0, 0, 200],
      ...[60, 0, 0, 200],
      ...[30, 0, 0, 200],
    ]);
  });

  it("outlines the crowns when given an edge colour, but not along the picture's rim", () => {
    const edge = [255, 255, 255, 235] as const;
    const size = 5;
    const classes = new Int8Array(size * size).fill(1);
    // One pixel that is not a tree, in the middle.
    classes[2 * size + 2] = NO_TREE;
    const pixels = paintTrees(classes, size, { ...PALETTE, edge });
    const alphaRows = rows(
      Array.from({ length: size * size }, (_, i) => pixels[4 * i]),
      size,
      (red) => (red === 255 ? "E" : red === 0 ? "." : "t"),
    );
    // Its four neighbours are the edge; the rim of the picture is not one.
    expect(alphaRows).toEqual(["ttttt", "ttEtt", "tE.Et", "ttEtt", "ttttt"]);
  });

  it("paints the top class for anything above the palette's last colour", () => {
    const short: TreePalette = { fills: [PALETTE.fills[0], PALETTE.fills[1]], edge: null };
    expect([...paintTrees(Int8Array.from([5]), 1, short)]).toEqual([20, 0, 0, 200]);
  });
});

describe("renderTreePixels", () => {
  const size = 16;
  /** A 16 px picture of tile 14/x/y, all trees of 40 ft (class 2). */
  const allTrees = () => heightsOf(new Array<number>(size * size).fill(40));
  const TILE = { z: 14, x: 2611, y: 5858 };

  it("cuts the buildings out, grown by their margin", () => {
    // A building over the middle quarter of the tile: pixels 4..11.
    const buildings = encodeBuildingTile([{ polygons: [[box(1024, 1024, 3072, 3072)]] }]);
    const pixels = renderTreePixels({
      tile: TILE,
      heights: allTrees(),
      size,
      buildings,
      buildingZoom: 14,
      palette: PALETTE,
    });
    const drawn = rows(
      Array.from({ length: size * size }, (_, i) => pixels[4 * i + 3]),
      size,
    );
    // Pixels 4..11 are the building; one more on every side is its margin at zoom 14.
    const open = "###..........###";
    const full = "################";
    expect(drawn).toEqual([
      full,
      full,
      full,
      ...new Array<string>(10).fill(open),
      full,
      full,
      full,
    ]);
    // What is drawn is the class's colour.
    expect([...pixels.slice(0, 4)]).toEqual([30, 0, 0, 200]);
  });

  it("draws the trees as they are where there are no buildings", () => {
    const feet = new Array<number>(size * size).fill(0);
    for (let row = 2; row < 8; row++)
      for (let column = 2; column < 8; column++) feet[row * size + column] = 75;
    const pixels = renderTreePixels({
      tile: TILE,
      heights: heightsOf(feet),
      size,
      buildings: new ArrayBuffer(0),
      buildingZoom: 14,
      palette: PALETTE,
    });
    const reds = new Set<number>();
    for (let i = 0; i < size * size; i++) if (pixels[4 * i + 3]) reds.add(pixels[4 * i]);
    expect([...reds]).toEqual([50]);
    // 36 pixels, less the four corners that count as specks.
    expect(pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0)).toHaveLength(32);
  });

  it("is fully transparent where nothing is tall enough, or the survey has nothing", () => {
    for (const feet of [0, 9, -1]) {
      const pixels = renderTreePixels({
        tile: TILE,
        heights: heightsOf(new Array<number>(size * size).fill(feet)),
        size,
        // Not even looked at: there is nothing to cut out of.
        buildings: Uint8Array.from([1, 2, 3]),
        buildingZoom: 14,
        palette: PALETTE,
      });
      expect(pixels).toHaveLength(size * size * 4);
      expect(pixels.every((value) => value === 0)).toBe(true);
    }
  });

  it("refuses a picture that is not the size it is said to be", () => {
    expect(() =>
      renderTreePixels({
        tile: TILE,
        heights: new Uint8ClampedArray(12),
        size,
        buildings: new ArrayBuffer(0),
        buildingZoom: 14,
        palette: PALETTE,
      }),
    ).toThrow(RangeError);
  });
});
