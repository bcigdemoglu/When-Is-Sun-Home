// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SunState, type SunInstant } from "@/lib/types";

import { drawHeatmapBase } from "./heatmapCanvas";
import { SunReport } from "./SunReport";
import { syntheticDay, syntheticHorizon, syntheticYear, YARD } from "./testing";
import type { SunReportProps } from "./types";

// jsdom has no canvas: the drawing module is the one place that needs one.
vi.mock("./heatmapCanvas", () => ({
  createHeatmapBitmap: vi.fn(() => ({ cells: {}, outMask: null })),
  drawHeatmapBase: vi.fn(),
}));

// Pin the clock style so expectations do not depend on the machine's locale.
vi.mock("./hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hooks")>()),
  useHour12: () => true,
}));

/** Every observed element measures 560 × 320. */
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 560, height: 320 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

// A toy year: sun up 06:00–18:00 every day; a wall hides it from 15:00 on.
const wall = syntheticHorizon((azimuth) => (azimuth >= 225 ? 85 : 0));
const { grid, year } = syntheticYear({}, wall);

const sunny: SunInstant = { azimuthDeg: 165, altitudeDeg: 49, state: SunState.Sun };

function props(overrides: Partial<SunReportProps> = {}): SunReportProps {
  return {
    place: { lat: 40, lng: 0 },
    timeZone: "Etc/UTC",
    observer: YARD,
    date: "2026-06-15",
    minuteOfDay: 600,
    year,
    grid,
    day: syntheticDay("2026-06-15", [
      [360, 550, SunState.Blocked],
      [550, 760, SunState.Sun],
      [760, 900, SunState.Blocked],
      [900, 1000, SunState.Sun],
      [1000, 1080, SunState.Blocked],
    ]),
    horizon: wall,
    instant: sunny,
    buildings: {
      status: "ready",
      stats: { total: 384, tagged: 321, levels: 8, default: 55 },
      onRetry: vi.fn(),
    },
    pinOnBuilding: false,
    onSelectDateTime: vi.fn(),
    ...overrides,
  };
}

