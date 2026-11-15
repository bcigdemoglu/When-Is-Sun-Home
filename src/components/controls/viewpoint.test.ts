import { describe, expect, it } from "vitest";
import { floorToHeightM } from "@/state";
import {
  floorName,
  formatMeters,
  fovPreset,
  roofHeightM,
  viewConeSentence,
  viewpointSummary,
} from "./viewpoint";

const base = { heightM: 1, facingDeg: 180, fovDeg: 180 };

describe("viewpointSummary", () => {
  it("summarises a yard by its height", () => {
    expect(viewpointSummary({ ...base, mode: "yard" })).toBe("Yard · ground");
    expect(viewpointSummary({ ...base, mode: "yard", heightM: 3 })).toBe("Yard · 3 m up");
    expect(viewpointSummary({ ...base, mode: "yard", heightM: 10.5 })).toBe("Yard · 10.5 m up");
  });

  it("summarises a window by floor and facing", () => {
    expect(viewpointSummary({ ...base, mode: "window", heightM: floorToHeightM(2) })).toBe(
      "Window · 2nd floor · S",
    );
    expect(
      viewpointSummary({ ...base, mode: "window", heightM: floorToHeightM(1), facingDeg: 315 }),
    ).toBe("Window · ground floor · NW");
  });
});

describe("names", () => {
  it("names floors the way a lift does", () => {
    expect(floorName(1)).toBe("Ground floor");
    expect(floorName(2)).toBe("2nd floor");
    expect(floorName(3)).toBe("3rd floor");
    expect(floorName(4)).toBe("4th floor");
    expect(floorName(11)).toBe("11th floor");
    expect(floorName(21)).toBe("21st floor");
  });

  it("formats metres", () => {
    expect(formatMeters(1)).toBe("1 m");
    expect(formatMeters(4.5)).toBe("4.5 m");
  });

  it("recognises field-of-view presets", () => {
    expect(fovPreset(90)).toBe("narrow");
    expect(fovPreset(180)).toBe("normal");
    expect(fovPreset(270)).toBe("wide");
    expect(fovPreset(140)).toBeNull();
  });

  it("puts the roof preset at eye level on the building under the pin", () => {
    expect(roofHeightM(null)).toBe(9);
    expect(roofHeightM(12.2)).toBe(13.5);
    expect(roofHeightM(1000)).toBe(300);
  });
});

describe("viewConeSentence", () => {
  it("says which part of the sky counts", () => {
    expect(viewConeSentence({ facingDeg: 180, fovDeg: 180 })).toBe(
      "The sun counts while it is between the east and the west.",
    );
    expect(viewConeSentence({ facingDeg: 0, fovDeg: 90 })).toBe(
      "The sun counts while it is between the north-west and the north-east.",
    );
  });

  it("handles the extremes", () => {
    expect(viewConeSentence({ facingDeg: 90, fovDeg: 360 })).toMatch(/wherever/);
    expect(viewConeSentence({ facingDeg: 90, fovDeg: 10 })).toBe(
      "The sun counts only when it is close to the east.",
    );
  });
});
