/**
 * Journey 7 — the sun report: its sections and jump tabs, choosing a day in
 * the heat map (pointer, keyboard, table alternative), one total for the
 * selected day on every card, and swipes that scroll instead of selecting.
 */
import { FIXTURE_QUERY, expect, test } from "./fixtures";

test.describe("Sun report", () => {
  test.beforeEach(async ({ app, mocks, isPhone }) => {
    mocks.photon.noAddresses();
    await app.openPlace(FIXTURE_QUERY);
    // On phones the report is read with the sheet up.
    if (isPhone) await app.moveSheetTo("full");
  });

  test("every section is there, in reading order, with jump tabs", async ({
    report,
    page,
    isPhone,
  }) => {
    const headings = page.locator(".sun-report").last().getByRole("heading", { level: 2 });
    await expect(headings).toHaveText([
      "Direct sun · average day",
      // Sun hours comes first: it is what people come for.
      "Sun hours",
      "Sun, Jun 21",
      "Seasons",
      "Through the year",
      "What blocks the sun",
      "About these numbers",
    ]);

    await expect(report.tabs.getByRole("button")).toHaveText([
      "Sun hours",
      "Today",
      "Year",
      "Skyline",
      "About",
    ]);
    // Each tab brings its card on screen and marks itself as the current one.
    // (Desktop "Skyline" is left to the fixme test below.)
    const jumps = [
      ["Year", report.year],
      ["Sun hours", report.sunHours],
      ["About", report.about],
      ["Today", report.today],
      ...(isPhone ? ([["Skyline", report.skyline]] as const) : []),
    ] as const;
    for (const [name, card] of jumps) {
      await report.press(report.tab(name));
      await expect(card.getByRole("heading", { level: 2 })).toBeInViewport();
      await expect(report.tab(name)).toHaveAttribute("aria-current", "location");
      await expect(report.tabs.locator("[aria-current]")).toHaveCount(1);
    }

    // What the cards hold.
    await expect(report.seasons.getByRole("listitem")).toHaveCount(4);
    await expect(report.seasons).toContainText("Summer · June");
    await expect(report.seasons).toContainText("Winter · December");
    await expect(report.sunHoursMode.getByRole("radio", { name: "Months" })).toBeChecked();
    await expect(report.sunHoursMode.getByRole("radio", { name: "Days" })).not.toBeChecked();
    await expect(report.monthBars.getByRole("button")).toHaveCount(12);
    await expect(
      report.skyline.getByRole("table", { name: "Highest obstruction in each compass direction" }),
    ).toBeAttached();
    await expect(report.skyline.getByRole("img", { name: /^Skyline panorama/ })).toBeVisible();
    await expect(report.about).toContainText(
      "These are estimates from building and terrain height",
    );
    await expect(
      report.about.getByRole("link", { name: "OpenStreetMap contributors" }),
    ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");

    // "How it is worked out" folds out.
    const method = report.about.getByRole("button", { name: "How it is worked out" });
    await expect(method).toHaveAttribute("aria-expanded", "false");
    await report.press(method);
    const hide = report.about.getByRole("button", { name: "Hide the details" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(report.about).toContainText("Clear-sky geometry.");
  });

  // BUG (desktop, 1440×900): tapping the "Skyline" tab lights up "About".
  // The panel is tall enough that it reaches the end of its scroll 30 px
  // before the Skyline card arrives under the tab row; ReportTabs then applies
  // its "scrolled to the end → the last section is the current one" rule
  // (`activeSectionIndex(tops, atEnd)` in src/components/app/ReportTabs.tsx),
  // which overrides the tab that was just pressed. On the phone the sheet can
  // scroll far enough and the same tap marks "Skyline" correctly.
  // Suspected fix: only let "at the end" win over a section that has not
  // reached the line if the user did not just jump to it (or pad the report's
  // end so every section can reach the line).
  test.fixme("desktop: pressing a jump tab marks THAT tab as current, also near the end", async ({
    report,
    isPhone,
  }) => {
    test.skip(isPhone, "desktop layout only (the phone gets this right)");
    await report.press(report.tab("Skyline"));
    await expect(report.skyline.getByRole("heading", { level: 2 })).toBeInViewport();
    await expect(report.tab("Skyline")).toHaveAttribute("aria-current", "location");
    await expect(report.tab("About")).not.toHaveAttribute("aria-current", "location");
  });

  test("choosing a day in the heat map moves every card to the same day and total", async ({
    app,
    report,
    timeBar,
    page,
    isPhone,
  }) => {
    await expect(report.heatmapValue).toHaveText("Sun, Jun 21 · 3:00 PM");
    expect(new Set(Object.values(await report.dayTotals(app)))).toEqual(new Set(["12 h 27 m"]));

    for (const [fx, fy] of [
      [0.25, 0.5],
      [0.85, 0.35],
    ]) {
      const before = await report.heatmapValue.textContent();
      await report.pressHeatmap(fx, fy);
      await expect(report.heatmapValue).not.toHaveText(before ?? "");

      // "Thu, Apr 2 · 1:00 PM"
      const [day, clock] = ((await report.heatmapValue.textContent()) ?? "").split(" · ");
      expect(day).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
      expect(clock).toMatch(/^\d{1,2}:\d{2} [AP]M$/);

      // One day everywhere: the header, the selected-day card, the time bar, the link.
      await expect(app.summaryCaption).toContainText(`on ${day}`);
      await expect(report.today.getByRole("heading")).toHaveText(day);
      await expect(timeBar.dayButton).toHaveAccessibleName(new RegExp(`^${day}, ${clock} `));
      await expect(app.summaryStatus).toContainText(`At ${clock}:`);
      await expect(report.heatmapAnnouncement).toContainText(`Selected ${day}, ${clock}:`);
      await expect(page).toHaveURL(/[?&]d=2026-\d\d-\d\d&t=\d{4}/);

      // One total everywhere.
      await expect
        .poll(async () => new Set(Object.values(await report.dayTotals(app))).size, {
          message: "every card shows the same total for the selected day",
        })
        .toBe(1);
      const totals = await report.dayTotals(app);
      expect(totals.summary).toMatch(/^(\d+ h( \d+ m)?|\d+ m)$/);
      expect(totals.summary).not.toBe("12 h 27 m");

      // The day-by-day chart agrees as well.
      await report.show(report.sunHoursMode);
      await report.chooseSegment(report.sunHoursMode, "Days");
      await expect(report.sunHoursValue).toHaveText(`${totals.summary} on ${day}`);
      await report.chooseSegment(report.sunHoursMode, "Months");

      // Exploring the charts does not throw the reader out of the report.
      if (isPhone) await expect(app.sheetScroller).toHaveAttribute("data-detent", "full");
    }
  });

  test("the heat map works from the keyboard", async ({ app, report, timeBar, page }) => {
    await report.show(report.heatmap);
    await report.heatmap.focus();
    await expect(report.heatmap).toBeFocused();
    await expect(report.heatmap).toHaveAccessibleName(/Arrow keys move the selection/);

    // (One press at a time, each waited for: see the fixme test below about quick presses.)
    await page.keyboard.press("ArrowRight");
    await expect(report.heatmapValue).toHaveText("Mon, Jun 22 · 3:00 PM");
    await page.keyboard.press("ArrowLeft");
    await expect(report.heatmapValue).toHaveText("Sun, Jun 21 · 3:00 PM");
    await page.keyboard.press("ArrowLeft");
    await expect(report.heatmapValue).toHaveText("Sat, Jun 20 · 3:00 PM");
    await page.keyboard.press("ArrowDown");
    await expect(report.heatmapValue).toHaveText("Sat, Jun 20 · 3:15 PM");
    await page.keyboard.press("ArrowUp");
    await expect(report.heatmapValue).toHaveText("Sat, Jun 20 · 3:00 PM");
    await page.keyboard.press("ArrowUp");
    await expect(report.heatmapValue).toHaveText("Sat, Jun 20 · 2:45 PM");

    // Announced for screen readers, and the rest of the app follows.
    await expect(report.heatmapAnnouncement).toHaveText(
      /^Selected Sat, Jun 20, 2:45 PM: In direct sun\. \d+ h \d+ m of direct sun that day\.$/,
    );
    await expect(app.summaryCaption).toContainText("on Sat, Jun 20");
    await expect(timeBar.slider).toHaveValue("885");
    await expect(report.heatmap).toBeFocused();
    await expect(page).toHaveURL(/d=2026-06-20&t=1445/);
  });

  // BUG: arrow keys pressed in quick succession on the heat map lose steps —
  // two presses of ← move the selection ONE day (seen on both projects; the
  // same happens with ↑ / ↓). YearHeatmap.onKeyDown works out the next
  // selection from its `date` / `minuteOfDay` props, and those reach the report
  // through `usePacedValue` (REPORT_PACING in AppShell: at most one update per
  // 50 ms, slower when a redraw is slow). A second key press that arrives
  // before the paced props have caught up starts from the OLD selection and
  // lands on the same day as the first. A person double-tapping an arrow on a
  // slow device, or holding it down (key repeat is ~30 Hz), gets fewer steps
  // than presses. Suspected fix: compute keyboard steps from the live store
  // (`useSettings.getState()`), as the global ← / → shortcuts already do.
  test.fixme("every arrow-key press on the heat map counts, however quick", async ({
    report,
    page,
  }) => {
    await report.show(report.heatmap);
    await report.heatmap.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(report.heatmapValue).toHaveText("Thu, Jun 18 · 3:00 PM");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(report.heatmapValue).toHaveText("Thu, Jun 18 · 3:30 PM");
  });

  test("the monthly numbers are also there as a table", async ({ report }) => {
    await report.show(report.tableToggle);
    await expect(report.tableToggle).toHaveAttribute("aria-expanded", "false");
    await expect(report.monthlyTable).toHaveCount(0);

    await report.press(report.tableToggle);
    await expect(report.tableToggle).toHaveAttribute("aria-expanded", "true");
    await expect(report.tableToggle).toHaveText("Hide the monthly numbers");
    await expect(report.monthlyTable.getByRole("columnheader")).toHaveCount(6);
    await expect(report.monthlyTable.getByRole("rowheader")).toHaveCount(12);
    // The same numbers as the chart (pinned in answer.spec.ts).
    await expect(report.monthlyTable.getByRole("row", { name: /^June/ })).toHaveText(
      /June\s*12\.5\s*14\.6\s*86%\s*6:30 AM\s*7:00 PM/,
    );
    await expect(report.monthlyTable.getByRole("row", { name: /^December/ })).toHaveText(
      /December\s*0\.0\s*9\.4\s*0%/,
    );

    await report.press(report.tableToggle);
    await expect(report.monthlyTable).toHaveCount(0);
  });

  test("sun hours: a month bar goes to that month, and the day chart steps by keyboard", async ({
    app,
    report,
    page,
  }) => {
    await report.show(report.monthBars);
    const october = report.monthBars.getByRole("button", { name: /^October: / });
    await expect(report.monthBars.getByRole("button", { name: /^June: / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await report.press(october);
    await expect(october).toHaveAttribute("aria-pressed", "true");
    await expect(app.summaryCaption).toContainText(/on \w{3}, Oct \d+/);
    await expect(report.sunHoursValue).toHaveText("1.2 h a day in October");
    await expect(page).toHaveURL(/d=2026-10-\d\d/);

    await report.chooseSegment(report.sunHoursMode, "Days");
    await expect(report.dailyChart).toBeVisible();
    const before = await report.sunHoursValue.textContent();
    await report.dailyChart.focus();
    await page.keyboard.press("ArrowRight");
    await expect(report.sunHoursValue).not.toHaveText(before ?? "");
    await page.keyboard.press("ArrowLeft");
    await expect(report.sunHoursValue).toHaveText(before ?? "");
  });

  test("the selected-day strip is a slider for the time of day", async ({
    app,
    report,
    timeBar,
    page,
  }) => {
    const strip = report.today.getByRole("slider", { name: "Time of day on the selected date" });
    await report.show(strip);
    await expect(strip).toHaveAttribute("aria-valuenow", "900");
    await expect(strip).toHaveAttribute("aria-valuetext", "3:00 PM, In direct sun");

    await strip.focus();
    await page.keyboard.press("ArrowRight");
    await expect(strip).not.toHaveAttribute("aria-valuenow", "900");
    const minute = Number(await strip.getAttribute("aria-valuenow"));
    expect(minute).toBeGreaterThan(900);
    await expect(timeBar.slider).toHaveValue(String(minute));
    // The day did not change, so neither did its total.
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(app.summaryCaption).toContainText("on Sun, Jun 21");
  });

  test("phone: a vertical swipe that starts on a chart scrolls, and selects nothing", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "touch gestures");
    const selection = async () => ({
      heatmap: await report.heatmapValue.textContent(),
      day: await app.summaryCaption.textContent(),
      minute: await page.getByRole("slider", { name: "Time of day", exact: true }).inputValue(),
    });
    const initial = await selection();
    expect(initial.heatmap).toBe("Sun, Jun 21 · 3:00 PM");

    const strip = report.today.getByRole("slider", { name: "Time of day on the selected date" });
    for (const chart of [strip, report.heatmapPlot, report.monthBars]) {
      await report.show(chart);
      const start = await app.centerOf(chart);
      // Off the chart's centre, so a tap here WOULD move the selection.
      start.x -= 60;
      const scrolled = (await app.sheetGeometry()).scrollTop;

      await app.touchDrag(start, -140);
      await expect
        .poll(async () => (await app.sheetGeometry()).scrollTop)
        .toBeGreaterThan(scrolled + 100);
      expect(await selection()).toEqual(initial);

      // Swiping back down over it changes nothing either.
      await app.touchDrag({ x: start.x, y: start.y - 140 }, 140);
      await expect
        .poll(async () => (await app.sheetGeometry()).scrollTop)
        .toBeLessThan(scrolled + 40);
      expect(await selection()).toEqual(initial);
    }

    // A finger moving ALONG the heat map only reads: it previews, and commits nothing.
    await report.show(report.heatmapPlot);
    const middle = await app.centerOf(report.heatmapPlot);
    await app.touchDrag({ x: middle.x - 80, y: middle.y }, 0, { dx: 120 });
    expect(await selection()).toEqual(initial);

    // Whereas a tap does choose.
    await report.pressHeatmap(0.25, 0.5);
    await expect(report.heatmapValue).not.toHaveText(initial.heatmap ?? "");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
