import { describe, expect, it } from "vitest";
import {
  availableDetents,
  coveringAt,
  detentAt,
  detentOffsets,
  nextDetent,
  restingCorrection,
  sheetMetrics,
  visibleSheetHeight,
} from "./sheetGeometry";

// A 390×844 phone with a 64 px time bar: the scroller is 780 px tall.
const PHONE = sheetMetrics({ viewport: 780, header: 172, gap: 76, halfRatio: 0.5 });

describe("sheetMetrics", () => {
  it("takes the peek from the header and the half from the viewport", () => {
    expect(PHONE).toEqual({ viewport: 780, peek: 172, half: 390, gap: 76 });
  });

  it("opens taller when a minimum share of the screen is asked for", () => {
    const start = sheetMetrics({
      viewport: 780,
      header: 250,
      gap: 76,
      halfRatio: null,
      minPeekRatio: 0.42,
    });
    expect(start.peek).toBe(328);
    expect(start.half).toBe(start.peek);
  });

  it("drops the half stop when it would sit too close to peek or full", () => {
    const landscape = sheetMetrics({ viewport: 326, header: 172, gap: 76, halfRatio: 0.5 });
    expect(landscape.half).toBe(landscape.peek);
    expect(availableDetents(landscape)).toEqual(["peek", "full"]);
  });

  it("never lets the peek exceed the room there is", () => {
    const tiny = sheetMetrics({ viewport: 200, header: 400, gap: 60, halfRatio: 0.5 });
    expect(tiny.peek).toBe(140);
    expect(availableDetents(tiny)).toEqual(["peek"]);
    expect(detentOffsets(tiny)).toEqual({ peek: 0, half: 0, full: 0 });
  });
});

describe("detents", () => {
  it("places the stops in scroll space", () => {
    expect(detentOffsets(PHONE)).toEqual({ peek: 0, half: 218, full: 532 });
    expect(availableDetents(PHONE)).toEqual(["peek", "half", "full"]);
  });

  it("names the nearest stop, and full for everything beyond it", () => {
    expect(detentAt(0, PHONE)).toBe("peek");
    expect(detentAt(100, PHONE)).toBe("peek");
    expect(detentAt(120, PHONE)).toBe("half");
    expect(detentAt(218, PHONE)).toBe("half");
    expect(detentAt(400, PHONE)).toBe("full");
    expect(detentAt(532, PHONE)).toBe("full");
    expect(detentAt(5000, PHONE)).toBe("full");
  });

  it("cycles up and then back to peek", () => {
    expect(nextDetent("peek", PHONE)).toBe("half");
    expect(nextDetent("half", PHONE)).toBe("full");
    expect(nextDetent("full", PHONE)).toBe("peek");
    const noHalf = sheetMetrics({ viewport: 780, header: 300, gap: 76, halfRatio: null });
    expect(nextDetent("peek", noHalf)).toBe("full");
    expect(nextDetent("full", noHalf)).toBe("peek");
  });

  it("measures how much sheet is showing, capped at full", () => {
    expect(visibleSheetHeight(0, PHONE)).toBe(172);
    expect(visibleSheetHeight(218, PHONE)).toBe(390);
    expect(visibleSheetHeight(532, PHONE)).toBe(704);
    expect(visibleSheetHeight(3000, PHONE)).toBe(704);
    expect(visibleSheetHeight(-20, PHONE)).toBe(172);
  });
});

describe("coveringAt", () => {
  it("is true from halfway between half and full, so the top strip is solid in time", () => {
    // half at 218, full at 532.
    expect(coveringAt(0, PHONE)).toBe(false);
    expect(coveringAt(218, PHONE)).toBe(false);
    expect(coveringAt(374, PHONE)).toBe(false);
    expect(coveringAt(375, PHONE)).toBe(true);
    expect(coveringAt(532, PHONE)).toBe(true);
    expect(coveringAt(4000, PHONE)).toBe(true);
  });

  it("counts from peek when there is no half stop", () => {
    const start = sheetMetrics({ viewport: 780, header: 320, gap: 76, halfRatio: null });
    // full at 384.
    expect(coveringAt(191, start)).toBe(false);
    expect(coveringAt(192, start)).toBe(true);
  });

  it("is never true for a sheet that cannot rise", () => {
    const tiny = sheetMetrics({ viewport: 200, header: 400, gap: 60, halfRatio: 0.5 });
    expect(coveringAt(0, tiny)).toBe(false);
    expect(coveringAt(0, sheetMetrics({ viewport: 0, header: 0, gap: 76, halfRatio: 0.5 }))).toBe(
      false,
    );
  });
});

describe("restingCorrection", () => {
  it("leaves a sheet on a stop alone", () => {
    expect(restingCorrection(0, PHONE)).toBeNull();
    expect(restingCorrection(218, PHONE)).toBeNull();
    expect(restingCorrection(219.4, PHONE)).toBeNull();
    expect(restingCorrection(532, PHONE)).toBeNull();
  });

  it("sends a sheet between two stops to the nearest one", () => {
    expect(restingCorrection(60, PHONE)).toBe(0);
    expect(restingCorrection(150, PHONE)).toBe(218);
    expect(restingCorrection(300, PHONE)).toBe(218);
    expect(restingCorrection(400, PHONE)).toBe(532);
  });

  it("never touches the content once the sheet is at or beyond full", () => {
    expect(restingCorrection(531, PHONE)).toBeNull();
    expect(restingCorrection(700, PHONE)).toBeNull();
    expect(restingCorrection(9000, PHONE)).toBeNull();
  });

  it("has nothing to say before the sheet is measured", () => {
    expect(
      restingCorrection(40, sheetMetrics({ viewport: 0, header: 0, gap: 76, halfRatio: 0.5 })),
    ).toBeNull();
  });
});
