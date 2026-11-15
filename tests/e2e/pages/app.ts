import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

export type Detent = "peek" | "half" | "full";

/**
 * For `expect.poll` on things that settle within a few frames (a scroll
 * position, a counter): look again every 50 ms instead of backing off to a
 * second, which is what makes animation-bound tests slow.
 */
export const OFTEN = { intervals: [50] };

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
  readonly heroFigure = this.hero.locator(":scope > p").first();
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

  /** Open a link as it was shared (an absolute URL, or a path with its query). */
  async openLink(link: string): Promise<void> {
    const url = new URL(link, "http://localhost");
    await this.open(url.search.replace(/^\?/, ""));
    await this.waitForAnswer();
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

  /**
   * Where the sheet's top edge (its handle) is, and where each detent puts
   * it, px from the top of the screen. At "full" the handle stays put while
   * the content scrolls on underneath, so `scrollTop` keeps growing there.
   */
  async sheetGeometry(): Promise<{ top: number; scrollTop: number } & Record<Detent, number>> {
    return this.sheetScroller.evaluate((scroller) => {
      const style = (scroller as HTMLElement).style;
      const px = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
      const handle = scroller.querySelector(".sheet-handle") as HTMLElement;
      const box = scroller.getBoundingClientRect();
      return {
        top: Math.round(handle.getBoundingClientRect().top),
        scrollTop: Math.round(scroller.scrollTop),
        peek: Math.round(box.bottom - px("--sheet-peek")),
        half: Math.round(box.bottom - px("--sheet-half")),
        full: Math.round(box.top + px("--sheet-gap")),
      };
    });
  }

  /** The sheet has come to rest at the detent it reports (mid-animation does not count). */
  async expectSheetSettled(): Promise<void> {
    await expect
      .poll(async () => {
        const detent = (await this.sheetScroller.getAttribute("data-detent")) as Detent;
        const geometry = await this.sheetGeometry();
        return Math.abs(geometry.top - geometry[detent]);
      }, OFTEN)
      .toBeLessThanOrEqual(2);
  }

  /** The sheet rests at `detent`. */
  async expectSheetAt(detent: Detent): Promise<void> {
    await expect(this.sheetScroller).toHaveAttribute("data-detent", detent);
    await this.expectSheetSettled();
    await expect(this.sheetScroller).toHaveAttribute("data-detent", detent);
  }

  /** Step the sheet with its handle (peek → half → full → peek) until it rests at `detent`. */
  async moveSheetTo(detent: Detent): Promise<void> {
    for (let step = 0; step < 3; step++) {
      await this.expectSheetSettled();
      const current = await this.sheetScroller.getAttribute("data-detent");
      if (current === detent) break;
      await this.press(this.sheetHandle);
      await expect(this.sheetScroller).not.toHaveAttribute("data-detent", current ?? "");
    }
    await this.expectSheetAt(detent);
  }

  /**
   * A real finger drag (touch events through the DevTools protocol), from
   * `from` by `dy` pixels (negative = up) and optionally `dx` sideways.
   *
   * The events carry their own timestamps: a steady pan of one step per
   * frame, and — unless `fling` is set — a rest at the end, so the browser
   * sees a finger that stopped before lifting and adds no momentum. That
   * makes where the sheet comes to rest a matter of geometry, not of timing.
   */
  async touchDrag(
    from: { x: number; y: number },
    dy: number,
    options: { dx?: number; steps?: number; fling?: boolean } = {},
  ): Promise<void> {
    const steps = options.steps ?? 16;
    const dx = options.dx ?? 0;
    const session = await this.page.context().newCDPSession(this.page);
    /** The finger's position `progress` (0..1) of the way along the drag. */
    const at = (progress: number) => [
      { x: Math.round(from.x + dx * progress), y: Math.round(from.y + dy * progress) },
    ];
    let timestamp = Date.now() / 1000;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(0),
      timestamp,
    });
    for (let step = 1; step <= steps; step++) {
      timestamp += 0.016;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(step / steps),
        timestamp,
      });
    }
    if (!options.fling) {
      for (let rest = 0; rest < 4; rest++) {
        timestamp += 0.1;
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: at(1),
          timestamp,
        });
      }
    }
    timestamp += 0.016;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp,
    });
    await session.detach();
  }

  /** The middle of an element, in viewport pixels. */
  async centerOf(target: Locator): Promise<{ x: number; y: number }> {
    const box = await target.boundingBox();
    if (!box) throw new Error("element is not on screen");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
}
