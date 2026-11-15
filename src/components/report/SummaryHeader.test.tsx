// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SunState, type SunInstant } from "@/lib/types";

import { SunSummaryHeader } from "./SummaryHeader";
import { syntheticDay } from "./testing";
import type { SunSummaryHeaderProps } from "./types";

// Pin the clock style so expectations do not depend on the machine's locale.
vi.mock("./hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hooks")>()),
  useHour12: () => true,
}));

let measuredWidth = 358;

/** Every observed element measures `measuredWidth` wide. */
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: measuredWidth, height: 24 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

// Sunrise 06:00, sunset 18:00; direct sun 09:10–12:40 and 15:00–16:40.
const day = syntheticDay("2026-06-15", [
  [360, 550, SunState.Blocked],
  [550, 760, SunState.Sun],
  [760, 900, SunState.Blocked],
  [900, 1000, SunState.Sun],
  [1000, 1080, SunState.Blocked],
]);

const at = (state: SunInstant["state"], blocker?: SunInstant["blocker"]): SunInstant => ({
  azimuthDeg: 180,
  altitudeDeg: state === SunState.Night ? -5 : 30,
  state,
  blocker,
});

function props(overrides: Partial<SunSummaryHeaderProps> = {}): SunSummaryHeaderProps {
  return {
    date: "2026-06-15",
    minuteOfDay: 600,
    isLive: true,
    day,
    instant: at(SunState.Sun),
    year: null,
    buildingsStatus: "ready",
    ...overrides,
  };
}

beforeEach(() => {
  measuredWidth = 358;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SunSummaryHeader", () => {
  it("leads with the day's direct sun and says what the sun is doing now", () => {
    render(<SunSummaryHeader {...props()} />);
    expect(screen.getByText("5 h 10 m")).toBeTruthy();
    expect(screen.getByText("of direct sun")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();
    expect(screen.getByText("In sun now · until 12:40 PM")).toBeTruthy();
    // The state is an icon badge as well as words.
    expect(screen.getByTestId("status-sun").querySelector("svg")).toBeTruthy();
  });

  it("names the date and the time when it is not now", () => {
    render(<SunSummaryHeader {...props({ isLive: false })} />);
    expect(screen.getByText("on Mon, Jun 15")).toBeTruthy();
    expect(screen.queryByText("today")).toBeNull();
    expect(screen.getByText("At 10:00 AM: in sun · until 12:40 PM")).toBeTruthy();
  });

  it.each([
    [
      "shaded by a building",
      at(SunState.Blocked, { buildingIndex: 3, distanceM: 42, elevationDeg: 30 }),
      800,
      "status-shade",
      "Shaded by a building · sun returns 3:00 PM",
    ],
    [
      "behind a hill",
      at(SunState.Blocked, { kind: "terrain", buildingIndex: -2, distanceM: 900, elevationDeg: 9 }),
      400,
      "status-hill",
      "Behind a hill · sun returns at 9:10 AM",
    ],
    ["before sunrise", at(SunState.Night), 300, "status-night", "Sun is down · rises 6:00 AM"],
    [
      "after sunset",
      at(SunState.Night),
      1300,
      "status-night",
      "Sun is down · up again around 6:00 AM",
    ],
    [
      "outside a window's view",
      at(SunState.OutOfView),
      800,
      "status-out",
      "Outside the view · sun returns 3:00 PM",
    ],
  ] as const)("%s", (_name, instant, minuteOfDay, badge, text) => {
    render(<SunSummaryHeader {...props({ instant, minuteOfDay })} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByTestId(badge)).toBeTruthy();
  });

  it("uses the longer wording when there is room for it", () => {
    measuredWidth = 480;
    const building = { buildingIndex: 3, distanceM: 42, elevationDeg: 30 };
    render(
      <SunSummaryHeader
        {...props({ instant: at(SunState.Blocked, building), minuteOfDay: 800 })}
      />,
    );
    expect(screen.getByText("Shaded by a building 42 m away · sun returns 3:00 PM")).toBeTruthy();
  });

  it("marks the number as provisional while buildings are being checked", () => {
    const { container } = render(<SunSummaryHeader {...props({ buildingsStatus: "loading" })} />);
    expect(container.textContent).toContain("≈");
    expect(screen.getByText("5 h 10 m", { exact: false })).toBeTruthy();
    expect(screen.getByText("of direct sun before shading")).toBeTruthy();
    expect(screen.getByText("Checking nearby buildings…")).toBeTruthy();
    // No claim about sun or shade yet.
    expect(screen.queryByText(/In sun now/)).toBeNull();
    expect(screen.queryByTestId("status-sun")).toBeNull();
  });

  it("says so when building heights could not be loaded", () => {
    const { container } = render(<SunSummaryHeader {...props({ buildingsStatus: "error" })} />);
    expect(container.textContent).toContain("≈");
    expect(screen.getByText("Building heights unavailable")).toBeTruthy();
  });

  it("shows placeholders, never zeros, while the day is being analysed", () => {
    const { container } = render(<SunSummaryHeader {...props({ day: null, instant: null })} />);
    expect(screen.getAllByTestId("skeleton")).toHaveLength(2);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toMatch(/\d/);
    expect(screen.getByText("of direct sun")).toBeTruthy();
  });

  it("is the same height in every state, and takes a class name", () => {
    const heights = [
      props(),
      props({ isLive: false }),
      props({ buildingsStatus: "loading" }),
      props({ buildingsStatus: "error" }),
      props({ day: null, instant: null }),
      props({ instant: at(SunState.Night), minuteOfDay: 60 }),
    ].map((p) => {
      const { container } = render(<SunSummaryHeader {...p} className="px-4" />);
      const root = container.firstElementChild as HTMLElement;
      cleanup();
      return root.className;
    });
    for (const className of heights) {
      expect(className).toContain("h-[72px]");
      expect(className).toContain("px-4");
    }
  });
});
