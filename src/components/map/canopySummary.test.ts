import { describe, expect, it } from "vitest";
import type { LatLng } from "@/lib/types";
import {
  HOUSE_LOT_MAX_SQ_FT,
  canopyCover,
  canopySides,
  circleMask,
  countCrowns,
  heightNear,
  lotCanopy,
  polygonMask,
} from "./canopySummary";
import { metresPerPixel, windowAround, type CanopyWindow } from "./canopyWindow";
import {
  GROUND_BUILDING,
  GROUND_NO_DATA,
  GROUND_OPEN,
  GROUND_TREE,
  type CanopyGrid,
} from "./treeTileJob";

const HOUSE = { lat: 45.5382208, lng: -122.6257477 };

/** The position of a point given in the window's pixels (fractional). */
function spotAt(window: CanopyWindow, x: number, y: number): LatLng {
  const across = 512 * 2 ** window.z;
  const lng = ((window.x0 + x) / across) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (window.y0 + y)) / across))) * 180) / Math.PI;
  return { lat, lng };
}

/** A rectangle in pixels, as lot rings. */
function rect(window: CanopyWindow, x0: number, y0: number, x1: number, y1: number): LatLng[][] {
  return [
    [
      spotAt(window, x0, y0),
      spotAt(window, x1, y0),
      spotAt(window, x1, y1),
      spotAt(window, x0, y1),
    ],
  ];
}

/**
 * A grid from a picture in characters, one per pixel: "." open ground,
 * " " no data, "t" a 15 ft tree, "T" a 40 ft tree, "H" an 80 ft tree, and
 * digits for buildings (the digit is the building's number).
 */
function gridOf(rows: string[]): CanopyGrid {
  const size = rows.length;
  const window = { ...windowAround(HOUSE, 16, size), size };
  const ground = new Uint8Array(size * size);
  const feet = new Uint8Array(size * size);
  const labels = new Int32Array(size * size);
  rows.forEach((row, y) => {
    expect(row.length).toBe(size);
    [...row].forEach((char, x) => {
      const i = y * size + x;
      if (char === " ") ground[i] = GROUND_NO_DATA;
      else if (char === ".") ground[i] = GROUND_OPEN;
      else if (/\d/.test(char)) {
        ground[i] = GROUND_BUILDING;
        labels[i] = Number(char);
      } else {
        ground[i] = GROUND_TREE;
        feet[i] = char === "t" ? 15 : char === "T" ? 40 : 80;
      }
    });
  });
  return { window, ground, feet, labels, cover: null };
}

const all = (grid: CanopyGrid) => new Uint8Array(grid.ground.length).fill(1);

