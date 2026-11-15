import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

/**
 * The sun report: the cards under the answer. On phones it lives in the
 * bottom sheet, so a card must be scrolled to before it can be touched
 * (`show`).
 */
export class ReportPage extends PageObject {
  readonly tabs = this.page.getByRole("navigation", { name: "Report sections" });
  readonly hero = this.page.getByRole("region", { name: /average day$/ });
  /** The selected day. Its heading is the date, so it is found by its jump-target id. */
  readonly today = this.page.locator("#report-today");
  readonly seasons = this.page.getByRole("region", { name: "Seasons" });
  readonly year = this.page.getByRole("region", { name: "Through the year" });
  readonly sunHours = this.page.getByRole("region", { name: "Sun hours" });
  readonly skyline = this.page.getByRole("region", { name: "What blocks the sun" });
  readonly about = this.page.getByRole("region", { name: "About these numbers" });

  // ── Year heat map ────────────────────────────────────────────────────────
  /** The focusable chart (arrow keys move the selection). */
  readonly heatmap = this.year.getByRole("group", { name: /^Heat map of direct sun/ });
  /** The plot area that takes taps and clicks. */
  readonly heatmapPlot = this.year.getByTestId("heatmap-hit");
  /** "Thu, Apr 2 · 1:00 PM" — the selection (or what is under the pointer). */
  readonly heatmapValue = this.year.locator("p").first();
  /** "9 h 47 m of direct sun that day". */
  readonly heatmapDayTotal = this.year.getByTestId("heatmap-day-total");
  /** For screen readers: "Selected Thu, Apr 2, 1:00 PM: In direct sun. …" */
  readonly heatmapAnnouncement = this.year.locator("p[aria-live]");
  readonly tableToggle = this.year.getByRole("button", { name: /monthly numbers/ });
  readonly monthlyTable = this.year.getByRole("table");

  // ── Sun hours ────────────────────────────────────────────────────────────
  readonly sunHoursMode = this.sunHours.getByRole("radiogroup", { name: "Show sun hours by" });
  readonly monthBars = this.sunHours.getByRole("group", {
    name: /^Average hours of direct sun per day/,
  });
  readonly dailyChart = this.sunHours.getByRole("group", {
    name: /^Line chart of hours of direct sun/,
  });
  /** The card's value line: "12.5 h a day in June" / "9 h 47 m on Thu, Apr 2". */
  readonly sunHoursValue = this.sunHours.locator("p").first();

  /** A jump tab ("Today", "Year", "Sun hours", "Skyline", "About"). */
  tab(name: string): Locator {
    return this.tabs.getByRole("button", { name, exact: true });
  }

  /** Bring a card on screen (on phones this raises and scrolls the sheet). */
  async show(card: Locator): Promise<void> {
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
  }

  /** Press the heat map at a position given as fractions of its plot area (0..1 from the top left). */
  async pressHeatmap(fx: number, fy: number): Promise<void> {
    await this.show(this.heatmapPlot);
    const box = await this.heatmapPlot.boundingBox();
    if (!box) throw new Error("the heat map is not on screen");
    const position = { x: Math.round(box.width * fx), y: Math.round(box.height * fy) };
    if (this.isPhone) await this.heatmapPlot.tap({ position });
    else await this.heatmapPlot.click({ position });
  }

  /**
   * The selected day's direct sun as each card states it, as text like
   * "9 h 47 m". They must all agree (they come from one source).
   */
  async dayTotals(app: { summaryFigure: Locator }): Promise<Record<string, string>> {
    const duration = /\d+ h(?: \d+ m)?|\d+ m/;
    const first = async (locator: Locator) =>
      duration.exec((await locator.innerText()).replace(/\s+/g, " "))?.[0] ?? "(none)";
    return {
      summary: await first(app.summaryFigure),
      // The third tile of the hero: "<date> / 9 h 47 m / direct sun".
      hero: await first(this.hero.locator("dd").nth(2)),
      today: await first(this.today.locator("p").first()),
      heatmap: await first(this.heatmapDayTotal),
    };
  }
}
