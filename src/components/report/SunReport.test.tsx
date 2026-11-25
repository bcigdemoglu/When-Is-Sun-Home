// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderInDom, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SunState, type SunInstant } from "@/lib/types";

import { drawHeatmapBase } from "./heatmapCanvas";
import { SunSummaryHeader } from "./SummaryHeader";
import { REPORT_SECTIONS, SunReport, type ReportSection } from "./SunReport";
import { syntheticDay, syntheticHorizon, syntheticYear, YARD } from "./testing";
import type { SunReportProps } from "./types";

/** The report's Trees section asks through TanStack Query (lazily: nothing is fetched here). */
function render(ui: ReactElement) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderInDom(ui, { wrapper });
}

// jsdom has no canvas: the drawing module is the one place that needs one.
vi.mock("./heatmapCanvas", () => ({
  createHeatmapBitmap: vi.fn(() => ({ cells: {}, outMask: null })),
  drawHeatmapBase: vi.fn(() => true),
  releaseHeatmapBitmap: vi.fn(),
  releaseHeatmapScratch: vi.fn(),
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

/** The card (its <section>) with the given title. */
const card = (title: string | RegExp) =>
  screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

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
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(12);
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(6);
    // Never a zero standing in for "not computed yet".
    expect(container.textContent).not.toMatch(/\b0(\.0)? ?h\b/);
    expect(container.textContent).not.toMatch(/\b0%/);
    expect(container.textContent).not.toMatch(/\b0 m\b/);
    expect(screen.queryByTestId("heatmap-canvas")).toBeNull();
    expect(drawHeatmapBase).not.toHaveBeenCalled();
  });

  it("keeps every card, its title and its legends in place", () => {
    render(<SunReport {...loadingProps()} />);
    for (const title of [
      /Direct sun · average day/i,
      "Mon, Jun 15",
      "Seasons",
      "Through the year",
      "Sun hours",
      "What blocks the sun",
      "About these numbers",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.getByText("Shaded by buildings")).toBeTruthy();
    expect(screen.getByText("Best month")).toBeTruthy();
    // Season names are known from the latitude alone.
    expect(within(card("Seasons")).getByText("Summer")).toBeTruthy();
  });

  it("fills in once the analysis arrives", () => {
    const { rerender } = render(<SunReport {...loadingProps()} />);
    rerender(<SunReport {...props()} />);
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
    expect(screen.getByTestId("heatmap-canvas")).toBeTruthy();
  });
});

describe("section anchors", () => {
  it("exports the jump targets in reading order", () => {
    expect(REPORT_SECTIONS.map((section) => section.label)).toEqual([
      "Sun hours",
      "Today",
      "Year",
      "Skyline",
      "Trees",
      "About",
    ]);
    expect(new Set(REPORT_SECTIONS.map((section) => section.id)).size).toBe(6);
  });

  it("renders one section per id, in that order, loading or not", () => {
    for (const p of [props(), loadingProps()]) {
      const { container } = render(<SunReport {...p} />);
      const ids = [...container.querySelectorAll("section[id]")].map((el) => el.id);
      expect(ids).toEqual(REPORT_SECTIONS.map((section) => section.id));
      cleanup();
    }
  });
});

