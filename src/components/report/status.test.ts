import { describe, expect, it } from "vitest";

import { SunState, type SunInstant } from "@/lib/types";

import { describeLiveStatus, type LiveStatusInput } from "./status";
import { syntheticDay } from "./testing";

// Sunrise 06:00, sunset 18:00; direct sun 09:10–12:40 and 15:00–16:40, shade otherwise.
const day = syntheticDay("2026-06-15", [
  [360, 550, SunState.Blocked],
  [550, 760, SunState.Sun],
  [760, 900, SunState.Blocked],
  [900, 1000, SunState.Sun],
  [1000, 1080, SunState.Blocked],
]);

const instant = (state: SunInstant["state"], blocker?: SunInstant["blocker"]): SunInstant => ({
  azimuthDeg: 180,
  altitudeDeg: state === SunState.Night ? -5 : 30,
  state,
  blocker,
});

const status = (overrides: Partial<LiveStatusInput>) =>
  describeLiveStatus({
    day,
    instant: instant(SunState.Sun),
    minuteOfDay: 600,
    isLive: true,
    hour12: true,
    maxChars: 60,
    ...overrides,
  });

describe("in sun", () => {
  it("says until when", () => {
    expect(status({ minuteOfDay: 600 })).toEqual({
      icon: "sun",
      text: "In sun now · until 12:40 PM",
    });
    expect(status({ minuteOfDay: 950 }).text).toBe("In sun now · until 4:40 PM");
  });

  it("spells out the time when it is not now", () => {
    expect(status({ minuteOfDay: 940, isLive: false }).text).toBe(
      "At 3:40 PM: in sun · until 4:40 PM",
    );
  });

  it("follows the 24-hour clock", () => {
    expect(status({ minuteOfDay: 940, isLive: false, hour12: false }).text).toBe(
      "At 15:40: in sun · until 16:40",
    );
  });

  it("knows a day without night", () => {
    const polarDay = syntheticDay("2026-06-21", [[0, 1440, SunState.Sun]]);
    expect(status({ day: polarDay, minuteOfDay: 720 }).text).toBe("In sun now · all day");
  });

  it("stays plain when the minute falls between the day's windows", () => {
    expect(status({ minuteOfDay: 800 }).text).toBe("In sun now");
  });
});

describe("in shade", () => {
  const building = { buildingIndex: 4, distanceM: 41.6, elevationDeg: 30 };

  it("names the building, its distance and when the sun returns", () => {
    expect(status({ instant: instant(SunState.Blocked, building), minuteOfDay: 800 })).toEqual({
      icon: "shade",
      text: "Shaded by a building 42 m away · sun returns 3:00 PM",
    });
  });

  it("drops the distance, then the building, as the line gets shorter", () => {
    const at = (maxChars: number) =>
      status({ instant: instant(SunState.Blocked, building), minuteOfDay: 800, maxChars }).text;
    expect(at(46)).toBe("Shaded by a building · sun returns at 3:00 PM");
    expect(at(42)).toBe("Shaded by a building · sun returns 3:00 PM");
    expect(at(36)).toBe("In shade · sun returns at 3:00 PM");
    expect(at(10)).toBe("In shade · sun returns 3:00 PM");
  });

  it("says so when the sun does not come back", () => {
    expect(status({ instant: instant(SunState.Blocked, building), minuteOfDay: 1040 }).text).toBe(
      "Shaded by a building 42 m away · no more sun today",
    );
    expect(
      status({ instant: instant(SunState.Blocked), minuteOfDay: 1040, isLive: false }).text,
    ).toBe("At 5:20 PM: shaded by a building · no more sun that day");
  });

  it("tells a hill from a building", () => {
    const hill = { kind: "terrain" as const, buildingIndex: -2, distanceM: 2400, elevationDeg: 12 };
    expect(status({ instant: instant(SunState.Blocked, hill), minuteOfDay: 400 })).toEqual({
      icon: "hill",
      text: "Behind a hill 2.4 km away · sun returns 9:10 AM",
    });
    // Older values carry only the index.
    const indexOnly = { buildingIndex: -2, distanceM: 0, elevationDeg: 12 };
    expect(status({ instant: instant(SunState.Blocked, indexOnly), minuteOfDay: 400 }).text).toBe(
      "Behind a hill · sun returns 9:10 AM",
    );
  });

  it("spells out the time when it is not now", () => {
    expect(
      status({
        instant: instant(SunState.Blocked, building),
        minuteOfDay: 510,
        isLive: false,
        maxChars: 46,
      }).text,
    ).toBe("At 8:30 AM: in shade · sun returns at 9:10 AM");
  });
});

describe("sun down", () => {
  it("gives the sunrise before dawn", () => {
    expect(status({ instant: instant(SunState.Night), minuteOfDay: 300 })).toEqual({
      icon: "night",
      text: "Sun is down · rises 6:00 AM",
    });
  });

  it("looks to the next morning after sunset", () => {
    expect(status({ instant: instant(SunState.Night), minuteOfDay: 1300 }).text).toBe(
      "Sun is down · up again around 6:00 AM",
    );
    expect(status({ instant: instant(SunState.Night), minuteOfDay: 1300, maxChars: 30 }).text).toBe(
      "Sun is down · rises tomorrow",
    );
    expect(
      status({ instant: instant(SunState.Night), minuteOfDay: 1380, isLive: false, maxChars: 46 })
        .text,
    ).toBe("At 11:00 PM: sun is down · rises the next day");
  });

  it("knows the polar night", () => {
    const polarNight = syntheticDay("2026-12-21", []);
    expect(
      status({ day: polarNight, instant: instant(SunState.Night), minuteOfDay: 720 }).text,
    ).toBe("Sun is down · it does not rise today");
    expect(
      status({ day: polarNight, instant: instant(SunState.Night), minuteOfDay: 720, isLive: false })
        .text,
    ).toBe("At 12:00 PM: sun is down · it does not rise that day");
  });
});

describe("window", () => {
  // The sun is in view 12:00–15:00 only.
  const windowDay = syntheticDay("2026-06-15", [
    [360, 720, SunState.OutOfView],
    [720, 900, SunState.Sun],
    [900, 1080, SunState.OutOfView],
  ]);

  it("says the sun is outside the view, and when it comes into it", () => {
    expect(
      status({ day: windowDay, instant: instant(SunState.OutOfView), minuteOfDay: 600 }),
    ).toEqual({ icon: "out", text: "Outside this window’s view · sun returns 12:00 PM" });
  });

  it("shortens to fit", () => {
    const at = (maxChars: number) =>
      status({ day: windowDay, instant: instant(SunState.OutOfView), minuteOfDay: 600, maxChars })
        .text;
    expect(at(44)).toBe("Outside the view · sun returns 12:00 PM");
    expect(at(30)).toBe("Outside this window’s view");
  });

  it("says when the sun will not come into view again", () => {
    expect(
      status({ day: windowDay, instant: instant(SunState.OutOfView), minuteOfDay: 1000 }).text,
    ).toBe("Outside this window’s view · no more sun today");
  });
});
