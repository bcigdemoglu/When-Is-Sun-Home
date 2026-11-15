import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

export type Detent = "peek" | "half" | "full";

/** Matches a duration as the app writes it: "12 h 27 m", "8 h", "45 m", "0 m". */
export const DURATION = /^(?:\d+ h(?: \d+ m)?|\d+ m)$/;

/**
 * The shell: start screen, the compact answer (summary header), the phone's
 * bottom sheet and the map area.
 */
export class AppPage extends PageObject {
  // ── Start screen ─────────────────────────────────────────────────────────
  readonly startHeading = this.page.getByRole("heading", { name: "Where do you want sun?" });
  /** The start screen's own region: the sheet on phones, the panel's card on desktop. */
  readonly start = this.isPhone
    ? this.page.getByRole("region", { name: "Get started" })
    : this.page.getByRole("complementary").getByRole("main");
  readonly useMyLocation = this.start.getByRole("button", { name: "Use my location" });
  readonly enterAddress = this.start.getByRole("button", { name: "Enter an address" });
  readonly seeExample = this.start.getByRole("button", { name: "See an example" });
  /** Where a location problem is explained, next to the two buttons. */
  readonly startAlert = this.start.getByRole("alert");

  // ── The answer ───────────────────────────────────────────────────────────
  /** The place's name (visually hidden on phones, where the search pill shows it). */
  readonly placeTitle = this.page.getByRole("heading", { level: 1 });
  /**
   * The summary header: the selected day's direct sun and the status line.
   * It has no role of its own, so this is the one place that leans on markup:
   * it is the first `.sun-report` block in the document, in both layouts.
   */
  readonly summary = this.page.locator(".sun-report").first();
  /** "12 h 27 m" (or "≈ 14 h 37 m" while it is provisional). */
  readonly summaryFigure = this.summary.locator("p").nth(0);
  /** "of direct sun / on Sun, Jun 21" (or "… before shading"). */
  readonly summaryCaption = this.summary.locator("p").nth(1);
  /** "At 3:00 PM: in sun · until 6:59 PM". */
  readonly summaryStatus = this.summary.locator("p").nth(2);

  /** The report's first card: the average day, the verdict, the building note. */
  readonly hero = this.page.getByRole("region", { name: /average day$/ });
  /** "6.4" + "h" — the average day. */
  readonly heroFigure = this.hero.locator("p").first();
  /** "Estimate: includes shade from 3,632 nearby buildings, …" — present once shading is in. */
  readonly includedNote = this.hero.getByText(/^Estimate: /);

  // ── Map area ─────────────────────────────────────────────────────────────
  readonly map = this.page.getByRole("region", { name: "Map" });
  readonly pin = this.page.getByRole("button", { name: /^Pin\. Drag it/ });
  readonly mapUnavailable = this.page
    .getByRole("alert")
    .filter({ hasText: "The map can’t be shown" });
  /** The notice on the map while buildings load / after they failed. */
  readonly buildingNotice = this.page
    .getByRole("status")
    .filter({ hasText: "Sun hours are before shading until then" });
  readonly buildingError = this.page
    .getByRole("alert")
    .filter({ hasText: "Showing sun without shading for now." });

  // ── Phone: bottom sheet ──────────────────────────────────────────────────
  /** The sheet's scroll container; `data-detent` says where it rests. */
  readonly sheetScroller = this.page.locator(".sheet-scroller");
  readonly sheet = this.page.getByRole("region", { name: /^(Sun report|Get started)$/ });
  readonly sheetHandle = this.sheet.getByRole("button", {
    name: /^(Expand the sheet|Collapse the sheet to show the map)$/,
  });

  /** Open the app. `query` is everything after "/?" (see `FIXTURE_QUERY`). */
  async open(query = ""): Promise<void> {
    await this.page.goto(query ? `/?${query}` : "/");
    // The skeleton ("Loading") gives way once the saved settings and the URL are read.
    await expect(this.page.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0);
  }

  /** Open a place and wait until the buildings are in the numbers. */
  async openPlace(query: string): Promise<void> {
    await this.open(query);
    await this.waitForAnswer();
  }

  /** The numbers on screen include shading (no longer provisional). */
  async waitForAnswer(): Promise<void> {
    await expect(this.includedNote).toBeAttached({ timeout: 30_000 });
    await expect(this.summaryFigure).toHaveText(DURATION);
  }

  /** The start screen is showing and no place is pinned. */
  async expectStartScreen(): Promise<void> {
    await expect(this.startHeading).toBeVisible();
    await expect(this.page.getByRole("region", { name: "Date and time" })).toHaveCount(0);
  }

  // ── Sheet geometry (phone) ───────────────────────────────────────────────

  /** Where the sheet's top edge is, and where each detent puts it, px from the top of the screen. */
  async sheetGeometry(): Promise<{ top: number; scrollTop: number } & Record<Detent, number>> {
    return this.sheetScroller.evaluate((scroller) => {
      const style = (scroller as HTMLElement).style;
      const px = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
      const sheet = scroller.querySelector(".sheet") as HTMLElement;
      const box = scroller.getBoundingClientRect();
      return {
        top: Math.round(sheet.getBoundingClientRect().top),
        scrollTop: Math.round(scroller.scrollTop),
        peek: Math.round(box.bottom - px("--sheet-peek")),
        half: Math.round(box.bottom - px("--sheet-half")),
        full: Math.round(box.top + px("--sheet-gap")),
      };
    });
  }

  /** The sheet has come to rest at `detent` (attribute AND position, so mid-animation does not count). */
  async expectSheetAt(detent: Detent): Promise<void> {
    await expect(this.sheetScroller).toHaveAttribute("data-detent", detent);
    await expect
      .poll(async () => {
        const geometry = await this.sheetGeometry();
        return Math.abs(geometry.top - geometry[detent]);
      })
      .toBeLessThanOrEqual(2);
  }

  /** Step the sheet with its handle until it rests at `detent`. */
  async moveSheetTo(detent: Detent): Promise<void> {
    for (let step = 0; step < 3; step++) {
      if ((await this.sheetScroller.getAttribute("data-detent")) === detent) break;
      const before = await this.sheetScroller.getAttribute("data-detent");
      await this.press(this.sheetHandle);
      await expect(this.sheetScroller).not.toHaveAttribute("data-detent", before ?? "");
    }
    await this.expectSheetAt(detent);
  }

  /**
   * A real finger drag (touch events through the DevTools protocol), from
   * `from` by `dy` pixels (negative = up), in small steps so the browser sees
   * a pan rather than a jump.
   */
  async touchDrag(from: { x: number; y: number }, dy: number, steps = 12): Promise<void> {
    const session = await this.page.context().newCDPSession(this.page);
    const point = (y: number) => [{ x: Math.round(from.x), y: Math.round(y) }];
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(from.y),
    });
    for (let step = 1; step <= steps; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(from.y + (dy * step) / steps),
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  }

  /** The middle of an element, in viewport pixels. */
  async centerOf(target: Locator): Promise<{ x: number; y: number }> {
    const box = await target.boundingBox();
    if (!box) throw new Error("element is not on screen");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
}
