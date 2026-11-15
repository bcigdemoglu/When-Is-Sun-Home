import { describe, expect, it } from "vitest";
import { floorToHeightM } from "@/state/selectors";
import { floorName, formatMeters, viewpointLabel } from "./viewpoint";

const base = { heightM: 1, facingDeg: 180, fovDeg: 180 };

describe("viewpointLabel", () => {
  it("describes a yard by its height, the thing its control sets", () => {
    expect(viewpointLabel({ ...base, mode: "yard" })).toBe("Yard · ground");
    expect(viewpointLabel({ ...base, mode: "yard", heightM: 1.5 })).toBe("Yard · ground");
    expect(viewpointLabel({ ...base, mode: "yard", heightM: 3 })).toBe("Yard · 3 m up");
    expect(viewpointLabel({ ...base, mode: "yard", heightM: 10.5 })).toBe("Yard · 10.5 m up");
  });

  it("describes a window by floor and facing", () => {
    expect(viewpointLabel({ ...base, mode: "window", heightM: floorToHeightM(2) })).toBe(
      "Window · 2nd floor · facing S",
    );
    expect(
      viewpointLabel({ ...base, mode: "window", heightM: floorToHeightM(1), facingDeg: 315 }),
    ).toBe("Window · ground floor · facing NW");
    expect(
      viewpointLabel({ ...base, mode: "window", heightM: floorToHeightM(11), facingDeg: 350 }),
    ).toBe("Window · 11th floor · facing N");
  });

  it("ignores the facing of a yard and the field of view of anything", () => {
    expect(viewpointLabel({ mode: "yard", heightM: 1, facingDeg: 90, fovDeg: 40 })).toBe(
      "Yard · ground",
    );
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
});
