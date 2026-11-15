/**
 * Journey 3 — the answer for the fixture pin on a fixed date and time:
 * provisional while buildings load, exact once they are in, and the same
 * headline number in the share link.
 */
import { FIXTURE_BUILDING_COUNT, FIXTURE_PIN_LABEL, FIXTURE_QUERY, expect, test } from "./fixtures";
import { localPath, stubNativeShare } from "./pages/share";

/**
 * PINNED NUMBERS — a regression guard for the whole pipeline (tile decoding,
 * heights, skyline, solar model, time zone, formatting).
 *
 * Setup: pin 37.7912, −122.4301 (a back yard in Pacific Heights), yard at
 * ground level (eye height 1 m), flat ground (terrain mocked away), the
 * building fixture tiles in tests/fixtures/openfreemap (3,632 buildings),
 * 21 June 2026 at 3:00 PM Pacific time.
 *
 * Source: read off the running app (commit 1911cd4, 2026-11) with exactly
 * this setup, on both projects. If an intended change to the engine or the
 * data moves them, check the new values by hand and update them here — in
 * one go, with the reason in the commit message.
 */
const PINNED = {
  /** Summary header and the "selected day" figure of every card. */
  daySun: "12 h 27 m",
  status: "At 3:00 PM: in sun · until 6:59 PM",
  /** Before shading (while buildings load): the day's daylight and the open-sky average. */
  provisionalDaySun: "≈ 14 h 37 m",
  provisionalAverage: "≈ 12.0h",
  /** The hero. */
  average: "6.4h",
  share: "53% of possible daylight · 2,324 h a year",
  verdict: "Sunny from April to September: up to 12.6 h a day in July.",
  verdictDetail: "Almost none from November to February.",
  bestMonth: "12.6 h",
  bestMonthName: "July",
  leastMonth: "0.0 h",
  leastMonthName: "January",
  /** The selected-day card. */
  daylightShare: "85% of the day’s 14 h 37 m of daylight",
  sunTimes: "Direct sun 6:32 AM – 6:59 PM 12 h 27 m",
  shadeTimes: "Shaded by buildings 5:53 AM – 6:32 AM, 6:59 PM – 8:30 PM 2 h 10 m",
  night: "Night until 5:53 AM, from 8:30 PM",
  /** Average direct sun per day, January to December, hours. */
  monthly: ["0.0", "0.1", "5.5", "11.4", "12.6", "12.5", "12.6", "12.2", "8.0", "1.2", "0.0", "0.0"],
  /** The skyline card. */
  tallestObstruction: "48° up, to the S",
} as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test.describe("The answer", () => {
  test("numbers are marked provisional while buildings load, then settle", async ({
    app,
    mocks,
  }) => {
    mocks.buildings.hold();
    await app.open(FIXTURE_QUERY);

    // Open-sky numbers, clearly marked as such — in the header, the hero and on the map.
    await expect(app.summaryFigure).toHaveText(PINNED.provisionalDaySun);
    await expect(app.summaryCaption).toContainText("of direct sun before shading");
    await expect(app.summaryCaption).toContainText("on Sun, Jun 21");
    await expect(app.summaryStatus).toHaveText("Checking nearby buildings…");
    await expect(app.heroFigure).toHaveText(PINNED.provisionalAverage);
    await expect(app.hero).toContainText("before shading · 2026 estimate");
    await expect(app.hero).toContainText("For now the numbers assume an open sky.");
    await expect(app.buildingNotice).toBeVisible();
    // Nothing claims to include buildings yet.
    await expect(app.includedNote).toHaveCount(0);

    mocks.buildings.release();

    await app.waitForAnswer();
    await expect(app.summaryFigure).toHaveText(PINNED.daySun);
    await expect(app.summaryCaption).not.toContainText("before shading");
    await expect(app.summaryStatus).toHaveText(PINNED.status);
    await expect(app.heroFigure).toHaveText(PINNED.average);
    await expect(app.hero).not.toContainText("before shading");
    await expect(app.buildingNotice).toHaveCount(0);
    await expect(app.includedNote).toHaveText(
      `Estimate: includes shade from ${FIXTURE_BUILDING_COUNT} nearby buildings, but not trees, fences or clouds.`,
    );
  });

  test("the fixture pin on 21 June at 3 PM gives exactly the pinned numbers", async ({
    app,
    report,
    timeBar,
    isPhone,
  }) => {
    await app.openPlace(FIXTURE_QUERY);

    // The place and the moment.
    await expect(app.placeTitle).toHaveText(FIXTURE_PIN_LABEL);
    await expect(timeBar.dayButton).toHaveAccessibleName(
      "Sun, Jun 21, 3:00 PM PDT. Change the day",
    );
    await expect(timeBar.slider).toHaveValue("900");
    await expect(timeBar.slider).toHaveAttribute("aria-valuetext", "3:00 PM PDT, in sun");

    // The compact answer.
    await expect(app.summaryFigure).toHaveText(PINNED.daySun);
    await expect(app.summaryCaption).toContainText("of direct sun");
    await expect(app.summaryCaption).toContainText("on Sun, Jun 21");
    await expect(app.summaryStatus).toHaveText(PINNED.status);

    // The year.
    await expect(app.heroFigure).toHaveText(PINNED.average);
    await expect(app.hero).toContainText(PINNED.share);
    await expect(app.hero).toContainText(PINNED.verdict);
    await expect(app.hero).toContainText(PINNED.verdictDetail);
    const tiles = app.hero.locator("dd");
    await expect(tiles.nth(0)).toHaveText(`${PINNED.bestMonth}${PINNED.bestMonthName}`);
    await expect(tiles.nth(1)).toHaveText(`${PINNED.leastMonth}${PINNED.leastMonthName}`);
    await expect(tiles.nth(2)).toHaveText(`${PINNED.daySun}direct sun`);
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);

    // The selected day.
    if (isPhone) await app.moveSheetTo("full");
    await expect(report.today.getByRole("heading")).toHaveText("Sun, Jun 21");
    await expect(report.today).toContainText(`${PINNED.daySun} of direct sun`);
    await expect(report.today).toContainText(PINNED.daylightShare);
    const states = report.today.getByRole("list", { name: "Times of each state" });
    await expect(states.getByRole("listitem")).toHaveText([
      PINNED.sunTimes,
      PINNED.shadeTimes,
      PINNED.night,
    ]);

    // Month by month.
    for (const [index, month] of MONTHS.entries()) {
      await expect(
        report.monthBars.getByRole("button", { name: new RegExp(`^${month}: `) }),
      ).toHaveAccessibleName(
        new RegExp(`^${month}: ${PINNED.monthly[index]} hours of direct sun per day, out of `),
      );
    }
    await expect(report.heatmapDayTotal).toHaveText(`${PINNED.daySun} of direct sun that day`);
    await expect(report.skyline).toContainText(PINNED.tallestObstruction);
  });

  test("the share link carries the same headline number as the hero", async ({
    app,
    share,
    page,
    request,
    isPhone,
  }) => {
    if (isPhone) await stubNativeShare(page);
    await app.openPlace(FIXTURE_QUERY);
    // Read what is on screen (not the pinned constant): this test is about agreement.
    const average = ((await app.heroFigure.textContent()) ?? "").replace(/h$/, "").trim();
    expect(average).toMatch(/^\d+\.\d$/);

    const link = await share.currentLink();
    expect(new URL(link).searchParams.get("s")).toBeTruthy();
    if (isPhone) {
      const [shared] = await share.shared();
      expect(shared.title).toBe(`This spot: ${average} h of direct sun a day`);
      expect(shared.text).toContain(`${average} h of direct sun on an average day`);
    }

    // What a chat app sees when it unfurls that link.
    const html = await (await request.get(localPath(link))).text();
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain(`${average} h of direct sun a day`);
    expect(head).toMatch(
      new RegExp(
        `<meta property="og:description" content="${average.replace(".", "\\.")} h of direct sun on an average day \\(${PINNED.bestMonth} in ${PINNED.bestMonthName}, none in ${PINNED.leastMonthName}\\)`,
      ),
    );
  });
});
