/**
 * Journey 4 — the phone's bottom sheet: detents (handle and real touch
 * drags), scrolling the report at full, the controls around it, and the
 * things that must never happen (the document scrolling, sideways overflow).
 */
import { FIXTURE_QUERY, expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** How far the document itself has scrolled, and whether it could. */
function documentScroll(page: Page) {
  return page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    canScrollDown: document.documentElement.scrollHeight > window.innerHeight,
    canScrollSideways: document.documentElement.scrollWidth > window.innerWidth,
  }));
}
const STILL = { x: 0, y: 0, canScrollDown: false, canScrollSideways: false };

test.describe("Bottom sheet (phone)", () => {
  test.beforeEach(({ isPhone }) => {
    test.skip(!isPhone, "the bottom sheet only exists in the phone layout");
  });

  test("the handle steps peek → half → full → peek", async ({ app, report }) => {
    await app.openPlace(FIXTURE_QUERY);
    await app.expectSheetAt("peek");

    // The sheet is really laid out as a sheet. (A build that ships without its
    // stylesheet still passes every text assertion: this one it fails.)
    const layout = await app.sheetScroller.evaluate((scroller) => {
      const style = getComputedStyle(scroller);
      const sheet = getComputedStyle(scroller.querySelector(".sheet") as HTMLElement);
      return {
        position: style.position,
        overflowY: style.overflowY,
        snap: style.scrollSnapType,
        // iOS Safari cannot touch-scroll a container (or anything inside one)
        // that has `pointer-events: none` (WebKit bug 183870), so the sheet's
        // scroller and all its ancestors must take pointer events…
        takesTouches: (() => {
          for (let node: Element | null = scroller; node; node = node.parentElement) {
            if (getComputedStyle(node).pointerEvents === "none") return false;
          }
          return true;
        })(),
        // …and the map must live INSIDE the scroller, not underneath it.
        holdsTheMap: scroller.firstElementChild?.classList.contains("sheet-map") === true,
        mapIsSticky:
          getComputedStyle(scroller.firstElementChild as HTMLElement).position === "sticky",
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        coversTheWidth: scroller.clientWidth === window.innerWidth,
        sheetBackground: sheet.backgroundColor,
        sheetRadius: sheet.borderTopLeftRadius,
      };
    });
    expect(layout).toEqual({
      position: "fixed",
      overflowY: "auto",
      snap: "y proximity",
      takesTouches: true,
      holdsTheMap: true,
      mapIsSticky: true,
      scrollable: true,
      coversTheWidth: true,
      sheetBackground: "rgb(255, 253, 248)",
      sheetRadius: "28px",
    });
    await expect(app.sheetHandle).toHaveAccessibleName("Expand the sheet");
    await expect(app.sheetHandle).toHaveAttribute("aria-expanded", "false");
    // At peek: the answer and its actions, with the map (and its buttons) above.
    await expect(app.summaryFigure).toBeInViewport();
    await expect(app.sheet.getByRole("button", { name: "Save this place" })).toBeInViewport();
    await expect(app.sheet.getByRole("button", { name: "Use my location" })).toBeVisible();
    await expect(app.hero).not.toBeInViewport();

    await app.sheetHandle.tap();
    await app.expectSheetAt("half");
    await expect(app.sheetHandle).toHaveAttribute("aria-expanded", "true");
    await expect(app.summaryFigure).toBeInViewport();
    await expect(report.tabs).toBeInViewport();
    await expect(app.heroFigure).toBeInViewport();

    await app.sheetHandle.tap();
    await app.expectSheetAt("full");
    await expect(app.sheetHandle).toHaveAccessibleName("Collapse the sheet to show the map");
    // The map's floating buttons step aside at full: faded out and out of reach.
    const locate = app.sheet.getByRole("button", { name: "Use my location" });
    const outOfReach = () => locate.evaluate((button) => button.closest("[inert]") !== null);
    await expect.poll(outOfReach).toBe(true);

    await app.sheetHandle.tap();
    await app.expectSheetAt("peek");
    await expect.poll(outOfReach).toBe(false);
    await expect(locate).toBeVisible();
  });

  test("a finger drags the sheet between detents, and it always comes to rest on one", async ({
    app,
    page,
  }) => {
    await app.openPlace(FIXTURE_QUERY);
    await app.expectSheetAt("peek");
    const at = await app.sheetGeometry();
    const handle = () => app.centerOf(app.sheetHandle);

    // Pulled up to the middle: rests at half.
    await app.touchDrag(await handle(), at.half - at.peek);
    await app.expectSheetAt("half");
    // A short tug either way falls back to where it was.
    await app.touchDrag(await handle(), -60);
    await app.expectSheetAt("half");
    await app.touchDrag(await handle(), 60);
    await app.expectSheetAt("half");
    // On to the top, where the handle stops below the search pill.
    await app.touchDrag(await handle(), at.full - at.half);
    await app.expectSheetAt("full");
    // All the way down in one pull, and all the way up again.
    await app.touchDrag(await handle(), at.peek - at.full);
    await app.expectSheetAt("peek");
    await app.touchDrag(await handle(), at.full - at.peek);
    await app.expectSheetAt("full");
    // Dragging the header (not just the handle) moves the sheet too.
    await app.touchDrag(await app.centerOf(app.summaryFigure), at.peek - at.full);
    await app.expectSheetAt("peek");
    // A flick carries further than the finger went.
    await app.touchDrag(await handle(), -150, { fling: true });
    await app.expectSheetSettled();
    await expect(app.sheetScroller).not.toHaveAttribute("data-detent", "peek");

    expect(await documentScroll(page)).toEqual(STILL);
  });

  test("at full the report scrolls under the handle, and the jump tabs work", async ({
    app,
    report,
    page,
  }) => {
    await app.openPlace(FIXTURE_QUERY);
    await app.moveSheetTo("full");
    const full = await app.sheetGeometry();

    // Swipe up on the report: the content moves, the handle stays put.
    await app.touchDrag(await app.centerOf(app.includedNote), -300);
    await expect
      .poll(async () => (await app.sheetGeometry()).scrollTop)
      .toBeGreaterThan(full.scrollTop + 100);
    await expect(app.sheetScroller).toHaveAttribute("data-detent", "full");
    const handle = await app.sheetHandle.boundingBox();
    expect(Math.round(handle?.y ?? -1)).toBe(full.full);
    await expect(report.tabs).toBeInViewport();

    // The last card can be reached.
    await report.show(report.about);
    await expect(report.about.getByRole("heading", { name: "About these numbers" })).toBeVisible();

    // A jump tab brings its card up under the sticky rows and marks itself.
    await report.tab("Year").tap();
    await expect(report.year.getByRole("heading", { name: "Through the year" })).toBeInViewport();
    await expect(report.tab("Year")).toHaveAttribute("aria-current", "location");
    // It comes to rest just below the tab row — not behind it.
    await expect
      .poll(async () => {
        const tabs = await report.tabs.boundingBox();
        const card = await report.year.boundingBox();
        return tabs && card ? Math.round(card.y - (tabs.y + tabs.height)) : null;
      })
      .toBe(12);

    expect(await documentScroll(page)).toEqual(STILL);
  });

  test("the search pill and the time bar stay usable at every detent", async ({
    app,
    search,
    timeBar,
  }) => {
    await app.openPlace(FIXTURE_QUERY);

    for (const detent of ["peek", "half", "full"] as const) {
      await app.moveSheetTo(detent);

      // Search opens and closes (the tap is refused if anything covers the pill).
      await search.pill.tap();
      await expect(search.field).toBeFocused();
      await search.back.tap();
      await search.expectClosed();

      // The day menu opens from the bar.
      await timeBar.openMenu();
      await timeBar.closeMenu();

      // The slider takes a real touch.
      const before = await timeBar.minute();
      const box = await timeBar.slider.boundingBox();
      if (!box) throw new Error("no slider");
      await timeBar.slider.tap({ position: { x: box.width * 0.25, y: box.height / 2 } });
      await expect.poll(() => timeBar.minute()).not.toBe(before);
      await timeBar.slider.tap({ position: { x: box.width * 0.62, y: box.height / 2 } });

      // None of that moved the sheet.
      await app.expectSheetAt(detent);
    }
  });

  test("the document itself never scrolls", async ({ app, search, page }) => {
    await app.openPlace(FIXTURE_QUERY);
    expect(await documentScroll(page)).toEqual(STILL);

    // Swipes on the sheet, on the time bar and on the map: none scroll the page.
    await app.touchDrag(await app.centerOf(app.summaryFigure), -200);
    await app.expectSheetSettled();
    expect(await documentScroll(page)).toEqual(STILL);

    await app.touchDrag(
      await app.centerOf(page.getByRole("region", { name: "Date and time" })),
      -150,
    );
    expect(await documentScroll(page)).toEqual(STILL);

    await app.moveSheetTo("full");
    await app.touchDrag(await app.centerOf(app.includedNote), -400);
    await app.touchDrag(await app.centerOf(app.sheetHandle), 300);
    await app.expectSheetSettled();
    expect(await documentScroll(page)).toEqual(STILL);

    // The start screen holds still as well.
    await search.clearPlace.tap();
    await expect(app.startHeading).toBeVisible();
    await app.touchDrag(await app.centerOf(app.startHeading), -200);
    await app.expectSheetSettled();
    expect(await documentScroll(page)).toEqual(STILL);
  });

  test("a new place brings the sheet back to peek", async ({ app, search }) => {
    await app.openPlace(FIXTURE_QUERY);
    await app.moveSheetTo("full");

    await search.pill.tap();
    await search.type("pacific");
    await search.option(/Alameda/).tap();

    await expect(app.placeTitle).toContainText("Alameda");
    await app.expectSheetAt("peek");
    await expect(app.summaryFigure).toBeInViewport();
  });

  test("nothing overflows sideways on a 360 px wide phone", async ({ app, report, page }) => {
    await page.setViewportSize({ width: 360, height: 740 });

    /** Elements of the sheet / bars that stick out of the screen (ignoring deliberate side-scrollers). */
    const overflowing = () =>
      page.evaluate(() => {
        const width = window.innerWidth;
        const scrollsSideways = (element: Element | null): boolean => {
          for (let node = element; node && node !== document.body; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (
              (overflowX === "auto" || overflowX === "scroll") &&
              node.scrollWidth > node.clientWidth
            ) {
              return true;
            }
          }
          return false;
        };
        const culprits: string[] = [];
        const roots = document.querySelectorAll(
          ".sheet, header, section[aria-label='Date and time']",
        );
        for (const root of roots) {
          for (const element of root.querySelectorAll("*")) {
            const box = element.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            if (box.right <= width + 0.5 && box.left >= -0.5) continue;
            if (element.closest(".sr-only, [aria-hidden='true'], svg, canvas")) continue;
            if (scrollsSideways(element.parentElement)) continue;
            culprits.push(
              `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 40)} [${Math.round(box.left)}..${Math.round(box.right)}]`,
            );
          }
        }
        return culprits.slice(0, 8);
      });

    await app.open();
    await expect(app.startHeading).toBeVisible();
    expect(await documentScroll(page)).toEqual(STILL);
    expect(await overflowing()).toEqual([]);

    await app.openPlace(FIXTURE_QUERY);
    for (const detent of ["peek", "half", "full"] as const) {
      await app.moveSheetTo(detent);
      expect(await documentScroll(page), `document at ${detent}`).toEqual(STILL);
      expect(await overflowing(), `overflow at ${detent}`).toEqual([]);
    }
    // The sheet itself has no sideways scroll either.
    expect(
      await app.sheetScroller.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBe(0);

    // Every card of the report fits the width.
    for (const card of [
      report.hero,
      report.today,
      report.seasons,
      report.year,
      report.sunHours,
      report.skyline,
      report.about,
    ]) {
      await report.show(card);
      const box = await card.boundingBox();
      const id = (await card.getAttribute("id")) ?? "card";
      expect(box && box.x >= 0 && box.x + box.width <= 360, id).toBe(true);
    }
    expect(await overflowing()).toEqual([]);
  });
});
