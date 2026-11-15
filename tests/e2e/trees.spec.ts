/**
 * The Trees layer: measured tree heights (Oregon's laser surveys) drawn on
 * the map when a person switches them on — a picture, never part of the sun
 * hours.
 *
 * As everywhere in this suite, WebGL pixels are not looked at: what the map
 * asks the network for, what the switch, the legend and the credit say, and
 * that the answer does not move, are. The state's service is mocked
 * (`mockTrees`); any request to its host that the mock does not know fails
 * the test (see `fixtures.ts`).
 */
import type { Locator, Page } from "@playwright/test";
import { FIXTURE_QUERY, expect, test } from "./fixtures";
import {
  BUILDING_TILE_URL,
  TREE_HEIGHTS_URL,
  TREE_SURVEY_URL,
  watchTreeRequests,
} from "./helpers/mockMapData";

/** NE 36th Avenue, Portland, Oregon. */
const PORTLAND = "lat=45.5385&lng=-122.6265&d=2026-06-21&t=1500";
const SATELLITE_KEY = "sun-home:map-satellite:v1";

const HINT = "Measured tree heights, Oregon only. Not counted in the sun hours";
const ELSEWHERE_HINT = "Tree heights are only available in Oregon. Not counted in the sun hours";

const legend = (page: Page) => page.getByRole("group", { name: "Tree height legend" });
const credit = (page: Page) => page.locator(".maplibregl-ctrl-attrib");
const tiltButton = (page: Page) =>
  page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ });
const satelliteButton = (page: Page) =>
  page.getByRole("button", {
    name: /^(Satellite photo\. Switch to map|Map\. Switch to satellite photo)$/,
  });

const heights = (asked: string[]) => asked.filter((url) => TREE_HEIGHTS_URL.test(url));
const surveys = (asked: string[]) => asked.filter((url) => TREE_SURVEY_URL.test(url));

/** No more requests arrive: the count is the same a good second later. */
async function expectQuiet(page: Page, asked: string[]): Promise<void> {
  await page.waitForTimeout(400);
  const count = asked.length;
  await page.waitForTimeout(900);
  expect(asked.length, "requests to the tree service that came after it was off").toBe(count);
}