describe("canopyCover", () => {
  it("is the share of the measured ground under canopy, buildings and gaps left out", () => {
    const grid = gridOf(["tT11", "..11", "H.  ", "...."]);
    const cover = canopyCover(grid, all(grid));
    // 10 measured pixels (16 − 4 building − 2 no data), 3 of them trees.
    expect(cover.cover).toBeCloseTo(3 / 10);
    expect(cover.tallestFt).toBe(80);
    expect(cover.heightShares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(cover.groundM2).toBeCloseTo(10 * metresPerPixel(grid.window) ** 2);
    expect(cover.surveyed).toBeCloseTo(14 / 16);
  });

  it("has nothing to say without measured ground", () => {
    const grid = gridOf(["11", "  "]);
    expect(canopyCover(grid, all(grid))).toMatchObject({
      cover: null,
      tallestFt: null,
      heightShares: null,
    });
  });
});

describe("masks", () => {
  it("cover a circle of the right area", () => {
    const window = windowAround(HOUSE, 16, 200);
    const mask = circleMask(window, HOUSE, 50);
    const pixels = mask.reduce((sum, value) => sum + value, 0);
    const area = pixels * metresPerPixel(window) ** 2;
    expect(area / (Math.PI * 50 * 50)).toBeCloseTo(1, 1);
  });

  it("cover a polygon's pixels", () => {
    const window = windowAround(HOUSE, 16, 10);
    const mask = polygonMask(window, rect(window, 2, 2, 6, 5));
    expect(mask.reduce((sum, value) => sum + value, 0)).toBe(12);
    expect(mask[3 * 10 + 3]).toBe(1);
    expect(mask[0]).toBe(0);
  });
});

describe("heightNear", () => {
  it("is the tallest canopy around a trunk; 0 for none; null without data", () => {
    const grid = gridOf([
      "........",
      "..T.....",
      "........",
      "........",
      "......H.",
      "........",
      "        ",
      "        ",
    ]);
    const metres = metresPerPixel(grid.window);
    expect(heightNear(grid, spotAt(grid.window, 2.5, 2.5), 1.5 * metres)).toBe(40);
    expect(heightNear(grid, spotAt(grid.window, 6.5, 4.5), 0.5 * metres)).toBe(80);
    expect(heightNear(grid, spotAt(grid.window, 4.5, 2.5), 0.5 * metres)).toBe(0);
    expect(heightNear(grid, spotAt(grid.window, 3.5, 7.5), 0.5 * metres)).toBeNull();
  });
});

describe("countCrowns", () => {
  it("counts separate tops, not every tall pixel", () => {
    // Two crowns far apart (each a plateau with a peak) and a low shrub that does not count.
    const rows = Array.from({ length: 16 }, () => ".".repeat(16).split(""));
    for (const [cx, cy] of [
      [3, 3],
      [12, 12],
    ]) {
      for (let y = cy - 2; y <= cy + 2; y++)
        for (let x = cx - 2; x <= cx + 2; x++) rows[y][x] = "T";
      rows[cy][cx] = "H";
    }
    rows[12][2] = "t";
    const grid = gridOf(rows.map((row) => row.join("")));
    expect(countCrowns(grid, all(grid))).toBe(2);
  });

  it("counts one crown for a flat-topped one", () => {
    const grid = gridOf(["......", ".TTT..", ".TTT..", ".TTT..", "......", "......"]);
    expect(countCrowns(grid, all(grid))).toBe(1);
  });
});

describe("canopySides", () => {
  it("says which side of an area its trees are on", () => {
    const grid = gridOf(["......", "......", "......", "......", "TTTTTT", "TTTTTT"]);
    const sides = canopySides(grid, all(grid));
    expect(sides[0].side).toBe("south");
    expect(sides[0].share).toBeGreaterThan(0.6);
  });
});

describe("lotCanopy", () => {
  // A 20 px lot (cols 2–17, rows 2–17), the street to the north (row 0),
  // the house in the front half, trees at the back.
  const picture = [
    "....................",
    "....................",
    "....................",
    "....11111111111.....",
    "....11111111111.....",
    "....11111111111.....",
    "....11111111111.....",
    "....11111111111.....",
    "....................",
    "....................",
    "..........22........",
    "..........22........",
    "..TTTT..............",
    "..TTTTH.............",
    "..TTTT..............",
    "....................",
    "...............TT...",
    "...............TT...",
    "....................",
    "....................",
  ];
  const grid = gridOf(picture);
  const lot = { rings: rect(grid.window, 2, 2, 18, 18), areaSqFt: 4950 };
  const street = spotAt(grid.window, 9.5, 0);

  it("measures the backyard: the lot behind the house, its buildings cut out", () => {
    const result = lotCanopy(grid, lot, street);
    expect(result.lot?.cover).toBeGreaterThan(0);
    expect(result.backyard.kind).toBe("ok");
    if (result.backyard.kind !== "ok") return;
    const { cover, crowns, sides, yardSqFt } = result.backyard;
    // Behind the house's middle (row 5.5): rows 6–17 of the lot, less the house and the garage.
    // Rows 6–7 hold 11 house pixels each; rows 10–11 two garage pixels each.
    const yardPixels = 12 * 16 - 2 * 11 - 4;
    expect(cover.groundM2 / metresPerPixel(grid.window) ** 2).toBeCloseTo(yardPixels);
    expect(cover.cover).toBeCloseTo(17 / yardPixels);
    expect(cover.tallestFt).toBe(80);
    expect(crowns).toBe(2);
    expect(sides[0].side).toBe("west");
    expect(yardSqFt).toBeGreaterThan(0);
  });

  it("is not available for a big lot, many buildings, no house or an unknown street", () => {
    expect(lotCanopy(grid, { ...lot, areaSqFt: HOUSE_LOT_MAX_SQ_FT + 1 }, street).backyard).toEqual(
      {
        kind: "unavailable",
        reason: "large-lot",
      },
    );
    expect(lotCanopy(grid, lot, null).backyard).toEqual({
      kind: "unavailable",
      reason: "no-street",
    });
    const empty = gridOf(picture.map((row) => row.replace(/\d/g, ".")));
    expect(lotCanopy(empty, lot, street).backyard).toEqual({
      kind: "unavailable",
      reason: "no-house",
    });
    const sheds = gridOf(
      picture.map((row, y) =>
        y >= 9 && y <= 12
          ? "..3333..4444..5555.."
          : y >= 14 && y <= 17
            ? "..6666.............."
            : row,
      ),
    );
    // The house and four more buildings of a size: not a house lot.
    expect(lotCanopy(sheds, lot, street).backyard).toEqual({
      kind: "unavailable",
      reason: "many-buildings",
    });
    // Still the whole lot's canopy.
    expect(lotCanopy(sheds, lot, street).lot?.cover).not.toBeNull();
  });

  it("is not available for a lot outside the window", () => {
    const far = { rings: rect(grid.window, 100, 100, 120, 120), areaSqFt: 4000 };
    expect(lotCanopy(grid, far, street)).toEqual({
      lot: null,
      backyard: { kind: "unavailable", reason: "outside" },
    });
  });
});
