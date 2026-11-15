/**
 * Journey 1 — first run: the start screen, "Use my location" (granted,
 * imprecise, denied, late) and the example place.
 */
import { FIXTURE_BUILDING_COUNT, FIXTURE_PIN, MOCK_ADDRESS, expect, test } from "./fixtures";

interface GeolocationSpy {
  __locationRequests: number;
  __answerLocation?: (latitude: number, longitude: number) => void;
}

test.describe("First run", () => {
  test("the start screen asks the question and offers both ways in", async ({
    app,
    search,
    places,
    page,
    isPhone,
  }) => {
    await app.open();

    await expect(app.startHeading).toBeVisible();
    await expect(app.useMyLocation).toBeVisible();
    await expect(app.enterAddress).toBeVisible();
    await expect(isPhone ? search.pill : search.field).toBeVisible();
    await expect(places.open_).toHaveAccessibleName("Saved places");
    // No place yet: no time bar, no report, nothing in the address bar.
    await app.expectStartScreen();
    await expect(app.hero).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");

    // Below the two buttons (on phones: further down the sheet).
    if (isPhone) await app.moveSheetTo("full");
    await expect(places.emptyMessage).toBeVisible();
    await expect(app.seeExample).toBeVisible();
  });

  test("never asks for the location until the button is pressed", async ({ app, page }) => {
    await page.addInitScript(() => {
      const spy = window as unknown as GeolocationSpy;
      spy.__locationRequests = 0;
      const count = () => {
        spy.__locationRequests += 1;
      };
      navigator.geolocation.getCurrentPosition = count;
      navigator.geolocation.watchPosition = () => {
        count();
        return 0;
      };
    });
    const requests = () =>
      page.evaluate(() => (window as unknown as GeolocationSpy).__locationRequests);

    await app.open();
    await expect(app.startHeading).toBeVisible();
    // The map (the other thing that could ask) has started as well.
    await expect(app.map).toBeVisible();
    expect(await requests()).toBe(0);

    await app.press(app.useMyLocation);
    await expect.poll(requests).toBe(1);
    await expect(app.start.getByRole("button", { name: "Finding you…" })).toBeDisabled();
  });

  test("“Use my location” drops the pin there and answers", async ({
    app,
    timeBar,
    context,
    page,
    mocks,
    isPhone,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_PIN.lat,
      longitude: FIXTURE_PIN.lng,
      accuracy: 12,
    });
    await app.open();
    await app.press(app.useMyLocation);

    await app.waitForAnswer();
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(app.summaryFigure).toBeVisible();
    await expect(app.summaryStatus).not.toBeEmpty();
    await expect(timeBar.region).toBeVisible();
    if (isPhone) {
      await app.expectSheetAt("peek");
      await expect(app.summaryFigure).toBeInViewport();
    }

    // The spot gets its address in the background, and the link carries both.
    await expect(app.placeTitle).toHaveText(MOCK_ADDRESS);
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010&n=2200\+Sacramento/);
    // The lookup is sent rounded (about 11 m), never the exact fix.
    expect(mocks.photon.reverseLookups).toEqual(["37.7912,-122.4301"]);
    // A precise fix needs no warning.
    await expect(app.toast(/only accurate to/)).toHaveCount(0);
  });

  test("a rough fix still pins, and says how rough it is", async ({ app, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_PIN.lat,
      longitude: FIXTURE_PIN.lng,
      accuracy: 400,
    });
    await app.open();
    await app.press(app.useMyLocation);

    await expect(
      app.toast("Your location is only accurate to about 400 m. Drag the pin onto the exact spot."),
    ).toBeVisible();
    await app.waitForAnswer();
  });

  test("location denied: says so next to the button, and the address path still works", async ({
    app,
    search,
  }) => {
    // No permission granted: Chromium answers "denied" at once.
    await app.open();
    await app.press(app.useMyLocation);

    await expect(app.startAlert).toContainText("Location is blocked for this site.");
    await expect(app.startAlert).toContainText("enter an address instead");
    await expect(app.useMyLocation).toBeEnabled();
    await app.expectStartScreen();

    await app.press(app.enterAddress);
    await expect(search.field).toBeFocused();
    await search.type("pacific");
    await app.press(search.option(/^2140 Pacific Avenue, San Francisco/));

    await app.waitForAnswer();
    await expect(app.placeTitle).toContainText("2140 Pacific Avenue");
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
  });

  test("a location that arrives after another place was chosen is ignored", async ({
    app,
    page,
    isPhone,
  }) => {
    // A device that takes its time: the fix arrives when the test says so.
    await page.addInitScript(() => {
      const spy = window as unknown as GeolocationSpy;
      navigator.geolocation.getCurrentPosition = (onSuccess) => {
        spy.__answerLocation = (latitude, longitude) =>
          onSuccess({
            coords: { latitude, longitude, accuracy: 10 },
            timestamp: Date.now(),
          } as GeolocationPosition);
      };
    });
    await app.open();
    await app.press(app.useMyLocation);
    await expect(app.start.getByRole("button", { name: "Finding you…" })).toBeVisible();

    // Meanwhile the person opens the example instead.
    if (isPhone) await app.moveSheetTo("full");
    await app.press(app.seeExample);
    await expect(app.placeTitle).toContainText("Example: a backyard in Pacific Heights");
    await expect(page).toHaveURL(/lat=37\.79118/);

    // Now the fix comes in — for somewhere else entirely.
    await page.evaluate(() => (window as unknown as GeolocationSpy).__answerLocation?.(40.7, -74));
    await expect(app.placeTitle).toContainText("Example: a backyard in Pacific Heights");
    await app.waitForAnswer();
    await expect(page).toHaveURL(/lat=37\.79118/);
    await expect(page).not.toHaveURL(/lat=40\.7/);
  });

  test("with a place open, the map’s locate button moves the pin — or says why it cannot", async ({
    app,
    context,
    page,
    isPhone,
  }) => {
    await app.openPlace("lat=37.76956&lng=-122.24604&n=Open+field");
    // The map button (the start screen's big one is gone with the start screen).
    const scope = isPhone ? app.sheet : page;
    const locate = scope.getByRole("button", { name: "Use my location", exact: true });

    // Denied: there is no room next to the button, so it is said as a toast.
    await app.press(locate);
    await expect(app.toast(/^Location is blocked for this site\./)).toBeVisible();
    await expect(app.placeTitle).toHaveText("Open field");
    await expect(locate).toBeEnabled();

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_PIN.lat,
      longitude: FIXTURE_PIN.lng,
      accuracy: 20,
    });
    await app.press(locate);
    await expect(page).toHaveURL(/lat=37\.79120&lng=-122\.43010/);
    // A new spot: the old name is gone, the new address is looked up.
    await expect(app.placeTitle).toHaveText(MOCK_ADDRESS);
    await app.waitForAnswer();
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    if (isPhone) await app.expectSheetAt("peek");
  });

  test("“See an example” opens a real report", async ({ app, timeBar, isPhone }) => {
    await app.open();
    if (isPhone) await app.moveSheetTo("full");
    await app.press(app.seeExample);

    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText(
      "Example: a backyard in Pacific Heights, San Francisco",
    );
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(timeBar.region).toBeVisible();
    if (isPhone) await app.expectSheetAt("peek");
  });
});