test.describe("Trees layer", () => {
  test("the switch draws measured tree heights, with a legend and a credit, and takes them away again", async ({
    app,
    viewpoint,
    page,
  }) => {
    const asked = watchTreeRequests(page);
    await app.openPlace(PORTLAND);
    await expect(tiltButton(page)).toBeEnabled({ timeout: 15_000 });
    const figure = (await app.summaryFigure.textContent()) ?? "";
    const hero = (await app.heroFigure.textContent()) ?? "";

    // Off until asked for: no legend, no credit, and not one request.
    await expect(legend(page)).toHaveCount(0);
    await expect(credit(page)).not.toContainText("Tree heights");
    await page.waitForTimeout(600);
    expect(asked, "nothing is asked of the state's server until the layer is wanted").toEqual([]);

    await viewpoint.open();
    const trees = viewpoint.panel.getByRole("switch", { name: /^Trees/ });
    await expect(trees).not.toBeChecked();
    await expect(trees).toHaveAccessibleName(`Trees ${HINT}`);
    // The inputs are visually hidden: people press the row.
    await viewpoint.press(viewpoint.panel.getByText(HINT));
    await expect(trees).toBeChecked();
    await expect(page).toHaveURL(/&tr=1(&|$)/);
    await viewpoint.close();

    // Pictures are asked for, and the legend says what the colours mean and how old they are.
    await expect.poll(() => heights(asked).length).toBeGreaterThan(0);
    await expect(legend(page)).toBeVisible();
    await expect(legend(page)).toContainText("Tree height in feet");
    for (const label of ["10", "20", "35", "50", "70", "100+"]) {
      await expect(legend(page).getByText(label, { exact: true })).toHaveCount(1);
    }
    // For a screen reader, the classes in words.
    await expect(legend(page).getByRole("listitem")).toHaveText([
      "10 to 20 feet",
      "20 to 35 feet",
      "35 to 50 feet",
      "50 to 70 feet",
      "70 to 100 feet",
      "100 feet and more",
    ]);
    await expect.poll(() => surveys(asked).length).toBeGreaterThan(0);
    await expect(legend(page)).toContainText("Laser survey, 2014 (OLC Metro)");
    // The source is credited, with a link, while its pictures are drawn.
    await expect(credit(page)).toContainText("Tree heights: Oregon DOGAMI lidar");
    await expect(credit(page).getByRole("link", { name: "Oregon DOGAMI lidar" })).toHaveAttribute(
      "href",
      "https://www.oregon.gov/dogami/lidar/Pages/index.aspx",
    );
    // Only the two addresses the mock knows were ever asked for.
    expect(
      asked.filter((url) => !TREE_HEIGHTS_URL.test(url) && !TREE_SURVEY_URL.test(url)),
    ).toEqual([]);

    // A picture, not a number: the answer has not moved, and still says trees are left out.
    await expect(app.summaryFigure).toHaveText(figure);
    await expect(app.heroFigure).toHaveText(hero);
    await expect(app.includedNote).toContainText("but not trees");
    await expect(app.buildingError).toHaveCount(0);
    await expect(app.mapUnavailable).toHaveCount(0);

    // Off again: the legend and the credit go, the link forgets it, and nothing more is asked for.
    await viewpoint.open();
    await viewpoint.press(viewpoint.panel.getByText(HINT));
    await expect(trees).not.toBeChecked();
    await expect(page).not.toHaveURL(/tr=/);
    await viewpoint.close();
    await expect(legend(page)).toHaveCount(0);
    await expect(credit(page)).not.toContainText("Tree heights");
    await expectQuiet(page, asked);
    await expect(app.summaryFigure).toHaveText(figure);
  });

  test("the trees stay through 2D, 3D and Satellite, recoloured for the photo", async ({
    app,
    page,
  }) => {
    const asked = watchTreeRequests(page);
    await app.openPlace(`${PORTLAND}&tr=1`);
    const tilt = tiltButton(page);
    const satellite = satelliteButton(page);
    await expect(tilt).toBeEnabled({ timeout: 15_000 });
    await expect(legend(page)).toBeVisible();
    await expect.poll(() => heights(asked).length).toBeGreaterThan(0);

    // The map opens tilted (3D); flat (2D) keeps the layer.
    await expect(tilt).toHaveAttribute("aria-pressed", "true");
    await app.press(tilt);
    await expect(tilt).toHaveAttribute("aria-pressed", "false");
    await expect(legend(page)).toBeVisible();
    await expect(credit(page)).toContainText("Tree heights: Oregon DOGAMI lidar");

    // Over the photos the trees are drawn in other colours: the pictures are made anew.
    const before = heights(asked).length;
    await app.press(satellite);
    await expect(satellite).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => heights(asked).length).toBeGreaterThan(before);
    await expect(legend(page)).toBeVisible();
    await expect(legend(page)).toContainText("Laser survey, 2014 (OLC Metro)");
    await expect(credit(page)).toContainText("Tree heights: Oregon DOGAMI lidar");
    await expect(credit(page)).toContainText("Imagery: USGS The National Map");
    // The legend shows the colours that are on the map: the photo's, not the map's.
    const swatch = legend(page).locator(".tree-legend-swatch").first();
    const onPhoto = await swatch.evaluate((element) => getComputedStyle(element).backgroundColor);

    // And back to the tilted map, trees and all.
    await app.press(tilt);
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    await expect(tilt).toHaveAttribute("aria-pressed", "true");
    await expect(legend(page)).toBeVisible();
    await expect(credit(page)).not.toContainText("Imagery");
    await expect
      .poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(onPhoto);
  });

  test("over a photo the buildings are still cut out of the trees: their tiles are fetched for that", async ({
    app,
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), SATELLITE_KEY);
    let buildingTiles = 0;
    page.on("request", (request) => {
      if (BUILDING_TILE_URL.test(request.url())) buildingTiles++;
    });
    const asked = watchTreeRequests(page);
    await app.openPlace(`${PORTLAND}&tr=1`);
    await expect(satelliteButton(page)).toHaveAttribute("aria-pressed", "true", {
      timeout: 15_000,
    });
    await expect(legend(page)).toBeVisible();
    await expect.poll(() => heights(asked).length).toBeGreaterThan(0);
    // The sun computation's tiles, and the one around each tree picture.
    await expect.poll(() => buildingTiles).toBeGreaterThan(0);
    await expect(app.includedNote).toBeAttached();
  });

  test("outside Oregon the switch says so, stays usable, and nothing is asked for", async ({
    app,
    viewpoint,
    page,
  }) => {
    const asked = watchTreeRequests(page);
    // San Francisco.
    await app.openPlace(FIXTURE_QUERY);
    await expect(tiltButton(page)).toBeEnabled({ timeout: 15_000 });
    const figure = (await app.summaryFigure.textContent()) ?? "";

    await viewpoint.open();
    const trees = viewpoint.panel.getByRole("switch", { name: /^Trees/ });
    await expect(trees).toHaveAccessibleName(`Trees ${ELSEWHERE_HINT}`);
    await expect(viewpoint.panel.getByText(HINT)).toHaveCount(0);
    await expect(trees).toBeEnabled();
    await viewpoint.press(viewpoint.panel.getByText(ELSEWHERE_HINT));
    await expect(trees).toBeChecked();
    // The choice is kept (it will show in Oregon), and it is in the link.
    await expect(page).toHaveURL(/&tr=1(&|$)/);
    await viewpoint.close();

    // The map shows nothing extra: no legend, no credit, no request.
    await expect(legend(page)).toHaveCount(0);
    await expect(credit(page)).not.toContainText("Tree heights");
    await page.waitForTimeout(1200);
    expect(asked, "requests to the tree service from outside Oregon").toEqual([]);
    await expect(app.summaryFigure).toHaveText(figure);

    // The same switch, still on, takes effect at a place in Oregon.
    await app.openPlace(`${PORTLAND}&tr=1`);
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => heights(asked).length).toBeGreaterThan(0);
  });

  test("the link carries the layer: another person sees the trees, an old link shows none", async ({
    app,
    viewpoint,
    page,
    newVisitor,
  }) => {
    await app.openPlace(PORTLAND);
    await viewpoint.open();
    await viewpoint.press(viewpoint.panel.getByText(HINT));
    await viewpoint.close();
    await expect(page).toHaveURL(/\?lat=45\.53850&lng=-122\.62650&[^#]*&tr=1(&s=[^&]+)?$/);
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });

    // Somebody else opens the very same link.
    const visitor = await newVisitor();
    const asked = watchTreeRequests(visitor.page);
    await visitor.app.openLink(page.url());
    await expect(legend(visitor.page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => heights(asked).length).toBeGreaterThan(0);
    await expect(visitor.page).toHaveURL(page.url());
    await expect(visitor.app.summaryFigure).toHaveText(
      (await app.summaryFigure.textContent()) ?? "",
    );

    // After a reload the layer is still on (it is a setting like the other two).
    await page.reload();
    await app.waitForAnswer();
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });

    // A link that says nothing about trees — every link from before the
    // layer existed, and the old app's — opens without them, even for
    // somebody who had them on: a link shows what its sender saw.
    for (const link of [`/?${PORTLAND}`, "/?lat=45.5385&lng=-122.6265&z=15&t=870&d=172&f=1"]) {
      await visitor.app.openLink(link);
      await expect(tiltButton(visitor.page)).toBeEnabled({ timeout: 15_000 });
      await expect(visitor.page).not.toHaveURL(/tr=/);
      await expect(legend(visitor.page)).toHaveCount(0);
      await expectQuiet(visitor.page, asked);
    }
  });

  test("a failing tree service is asked again, and otherwise costs nothing: no error, no changed number", async ({
    app,
    page,
    errorGuard,
  }) => {
    // The browser's own line for each failed request is expected here, and nothing else.
    errorGuard.allow(/Failed to load resource.*(503|gis\.dogami\.oregon\.gov)/);
    const perPicture = new Map<string, number>();
    await page.route(TREE_HEIGHTS_URL, (route) => {
      const url = route.request().url();
      perPicture.set(url, (perPicture.get(url) ?? 0) + 1);
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        headers: { "access-control-allow-origin": "*" },
        body: "down",
      });
    });
    await page.route(TREE_SURVEY_URL, (route) => route.abort("failed"));

    await app.openPlace(PORTLAND);
    const figure = (await app.summaryFigure.textContent()) ?? "";
    await app.open(`${PORTLAND}&tr=1`);
    await app.waitForAnswer();
    await expect(tiltButton(page)).toBeEnabled({ timeout: 15_000 });

    // A picture that failed is asked for again after two seconds.
    await expect.poll(() => Math.max(0, ...perPicture.values()), { timeout: 10_000 }).toBe(2);
    // The legend is there all the same, and honest about what it does not know.
    await expect(legend(page)).toBeVisible();
    await expect(legend(page)).toContainText("Laser surveys; the year varies by area");
    // Not a word about it anywhere, and the answer is the answer.
    await expect(app.buildingError).toHaveCount(0);
    await expect(page.locator("[data-toaster]")).not.toContainText(/tree|error|load/i);
    await expect(app.summaryFigure).toHaveText(figure);
    await expect(app.mapUnavailable).toHaveCount(0);
  });

  test.describe("phone: the legend keeps clear of everything else on the map", () => {
    const overlaps = (a: Box, b: Box) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    type Box = { x: number; y: number; width: number; height: number };
    const boxOf = async (target: Locator): Promise<Box> => {
      const box = await target.boundingBox();
      if (!box) throw new Error("not on screen");
      return box;
    };

    for (const size of [
      { width: 360, height: 640 },
      { width: 390, height: 844 },
    ]) {
      for (const scheme of ["light", "dark"] as const) {
        for (const view of ["map", "satellite"] as const) {
          test(`${size.width}×${size.height}, ${scheme}, ${view}`, async ({
            app,
            search,
            page,
            isPhone,
          }) => {
            test.skip(!isPhone, "phone layout only");
            await page.setViewportSize(size);
            await page.emulateMedia({ colorScheme: scheme });
            if (view === "satellite") {
              await page.addInitScript((key) => localStorage.setItem(key, "1"), SATELLITE_KEY);
            }
            await app.openPlace(`${PORTLAND}&tr=1`);
            await expect(tiltButton(page)).toBeEnabled({ timeout: 15_000 });
            await expect(satelliteButton(page)).toHaveAttribute(
              "aria-pressed",
              String(view === "satellite"),
            );
            await app.expectSheetAt("peek");
            await expect(legend(page)).toBeVisible();
            await expect(legend(page)).toContainText("Laser survey, 2014 (OLC Metro)");

            const box = await boxOf(page.locator(".tree-legend"));
            // On the screen, whole.
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(size.width);
            // The test's Portland has no building data, so the app's own notice
            // is at the top of the map as well: the legend sits under it.
            const notice = page.getByRole("status").filter({ hasText: "No buildings are mapped" });
            await expect(notice).toBeVisible();
            // The credits are open (they are until the map is first touched): the worst case.
            const others: Record<string, Locator> = {
              "the credit box": credit(page),
              "the building notice": notice,
              "the search pill": search.pill,
              "the saved places button": page.getByRole("button", { name: /^Saved places/ }),
              "the location button": page.getByRole("button", { name: "Use my location" }),
              "the satellite button": satelliteButton(page),
              "the 2D / 3D button": tiltButton(page),
              "the pin": app.pin,
            };
            for (const [name, target] of Object.entries(others)) {
              expect(overlaps(box, await boxOf(target)), `the legend lies over ${name}`).toBe(
                false,
              );
            }
            const legendIsOnTop = () =>
              page.evaluate(
                ([x, y]) => document.elementFromPoint(x, y)?.closest(".tree-legend") != null,
                [box.x + box.width / 2, box.y + box.height / 2],
              );

            // In the top-left corner of the map, it is in view — and nothing lies
            // over it — with the sheet at peek and half up…
            for (const detent of ["peek", "half"] as const) {
              await app.moveSheetTo(detent);
              const sheet = await app.sheetGeometry();
              expect(box.y + box.height, `the sheet at ${detent} reaches the legend`).toBeLessThan(
                sheet.top,
              );
              expect(await legendIsOnTop(), `at ${detent} the legend is covered`).toBe(true);
            }
            // …and all the way up, the sheet covers the whole map, legend and
            // all, rather than the legend lying over the report.
            await app.moveSheetTo("full");
            expect(await legendIsOnTop(), "the legend shows through the full sheet").toBe(false);
          });
        }
      }
    }
  });

  test("desktop: the legend sits in the map's bottom-left corner, clear of the time bar and the buttons", async ({
    app,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "desktop layout only");
    await app.openPlace(`${PORTLAND}&tr=1`);
    await expect(tiltButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(legend(page)).toBeVisible();
    const box = await page.locator(".tree-legend").boundingBox();
    const bar = await page.getByRole("region", { name: "Date and time" }).boundingBox();
    const map = await app.map.boundingBox();
    const creditBox = await credit(page).boundingBox();
    const tilt = await tiltButton(page).boundingBox();
    if (!box || !bar || !map || !creditBox || !tilt) throw new Error("not on screen");
    expect(box.x).toBeGreaterThanOrEqual(map.x);
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    // The credits are in the opposite corner, the buttons on the other side.
    expect(creditBox.y + creditBox.height).toBeLessThan(box.y);
    expect(box.x + box.width).toBeLessThan(tilt.x);
  });
});
