import { describe, expect, it } from "vitest";
import { fovPreset, roofHeightM, viewConeSentence } from "./viewpoint";

describe("presets", () => {
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
