/**
 * The Satellite view: aerial photos under the pin instead of the drawn
 * buildings, with the computed shadows over them.
 *
 * As everywhere in this suite, WebGL pixels are not looked at: what the map
 * asks the network for, what the buttons say, and what the page says, are.
 * Both picture services are mocked (`mockImagery`); a request to them that
 * the mock does not know fails the test.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BUILDING_TILE_URL, IMAGERY_BASE_URL, IMAGERY_DETAIL_URL } from "./helpers/mockMapData";

/**
 * In the middle of building tile 14/2620/6331 (San Francisco): the next tile
 * east, which only the map itself would ever ask for, is 900 m away.
 */
const PLACE = "lat=37.7968&lng=-122.4199&d=2026-06-21&t=1500";
/** Sultanahmet, Istanbul: no aerial photos. */
const ABROAD = "lat=41.0082&lng=28.9784&d=2026-06-21&t=1500";
const STORAGE_KEY = "sun-home:map-satellite:v1";

/** Counts what the page asks the picture services and the building tiles for, from now on. */
function watchRequests(page: Page) {
  const seen = { base: 0, detail: 0, buildings: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (IMAGERY_BASE_URL.test(url)) seen.base++;
    else if (IMAGERY_DETAIL_URL.test(url)) seen.detail++;
    else if (BUILDING_TILE_URL.test(url)) seen.buildings++;
  });
  return seen;
}

const satelliteButton = (page: Page) =>
  page.getByRole("button", {
    name: /^(Satellite photo\. Switch to map|Map\. Switch to satellite photo)$/,
  });
const tiltButton = (page: Page) =>
  page.getByRole("button", { name: /Switch to (tilted 3D|flat 2D)$/ });
const credit = (page: Page) => page.locator(".maplibregl-ctrl-attrib");

test.describe("Satellite view", () => {
  test("the button swaps the map for aerial photos, and back", async ({ app, page }) => {
    const seen = watchRequests(page);
    await app.openPlace(PLACE);
    const satellite = satelliteButton(page);
    await expect(satellite).toBeEnabled({ timeout: 15_000 });
    await expect(satellite).toHaveAccessibleName("Map. Switch to satellite photo");
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    // The map opens tilted (3D), drawing buildings.
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(credit(page)).not.toContainText("Imagery");
    expect([seen.base, seen.detail], "no pictures are asked for until they are wanted").toEqual([
      0, 0,
    ]);

    await app.press(satellite);
    await expect(satellite).toHaveAccessibleName("Satellite photo. Switch to map");
    await expect(satellite).toHaveAttribute("aria-pressed", "true");
    // Pictures come from both services: the quick base and, this close in, the detail.
    await expect.poll(() => seen.base).toBeGreaterThan(0);
    await expect.poll(() => seen.detail).toBeGreaterThan(0);
    await expect(credit(page)).toContainText("Imagery: USGS The National Map");
    await expect(credit(page).getByRole("link", { name: "USGS The National Map" })).toHaveAttribute(
      "href",
      "https://www.usgs.gov/programs/national-geospatial-program/national-map",
    );
    // The photos are taken from straight above: the camera lies flat.
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "false");

    // Back to the map: the camera returns to the 3D view it was left in, the
    // credit goes, and no more pictures are asked for.
    await app.press(satellite);
    await expect(satellite).toHaveAccessibleName("Map. Switch to satellite photo");
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(credit(page)).not.toContainText("Imagery");
    await page.waitForTimeout(400);
    const pictures = seen.base + seen.detail;
    await page.waitForTimeout(800);
    expect(seen.base + seen.detail, "no pictures are asked for once they are off").toBe(pictures);

    // None of this is the answer's business.
    await expect(app.includedNote).toBeAttached();
    await expect(app.buildingError).toHaveCount(0);
    await expect(app.mapUnavailable).toHaveCount(0);
  });

  test("over the photos the drawn buildings are gone: their tiles are not even loaded", async ({
    app,
    page,
  }) => {
    // Satellite was chosen on an earlier visit.
    await page.addInitScript((key) => localStorage.setItem(key, "1"), STORAGE_KEY);
    const seen = watchRequests(page);
    await app.openPlace(PLACE);
    const satellite = satelliteButton(page);
    await expect(satellite).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect.poll(() => seen.detail).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    // One building tile was fetched: by the sun computation, which needs it
    // whatever the map shows. The map itself drew none.
    expect(seen.buildings).toBe(1);
    await expect(app.includedNote).toBeAttached();

    // The map view draws them, so now it loads them.
    await app.press(satellite);
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => seen.buildings).toBeGreaterThan(1);
  });

  test("the 3D button leaves the photos for the tilted map", async ({ app, page }) => {
    await app.openPlace(PLACE);
    const satellite = satelliteButton(page);
    const tilt = tiltButton(page);
    await expect(satellite).toBeEnabled({ timeout: 15_000 });
    await app.press(satellite);
    await expect(satellite).toHaveAttribute("aria-pressed", "true");
    await expect(tilt).toHaveAccessibleName("Flat 2D view. Switch to tilted 3D");

    await app.press(tilt);
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    await expect(satellite).toHaveAccessibleName("Map. Switch to satellite photo");
    await expect(tilt).toHaveAttribute("aria-pressed", "true");
    await expect(tilt).toHaveAccessibleName("Tilted 3D view. Switch to flat 2D");
    await expect(credit(page)).not.toContainText("Imagery");
  });

  test("the choice is remembered in this browser", async ({ app, page }) => {
    await app.openPlace(PLACE);
    const satellite = satelliteButton(page);
    await expect(satellite).toBeEnabled({ timeout: 15_000 });
    await app.press(satellite);
    await expect(satellite).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("1");
    // Not in the link: a shared place opens as a map for the next person.
    expect(page.url()).not.toMatch(/sat|imagery|photo/i);

    await page.reload();
    const seen = watchRequests(page);
    await app.waitForAnswer();
    await expect(satelliteButton(page)).toHaveAttribute("aria-pressed", "true", {
      timeout: 15_000,
    });
    await expect.poll(() => seen.base).toBeGreaterThan(0);
    await expect.poll(() => seen.detail).toBeGreaterThan(0);
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "false");

    // Switching it off is remembered just the same.
    await app.press(satelliteButton(page));
    await expect(satelliteButton(page)).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await app.waitForAnswer();
    await expect(satelliteButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(satelliteButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("outside the United States there are no photos: the button says so and the map stays", async ({
    app,
    page,
  }) => {
    const seen = watchRequests(page);
    await app.openPlace(ABROAD);
    const satellite = satelliteButton(page);
    await expect(satellite).toBeEnabled({ timeout: 15_000 });
    await app.press(satellite);
    await expect(app.toast("Aerial photos are only available in the United States.")).toBeVisible();
    await expect(satellite).toHaveAttribute("aria-pressed", "false");
    await expect(satellite).toHaveAccessibleName("Map. Switch to satellite photo");
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "true");

    // Remembered as on from a place that has photos: here the normal map is drawn.
    await page.evaluate((key) => localStorage.setItem(key, "1"), STORAGE_KEY);
    await page.reload();
    await app.waitForAnswer();
    await expect(satelliteButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(satelliteButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(tiltButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(credit(page)).not.toContainText("Imagery");
    await page.waitForTimeout(500);
    expect([seen.base, seen.detail]).toEqual([0, 0]);
  });
});