describe("section share slot", () => {
  const renderSectionShare = (section: ReportSection) => (
    <button type="button" data-testid="section-share">
      Share {section.slug}
    </button>
  );

  it("puts the shell's control right after every section's title, and only there", () => {
    const spy = vi.fn(renderSectionShare);
    const { container } = render(<SunReport {...props()} renderSectionShare={spy} />);
    expect(screen.getAllByTestId("section-share")).toHaveLength(REPORT_SECTIONS.length);
    for (const section of REPORT_SECTIONS) {
      const element = container.querySelector<HTMLElement>(`#${section.id}`)!;
      const heading = within(element).getAllByRole("heading", { level: 2 })[0];
      const control = within(element).getByRole("button", { name: `Share ${section.slug}` });
      // the next element after the <h2>, in the same title row
      expect(heading.nextElementSibling).toBe(control);
      expect(heading.closest("header")).toBe(control.closest("header"));
    }
    expect([...new Set(spy.mock.calls.map(([section]) => section.slug))].sort()).toEqual(
      REPORT_SECTIONS.map((section) => section.slug).sort(),
    );
    // cards that are not jump targets get none
    expect(within(card("Seasons")).queryByTestId("section-share")).toBeNull();
    expect(within(card(/Direct sun · average day/i)).queryByTestId("section-share")).toBeNull();
  });

  it("keeps the card's aside on the right of the row", () => {
    render(<SunReport {...props()} renderSectionShare={renderSectionShare} />);
    const header = screen.getByRole("button", { name: "Share sun-hours" }).closest("header")!;
    expect(within(header).getByRole("radiogroup", { name: "Show sun hours by" })).toBeTruthy();
    expect(header.lastElementChild).toContainElement(
      within(header).getByRole("radiogroup", { name: "Show sun hours by" }),
    );
  });

  it("renders nothing extra without one", () => {
    render(<SunReport {...props()} />);
    expect(screen.queryByTestId("section-share")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
  });
});

describe("hero", () => {
  const hero = () => within(card(/average day/i));

  it("leads with the average day, its share of daylight and a verdict", () => {
    render(<SunReport {...props()} />);
    // 06:00–15:00 in sun, 15:00–18:00 behind the wall.
    expect(hero().getByText("9.0")).toBeTruthy();
    expect(hero().getByText("75%")).toBeTruthy();
    expect(hero().getByText(/of possible daylight · 3,285 h a year/)).toBeTruthy();
    expect(
      hero().getByText(
        "A morning-sun spot: direct sun until about 3 PM most of the year, shade after.",
      ),
    ).toBeTruthy();
  });

  it("gives three figures to compare places by", () => {
    render(<SunReport {...props()} />);
    const tiles = hero()
      .getAllByRole("term")
      .map((dt) => dt.textContent);
    expect(tiles).toEqual(["Best month", "Least sun", "Jun 15"]);
    const values = hero()
      .getAllByRole("definition")
      .map((dd) => dd.textContent);
    expect(values).toEqual(["9.0 hJanuary", "9.0 hJanuary", "5 h 10 mdirect sun"]);
  });

  it("words the verdict for a window", () => {
    // Facing east, 90° wide: the sun is in view 06:00–09:00.
    const observer = { mode: "window", heightM: 4, facingDeg: 90, fovDeg: 90 } as const;
    const east = syntheticYear({}, null, observer);
    render(<SunReport {...props({ observer, year: east.year, grid: east.grid, horizon: null })} />);
    expect(
      screen.getByRole("heading", { name: /Sun through this window · average day/i }),
    ).toBeTruthy();
    expect(screen.getByText(/^A morning-sun window: direct sun until about 9 AM/)).toBeTruthy();
    expect(screen.getAllByText("Sun outside the view").length).toBeGreaterThan(0);
  });

  it("says when there is no direct sun at all", () => {
    const dark = syntheticYear(
      {},
      syntheticHorizon(() => 85),
    );
    render(<SunReport {...props({ year: dark.year, grid: dark.grid })} />);
    expect(hero().getByText("No direct sun at any time of year.")).toBeTruthy();
    expect(hero().getAllByText("no direct sun")).toHaveLength(2);
  });
});

describe("building data states", () => {
  it("quietly says what is included when all is well", () => {
    render(<SunReport {...props()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(
      "Estimate: includes shade from 384 nearby buildings, but not trees, fences or clouds.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the numbers as provisional while buildings load", () => {
    const { container } = render(
      <SunReport {...props({ buildings: { status: "loading", stats: null, onRetry: vi.fn() } })} />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Checking nearby buildings/);
    expect(status.textContent).toMatch(/assume an open sky/i);
    const hero = card(/average day/i);
    expect(hero.textContent).toContain("≈");
    expect(hero.textContent).toMatch(/before shading/);
    // No verdict and no comparison figures from unshaded numbers.
    expect(container.textContent).not.toMatch(/morning-sun spot/);
    expect(within(hero).getAllByTestId("skeleton").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a prominent error with a working Retry button", () => {
    const onRetry = vi.fn();
    render(<SunReport {...props({ buildings: { status: "error", stats: null, onRetry } })} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t load building heights/);
    expect(alert.textContent).toMatch(/without shading/);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("notes that the pin's own building is ignored", () => {
    render(<SunReport {...props({ pinOnBuilding: true })} />);
    expect(screen.getByRole("status").textContent).toMatch(/that building itself is ignored/i);
  });

  it("mentions the hills when terrain is ready", () => {
    render(<SunReport {...props({ terrain: "ready" })} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Estimate: includes shade from 384 nearby buildings and the hills around, but not trees, fences or clouds.",
    );
  });
});

describe("selected day", () => {
  const today = () => within(card("Mon, Jun 15"));

  it("gives the day's direct sun as its value line", () => {
    render(<SunReport {...props()} />);
    // Once as the value line, once as the total of the "Direct sun" row.
    expect(today().getAllByText("5 h 10 m")).toHaveLength(2);
    // 310 minutes of sun out of 12 hours of daylight.
    expect(today().getByText("43% of the day’s 12 h of daylight")).toBeTruthy();
  });

  it("lists each state with its clock ranges: the legend is the timetable", () => {
    render(<SunReport {...props()} />);
    const rows = within(today().getByRole("list", { name: "Times of each state" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "Direct sun 9:10 AM – 12:40 PM, 3:00 PM – 4:40 PM5 h 10 m",
      "Shaded by buildings 6:00 AM – 9:10 AM, 12:40 PM – 3:00 PM, 4:40 PM – 6:00 PM6 h 50 m",
      "Night until 6:00 AM, from 6:00 PM",
    ]);
  });

  it("says so when the day has no direct sun", () => {
    render(
      <SunReport
        {...props({ day: syntheticDay("2026-06-15", [[360, 1080, SunState.Blocked]]) })}
      />,
    );
    expect(today().getByText("none on this day")).toBeTruthy();
    cleanup();
    render(<SunReport {...props({ day: syntheticDay("2026-06-15", []) })} />);
    expect(today().getByText("The sun does not rise on this day")).toBeTruthy();
  });

  it("exposes the day bar as a slider that selects a time", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    expect(slider.getAttribute("aria-valuenow")).toBe("600");
    expect(slider.getAttribute("aria-valuetext")).toBe("10:00 AM, In direct sun");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 605, "today");
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 540, "today");
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 1439, "today");

    // The bar is 560 px wide: 3/4 of the way along is 18:00.
    // A mouse sets the time as soon as it presses, and keeps setting it while it drags.
    fireEvent.pointerDown(slider, { clientX: 420, button: 0, pointerId: 1, pointerType: "mouse" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 1080, "today");
    fireEvent.pointerMove(slider, { clientX: 280, pointerId: 1, pointerType: "mouse" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 720, "today");
    fireEvent.pointerUp(slider, { clientX: 280, pointerId: 1, pointerType: "mouse" });
    const calls = onSelectDateTime.mock.calls.length;
    fireEvent.pointerMove(slider, { clientX: 100, pointerId: 1, pointerType: "mouse" });
    expect(onSelectDateTime).toHaveBeenCalledTimes(calls);
  });

  it("turns the value line into the reading under the finger", () => {
    render(<SunReport {...props()} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    // 13:20 is in the shade between the two sunny spells.
    fireEvent.pointerDown(slider, {
      clientX: (800 / 1440) * 560,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(today().getByText("1:20 PM")).toBeTruthy();
    expect(today().getByText("Shaded by a building")).toBeTruthy();
    // Only the legend row still shows the day's total.
    expect(today().getAllByText("5 h 10 m")).toHaveLength(1);
    fireEvent.pointerUp(slider, { pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerLeave(slider, { pointerType: "mouse" });
    expect(today().getAllByText("5 h 10 m")).toHaveLength(2);
  });
});

describe("one day, one total", () => {
  // The toy year's grid says 9 h for every day; the selected day's own
  // (1-minute) analysis says 5 h 10 m. A real pair differs by a few minutes.
  const heroDayTile = () => within(card(/average day/i)).getAllByRole("definition")[2].textContent;
  const todayValue = () => card("Mon, Jun 15").querySelector("p")?.textContent;
  const heatmapTotal = () => screen.getByTestId("heatmap-day-total").textContent;
  const daysValue = () => card("Sun hours").querySelector("p")?.textContent;

  it("shows the selected day's precise total in every card", () => {
    render(
      <>
        <div data-testid="header">
          <SunSummaryHeader
            date="2026-06-15"
            minuteOfDay={600}
            isLive
            day={props().day}
            instant={sunny}
            year={year}
            buildingsStatus="ready"
          />
        </div>
        <SunReport {...props()} />
      </>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    expect(screen.getByTestId("header").textContent).toMatch(/^5 h 10 mof direct sun/);
    expect(heroDayTile()).toBe("5 h 10 mdirect sun");
    expect(todayValue()).toBe("5 h 10 m of direct sun");
    expect(heatmapTotal()).toBe("5 h 10 m of direct sun that day");
    expect(daysValue()).toBe("5 h 10 m on Mon, Jun 15");
    expect(screen.getByText(/Selected Mon, Jun 15, 10:00 AM/).textContent).toMatch(
      /5 h 10 m of direct sun that day\.$/,
    );
  });

  it("keeps the grid's figure for any other day that is previewed", () => {
    render(<SunReport {...props()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    // Hover another day on the heat map and on the days line.
    fireEvent.pointerMove(screen.getByTestId("heatmap-hit"), { clientX: 141, clientY: 100 });
    expect(heatmapTotal()).toBe("9 h of direct sun that day");
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/9 h of direct sun that day/);
    fireEvent.pointerLeave(screen.getByTestId("heatmap-hit"));
    fireEvent.pointerMove(screen.getByTestId("daily-hit"), { clientX: 0 });
    expect(daysValue()).toBe("9 h on Thu, Jan 1");
    fireEvent.pointerLeave(screen.getByTestId("daily-hit"));
    // Hovering the selected day itself still reads the precise figure.
    const selectedX = ((165 + 0.5) / 365) * 515;
    fireEvent.pointerMove(screen.getByTestId("heatmap-hit"), { clientX: selectedX, clientY: 100 });
    expect(heatmapTotal()).toBe("5 h 10 m of direct sun that day");
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/5 h 10 m of direct sun/);
  });

  it("reads the grid everywhere while the day analysis is still for another date", () => {
    // The date has moved on to 16 June; `day` is still the analysis of the 15th.
    render(
      <>
        <div data-testid="header">
          <SunSummaryHeader
            date="2026-06-16"
            minuteOfDay={600}
            isLive={false}
            day={props().day}
            instant={sunny}
            year={year}
            buildingsStatus="ready"
          />
        </div>
        <SunReport {...props({ date: "2026-06-16" })} />
      </>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    expect(screen.getByTestId("header").textContent).toMatch(/^9 hof direct sun/);
    expect(heroDayTile()).toBe("9 hdirect sun");
    expect(card("Tue, Jun 16").querySelector("p")?.textContent).toBe("9 h of direct sun");
    expect(heatmapTotal()).toBe("9 h of direct sun that day");
    expect(card("Sun hours").querySelector("p")?.textContent).toBe("9 h on Tue, Jun 16");
  });
});

describe("seasons", () => {
  const seasonOf = (month: string) => {
    const tile = within(card("Seasons"))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(month))!;
    return within(tile).getByText(/^(Spring|Summer|Autumn|Winter)$/).textContent;
  };

  it("names the seasons for the hemisphere", () => {
    render(<SunReport {...props()} />);
    expect(seasonOf("December")).toBe("Winter");
    expect(seasonOf("June")).toBe("Summer");
    cleanup();
    render(<SunReport {...props({ place: { lat: -33.87, lng: 151.21 } })} />);
    expect(seasonOf("December")).toBe("Summer");
    expect(seasonOf("June")).toBe("Winter");
  });

  it("gives each season its hours and typical times", () => {
    render(<SunReport {...props()} />);
    const tiles = within(card("Seasons")).getAllByRole("listitem");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.textContent).toMatch(/9\.0 h \/ day/);
      expect(tile.textContent).toMatch(/6:00 AM – 3:00 PM/);
      expect(within(tile).getByRole("img", { name: /^Typical \w+ day$/ })).toBeTruthy();
    }
  });
});

describe("year heat map", () => {
  const getChart = () =>
    screen.getByRole("group", { name: /heat map of direct sun through 2026/i });
  // Plot: 515 × 278 px showing 05:00–19:00 (the cropped range) in 30-minute slots.
  const cellPoint = (dayIndex: number, minute: number) => ({
    clientX: ((dayIndex + 0.5) / 365) * 515,
    clientY: ((minute - 5 * 60) / (14 * 60)) * 278,
  });

  it("summarises itself for assistive technology", () => {
    render(<SunReport {...props()} />);
    const label = getChart().getAttribute("aria-label")!;
    expect(label).toMatch(/On average 9\.0 hours of direct sun per day/);
    expect(label).toMatch(/Arrow keys move the selection/);
    expect(getChart().tabIndex).toBe(0);
    expect(screen.getByText(/Selected Mon, Jun 15, 10:00 AM: In direct sun\./)).toBeTruthy();
  });

  it("reads out the selection on its value line", () => {
    render(<SunReport {...props()} />);
    const year = within(card("Through the year"));
    expect(year.getByText("Mon, Jun 15 · 10:00 AM")).toBeTruthy();
    expect(year.getByTestId("heatmap-readout").textContent).toBe("In direct sun");
    // The selected day's total is the day analysis's own figure, as on every other card.
    expect(year.getByTestId("heatmap-day-total").textContent).toBe(
      "5 h 10 m of direct sun that day",
    );
  });

  it("moves the selection with the arrow keys", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const chart = getChart();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-16", 600, "heatmap");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-14", 600, "heatmap");
    fireEvent.keyDown(chart, { key: "ArrowDown" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 615, "heatmap");
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 585, "heatmap");
    expect(onSelectDateTime).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(chart, { key: "a" });
    fireEvent.keyDown(chart, { key: "ArrowRight", ctrlKey: true });
    expect(onSelectDateTime).toHaveBeenCalledTimes(4);
  });

  it("reads the cell under the pointer, and selects it on a click", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    const point = cellPoint(100, 15 * 60 + 15);
    fireEvent.pointerMove(hit, point);
    // The value line is the reading…
    const year = within(card("Through the year"));
    expect(year.getAllByText("Sat, Apr 11 · 3:00 PM")[0].tagName).toBe("P");
    expect(year.getByTestId("heatmap-readout").textContent).toBe("Shaded by a building");
    expect(year.getByTestId("heatmap-day-total").textContent).toBe("9 h of direct sun that day");
    // …and with a mouse it also floats beside the pointer.
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.textContent).toMatch(/Sat, Apr 11 · 3:00 PM/);
    expect(tooltip.textContent).toMatch(/9 h of direct sun that day/);
    expect(onSelectDateTime).not.toHaveBeenCalled();
    fireEvent.pointerDown(hit, { ...point, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(hit, { ...point, button: 0, pointerType: "mouse" });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);
    expect(onSelectDateTime).toHaveBeenCalledWith("2026-04-11", 900, "heatmap");
    fireEvent.pointerLeave(hit);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    expect(year.getByText("Mon, Jun 15 · 10:00 AM")).toBeTruthy();
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
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(rows[1]).getByRole("rowheader", { name: "January" })).toBeTruthy();
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

describe("touch: reading is not choosing", () => {
  const finger = { pointerType: "touch", pointerId: 7 };
  // Heat-map plot: 515 × 278 px showing 05:00–19:00 in 30-minute slots.
  const cell = (dayIndex: number, minute: number) => ({
    clientX: ((dayIndex + 0.5) / 365) * 515,
    clientY: ((minute - 5 * 60) / (14 * 60)) * 278,
  });
  const yearValue = () => card("Through the year").querySelector("p")?.textContent;

  it("a tap on the heat map selects that cell, once, on release", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    const point = cell(100, 15 * 60 + 15);
    fireEvent.pointerDown(hit, { ...point, ...finger });
    // Not yet: the finger may be about to scroll the page.
    expect(onSelectDateTime).not.toHaveBeenCalled();
    expect(yearValue()).toBe("Mon, Jun 15 · 10:00 AM");
    fireEvent.pointerUp(hit, { ...point, ...finger });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);
    expect(onSelectDateTime).toHaveBeenCalledWith("2026-04-11", 900, "heatmap");
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("a sideways scrub on the heat map previews on the value line and selects nothing", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    const start = cell(100, 15 * 60 + 15);
    fireEvent.pointerDown(hit, { ...start, ...finger });
    fireEvent.pointerMove(hit, { ...cell(130, 15 * 60 + 15), ...finger });
    expect(yearValue()).toBe("Mon, May 11 · 3:00 PM");
    fireEvent.pointerMove(hit, { ...cell(200, 9 * 60 + 15), ...finger });
    expect(yearValue()).toBe("Mon, Jul 20 · 9:00 AM");
    // Under a finger the value line is the tooltip: nothing floats.
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    fireEvent.pointerUp(hit, { ...cell(200, 9 * 60 + 15), ...finger });
    expect(onSelectDateTime).not.toHaveBeenCalled();
    // The preview is gone; the value line is back on the selection.
    expect(yearValue()).toBe("Mon, Jun 15 · 10:00 AM");
  });

  it("a vertical move that starts on the heat map is the page scrolling: nothing happens", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    const start = cell(100, 9 * 60);
    fireEvent.pointerDown(hit, { ...start, ...finger });
    fireEvent.pointerMove(hit, {
      clientX: start.clientX + 2,
      clientY: start.clientY + 30,
      ...finger,
    });
    fireEvent.pointerMove(hit, {
      clientX: start.clientX + 40,
      clientY: start.clientY + 120,
      ...finger,
    });
    expect(yearValue()).toBe("Mon, Jun 15 · 10:00 AM");
    // The browser takes the gesture over and cancels the pointer.
    fireEvent.pointerCancel(hit, finger);
    fireEvent.pointerUp(hit, { ...start, ...finger });
    expect(onSelectDateTime).not.toHaveBeenCalled();
    expect(yearValue()).toBe("Mon, Jun 15 · 10:00 AM");
  });

  it("a cancelled scrub discards its preview and selects nothing", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const hit = screen.getByTestId("heatmap-hit");
    fireEvent.pointerDown(hit, { ...cell(100, 9 * 60), ...finger });
    fireEvent.pointerMove(hit, { ...cell(140, 9 * 60), ...finger });
    expect(yearValue()).not.toBe("Mon, Jun 15 · 10:00 AM");
    fireEvent.pointerCancel(hit, finger);
    expect(yearValue()).toBe("Mon, Jun 15 · 10:00 AM");
    expect(onSelectDateTime).not.toHaveBeenCalled();
  });

  it("the day bar ignores a press and a vertical move", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    fireEvent.pointerDown(slider, { clientX: 420, clientY: 20, ...finger });
    fireEvent.pointerMove(slider, { clientX: 423, clientY: 60, ...finger });
    fireEvent.pointerCancel(slider, finger);
    expect(onSelectDateTime).not.toHaveBeenCalled();
    expect(within(card("Mon, Jun 15")).getAllByText("5 h 10 m")).toHaveLength(2);
  });

  it("a tap on the day bar sets the time on release", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    fireEvent.pointerDown(slider, { clientX: 420, clientY: 20, ...finger });
    expect(onSelectDateTime).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { clientX: 420, clientY: 20, ...finger });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);
    expect(onSelectDateTime).toHaveBeenCalledWith("2026-06-15", 1080, "today");
  });

  it("dragging the needle sideways sets the time continuously", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    const slider = screen.getByRole("slider", { name: /time of day/i });
    fireEvent.pointerDown(slider, { clientX: 280, clientY: 20, ...finger });
    fireEvent.pointerMove(slider, { clientX: 284, clientY: 21, ...finger }); // still within the slop
    expect(onSelectDateTime).not.toHaveBeenCalled();
    fireEvent.pointerMove(slider, { clientX: 350, clientY: 22, ...finger });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 900, "today");
    // The value line reads the time under the finger while it drags.
    expect(within(card("Mon, Jun 15")).getByText("3:00 PM")).toBeTruthy();
    fireEvent.pointerMove(slider, { clientX: 420, clientY: 30, ...finger });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-15", 1080, "today");
    fireEvent.pointerUp(slider, { clientX: 420, clientY: 30, ...finger });
    expect(onSelectDateTime).toHaveBeenCalledTimes(2);
    expect(within(card("Mon, Jun 15")).queryByText("6:00 PM")).toBeNull();
  });

  it("the days line previews under a scrub and selects on a tap", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    const sunHours = within(card("Sun hours"));
    const hit = screen.getByTestId("daily-hit");
    hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 365, height: 100 }) as DOMRect;
    // Scroll: nothing.
    fireEvent.pointerDown(hit, { clientX: 10.5, clientY: 10, ...finger });
    fireEvent.pointerMove(hit, { clientX: 11, clientY: 60, ...finger });
    fireEvent.pointerCancel(hit, finger);
    expect(sunHours.getByText("on Mon, Jun 15")).toBeTruthy();
    // Scrub: preview only.
    fireEvent.pointerDown(hit, { clientX: 10.5, clientY: 10, ...finger });
    fireEvent.pointerMove(hit, { clientX: 40.5, clientY: 12, ...finger });
    expect(sunHours.getByText("on Tue, Feb 10")).toBeTruthy();
    fireEvent.pointerUp(hit, { clientX: 40.5, clientY: 12, ...finger });
    expect(sunHours.getByText("on Mon, Jun 15")).toBeTruthy();
    expect(onSelectDateTime).not.toHaveBeenCalled();
    // Tap: select.
    fireEvent.pointerDown(hit, { clientX: 31.5, clientY: 10, ...finger });
    fireEvent.pointerUp(hit, { clientX: 31.5, clientY: 10, ...finger });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);
    expect(onSelectDateTime).toHaveBeenCalledWith("2026-02-01", undefined, "days");
  });

  it("a finger passing over the month bars does not change the reading", () => {
    render(<SunReport {...props()} />);
    const sunHours = within(card("Sun hours"));
    fireEvent.pointerEnter(screen.getByRole("button", { name: /^October:/ }), finger);
    expect(sunHours.getByText("a day in June")).toBeTruthy();
    fireEvent.pointerEnter(screen.getByRole("button", { name: /^October:/ }), {
      pointerType: "mouse",
    });
    expect(sunHours.getByText("a day in October")).toBeTruthy();
  });

  it("keeps vertical panning with the browser on every chart", () => {
    render(<SunReport {...props()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    expect(screen.getByTestId("heatmap-hit").className).toContain("touch-pan-y");
    expect(screen.getByRole("slider", { name: /time of day/i }).className).toContain("touch-pan-y");
    expect(
      screen.getByRole("group", { name: /line chart of hours of direct sun/i }).className,
    ).toContain("touch-pan-y");
    const scroller = screen.getByTestId("skyline-scroller").className;
    expect(scroller).toContain("touch-pan-x");
    expect(scroller).toContain("touch-pan-y");
    fireEvent.click(screen.getByRole("radio", { name: "Months" }));
    expect(
      screen.getByRole("group", { name: /Average hours of direct sun per day in each month/ })
        .className,
    ).toContain("touch-pan-y");
  });
});

