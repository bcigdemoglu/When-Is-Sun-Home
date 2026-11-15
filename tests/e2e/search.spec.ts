/**
 * Journey 2 — search: opening it (takeover on phones, inline with "/" on
 * desktop), suggestions, keyboard, the empty state, what happens when one or
 * both geocoders are down, coordinates, "Choose on the map" and clearing the
 * place.
 */
import {
  FIXTURE_BUILDING_COUNT,
  FIXTURE_QUERY,
  MOCK_ADDRESS,
  NOMINATIM_MOCK_ADDRESS,
  expect,
  test,
} from "./fixtures";

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

  test("Photon down: search waits for Enter, then asks Nominatim exactly once", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    mocks.photon.down();
    await search.open();
    await search.type("pacific");

    // The live search failed (one try, one retry): submit mode takes over.
    await expect(search.submitNote).toBeVisible();
    const submit = search.option("Search for pacific");
    await expect(submit).toBeVisible();
    await expect(submit).toContainText("Look this address up");
    await expect(search.searchFailed).toHaveCount(0);
    expect(mocks.photon.searches).toEqual(["pacific", "pacific"]);

    // From here on typing asks nobody: Photon is resting, Nominatim only answers a submit.
    await search.type(" ave");
    await expect(search.option("Search for pacific ave")).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(search.option("Search for pacific av")).toBeVisible();
    await search.type("e");
    await expect(search.option("Search for pacific ave")).toBeVisible();
    expect(mocks.photon.searches).toHaveLength(2);
    expect(mocks.nominatim.searches).toEqual([]);

    // Enter: one request, for the text as it stands.
    await page.keyboard.press("Enter");
    const first = search.option(/^2550 Pacific Avenue, San Francisco/);
    await expect(first).toBeVisible();
    await expect(
      search.list.getByRole("group", { name: "Addresses" }).getByRole("option"),
    ).toHaveCount(2);
    await expect(search.attribution).toHaveText(
      "Search by Photon / Nominatim · © OpenStreetMap contributors",
    );
    expect(mocks.nominatim.searches).toEqual(["pacific ave"]);
    // Still open, still in the field: nothing was picked yet.
    await expect(search.field).toBeFocused();

    await search.press(first);
    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toContainText("2550 Pacific Avenue");
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    // Exactly one Nominatim search in the whole journey; Photon was not asked again.
    expect(mocks.nominatim.searches).toEqual(["pacific ave"]);
    expect(mocks.photon.searches).toHaveLength(2);
  });

  test("Photon down: the “Search for …” row works by pointer, and nothing found says so", async ({
    app,
    search,
    mocks,
  }) => {
    await app.open();
    mocks.photon.down();
    mocks.nominatim.nothingFound();
    await search.open();
    await search.type("pacific");

    await search.press(search.option("Search for pacific"));
    await expect(search.noResults).toBeVisible();
    await expect(search.noResults).toContainText("pacific");
    await expect(search.chooseOnMap).toBeVisible();
    expect(mocks.nominatim.searches).toEqual(["pacific"]);
  });

  test("both geocoders down: says so, keeps the other ways in, and “Try again” recovers", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    mocks.photon.down();
    mocks.nominatim.down();
    await search.open();
    await search.type("pacific");
    await expect(search.option("Search for pacific")).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(search.searchFailed).toBeVisible();
    await expect(search.tryAgain).toBeVisible();
    // Never a dead end.
    await expect(search.useCurrentLocation).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    expect(mocks.nominatim.searches).toEqual(["pacific"]);

    mocks.nominatim.up();
    await search.press(search.tryAgain);
    await expect(search.option(/^2550 Pacific Avenue, San Francisco/)).toBeVisible();
    await expect(search.searchFailed).toHaveCount(0);
    expect(mocks.nominatim.searches).toEqual(["pacific", "pacific"]);
  });

  test("Photon down: a pin dropped on the map gets its address from Nominatim", async ({
    app,
    page,
    mocks,
  }) => {
    await app.open();
    mocks.photon.down();
    await expect(app.map).toBeVisible();
    const box = await app.map.boundingBox();
    if (!box) throw new Error("no map");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);

    await expect(app.pin).toBeVisible();
    await expect(app.placeTitle).toHaveText(NOMINATIM_MOCK_ADDRESS);
    await expect(page).toHaveURL(/&n=2698\+Pacific\+Avenue/);
    // Photon was tried once, found down, and Nominatim asked once — rounded to about 11 m.
    expect(mocks.photon.reverseLookups).toHaveLength(1);
    expect(mocks.nominatim.reverseLookups).toEqual(mocks.photon.reverseLookups);
    expect(mocks.nominatim.reverseLookups[0]).toMatch(/^-?\d+\.\d{4},-?\d+\.\d{4}$/);
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

  test("“Use my current location” in search pins the spot, or says why it cannot", async ({
    app,
    search,
    context,
    page,
  }) => {
    // Not allowed (the default in these tests): the row itself explains, and search stays open.
    await app.open();
    await search.open();
    await app.press(search.useCurrentLocation);
    await expect(search.useCurrentLocation).toContainText("Location is off for this site");
    await expect(search.useCurrentLocation).toContainText("site settings");
    await expect(search.list).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    await app.expectStartScreen();

    // Allowed: the same row pins the spot and search closes.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 37.7912, longitude: -122.4301, accuracy: 15 });
    await app.press(search.useCurrentLocation);
    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText(MOCK_ADDRESS);
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010/);
  });

  test("a location that arrives after search was closed pins nothing", async ({
    app,
    search,
    page,
    isPhone,
  }) => {
    interface SlowGeolocation {
      __answerLocation?: (latitude: number, longitude: number) => void;
    }
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (onSuccess) => {
        (window as unknown as SlowGeolocation).__answerLocation = (latitude, longitude) =>
          onSuccess({
            coords: { latitude, longitude, accuracy: 10 },
            timestamp: Date.now(),
          } as GeolocationPosition);
      };
    });
    await app.open();
    await search.open();
    await app.press(search.useCurrentLocation);
    await expect(search.useCurrentLocation).toContainText("Finding you…");

    // The person gives up waiting and closes search.
    if (isPhone) await search.back.tap();
    else {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
    await search.expectClosed();

    await page.evaluate(() => (window as unknown as SlowGeolocation).__answerLocation?.(40.7, -74));
    await app.expectStartScreen();
    await expect(page).not.toHaveURL(/lat=/);
    await expect(app.pin).toHaveCount(0);
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
