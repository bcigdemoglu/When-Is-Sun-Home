/**
 * The buildings on the map away from the pin.
 *
 * Around the pin the app loads building tiles for the sun computation. The
 * map draws its 3D buildings from the same tiles by itself, for whatever is
 * in view — so moving the map beyond the pin's surroundings must load the
 * tiles there, and nothing about them may ever disturb the answer: they are
 * decoration.
 *
 * WebGL pixels are not looked at here (they differ by machine); what the map
 * asks the network for, and what the page says, are.
 */
import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { MapHand } from "./helpers/mapHand";
import { BUILDING_TILE_URL } from "./helpers/mockMapData";

/**
 * A pin in the middle of fixture tile 14/2620/6331, 900 m west of its east
 * edge: the sun computation needs that one tile only, and the next tile east
 * (2621) is a few screens away.
 */
const PLACE = "lat=37.7968&lng=-122.4199&d=2026-06-21&t=1500";
const PIN_TILE = "2620/6331";

/** "x/y" of a building tile request, or null for any other request. */
function tileOf(request: Request): string | null {
  const match = BUILDING_TILE_URL.exec(request.url());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Collects the building tiles the page asks for from now on. */
function watchTiles(page: Page): { all: string[]; far: () => string[] } {
  const all: string[] = [];
  page.on("request", (request) => {
    const tile = tileOf(request);
    if (tile) all.push(tile);
  });
  return { all, far: () => all.filter((tile) => tile !== PIN_TILE) };
}

test.describe("Buildings on the map", () => {
  test("moving the map beyond the pin's surroundings loads the buildings there", async ({
    app,
    page,
    isPhone,
  }) => {
    const tiles = watchTiles(page);
    await app.openPlace(PLACE);
    const answer = await app.summaryFigure.textContent();
    // Once for the sun computation, and once more by the map, for what is in view.
    await expect.poll(() => tiles.all.length).toBeGreaterThan(1);
    expect(tiles.far(), "nothing beyond the pin's surroundings is loaded unasked").toEqual([]);

    await new MapHand(page, isPhone).panEastUntil(() => tiles.far().length > 0);
    expect(tiles.far().length).toBeGreaterThan(0);
    // East of the pin's tile, in the row the map was dragged along.
    expect(tiles.far().every((tile) => Number(tile.split("/")[0]) >= 2621)).toBe(true);

    // The pin, and the answer for it, have not moved.
    await expect(app.summaryFigure).toHaveText(answer!);
    await expect(app.buildingNotice).toHaveCount(0);
    await expect(app.buildingError).toHaveCount(0);
    // (Any request that is not a zoom-14 tile of the mocked host would have
    // failed the test as a stray request: see `fixtures.ts`.)
  });

  test("zoomed out beyond street level, nothing more is loaded", async ({ app, page, isPhone }) => {
    test.skip(isPhone, "the zoom buttons exist on the desktop layout only");
    await app.openPlace(PLACE);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    // 17.5 → 14.5: below the zoom the buildings are drawn from.
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 3; i++) {
      await zoomOut.click();
      await page.waitForTimeout(400);
    }
    const tiles = watchTiles(page);
    // Three screens to the east: 5 km at this zoom.
    const hand = new MapHand(page, false);
    for (let i = 0; i < 3; i++) {
      await hand.dragLeft(700);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);
    expect(tiles.all).toEqual([]);
  });

  test("the map credits the building data", async ({ app, page }) => {
    await app.openPlace(PLACE);
    const credit = page.locator(".maplibregl-ctrl-attrib");
    await expect(credit).toContainText("Buildings: OpenFreeMap © OpenMapTiles © OpenStreetMap");
    await expect(credit.getByRole("link", { name: "OpenFreeMap" })).toHaveAttribute(
      "href",
      "https://openfreemap.org",
    );
  });

  test("building tiles that fail away from the pin are no one's problem, and come back", async ({
    app,
    page,
    mocks,
    isPhone,
  }) => {
    await app.openPlace(PLACE);
    const answer = await app.summaryFigure.textContent();

    // From here on the tile host is down.
    mocks.buildings.fail();
    const failed: string[] = [];
    page.on("requestfailed", (request) => {
      const tile = tileOf(request);
      if (tile && tile !== PIN_TILE) failed.push(tile);
    });
    await new MapHand(page, isPhone).panEastUntil(() => failed.length > 0);
    expect(failed.length).toBeGreaterThan(0);
    // One more try by itself a second later; then it lets the matter rest.
    await page.waitForTimeout(2500);
    const settled = failed.length;
    expect(settled).toBeGreaterThan(1);
    await page.waitForTimeout(2500);
    expect(failed.length, "no retry loop").toBe(settled);

    // Nothing is said, nothing is lost.
    await expect(app.buildingError).toHaveCount(0);
    await expect(app.buildingNotice).toHaveCount(0);
    await expect(app.mapUnavailable).toHaveCount(0);
    await expect(app.summaryFigure).toHaveText(answer!);
    await expect(app.includedNote).toBeAttached();

    // The connection is back: the missing tiles are asked for again and arrive.
    mocks.buildings.recover();
    const arrived = page.waitForResponse((response) => {
      const tile = tileOf(response.request());
      return tile !== null && failed.includes(tile) && response.status() < 400;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await arrived;
  });
});