const loadingProps = () =>
  props({ year: null, grid: null, day: null, horizon: null, instant: null });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.mocked(drawHeatmapBase).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("while the analysis is loading", () => {
  it("shows skeletons instead of numbers", () => {
    const { container } = render(<SunReport {...loadingProps()} />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(8);
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(5);
    // Never a zero standing in for "not computed yet".
    expect(container.textContent).not.toMatch(/\b0(\.0)? ?h\b/);
    expect(container.textContent).not.toMatch(/\b0%/);
    expect(screen.queryByTestId("heatmap-canvas")).toBeNull();
    expect(drawHeatmapBase).not.toHaveBeenCalled();
  });

  it("keeps every section, its headings and its legends in place", () => {
    render(<SunReport {...loadingProps()} />);
    for (const title of [
      "Direct sun on this spot",
      "Selected day",
      "Sun through the year",
      "Direct sun, day by day",
      "Average day, month by month",
      "Skyline and sun paths",
      "About these numbers",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.getByText("Mon, Jun 15, 2026")).toBeTruthy();
    expect(screen.getByText("Shaded by buildings")).toBeTruthy();
    // Season names are known from the latitude alone.
    expect(screen.getByText("Summer")).toBeTruthy();
  });

  it("fills in once the analysis arrives", () => {
    const { rerender } = render(<SunReport {...loadingProps()} />);
    rerender(<SunReport {...props()} />);
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
    expect(screen.getByTestId("heatmap-canvas")).toBeTruthy();
  });
});

describe("headline", () => {
  it("leads with the average direct sun per day", () => {
    render(<SunReport {...props()} />);
    const card = within(
      screen.getByRole("heading", { name: "Direct sun on this spot" }).closest("section")!,
    );
    // 06:00–15:00 in sun, 15:00–18:00 behind the wall.
    expect(card.getByText("9.0")).toBeTruthy();
    expect(card.getByText("75%")).toBeTruthy();
    expect(card.getByText("25%")).toBeTruthy();
    expect(card.getByText("3,285 h")).toBeTruthy();
    expect(
      card.getByRole("img", {
        name: /Share of daylight hours: 75% of daylight in direct sun, 25% shaded by buildings/,
      }),
    ).toBeTruthy();
  });

  it("names the seasons for the hemisphere", () => {
    const seasonOf = (month: string) => {
      const row = screen.getAllByText(month).find((el) => el.closest("li"))!;
      return within(row.closest("li")!).getByText(/Spring|Summer|Autumn|Winter/).textContent;
    };
    render(<SunReport {...props()} />);
    expect(seasonOf("Dec")).toBe("Winter");
    expect(seasonOf("Jun")).toBe("Summer");
    cleanup();
    render(<SunReport {...props({ place: { lat: -33.87, lng: 151.21 } })} />);
    expect(seasonOf("Dec")).toBe("Summer");
    expect(seasonOf("Jun")).toBe("Winter");
  });

  it("lists out-of-view only for a window", () => {
    render(<SunReport {...props()} />);
    expect(screen.queryByText("Sun outside the view")).toBeNull();
    cleanup();
    render(
      <SunReport
        {...props({ observer: { mode: "window", heightM: 4, facingDeg: 90, fovDeg: 120 } })}
      />,
    );
    expect(screen.getByText("Sun outside the view")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Direct sun through this window" })).toBeTruthy();
  });
});

describe("building data states", () => {
  it("says the numbers assume an open sky while buildings load", () => {
    render(
      <SunReport {...props({ buildings: { status: "loading", stats: null, onRetry: vi.fn() } })} />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/loading surrounding buildings/i);
    expect(status.textContent).toMatch(/assume an open sky/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a prominent error with a working Retry button", () => {
    const onRetry = vi.fn();
    render(<SunReport {...props({ buildings: { status: "error", stats: null, onRetry } })} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(alert.textContent).toMatch(/ignore buildings/i);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reports how many buildings were used and where their heights came from", () => {
    render(<SunReport {...props()} />);
    expect(screen.getByRole("status").textContent).toMatch(/384 nearby buildings are included/);
    expect(
      screen.getByText(
        /384 buildings nearby — heights: 321 surveyed, 8 from floor counts, 55 estimated/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("notes that the pin's own building is ignored", () => {
    render(<SunReport {...props({ pinOnBuilding: true })} />);
    expect(screen.getByRole("status").textContent).toMatch(/that building itself is ignored/i);
  });
});

describe("selected day", () => {
  it("lists the sun windows as clock ranges with their length", () => {
    render(<SunReport {...props()} />);
    const list = screen.getByRole("region", { name: "Times of direct sun" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "9:10 AM – 12:40 PM3 h 30 m",
      "3:00 PM – 4:40 PM1 h 40 m",
    ]);
    // 310 minutes of sun out of 12 hours of daylight.
    expect(screen.getByText("5 h 10 m")).toBeTruthy();
    expect(screen.getByText(/out of 12 h of daylight \(43%\)/)).toBeTruthy();
  });

  it("says so when the day has no direct sun", () => {
    render(
      <SunReport
        {...props({ day: syntheticDay("2026-06-15", [[360, 1080, SunState.Blocked]]) })}
      />,
    );
    expect(screen.getByText(/No direct sun — the sun is up, but never reaches/)).toBeTruthy();
    cleanup();
    render(<SunReport {...props({ day: syntheticDay("2026-06-15", []) })} />);
    expect(screen.getByText(/the sun does not rise on this day/)).toBeTruthy();
  });

  it("describes the selected instant in plain language", () => {
    const blocked: SunInstant = {
      azimuthDeg: 240,
      altitudeDeg: 20,
      state: SunState.Blocked,
      blocker: { buildingIndex: 3, distanceM: 41.8, elevationDeg: 35 },
    };
    render(<SunReport {...props({ instant: blocked, minuteOfDay: 930 })} />);
    expect(screen.getByText("Shaded by a building 42 m away")).toBeTruthy();
    expect(screen.getByText("3:30 PM")).toBeTruthy();
  });

  it("exposes the timeline as a slider that selects a time", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    expect(slider.getAttribute("aria-valuenow")).toBe("600");
    expect(slider.getAttribute("aria-valuetext")).toBe("10:00 AM, In direct sun");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 605);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 540);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 1439);

    // The 560 px wide bar is inset by 7 px: 3/4 of the way along is 18:00.
    fireEvent.pointerDown(slider, { clientX: 7 + 546 * 0.75, button: 0, pointerId: 1 });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 1080);
  });
});

describe("year heat map", () => {
  const getChart = () =>
    screen.getByRole("group", { name: /heat map of direct sun through 2026/i });

  it("summarises itself for assistive technology", () => {
    render(<SunReport {...props()} />);
    const label = getChart().getAttribute("aria-label")!;
    expect(label).toMatch(/On average 9\.0 hours of direct sun per day/);
    expect(label).toMatch(/Arrow keys move the selection/);
    expect(getChart().tabIndex).toBe(0);
    expect(screen.getByText(/Selected Mon, Jun 15, 10:00 AM: In direct sun\./)).toBeTruthy();
  });

  it("moves the selection with the arrow keys", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const chart = getChart();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-16", 600);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-14", 600);
    fireEvent.keyDown(chart, { key: "ArrowDown" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 615);
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 585);
    expect(onSelectDateTime).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(chart, { key: "a" });
    fireEvent.keyDown(chart, { key: "ArrowRight", ctrlKey: true });
    expect(onSelectDateTime).toHaveBeenCalledTimes(4);
  });

  it("selects the date and time under a click, and shows them on hover", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    // Plot: 514 × 282 px showing 05:00–19:00 (the cropped range) in 30-minute slots.
    const x = ((100 + 0.5) / 365) * 514;
    const y = ((15 * 60 + 15 - 5 * 60) / (14 * 60)) * 282;
    fireEvent.pointerMove(hit, { clientX: x, clientY: y });
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/Sat, Apr 11 · 3:00 PM/);
    expect(tooltip.textContent).toMatch(/Shaded by a building/);
    expect(tooltip.textContent).toMatch(/9 h of direct sun that day/);
    fireEvent.click(hit, { clientX: x, clientY: y });
    expect(onSelectDateTime).toHaveBeenCalledWith("2026-04-11", 900);
    fireEvent.pointerLeave(hit);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("offers the monthly numbers as a table", () => {
    render(<SunReport {...props()} />);
    expect(screen.queryByRole("table", { name: /direct sun by month/i })).toBeNull();
    const toggle = screen.getByRole("button", { name: /monthly numbers as a table/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const table = screen.getByRole("table", { name: /direct sun by month in 2026/i });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(13);
    expect(
      within(rows[0])
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Month", "Sun, h/day", "Daylight, h/day", "Share", "First sun", "Last sun"]);
    expect(within(rows[1]).getByRole("rowheader").textContent).toBe("January");
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["9.0", "12.0", "75%", "6:00 AM", "3:00 PM"]);
    fireEvent.click(toggle);
    expect(screen.queryByRole("table", { name: /direct sun by month/i })).toBeNull();
  });

  it("paints the base once and leaves it alone while the time of day changes", () => {
    const { rerender } = render(<SunReport {...props()} />);
    expect(drawHeatmapBase).toHaveBeenCalledTimes(1);
    for (const minuteOfDay of [601, 660, 900, 1200]) {
      rerender(<SunReport {...props({ minuteOfDay })} />);
    }
    rerender(<SunReport {...props({ date: "2026-09-01" })} />);
    fireEvent.pointerMove(screen.getByTestId("heatmap-hit"), { clientX: 50, clientY: 50 });
    expect(drawHeatmapBase).toHaveBeenCalledTimes(1);

    // A new analysis is a new picture.
    rerender(<SunReport {...props({ year: syntheticYear({}, null).year })} />);
    expect(drawHeatmapBase).toHaveBeenCalledTimes(2);
  });

  it("notes when the clocks change", () => {
    const sf = syntheticYear({ timeZone: "America/Los_Angeles" }, wall);
    render(<SunReport {...props({ year: sf.year, grid: sf.grid })} />);
    expect(screen.getByText(/Clocks change on Mar 8 and Nov 1/)).toBeTruthy();
    cleanup();
    render(<SunReport {...props()} />);
    expect(screen.getByText(/Clocks do not change here/)).toBeTruthy();
  });
});

describe("other charts", () => {
  it("jumps to a month from its bar, keeping the day of the month", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime, date: "2026-03-31" })} />);
    const june = screen.getByRole("button", { name: /^June: 9\.0 hours of direct sun per day/ });
    expect(june.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /^March:/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(june);
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-30");
    fireEvent.click(screen.getByRole("button", { name: /^February:/ }));
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-02-28");
  });

  it("selects a day from the daily chart with the keyboard", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const chart = screen.getByRole("group", { name: /line chart of hours of direct sun/i });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-16");
    fireEvent.keyDown(chart, { key: "ArrowDown" });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);
  });

  it("describes the skyline and offers it as a table", () => {
    render(<SunReport {...props()} />);
    const panorama = screen.getByRole("img", { name: /skyline panorama/i });
    expect(panorama.getAttribute("aria-label")).toMatch(/W up to 85°/);
    const table = screen.getByRole("table", {
      name: /highest obstruction in each compass direction/i,
    });
    const west = within(table).getByRole("rowheader", { name: "W" }).closest("tr")!;
    expect(
      within(west)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["85°", "40 m"]);
    const east = within(table).getByRole("rowheader", { name: "E" }).closest("tr")!;
    expect(within(east).getAllByRole("cell")[0].textContent).toBe("Open");
    // The sun is up and in view: its dot is drawn.
    expect(screen.getByTestId("sun-dot")).toBeTruthy();
  });

  it("names hills wherever terrain is part of the skyline", () => {
    const ridge = syntheticHorizon(
      (azimuth) => (azimuth >= 225 ? 85 : 0),
      () => -2,
    );
    const { container } = render(<SunReport {...props({ horizon: ridge })} />);
    expect(screen.getAllByText("Shaded by buildings or hills").length).toBeGreaterThan(0);
    expect(screen.getByText("Hills")).toBeTruthy();
    expect(screen.getByText(/Hills are included\./)).toBeTruthy();
    expect(container.textContent).not.toMatch(/fences, hills/);
    // 15:15 on day 100: the sun stands behind the ridge.
    const hit = screen.getByTestId("heatmap-hit");
    fireEvent.pointerMove(hit, {
      clientX: ((100 + 0.5) / 365) * 514,
      clientY: ((15 * 60 + 15 - 5 * 60) / (14 * 60)) * 282,
    });
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/Shaded by a hill/);
  });

  it("draws an open horizon when there is no building data", () => {
    render(<SunReport {...props({ horizon: null })} />);
    expect(screen.getByText(/the horizon is drawn open/)).toBeTruthy();
    expect(
      screen.queryByRole("table", { name: /highest obstruction in each compass direction/i }),
    ).toBeNull();
  });
});
