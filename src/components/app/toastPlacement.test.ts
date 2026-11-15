import { describe, expect, it } from "vitest";
import { toastPlacement, type SheetRest, type ToastPlacementInput } from "./toastPlacement";

const PEEK: SheetRest = { height: 168, detent: "peek", roomAbove: 548 };
const HALF: SheetRest = { height: 390, detent: "half", roomAbove: 326 };
const FULL: SheetRest = { height: 716, detent: "full", roomAbove: 0 };

function phone(partial: Partial<ToastPlacementInput> = {}): ToastPlacementInput {
  return {
    isDesktop: false,
    hasTimeBar: true,
    desktopClearance: 96,
    sheet: PEEK,
    hasFabs: true,
    ...partial,
  };
}

const ABOVE_TIME_BAR = "calc(64px + env(safe-area-inset-bottom, 0px) + 12px)";

describe("toastPlacement", () => {
  it("rests just above the sheet's top edge at peek, clear of the map buttons", () => {
    expect(toastPlacement(phone())).toEqual({
      bottom: "calc(64px + env(safe-area-inset-bottom, 0px) + 180px)",
      right: "calc(72px + env(safe-area-inset-right, 0px))",
      modalBottom: ABOVE_TIME_BAR,
    });
  });

  it("follows the sheet to half", () => {
    expect(toastPlacement(phone({ sheet: HALF })).bottom).toBe(
      "calc(64px + env(safe-area-inset-bottom, 0px) + 402px)",
    );
  });

  it("sits above the time bar, full width, when the sheet is at full", () => {
    expect(toastPlacement(phone({ sheet: FULL }))).toEqual({
      bottom: ABOVE_TIME_BAR,
      right: "16px",
      modalBottom: ABOVE_TIME_BAR,
    });
  });

  it("sits above the time bar when there is no room left above the sheet (a phone on its side)", () => {
    const cramped: SheetRest = { height: 200, detent: "half", roomAbove: 60 };
    expect(toastPlacement(phone({ sheet: cramped })).bottom).toBe(ABOVE_TIME_BAR);
  });

  it("sits above the time bar until the sheet has reported where it rests", () => {
    expect(toastPlacement(phone({ sheet: null })).bottom).toBe(ABOVE_TIME_BAR);
  });

  it("uses the full width above the start sheet, which has no map buttons and no time bar", () => {
    expect(toastPlacement(phone({ hasTimeBar: false, hasFabs: false, sheet: HALF }))).toEqual({
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 402px)",
      right: "16px",
      modalBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
    });
  });

  it("is always above the time bar inside a modal, wherever the sheet rests", () => {
    for (const sheet of [PEEK, HALF, FULL, null]) {
      expect(toastPlacement(phone({ sheet })).modalBottom).toBe(ABOVE_TIME_BAR);
    }
  });

  it("stays bottom-left of the map on desktop, above the floating time bar", () => {
    expect(toastPlacement(phone({ isDesktop: true }))).toEqual({
      bottom: "112px",
      right: "auto",
      modalBottom: "112px",
    });
    expect(toastPlacement(phone({ isDesktop: true, hasTimeBar: false })).bottom).toBe("16px");
  });
});
