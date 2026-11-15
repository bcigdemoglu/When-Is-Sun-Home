/**
 * Journey 10 — links: the address bar follows the settings (without hammering
 * the history API), old links still open, nonsense in a link does no harm,
 * and the development harnesses are reachable in development.
 */
import { FIXTURE_PIN, FIXTURE_QUERY, MOCK_ADDRESS, SUMMER_NOON, expect, test } from "./fixtures";

const PIN = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}`;

interface HistorySpy {
  __replaceStateCalls: number;
}

test.describe("Links", () => {
  test("a 120-step slider burst costs a handful of history writes, and the link ends up right", async ({
    app,
    timeBar,
    page,
  }) => {
    await page.addInitScript(() => {
      const spy = window as unknown as HistorySpy;
      spy.__replaceStateCalls = 0;
      const original = history.replaceState.bind(history);
      history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
        spy.__replaceStateCalls += 1;
        return original(...args);
      };
    });
    const calls = () => page.evaluate(() => (window as unknown as HistorySpy).__replaceStateCalls);

    await app.openPlace(FIXTURE_QUERY);
    // The link is brought into its canonical form once.
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010/);

    await timeBar.slider.focus();
    for (let step = 0; step < 60; step++) await page.keyboard.press("ArrowRight");
    for (let step = 0; step < 20; step++) await page.keyboard.press("ArrowLeft");
    for (let step = 0; step < 40; step++) await page.keyboard.press("ArrowRight");
    await expect(timeBar.slider).toHaveValue("980");

    // The link catches up with where the slider stopped …
    await expect(page).toHaveURL(/&d=2026-06-21&t=1620/);
    // … at a tiny fraction of the 120 changes. (Safari throws after 100 calls
    // in 30 s; this counts the framework's own calls too.)
    expect(await calls()).toBeLessThan(60);
    // The app is still alive and consistent.
    await expect(app.summaryStatus).toContainText("At 4:20 PM:");
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
  });

  test("the address bar is a complete link: every setting, restored in another browser", async ({
    app,
    timeBar,
    viewpoint,
    page,
    newVisitor,
  }) => {
    await app.openPlace(PIN);
    await expect(page).toHaveURL(/\?lat=37\.79120&lng=-122\.43010&n=[^&]+$/);

    // Change one of everything.
    await timeBar.slider.fill("450");
    await timeBar.chooseDay("Shortest day");
    await viewpoint.open();
    await viewpoint.chooseMode("Window");
    await viewpoint.press(viewpoint.floorUp);
    await viewpoint.face("south-east");
    await viewpoint.chooseSegment(viewpoint.fieldOfView, "Wide");
    await viewpoint.press(viewpoint.panel.getByText("Draw buildings at their real height"));
    await viewpoint.close();

    await expect(page).toHaveURL(
      /\?lat=37\.79120&lng=-122\.43010&n=[^&]+&d=2026-12-21&t=0730&m=w&h=4\.5&dir=135&fov=270&b=0$/,
    );
    const daySun = await app.summaryFigure.textContent();
    const status = await app.summaryStatus.textContent();

    const visitor = await newVisitor();
    await visitor.app.openLink(page.url());
    await expect(visitor.app.placeTitle).toHaveText(MOCK_ADDRESS);
    await expect(visitor.app.summaryCaption).toContainText("on Mon, Dec 21");
    await expect(visitor.app.summaryFigure).toHaveText(daySun ?? "");
    await expect(visitor.app.summaryStatus).toHaveText(status ?? "");
    await expect(visitor.page.getByRole("button", { name: /^Viewpoint/ }).first()).toContainText(
      "Window · 2nd floor · facing SE",
    );
    // The visitor's address bar settles on the very same link.
    await expect(visitor.page).toHaveURL(page.url());
  });

  test.describe("old links", () => {
    // The old app wrote the day as a day-of-year: it means that day THIS year.
    test.use({ now: SUMMER_NOON });

    test("a link from the old app opens as a window on the right day, and is rewritten", async ({
      app,
      viewpoint,
      timeBar,
      page,
    }) => {
      // Old format: t = minutes since midnight, d = day of year, f = floor (1-based), z = zoom.
      await app.openPlace(`${PIN}&z=15&t=720&d=172&f=2&dir=180&fov=120`);

      // Day 172 of 2026 is 21 June; 720 minutes is noon; floor 2 is 4.5 m up.
      await expect(timeBar.dayButton).toHaveAccessibleName(/^Today, 12:00 PM PDT/);
      await expect(app.summaryCaption).toContainText("on Sun, Jun 21");
      await expect(timeBar.slider).toHaveValue("720");
      await expect(viewpoint.toggle).toContainText("Window · 2nd floor · facing S");
      await expect(app.hero.getByRole("heading")).toHaveText(
        "Sun through this window · average day",
      );
      await viewpoint.open();
      await expect(viewpoint.fieldOfViewSlider).toHaveValue("120");
      await expect(viewpoint.floorName).toHaveText("2nd floor");
      await viewpoint.close();

      // Rewritten into today's format; the keys only the old app knew are gone.
      await expect(page).toHaveURL(
        /\?lat=37\.79120&lng=-122\.43010(&n=[^&]+)?&d=2026-06-21&t=1200&m=w&h=4\.5&fov=120$/,
      );
    });

    test("an old link with only a time still reads the time the old way", async ({
      app,
      viewpoint,
      timeBar,
      page,
    }) => {
      // 1075 minutes = 5:55 PM (as "HHMM" it would be the impossible 10:75).
      await app.openPlace(`${PIN}&t=1075&f=1`);
      await expect(timeBar.slider).toHaveValue("1075");
      await expect(timeBar.dayButton).toContainText("5:55 PM");
      await expect(viewpoint.toggle).toContainText("Window · ground floor · facing S");
      // No `d` in an old link meant its default: 1 January.
      await expect(app.summaryCaption).toContainText("on Thu, Jan 1");
      await expect(page).toHaveURL(/&d=2026-01-01&t=1755&m=w/);
    });
  });

  test("nonsense in every parameter: the start screen, no crash", async ({ app, page }) => {
    await app.open(
      "lat=abc&lng=999&n=%00%FF&d=2026-99-99&t=zz&m=toString&h=NaN&dir=1e9&fov=-5&b=7&sh=x&s=%%%&f=abc&z=&bl=2",
    );
    await app.expectStartScreen();
    await expect(app.useMyLocation).toBeEnabled();
    await expect(page).not.toHaveURL(/lat=|lng=|d=|t=|m=/);
  });

  test("nonsense around a valid place: the place opens with defaults and a clean link", async ({
    app,
    viewpoint,
    timeBar,
    page,
  }) => {
    await app.openPlace(
      `${PIN}&d=2026-02-30&t=2575&m=__proto__&h=-40&b=maybe&sh=&s=${"z".repeat(4000)}&x=<script>alert(1)</script>`,
    );
    // A date and a time that do not exist are ignored: the view is live.
    await expect(timeBar.dayButton).toHaveAccessibleName(/^Today, /);
    await expect(timeBar.backToNow).toHaveCount(0);
    await expect(viewpoint.toggle).toContainText("Yard");
    await expect(app.heroFigure).toHaveText(/^\d+\.\d\s*h$/);
    await expect(page).not.toHaveURL(/[?&](d|t|m|b|sh|s|x)=/);
  });

  test("a name in a link is shown as text, whatever it contains", async ({ app, page }) => {
    const name = '<img src=x onerror="window.__xss=1"><b>Elm</b> & "St"';
    await app.openPlace(`${PIN}&n=${encodeURIComponent(name)}`);
    await expect(app.placeTitle).toHaveText(name);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(
      undefined,
    );
    await expect(page.locator("img[src='x']")).toHaveCount(0);
  });

  test("coordinates out of range are brought into range — here, to the North Pole in June", async ({
    app,
    page,
  }) => {
    // Latitude is clamped, longitude wraps; the polar day must not trip anything up.
    await app.openPlace("lat=91&lng=181&d=2026-06-21&t=1200");
    await expect(page).toHaveURL(/\?lat=90\.00000&lng=-179\.00000/);
    await expect(app.summaryFigure).toHaveText("24 h");
    await expect(app.summaryStatus).toContainText("in sun");
    // (No terrain tiles exist that far north, so the footnote is the bare one.)
    await expect(app.includedNote).toContainText(/no buildings (were found )?nearby/);
  });

  test("development harnesses are reachable in development", async ({ page, request }) => {
    // They are 404 in a production build (which is what CI runs): nothing to assert there.
    test.skip(!!process.env.CI, "the /dev pages only exist under `next dev`");
    for (const path of ["/dev/report", "/dev/places", "/dev/share", "/dev/report/summary"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).toContain("harness");
    }
    await page.goto("/dev/report");
    await expect(page.getByRole("heading", { name: "Sun report harness" })).toBeVisible();
  });
});
