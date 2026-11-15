/**
 * Journey 13 — accessibility basics, checked by role (the project has no
 * axe-core integration): every control in the main flows has a name, dialogs
 * keep and give back the focus, the phone's focus order starts sensibly,
 * touch targets are big enough, and reduced motion / dark mode work.
 */
import type { Locator, Page } from "@playwright/test";
import { FIXTURE_PIN, FIXTURE_QUERY, expect, test } from "./fixtures";
import { stubNativeShare } from "./pages/share";

const PIN = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}`;

/** Roles a person operates: each needs a name a screen reader can say. */
const OPERABLE =
  "button|link|textbox|searchbox|combobox|slider|spinbutton|checkbox|radio|switch|option|tab|menuitem";
/** Roles that group or announce: named so they can be told apart. */
const NAMED_CONTAINERS = "dialog|listbox|radiogroup|table|navigation|img";

/**
 * Lines of the accessibility tree under `root` for controls that have no
 * accessible name. Uses the browser's own name computation (Playwright's
 * ARIA snapshot): a named node reads `- button "Save"`, an unnamed one
 * `- button` or `- textbox: some value`.
 */
async function unnamedControls(root: Locator): Promise<string[]> {
  const snapshot = await root.ariaSnapshot();
  const unnamed = new RegExp(`^- (${OPERABLE}|${NAMED_CONTAINERS})\\b(?! ["/])`);
  return snapshot
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => unnamed.test(line));
}

/** What has the focus, as a person would call it. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "(nothing)";
    const label =
      element.getAttribute("aria-label") ??
      (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null) ??
      element.textContent ??
      "";
    return label.replace(/\s+/g, " ").trim().slice(0, 60);
  });
}

/**
 * Tab forwards and backwards through a dialog: the focus must stay inside it
 * (or on the browser's own chrome, which a native modal allows), and must
 * visit more than one control.
 */
async function expectFocusTrappedIn(page: Page, dialog: Locator, presses = 10): Promise<void> {
  const visited = new Set<string>();
  for (const key of [...Array(presses).fill("Tab"), ...Array(presses).fill("Shift+Tab")]) {
    await page.keyboard.press(key);
    const where = await dialog.evaluate((element) => {
      const active = document.activeElement;
      if (!active || active === document.body) return "browser";
      return element.contains(active) ? "inside" : "outside";
    });
    expect(where, `focus after ${key}: ${await focused(page)}`).not.toBe("outside");
    if (where === "inside") visited.add(await focused(page));
  }
  expect(visited.size, `controls reached: ${[...visited].join(" | ")}`).toBeGreaterThan(1);
}

