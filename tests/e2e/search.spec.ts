/**
 * Journey 2 — search: opening it (takeover on phones, inline with "/" on
 * desktop), suggestions, keyboard, the empty / failed states, coordinates,
 * "Choose on the map" and clearing the place.
 */
import { FIXTURE_BUILDING_COUNT, FIXTURE_QUERY, MOCK_ADDRESS, expect, test } from "./fixtures";

const SF = "2140 Pacific Avenue, San Francisco, California, United States";

test.describe("Search", () => {
  test("phone: tapping the pill opens a full-screen search with the field focused", async ({
    app,
    search,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "phone layout only");
    await app.open();
    await search.pill.tap();

    await expect(search.overlay).toBeVisible();
    await expect(search.field).toBeFocused();
    // A takeover: it covers the whole screen.
    const box = await search.overlay.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toEqual({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });
    // The fixed rows are there before anything is typed.
    await expect(search.useCurrentLocation).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    await expect(search.clearText).toHaveCount(0);

    // Back closes it and hands the focus back to the pill.
    await search.back.tap();
    await search.expectClosed();
    await expect(search.pill).toBeFocused();
  });

  test("desktop: “/” focuses the inline field and the list drops down in place", async ({
    app,
    search,
    places,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "desktop layout only");
    await app.open();
    await expect(search.list).toHaveCount(0);

    await page.keyboard.press("/");
    await expect(search.field).toBeFocused();
    await expect(search.field).toHaveValue(""); // the slash itself is not typed
    await expect(search.field).toHaveAttribute("aria-expanded", "true");
    await expect(search.useCurrentLocation).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    // In place: no dialog, the page behind is still there.
    await expect(search.overlay).toHaveCount(0);
    await expect(app.startHeading).toBeVisible();

    // First Escape puts the list away, the second gives the field up.
    await page.keyboard.press("Escape");
    await expect(search.list).toHaveCount(0);
    await expect(search.field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search.field).not.toBeFocused();

    // A click elsewhere closes it too.
    await search.open();
    await places.emptyMessage.click();
    await search.expectClosed();
  });

  test("typing shows suggestions; arrow keys and Enter pick one", async ({
    app,
    search,
    page,
    mocks,
    isPhone,
  }) => {
    await app.open();
    await search.open();
    await search.type("pacific");

    const addresses = search.list.getByRole("group", { name: "Addresses" });
    await expect(addresses.getByRole("option")).toHaveCount(3);
    await expect(addresses.getByRole("option").first()).toHaveAccessibleName(SF);
    await expect(page.getByRole("status").filter({ hasText: "3 results" })).toBeAttached();
    // The typed part is marked in the rows.
    await expect(search.option(SF).locator(".font-semibold").first()).toHaveText("Pacific");

    // ↓ walks the list from the top: location, map, then the addresses.
    await page.keyboard.press("ArrowDown");
    await expect(search.activeOption).toHaveAccessibleName(/^Use my current location/);
    await page.keyboard.press("ArrowDown");
    await expect(search.activeOption).toHaveAccessibleName(/^Choose on the map/);
    await page.keyboard.press("ArrowDown");
    await expect(search.activeOption).toHaveAccessibleName(SF);
    // The field points assistive tech at the highlighted row.
    const activeId = await search.activeOption.getAttribute("id");
    expect(activeId).toBeTruthy();
    await expect(search.field).toHaveAttribute("aria-activedescendant", activeId ?? "");
    await page.keyboard.press("ArrowDown");
    await expect(search.activeOption).toHaveAccessibleName(/Alameda/);
    await page.keyboard.press("ArrowUp");
    await expect(search.activeOption).toHaveAccessibleName(SF);
    // Focus never left the text field.
    await expect(search.field).toBeFocused();

    await page.keyboard.press("Enter");
    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText(SF);
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010&n=2140\+Pacific\+Avenue/);
    if (isPhone) {
      await expect(search.pill).toContainText("2140 Pacific Avenue");
      await app.expectSheetAt("peek");
    } else {
      await expect(search.field).toHaveValue(SF);
    }
    // One request per pause in typing, not one per key.
    expect(mocks.photon.searches.filter((query) => query !== "pacific")).toEqual([]);
  });

  test("picking a suggestion by pointer opens that place (one with no mapped buildings)", async ({
    app,
    search,
  }) => {
    await app.open();
    await search.find("pacific", /Alameda/);

    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toContainText("2140 Pacific Avenue, Alameda");
    await expect(app.includedNote).toHaveText(
      "Estimate: no buildings were found nearby, so nothing blocks the sun here.",
    );
  });

  test("one letter is not searched; nothing found says so and keeps the ways out", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();

    await search.type("p");
    await expect(page.getByText("Keep typing to search addresses.")).toBeVisible();
    expect(mocks.photon.searches).toEqual([]);

    await search.field.fill("");
    await search.type("zzzz");
    await expect(search.noResults).toBeVisible();
    await expect(search.noResults).toContainText("zzzz");
    await expect(search.noResults).toContainText("choose the spot on the map");
    // Never a dead end: the two fixed rows are still there.
    await expect(search.useCurrentLocation).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    await expect(search.list.getByRole("group", { name: "Addresses" })).toHaveCount(0);

    // ⓧ clears the text and keeps the field focused.
    await app.press(search.clearText);
    await expect(search.field).toHaveValue("");
    await expect(search.field).toBeFocused();
    await expect(search.noResults).toHaveCount(0);
  });

  test("a failed search says so, and “Try again” recovers", async ({ app, search, mocks }) => {
    await app.open();
    mocks.photon.failSearches();
    await search.open();
    await search.type("pacific");

    await expect(search.searchFailed).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();

    mocks.photon.searchWorks();
    await app.press(search.tryAgain);
    await expect(search.option(SF)).toBeVisible();
    await expect(search.searchFailed).toHaveCount(0);
  });

  test("coordinates typed by hand go straight to that spot, without a lookup", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.type("37.7912, -122.4301");

    const row = search.list
      .getByRole("group", { name: "Coordinates" })
      .getByRole("option", { name: "37.7912° N, 122.4301° W, Go to these coordinates" });
    await expect(row).toBeVisible();
    await app.press(row);

    await app.waitForAnswer();
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010/);
    expect(mocks.photon.searches).toEqual([]);
  });

  test("“Choose on the map” closes search; a tap on the map then drops the pin", async ({
    app,
    search,
    page,
  }) => {
    await app.open();
    await search.open();
    await app.press(search.chooseOnMap);

    await search.expectClosed();
    await expect(app.toast("Tap the map where you want the pin")).toBeVisible();
    await app.expectStartScreen();

    // The map shows the default view; anywhere on it is a valid spot.
    await expect(app.map).toBeVisible();
    const box = await app.map.boundingBox();
    if (!box) throw new Error("no map");
    // Upper part of the map: clear of the sheet, the time bar and the controls.
    const spot = { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
    await page.mouse.click(spot.x, spot.y);

    await expect(app.pin).toBeVisible();
    await app.waitForAnswer();
    await expect(page).toHaveURL(/lat=-?\d+\.\d+&lng=-?\d+\.\d+/);
    // The dropped pin gets its address looked up.
    await expect(app.placeTitle).toHaveText(MOCK_ADDRESS);
  });

  test("ⓧ forgets the place and returns to the start screen", async ({
    app,
    search,
    page,
    isPhone,
  }) => {
    await app.openPlace(FIXTURE_QUERY);
    // A link without a name: the address was looked up for it.
    if (isPhone) await expect(search.pill).toContainText(MOCK_ADDRESS);
    else await expect(search.field).toHaveValue(MOCK_ADDRESS);

    await app.press(search.clearPlace);

    await app.expectStartScreen();
    await expect(app.hero).toHaveCount(0);
    await expect(search.clearPlace).toHaveCount(0);
    await expect(page).not.toHaveURL(/lat=/);
    // And it stays forgotten.
    await page.reload();
    await app.expectStartScreen();
  });

  test("searching again from a report replaces the place", async ({ app, search }) => {
    await app.openPlace(FIXTURE_QUERY);
    await search.open();
    // The field starts with the current place selected, so typing replaces it.
    await search.type("pacific");
    await app.press(search.option(/Tacoma/));

    await search.expectClosed();
    await expect(app.placeTitle).toContainText("2140 Pacific Avenue, Tacoma");
    await app.waitForAnswer();
    await expect(app.includedNote).toContainText("no buildings were found nearby");
  });
});