describe("sun hours", () => {
  const sunHours = () => within(card("Sun hours"));

  it("opens on the months, with the selected month on the value line", () => {
    render(<SunReport {...props()} />);
    expect((screen.getByRole("radio", { name: "Months" }) as HTMLInputElement).checked).toBe(true);
    expect(sunHours().getAllByRole("button", { name: /hours of direct sun per day/ })).toHaveLength(
      12,
    );
    expect(sunHours().getByText("a day in June")).toBeTruthy();
    expect(sunHours().getByText("75% of 12.0 h daylight · 6:00 AM – 3:00 PM")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /line chart of hours of direct sun/i })).toBeNull();
  });

  it("jumps to a month from its bar, keeping the day of the month", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime, date: "2026-03-31" })} />);
    const june = screen.getByRole("button", { name: /^June: 9\.0 hours of direct sun per day/ });
    expect(june.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /^March:/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(june);
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-30", undefined, "months");
    fireEvent.click(screen.getByRole("button", { name: /^February:/ }));
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-02-28", undefined, "months");
  });

  it("puts a focused month on the value line", () => {
    render(<SunReport {...props()} />);
    fireEvent.focus(screen.getByRole("button", { name: /^October:/ }));
    expect(sunHours().getByText("a day in October")).toBeTruthy();
    fireEvent.blur(screen.getByRole("button", { name: /^October:/ }));
    expect(sunHours().getByText("a day in June")).toBeTruthy();
  });

  it("switches to the days of the year and back", () => {
    const onSelectDateTime = vi.fn();
    render(<SunReport {...props({ onSelectDateTime })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Days" }));
    expect(
      sunHours().queryAllByRole("button", { name: /hours of direct sun per day/ }),
    ).toHaveLength(0);
    const chart = screen.getByRole("group", { name: /line chart of hours of direct sun/i });
    expect(sunHours().getByText("5 h 10 m")).toBeTruthy();
    expect(sunHours().getByText("on Mon, Jun 15")).toBeTruthy();
    expect(sunHours().getByText("43% of 12 h of daylight")).toBeTruthy();
    expect(sunHours().getByText(/on every day of the year/)).toBeTruthy();

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-06-16", undefined, "days");
    fireEvent.keyDown(chart, { key: "ArrowDown" });
    expect(onSelectDateTime).toHaveBeenCalledTimes(1);

    // Hovering a day puts it on the value line; clicking selects it.
    const hit = screen.getByTestId("daily-hit");
    fireEvent.pointerMove(hit, { clientX: 0 });
    expect(sunHours().getByText("on Thu, Jan 1")).toBeTruthy();
    fireEvent.pointerDown(hit, { clientX: 0, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(hit, { clientX: 0, button: 0, pointerType: "mouse" });
    expect(onSelectDateTime).toHaveBeenLastCalledWith("2026-01-01", undefined, "days");

    fireEvent.click(screen.getByRole("radio", { name: "Months" }));
    expect(sunHours().getAllByRole("button", { name: /hours of direct sun per day/ })).toHaveLength(
      12,
    );
  });
});

describe("what blocks the sun", () => {
  const skyline = () => within(card("What blocks the sun"));

  it("names the tallest obstruction in the sun's way", () => {
    render(<SunReport {...props()} />);
    expect(card("What blocks the sun").textContent).toMatch(/85° up, to the (SW|WSW|W)The tallest/);
    expect(
      skyline().getByText("The tallest obstruction in the sun’s way: a building 40 m away."),
    ).toBeTruthy();
    // The sun is up and in view: its dot is drawn.
    expect(screen.getByTestId("sun-dot")).toBeTruthy();
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
  });

  it("pans on a narrow card and reads the direction under a tap", () => {
    render(<SunReport {...props()} />);
    // 560 px of card shows a 680 px panorama.
    const scroller = screen.getByTestId("skyline-scroller");
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.querySelector("svg")?.getAttribute("width")).toBe("680");
    expect(skyline().getByText(/Drag sideways to look around/)).toBeTruthy();

    const hit = screen.getByTestId("skyline-hit");
    hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 200 }) as DOMRect;
    // 3/4 of the way across a south-centred panorama is due west.
    fireEvent.pointerDown(hit, { clientX: 510, clientY: 50, pointerType: "touch", pointerId: 1 });
    // Nothing yet: the finger might be about to pan or scroll.
    expect(skyline().queryByText("W · 270°")).toBeNull();
    fireEvent.pointerUp(hit, { clientX: 510, clientY: 50, pointerType: "touch", pointerId: 1 });
    expect(skyline().getByText("W · 270°")).toBeTruthy();
    expect(skyline().getByText(/85° up · building 40 m away/)).toBeTruthy();
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("names hills wherever terrain is part of the skyline", () => {
    const ridge = syntheticHorizon(
      (azimuth) => (azimuth >= 225 ? 85 : 0),
      () => -2,
    );
    const { container } = render(<SunReport {...props({ horizon: ridge })} />);
    expect(screen.getAllByText("Shaded by buildings or hills").length).toBeGreaterThan(0);
    expect(skyline().getByText("Hills")).toBeTruthy();
    expect(skyline().getByText(/a hill 40 m away\.$/)).toBeTruthy();
    expect(container.textContent).toMatch(/Hills and slopes around the spot are included\./);
    // 15:15 on day 100: the sun stands behind the ridge.
    fireEvent.pointerMove(screen.getByTestId("heatmap-hit"), {
      clientX: ((100 + 0.5) / 365) * 515,
      clientY: ((15 * 60 + 15 - 5 * 60) / (14 * 60)) * 278,
    });
    expect(screen.getByTestId("chart-tooltip").textContent).toMatch(/Shaded by a hill/);
    expect(screen.getByTestId("heatmap-readout").textContent).toMatch(/^Shaded by a hill/);
  });

  it("draws an open horizon when there is no building data", () => {
    render(<SunReport {...props({ horizon: null })} />);
    expect(skyline().getByText("Open horizon")).toBeTruthy();
    expect(skyline().getByText("No building data: the horizon is drawn open.")).toBeTruthy();
    expect(
      screen.queryByRole("table", { name: /highest obstruction in each compass direction/i }),
    ).toBeNull();
  });

  it("says so when nothing stands in the sun's way", () => {
    render(<SunReport {...props({ horizon: syntheticHorizon(() => 0) })} />);
    expect(skyline().getByText("Open sky")).toBeTruthy();
    expect(
      skyline().getByText("Nothing rises above the horizon where the sun passes."),
    ).toBeTruthy();
  });
});

describe("about these numbers", () => {
  const about = () => within(card("About these numbers"));

  it("always shows the gist and keeps the detail behind a toggle", () => {
    render(<SunReport {...props()} />);
    expect(
      about().getByText(/These are estimates from building and terrain height data/),
    ).toBeTruthy();
    const toggle = about().getByRole("button", { name: "How it is worked out" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(region.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(region.hidden).toBe(false);
    expect(about().getByRole("button", { name: "Hide the details" })).toBeTruthy();
    expect(
      within(region).getByText(
        /384 buildings nearby — 329 with a mapped height \(8 of them from floor counts\), 55 estimated\./,
      ),
    ).toBeTruthy();
    expect(within(region).getByText(/local clock times at this place \(Etc\/UTC\)/)).toBeTruthy();
  });

  it.each([
    ["ready", /Hills and slopes around the spot are included\./],
    ["loading", /Ground heights are still loading; until they arrive flat ground is assumed\./],
    ["error", /Ground heights could not be loaded, so flat ground is assumed/],
    ["idle", /Flat ground is assumed: hills are not included\./],
  ] as const)("words the terrain status: %s", (terrain, text) => {
    const { container } = render(<SunReport {...props({ terrain })} />);
    expect(container.textContent).toMatch(text);
  });

  it("words the building heights so it holds for map tiles too", () => {
    // Tiles cannot tell a surveyed height from one derived from floors: no "levels".
    const tiles = { total: 384, tagged: 329, levels: 0, default: 55 };
    const { container } = render(
      <SunReport {...props({ buildings: { status: "ready", stats: tiles, onRetry: vi.fn() } })} />,
    );
    expect(container.textContent).toContain(
      "384 buildings nearby — 329 with a mapped height, 55 estimated from their neighbours.",
    );
    expect(container.textContent).not.toMatch(/surveyed|from floor counts/);
  });

  it("credits the data sources, visibly, with links", () => {
    render(<SunReport {...props()} />);
    const credit = about().getByText(/Building data ©/);
    expect(credit.textContent).toBe(
      "Building data © OpenStreetMap contributors, via OpenMapTiles / OpenFreeMap; terrain from Mapzen/AWS Terrain Tiles.",
    );
    // Not inside the collapsed details.
    expect(credit.closest("[hidden]")).toBeNull();
    const links = within(credit).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
      ["OpenMapTiles", "https://openmaptiles.org/"],
      ["OpenFreeMap", "https://openfreemap.org/"],
    ]);
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("noreferrer");
      expect(link.hasAttribute("target")).toBe(false);
    }
  });

  it("defaults to flat ground when no terrain status is given", () => {
    const { container } = render(<SunReport {...props()} />);
    expect(container.textContent).toMatch(/Flat ground is assumed/);
  });
});