test.describe("Accessibility basics", () => {
  test("every control has an accessible name: start screen and search", async ({
    app,
    search,
    page,
  }) => {
    await app.open();
    await expect(app.startHeading).toBeVisible();
    await expect(app.map).toBeVisible();
    expect(await unnamedControls(page.locator("body"))).toEqual([]);

    await search.open();
    await search.type("pacific");
    await expect(search.option(/^2140 Pacific Avenue, San Francisco/)).toBeVisible();
    expect(await unnamedControls(page.locator("body"))).toEqual([]);
    // The field is tied to its list and says so.
    await expect(search.field).toHaveAttribute("aria-expanded", "true");
    await expect(search.field).toHaveAttribute(
      "aria-controls",
      (await search.list.getAttribute("id")) ?? "-",
    );

    // The page is in a known language and has a title.
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
    await expect(page).toHaveTitle(/Sun Home/i);
  });

  test("every control has an accessible name: the report, the time bar and the viewpoint", async ({
    app,
    viewpoint,
    timeBar,
    report,
    page,
    isPhone,
  }) => {
    await app.openPlace(`${FIXTURE_QUERY}&m=w`);
    // One h1 (the place), and the report inside a main landmark.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    if (isPhone) await app.moveSheetTo("full");
    // With the monthly table and the method note folded out, and the day chart shown.
    await report.show(report.tableToggle);
    await report.press(report.tableToggle);
    await report.show(report.sunHoursMode);
    await report.chooseSegment(report.sunHoursMode, "Days");
    expect(await unnamedControls(page.locator("body"))).toEqual([]);

    // The window controls (all of them: floor, facing, field of view, layers).
    await viewpoint.open();
    await expect(viewpoint.floorUp).toBeVisible();
    expect(await unnamedControls(page.locator("body"))).toEqual([]);
    await viewpoint.chooseMode("Yard / open air");
    expect(await unnamedControls(viewpoint.panel)).toEqual([]);
    await viewpoint.close();

    await timeBar.openMenu();
    expect(await unnamedControls(timeBar.menu)).toEqual([]);
    // Sliders say their value in words, not in minutes.
    await timeBar.closeMenu();
    await expect(timeBar.slider).toHaveAttribute("aria-valuetext", /^\d{1,2}:\d{2} [AP]M P[SD]T, /);
  });

  test("every control has an accessible name: places, compare, rename and share", async ({
    app,
    places,
    share,
    page,
    isPhone,
  }) => {
    if (isPhone) await stubNativeShare(page);
    await app.openPlace(`${PIN}&n=Yard+house`);
    await places.saveCurrent();
    await app.openPlace("lat=37.76956&lng=-122.24604&n=Open+field");
    await places.saveCurrent();
    await app.openPlace("lat=37.79103&lng=-122.43018&n=Roof+house");

    await places.open();
    await expect(places.recentRow("Roof house")).toBeVisible();
    expect(await unnamedControls(places.panel)).toEqual([]);

    await places.tick("Yard house");
    await places.tick("Open field");
    await places.press(places.compare);
    await expect(places.compareTable).toBeVisible();
    expect(await unnamedControls(places.panel)).toEqual([]);
    await places.press(places.compareView.getByRole("button", { name: "Back to saved places" }));

    await places.press(places.edit);
    expect(await unnamedControls(places.panel)).toEqual([]);
    await places.press(places.renameButton("Yard house"));
    await expect(places.renameField).toBeFocused();
    expect(await unnamedControls(places.renameDialog)).toEqual([]);
    await page.keyboard.press("Escape");
    await places.press(places.done);
    await places.close();

    if (!isPhone) {
      await share.button.click();
      await expect(share.qrCode).toBeVisible();
      expect(await unnamedControls(share.popover)).toEqual([]);
    }
  });

  test("the day menu keeps the focus inside and gives it back", async ({ app, timeBar, page }) => {
    await app.openPlace(FIXTURE_QUERY);
    await timeBar.dayButton.focus();
    await page.keyboard.press("Enter");
    await expect(timeBar.menu).toBeVisible();
    // Focus moved into the dialog on its own.
    await expect
      .poll(() => timeBar.menu.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    await expectFocusTrappedIn(page, timeBar.menu, 16);

    await page.keyboard.press("Escape");
    await expect(timeBar.menu).toBeHidden();
    await expect(timeBar.dayButton).toBeFocused();
    await expect(timeBar.dayButton).toHaveAttribute("aria-expanded", "false");
  });

  test("the rename prompt keeps the focus inside and gives it back", async ({
    app,
    places,
    page,
  }) => {
    await app.openPlace(`${PIN}&n=Yard+house`);
    await places.saveCurrent();
    await places.press(places.toastAction("Rename"));
    await expect(places.renameField).toBeFocused();

    await expectFocusTrappedIn(page, places.renameDialog, 6);

    await page.keyboard.press("Escape");
    await expect(places.renameDialog).toHaveCount(0);
    await expect(places.save).toBeFocused();
  });

  test("phone: the viewpoint, places and search sheets keep the focus and give it back", async ({
    app,
    viewpoint,
    places,
    search,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "these are dialogs only in the phone layout");
    await app.openPlace(FIXTURE_QUERY);

    await viewpoint.toggle.focus();
    await page.keyboard.press("Enter");
    await expect(viewpoint.dialog).toBeVisible();
    await expectFocusTrappedIn(page, viewpoint.dialog, 12);
    await page.keyboard.press("Escape");
    await expect(viewpoint.dialog).toBeHidden();
    await expect(viewpoint.toggle).toBeFocused();

    await places.open_.focus();
    await page.keyboard.press("Enter");
    await expect(places.panel).toBeVisible();
    await expectFocusTrappedIn(page, places.panel, 8);
    await page.keyboard.press("Escape");
    await expect(places.panel).toBeHidden();
    await expect(places.open_).toBeFocused();

    await search.pill.focus();
    await page.keyboard.press("Enter");
    await expect(search.overlay).toBeVisible();
    await expect(search.field).toBeFocused();
    await expectFocusTrappedIn(page, search.overlay, 6);
    await page.keyboard.press("Escape");
    await search.expectClosed();
    await expect(search.pill).toBeFocused();
  });

  test("desktop: the share popover keeps Tab inside and gives the focus back", async ({
    app,
    share,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "phones use the system share sheet");
    await app.openPlace(FIXTURE_QUERY);
    await share.button.focus();
    await page.keyboard.press("Enter");
    await expect(share.popover).toBeVisible();
    await expect(share.copy).toBeFocused();

    await expectFocusTrappedIn(page, share.popover, 8);

    await page.keyboard.press("Escape");
    await expect(share.popover).toHaveCount(0);
    await expect(share.button).toBeFocused();
  });

  test("phone, sheet at peek: Tab walks the visible controls top to bottom first", async ({
    app,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "phone layout only");
    await app.openPlace(FIXTURE_QUERY);
    await app.expectSheetAt("peek");
    // The 3D button is enabled once the map has loaded; wait, so the order is the settled one.
    await expect(page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ })).toBeEnabled({
      timeout: 15_000,
    });

    const stops: string[] = [];
    for (let stop = 0; stop < 15; stop++) {
      await page.keyboard.press("Tab");
      stops.push(await focused(page));
      // Whatever has the focus can be seen: on screen, and not underneath something else.
      const visible = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        const top = document.elementFromPoint(x, y);
        return top !== null && (element.contains(top) || top.contains(element));
      });
      expect(visible, `“${stops[stop]}” is focused but cannot be seen`).toBe(true);
    }
    expect(stops).toEqual([
      // The search strip is first in the document, as it is on the screen.
      expect.stringMatching(/^Search an address\. Showing /),
      "Clear this place",
      "Saved places",
      "Map",
      expect.stringMatching(/^Pin\. Drag it/),
      // The map's credits: open over the map until it is first touched. (The
      // basemap's own two come before these; the test basemap has none.)
      "Toggle attribution",
      "OpenFreeMap",
      "© OpenMapTiles",
      "© OpenStreetMap",
      "Use my location",
      expect.stringMatching(/Switch to (tilted 3D|flat 2D)$/),
      "Expand the sheet",
      "Save this place",
      "Share this report",
      expect.stringMatching(/^Viewpoint: /),
    ]);
    // Reaching the header's controls did not move the sheet.
    await app.expectSheetAt("peek");
  });

  // FINDING (phones, keyboard and screen-reader order): at peek the time bar
  // is on screen right under the sheet's header, but in the document it comes
  // AFTER the whole sun report (AppShell renders the BottomSheet with the
  // report first, then the fixed time-bar wrapper). So the next stops after
  // Save / Share / Viewpoint are the report's jump tabs and ~40 controls of
  // cards that are not visible at peek (focusing them drags the sheet up to
  // full), and "Change the day", the time slider and Play come last. TalkBack
  // / VoiceOver swipe order follows the same sequence. Suspected fix: render
  // the time bar before the sheet in the DOM (it is position: fixed either
  // way), or make the report below the fold inert while the sheet is at peek.
  test.fixme("phone, sheet at peek: the time bar comes before the report's hidden content", async ({
    app,
    timeBar,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "phone layout only");
    await app.openPlace(FIXTURE_QUERY);
    await app.expectSheetAt("peek");
    await page.getByRole("button", { name: /^Viewpoint: / }).focus();
    await page.keyboard.press("Tab");
    await expect(timeBar.dayButton).toBeFocused();
    await app.expectSheetAt("peek");
  });

  test("phone: the controls of the peek state are big enough to hit", async ({
    app,
    search,
    places,
    share,
    viewpoint,
    timeBar,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "touch targets");
    await app.openPlace(FIXTURE_QUERY);
    const targets: [string, Locator][] = [
      ["search pill", search.pill],
      ["clear place", search.clearPlace],
      ["saved places", places.open_],
      ["locate", app.sheet.getByRole("button", { name: "Use my location" })],
      ["2D / 3D", page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ })],
      ["save", places.save],
      ["share", share.button],
      ["viewpoint", viewpoint.toggle],
      ["day", timeBar.dayButton],
      ["back to now", timeBar.backToNow],
      ["play", timeBar.play],
    ];
    const tooSmall: string[] = [];
    for (const [name, target] of targets) {
      const box = await target.boundingBox();
      if (!box || box.width < 44 || box.height < 44) {
        tooSmall.push(`${name}: ${box ? `${box.width}×${box.height}` : "not on screen"}`);
      }
    }
    expect(tooSmall).toEqual([]);
    // The grabber looks slim but its hit area reaches above the sheet's edge: 44 px in all.
    const hitArea = await app.sheetHandle.evaluate((button) => {
      const own = button.getBoundingClientRect().height;
      const extra = Number.parseFloat(getComputedStyle(button, "::before").height) || 0;
      return own + extra;
    });
    expect(hitArea).toBeGreaterThanOrEqual(44);
  });

  test.describe("reduced motion and dark colours", () => {
    test.use({ colorScheme: "dark" });

    test("the main flows work with reduced motion in the dark theme", async ({
      app,
      timeBar,
      viewpoint,
      places,
      share,
      report,
      page,
      isPhone,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      if (isPhone) await stubNativeShare(page);
      const darkStyle = page.waitForRequest(/dark-matter-gl-style\/style\.json/);
      await app.openPlace(FIXTURE_QUERY);

      // Dark: the page, the text and the map's style all follow the scheme.
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
        true,
      );
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        "rgb(18, 17, 14)",
      );
      expect(await app.summaryFigure.evaluate((element) => getComputedStyle(element).color)).toBe(
        "rgb(245, 240, 230)",
      );
      await darkStyle;
      await expect(app.summaryFigure).toHaveText("12 h 27 m");

      if (isPhone) {
        // Reduced motion: the sheet jumps to its detent instead of gliding there —
        // it is in place by the time the tap has been handled.
        const geometry = await app.sheetGeometry();
        await app.sheetHandle.tap();
        expect((await app.sheetGeometry()).top).toBe(geometry.half);
        await app.expectSheetAt("half");
        await app.sheetHandle.tap();
        expect((await app.sheetGeometry()).top).toBe(geometry.full);
        await app.expectSheetAt("full");
      }
      // Jump tabs, charts, dialogs, toasts: all still do their job.
      await report.press(report.tab("Year"));
      await expect(report.tab("Year")).toHaveAttribute("aria-current", "location");
      await report.pressHeatmap(0.3, 0.5);
      await expect(report.heatmapValue).not.toHaveText("Sun, Jun 21 · 3:00 PM");
      await timeBar.chooseDay("Shortest day");
      await expect(app.summaryCaption).toContainText("on Mon, Dec 21");
      if (isPhone) await app.moveSheetTo("peek");
      await viewpoint.open();
      await viewpoint.chooseMode("Window");
      await viewpoint.close();
      await expect(viewpoint.toggle).toContainText("Window · ground floor · facing S");
      await places.saveCurrent();
      await expect(places.toast(/^Saved as /)).toBeVisible();
      await timeBar.press(timeBar.play);
      await expect(timeBar.pause).toBeVisible();
      await timeBar.press(timeBar.pause);

      if (!isPhone) {
        await share.button.click();
        // A QR code stays dark on white, whatever the theme: cameras need the contrast.
        await expect(share.qrCode.locator("rect")).toHaveAttribute("fill", "#ffffff");
        await expect(share.qrCode.locator("path")).toHaveAttribute("fill", "#1e1a15");
        await page.keyboard.press("Escape");
      } else {
        await share.button.tap();
        await expect.poll(() => share.shared()).toHaveLength(1);
      }
    });

    test("the start screen, search and the empty places list render in the dark theme", async ({
      app,
      search,
      places,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      await app.open();
      await expect(app.startHeading).toBeVisible();
      expect(await app.startHeading.evaluate((element) => getComputedStyle(element).color)).toBe(
        "rgb(245, 240, 230)",
      );
      await search.open();
      await search.type("pacific");
      await expect(search.option(/^2140 Pacific Avenue, San Francisco/)).toBeVisible();
      await page.keyboard.press("Escape");
      if (!(await search.list.count())) await page.keyboard.press("Escape");
      await places.open();
      await expect(places.saved.getByText("No saved places yet.")).toBeVisible();
    });
  });
});
