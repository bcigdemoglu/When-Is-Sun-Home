/**
 * Journey 12 — when things around the app fail: building data, terrain, the
 * basemap, WebGL, the geocoder, browser storage. The answer must survive all
 * of them, and say honestly what it is missing.
 *
 * (That no test in the whole suite may log an error or reach a third-party
 * server is enforced by `fixtures.ts`; the last block here checks that guard.)
 */
import {
  ErrorGuard,
  FIXTURE_BUILDING_COUNT,
  FIXTURE_PIN_LABEL,
  FIXTURE_QUERY,
  MOCK_ADDRESS,
  expect,
  test,
} from "./fixtures";

test.describe("Resilience", () => {
  test("building data fails: open-sky numbers, a clear message, and Retry recovers", async ({
    app,
    report,
    mocks,
    isPhone,
  }) => {
    mocks.buildings.fail();
    await app.open(FIXTURE_QUERY);

    // On the map, with the way out.
    await expect(app.buildingError).toBeVisible({ timeout: 30_000 });
    await expect(app.buildingError).toContainText("Couldn’t load building heights.");
    const retry = app.buildingError.getByRole("button", { name: "Retry" });
    await expect(retry).toBeEnabled();
    // In the answer: still numbers, marked as unshaded — never a blank or a spinner for ever.
    await expect(app.summaryFigure).toHaveText("≈ 14 h 37 m");
    await expect(app.summaryCaption).toContainText("of direct sun before shading");
    await expect(app.summaryStatus).toHaveText("Building heights unavailable");
    await expect(app.includedNote).toHaveCount(0);
    // In the report, where the verdict would be.
    if (isPhone) await app.moveSheetTo("half");
    const inReport = app.hero.getByRole("alert");
    await expect(inReport).toContainText(
      "Couldn’t load building heights. Showing sun without shading for now, so real sun hours will be lower.",
    );
    await expect(inReport.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(app.heroFigure).toHaveText("≈ 12.0h");
    if (isPhone) await app.moveSheetTo("peek");

    // Retrying while it is still down changes nothing — and does not get stuck on "Retrying…".
    await app.press(retry);
    await expect(retry).toBeEnabled();
    await expect(app.buildingError).toBeVisible();
    await expect(app.summaryStatus).toHaveText("Building heights unavailable");

    // Back up: Retry brings the real answer.
    mocks.buildings.recover();
    await app.press(retry);
    await app.waitForAnswer();
    await expect(app.buildingError).toHaveCount(0);
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(app.heroFigure).toHaveText("6.4h");
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(report.hero.getByRole("alert")).toHaveCount(0);
  });

  test("the Retry inside the report works too", async ({ app, mocks, isPhone }) => {
    mocks.buildings.fail();
    await app.open(FIXTURE_QUERY);
    await expect(app.buildingError).toBeVisible({ timeout: 30_000 });
    if (isPhone) await app.moveSheetTo("half");

    mocks.buildings.recover();
    await app.press(app.hero.getByRole("button", { name: "Retry" }));
    await app.waitForAnswer();
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
  });

  test("terrain fails silently: flat ground, an honest footnote, no alarm", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    // Every elevation tile is refused in these tests (see `mockTerrain`).
    const terrainRequests: string[] = [];
    page.on("requestfailed", (request) => {
      if (/elevation-tiles-prod/.test(request.url())) terrainRequests.push(request.url());
    });
    await app.openPlace(FIXTURE_QUERY);
    expect(terrainRequests.length).toBeGreaterThan(0);

    // The answer is there, and nothing shouts about it.
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(app.includedNote).not.toContainText("hills");
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(page.locator("[data-toaster]")).toBeEmpty();

    // The method note says what was assumed.
    if (isPhone) await app.moveSheetTo("full");
    await report.show(report.about);
    await report.press(report.about.getByRole("button", { name: "How it is worked out" }));
    await expect(report.about).toContainText(/[Ff]lat ground is assumed/);
  });

  test("WebGL unavailable: the map says so, everything else works", async ({
    app,
    search,
    timeBar,
    page,
    isPhone,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await app.openPlace(FIXTURE_QUERY);

    await expect(app.mapUnavailable).toBeVisible();
    await expect(app.mapUnavailable).toContainText(
      "You can still search for an address, and the sun report keeps working.",
    );
    await expect(
      app.mapUnavailable.getByRole("button", { name: "Try the map again" }),
    ).toBeVisible();
    await expect(app.map).toHaveCount(0);

    // The answer, the time bar and the charts (2D canvas) are untouched.
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(app.heroFigure).toHaveText("6.4h");
    await timeBar.slider.fill("1320");
    await expect(app.summaryStatus).toContainText("At 10:00 PM: sun is down");
    await expect(page.getByTestId("heatmap-canvas")).toBeAttached();

    // Search still finds and opens places.
    await search.find("pacific", /Alameda/);
    await app.waitForAnswer();
    await expect(app.placeTitle).toContainText("2140 Pacific Avenue, Alameda");
    await expect(app.mapUnavailable).toBeVisible();

    // Trying again (still no WebGL) lands on the same message, not on a crash.
    await app.press(app.mapUnavailable.getByRole("button", { name: "Try the map again" }));
    await expect(app.mapUnavailable).toBeVisible();
    if (isPhone) await app.expectSheetAt("peek");
  });

  test.describe("without the basemap", () => {
    // Every request to the basemap's CDN fails: no style, no tiles, no fonts.
    test.use({ basemap: "blocked" });

    test("the answer, the pin and the report do not depend on the basemap", async ({
      app,
      report,
      search,
      timeBar,
      page,
      isPhone,
    }) => {
      const failed: string[] = [];
      page.on("requestfailed", (request) => {
        if (/basemaps\.cartocdn\.com/.test(request.url())) failed.push(request.url());
      });
      await app.openPlace(FIXTURE_QUERY);
      expect(failed.length).toBeGreaterThan(0);

      await expect(app.summaryFigure).toHaveText("12 h 27 m");
      await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
      await expect(app.mapUnavailable).toHaveCount(0);
      // The map's own widgets do not need the style: the pin is there and movable by keyboard.
      await expect(app.pin).toBeVisible();
      await app.pin.focus();
      await page.keyboard.press("ArrowUp");
      await expect(page).not.toHaveURL(/lat=37\.79120&/);
      await expect(page).toHaveURL(/lat=37\.791\d\d&lng=-122\.43010/);
      await app.waitForAnswer();

      // Time, search and the report carry on.
      await timeBar.slider.fill("600");
      await expect(app.summaryStatus).toContainText("At 10:00 AM:");
      await search.find("pacific", /Tacoma/);
      await app.waitForAnswer();
      await expect(app.placeTitle).toContainText("Tacoma");
      if (isPhone) await app.moveSheetTo("full");
      await report.show(report.heatmapPlot);
      await report.pressHeatmap(0.5, 0.5);
      await expect(report.heatmapValue).not.toHaveText(/^Sun, Jun 21 · 10:00 AM$/);
    });

    // BUG: without the basemap style the map never reports "loaded", so the
    // buttons that wait for it — Zoom in / Zoom out / Centre on the pin / 3D —
    // stay disabled for good, and nothing on screen says why. (MapLibre only
    // fires `load` once its style has loaded; SunMap sets `ready` in `onLoad`,
    // and the failed style request reaches `onError` WITH a target, which is
    // deliberately ignored there.) The pin, the compass and the report work,
    // so the app is usable; but on a network that blocks basemaps.cartocdn.com
    // (corporate filters, an outage of the CDN) the map is a blank surface
    // with dead controls. Suspected fix: treat a failed STYLE load as its own
    // state — fall back to an empty local style so the app's building and
    // shadow layers still draw and `load` fires, and say that the street map
    // is unavailable.
    test.fixme("the map's own controls become usable without the basemap", async ({
      app,
      page,
      isPhone,
    }) => {
      await app.openPlace(FIXTURE_QUERY);
      await expect(app.pin).toBeVisible();
      const tilt = page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ });
      await expect(tilt).toBeEnabled({ timeout: 15_000 });
      if (!isPhone) await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    });
  });

  test("the map's controls come alive once the map has loaded (with a basemap)", async ({
    app,
    page,
    isPhone,
  }) => {
    await app.openPlace(FIXTURE_QUERY);
    const tilt = page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ });
    await expect(tilt).toBeEnabled({ timeout: 15_000 });
    const pressed = await tilt.getAttribute("aria-pressed");
    await app.press(tilt);
    await expect(tilt).not.toHaveAttribute("aria-pressed", pressed ?? "");
    if (!isPhone) {
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.getByRole("button", { name: "Centre the map on the pin" }).click();
    }
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
  });

  test("no geocoder at all: a link still opens, under its coordinates", async ({ app, mocks }) => {
    mocks.photon.down();
    mocks.nominatim.down();
    await app.openPlace(FIXTURE_QUERY);
    await expect(app.placeTitle).toHaveText(FIXTURE_PIN_LABEL);
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    expect(mocks.photon.reverseLookups).toHaveLength(1);
    expect(mocks.nominatim.reverseLookups).toHaveLength(1);
  });

  test("browser storage that refuses writes does not stop the app", async ({
    app,
    places,
    timeBar,
    page,
  }) => {
    // Safari in private mode, a full disk, a locked-down profile.
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
      indexedDB.open = () => {
        throw new DOMException("Denied", "SecurityError");
      };
    });
    await app.openPlace(FIXTURE_QUERY);
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(app.placeTitle).toHaveText(MOCK_ADDRESS);

    await timeBar.slider.fill("600");
    await expect(app.summaryStatus).toContainText("At 10:00 AM:");
    // Saving works for this visit even though it cannot be kept.
    await places.saveCurrent();
    await expect(places.open_).toHaveAccessibleName("Saved places (1)");
    await expect(page).toHaveURL(/&t=1000/);
  });

  test.describe("the suite's own safety net", () => {
    test("the error guard notices logged errors, uncaught exceptions and stray requests", async ({
      app,
      page,
      errorGuard,
    }) => {
      // The guard that watches every test is told to expect these; a second
      // one, watching the same page, shows what it would have reported.
      errorGuard.allow(/deliberate/);
      const witness = new ErrorGuard();
      witness.watch(page);
      await app.open();

      await page.evaluate(() => console.error("deliberate error for the guard"));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              setTimeout(resolve, 0);
              throw new Error("deliberate exception for the guard");
            }, 0);
          }),
      );
      await expect
        .poll(() => witness.problems)
        .toEqual([
          expect.stringContaining("console.error: deliberate error for the guard"),
          "pageerror: deliberate exception for the guard",
        ]);

      // A request to a host nobody mocked never leaves the machine, and is held against the test.
      const reached = await page.evaluate(() =>
        fetch("https://example.com/deliberate")
          .then(() => true)
          .catch(() => false),
      );
      expect(reached).toBe(false);
      expect(errorGuard.takeStrayRequests()).toEqual(["https://example.com/deliberate"]);
      // Console noise the browser adds for that blocked request is not on the allowlist either.
      expect(witness.problems.length).toBeGreaterThanOrEqual(2);
    });

    test("without an allowance, the guard has nothing to report after a normal visit", async ({
      app,
      errorGuard,
    }) => {
      await app.openPlace(FIXTURE_QUERY);
      expect(errorGuard.problems).toEqual([]);
      expect(errorGuard.strayRequests).toEqual([]);
    });
  });
});
