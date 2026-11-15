/**
 * Journey — paste a listing link: a Zillow (Redfin, Realtor.com, Trulia) link
 * holds the home's address in its text. Pasting one — into the field, with
 * the clipboard row, or from the start screen — goes to that house without a
 * second tap when the geocoder is sure of it, shows the list when it is not,
 * and says what to do about a link that carries no address.
 *
 * Nothing is ever requested from a listing site: every test here ends by
 * checking that (see `watchListingSites`).
 */
import { FIXTURE_BUILDING_COUNT, LISTING, NO_BUILDINGS_NOTE, expect, test } from "./fixtures";
import { watchListingSites } from "./helpers/mockMapData";

const SF_HOUSE_URL = /lat=37\.79120&lng=-122\.43010&n=2220\+Clay\+Street/;

test.describe("Listing links", () => {
  let listingSiteRequests: string[];

  test.beforeEach(async ({ page, context }) => {
    listingSiteRequests = watchListingSites(page);
    // Chromium asks before a page reads the clipboard; a person would say yes.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test.afterEach(async ({ page }) => {
    expect(listingSiteRequests, "requests sent to a listing site").toEqual([]);
    // Nor is the link ever put in the page's own address.
    expect(page.url()).not.toMatch(/zillow|redfin|realtor|trulia|zpid/i);
  });

  test("pasting a Zillow link opens that house, with no second tap", async ({
    app,
    search,
    page,
    mocks,
    isPhone,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.zillow);

    // No tap, no Enter: search closes by itself and the place is there.
    await search.expectClosed();
    await app.waitForAnswer();
    // Named by the geocoder, like any search result.
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
    await expect(app.includedNote).toContainText(`${FIXTURE_BUILDING_COUNT} nearby buildings`);
    await expect(page).toHaveURL(SF_HOUSE_URL);
    if (isPhone) {
      await expect(search.pill).toContainText("2220 Clay Street");
      await app.expectSheetAt("peek");
    } else {
      await expect(search.field).toHaveValue(LISTING.zillowPlace);
    }
    // One question, about the address — never the link's own text.
    expect(mocks.photon.searches).toEqual([LISTING.zillowAddress]);
    expect(mocks.nominatim.searches).toEqual([]);
    // An exact find needs no caveat.
    await expect(app.toast(/isn’t on the map yet/)).toHaveCount(0);
  });

  test("a link wrapped in a share sheet's sentence works the same", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.zillowShared);

    await search.expectClosed();
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
    await expect(page).toHaveURL(SF_HOUSE_URL);
    expect(mocks.photon.searches).toEqual([LISTING.zillowAddress]);
  });

  test("while the address is looked up, the list says where it comes from", async ({
    app,
    search,
    page,
  }) => {
    // Hold Photon's answer back to see the state in between.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/^https:\/\/photon\.komoot\.io\/api/, async (route) => {
      await held;
      await route.fallback();
    });
    await app.open();
    await search.open();
    await search.paste(LISTING.zillow);

    await expect(page.getByText("From this Zillow link", { exact: true })).toBeVisible();
    await expect(page.getByText(LISTING.zillowAddress, { exact: true })).toBeVisible();
    await expect(page.getByTestId("search-skeleton")).toBeVisible();
    // Still on the start screen, and the fixed rows are all there.
    await expect(search.chooseOnMap).toBeVisible();
    await expect(page).not.toHaveURL(/lat=/);

    release();
    await search.expectClosed();
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
  });

  test("a link with no address in it says so, and asks nobody anything", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.zpidOnly);

    await expect(search.noAddress).toContainText("From this Zillow link");
    await expect(search.noAddress).toContainText(
      "This Zillow link doesn’t include the address. Copy the link from the listing’s Share button, or type the address.",
    );
    // Not a search for the link's text, and not a dead end.
    await expect(search.noResults).toHaveCount(0);
    await expect(search.useCurrentLocation).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(search.list).toBeVisible();
    await app.expectStartScreen();
    await expect(page).not.toHaveURL(/lat=/);
    expect(mocks.photon.searches).toEqual([]);
    expect(mocks.nominatim.searches).toEqual([]);
  });

  test("when the geocoder is not sure, the list is shown to choose from", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.unclear);

    // The geocoders know number 2140 in three towns — not 2141. Nothing opens.
    const group = search.fromLink("Zillow");
    await expect(group).toBeVisible();
    await expect(group).toContainText(LISTING.unclearAddress);
    await expect(group.getByRole("option")).toHaveText([
      /^2140 Pacific Avenue.*San Francisco/,
      /^2140 Pacific Avenue.*Alameda/,
      /^2140 Pacific Avenue.*Tacoma/,
      /^Edit this address/,
    ]);
    await expect(search.field).toBeFocused();
    await app.expectStartScreen();
    await expect(page).not.toHaveURL(/lat=/);
    // Both services were asked — the whole address, then without the city — and no more.
    expect(mocks.photon.searches).toEqual([LISTING.unclearAddress, "2141 Pacific Ave, CA 94115"]);
    expect(mocks.nominatim.searches).toEqual([
      LISTING.unclearAddress,
      "2141 Pacific Ave, CA 94115",
    ]);

    // The person chooses; it stays a choice (nothing opened by itself meanwhile).
    await search.press(group.getByRole("option", { name: /Alameda/ }));
    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toContainText("2140 Pacific Avenue, Alameda");
    await expect(app.includedNote).toHaveText(NO_BUILDINGS_NOTE);
  });

  test("a house only known along its street opens too, and says it is approximate", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.approximate);

    await search.expectClosed();
    await expect(app.placeTitle).toHaveText(LISTING.approximatePlace);
    await expect(
      app.toast("Near 212 Murray Lane: this house isn’t on the map yet. Drag the pin onto it."),
    ).toBeVisible();
    await expect(page).toHaveURL(/lat=32\.94956&lng=-96\.75743&n=212\+Murray\+Lane/);
    await expect(app.pin).toBeVisible();
    // Photon did not know it (asked with and without the city); Nominatim did, at once.
    expect(mocks.photon.searches).toEqual([
      "212 Murray Ln, Richardson, TX 75080",
      "212 Murray Ln, TX 75080",
    ]);
    expect(mocks.nominatim.searches).toEqual(["212 Murray Ln, Richardson, TX 75080"]);
  });

  test("an address nobody knows: says so, and one tap makes it editable text", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.paste(LISTING.unknown);

    const group = search.fromLink("Realtor.com");
    await expect(group).toContainText(`No match for “${LISTING.unknownAddress}”.`);
    await expect(group.getByRole("option")).toHaveText([/^Edit this address/]);
    await expect(search.chooseOnMap).toBeVisible();
    await app.expectStartScreen();

    const asked = mocks.photon.searches.length;
    await search.press(search.editAddress);
    await expect(search.field).toHaveValue(LISTING.unknownAddress);
    await expect(search.field).toBeFocused();
    // From here on it is an ordinary search for that text.
    await expect(search.fromLink("Realtor.com")).toHaveCount(0);
    await expect(search.noResults).toContainText(LISTING.unknownAddress);
    expect(mocks.photon.searches.slice(asked)).toEqual([LISTING.unknownAddress]);
    await expect(page).not.toHaveURL(/lat=/);
  });

  test("Photon down: a pasted link is still found, by the second service", async ({
    app,
    search,
    mocks,
  }) => {
    await app.open();
    mocks.photon.down();
    await search.open();
    await search.paste(LISTING.approximate);

    await search.expectClosed();
    await expect(app.placeTitle).toHaveText(LISTING.approximatePlace);
    // Photon was tried once and then left alone.
    expect(mocks.photon.searches).toHaveLength(1);
    expect(mocks.nominatim.searches).toEqual(["212 Murray Ln, Richardson, TX 75080"]);
  });

  test("“Paste a listing link” in search reads the clipboard and goes there", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.copy(LISTING.zillow);
    await search.open();

    // The third fixed row, after “Choose on the map”.
    await expect(search.options).toHaveText([
      /^Use my current location/,
      /^Choose on the map/,
      /^Paste a listing linkZillow, Redfin, Realtor\.com or Trulia$/,
    ]);
    await search.press(search.pasteLink);

    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
    await expect(page).toHaveURL(SF_HOUSE_URL);
    expect(mocks.photon.searches).toEqual([LISTING.zillowAddress]);
  });

  test("“Paste a listing link” with no link copied says so and leaves search as it was", async ({
    app,
    search,
    mocks,
  }) => {
    await app.open();
    await search.copy("milk, eggs, 2220 Clay St");
    await search.open();
    await search.press(search.pasteLink);

    await expect(
      app.toast(
        "No listing link on the clipboard. Copy a home’s link from Zillow, Redfin, Realtor.com or Trulia first.",
      ),
    ).toBeVisible();
    await expect(search.list).toBeVisible();
    await expect(search.field).toHaveValue("");
    await expect(search.pasteLink).toBeVisible();
    expect(mocks.photon.searches).toEqual([]);

    // The row is a way in for an empty field: it steps aside for what is typed.
    await search.type("pacific");
    await expect(search.option(/^2140 Pacific Avenue, San Francisco/)).toBeVisible();
    await expect(search.pasteLink).toHaveCount(0);
    await expect(search.chooseOnMap).toBeVisible();
  });

  test("“Paste a listing link” when the browser refuses the clipboard: a toast, no dead end", async ({
    app,
    search,
    context,
  }) => {
    await app.open();
    await search.copy(LISTING.zillow);
    // The person (or the browser) says no.
    await context.clearPermissions();
    await search.open();
    await search.press(search.pasteLink);

    await expect(
      app.toast("Couldn’t read the clipboard. Paste the link into the search field instead."),
    ).toBeVisible();
    await expect(search.list).toBeVisible();
    await expect(search.chooseOnMap).toBeVisible();
    await app.expectStartScreen();
  });

  test("the start screen's third action goes straight to the copied listing", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.copy(LISTING.zillow);

    // Quieter than the two big buttons above it.
    await expect(app.pasteListingLink).toBeVisible();
    expect((await app.pasteListingLink.boundingBox())?.height).toBe(44);
    const ways = ["Use my location", "Enter an address", "Paste a listing link"];
    const buttons = await app.start.getByRole("button").allTextContents();
    expect(buttons.filter((text) => ways.includes(text))).toEqual(ways);

    await app.press(app.pasteListingLink);
    await search.expectClosed();
    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
    await expect(page).toHaveURL(SF_HOUSE_URL);
    // Only ever about the address. (Search opens ON the link here, and a
    // development build mounts it twice — React's strict mode — so the one
    // question may be sent again; a production build asks once.)
    expect([...new Set(mocks.photon.searches)]).toEqual([LISTING.zillowAddress]);
    expect(mocks.nominatim.searches).toEqual([]);
  });

  test("the start screen's third action opens search on a link that needs a choice", async ({
    app,
    search,
    page,
  }) => {
    await app.open();
    await search.copy(LISTING.unclear);
    await app.press(app.pasteListingLink);

    await expect(search.list).toBeVisible();
    await expect(search.field).toHaveValue(LISTING.unclear);
    await expect(search.fromLink("Zillow").getByRole("option")).toHaveCount(4);
    await expect(page).not.toHaveURL(/lat=/);
  });

  test("the start screen's third action with nothing useful copied only says so", async ({
    app,
    search,
  }) => {
    await app.open();
    await search.copy("https://example.com/not-a-listing");
    await app.press(app.pasteListingLink);

    await expect(app.toast(/^No listing link on the clipboard\./)).toBeVisible();
    await search.expectClosed();
    await app.expectStartScreen();
  });

  test("a link typed by hand gets suggestions for its address and opens nothing by itself", async ({
    app,
    search,
    page,
    mocks,
  }) => {
    await app.open();
    await search.open();
    await search.type(LISTING.zillow);

    const group = search.fromLink("Zillow");
    await expect(group.getByRole("option", { name: /^2220 Clay Street/ })).toBeVisible();
    await app.expectStartScreen();
    await expect(page).not.toHaveURL(/lat=/);
    // Typing never involves the second service.
    expect(mocks.nominatim.searches).toEqual([]);

    // Enter is the same as pasting: look it up properly and go.
    await page.keyboard.press("Enter");
    await search.expectClosed();
    await expect(app.placeTitle).toHaveText(LISTING.zillowPlace);
  });
});

test.describe("Listing links — small screens", () => {
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`${viewport.width} × ${viewport.height}`, () => {
      test.use({ viewport });

      test("the search says a link will do, in full", async ({ app, search, isPhone }) => {
        test.skip(!isPhone, "phone layout only");
        await app.open();
        // In the pill …
        await expect(search.pill).toHaveText("Address or Zillow link");
        const pill = await search.pill.locator("span").evaluate((text) => ({
          needs: text.scrollWidth,
          has: text.clientWidth,
        }));
        expect(pill.needs, "the pill's text is cut off").toBeLessThanOrEqual(pill.has);
        // … and in the field it opens.
        await search.pill.tap();
        const field = await search.field.evaluate((input: HTMLInputElement) => {
          const style = getComputedStyle(input);
          const probe = document.createElement("span");
          probe.style.font = style.font;
          probe.style.letterSpacing = style.letterSpacing;
          probe.style.whiteSpace = "nowrap";
          probe.style.position = "absolute";
          probe.style.visibility = "hidden";
          probe.textContent = input.placeholder;
          document.body.append(probe);
          const needs = probe.getBoundingClientRect().width;
          probe.remove();
          return {
            placeholder: input.placeholder,
            needs,
            has:
              input.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight),
          };
        });
        expect(field.placeholder).toBe("Address or Zillow link");
        expect(field.needs, "the placeholder is cut off").toBeLessThanOrEqual(field.has);
      });

      test("the start sheet shows all three ways in at its start height, clear of the search pill", async ({
        app,
        search,
        context,
        page,
        isPhone,
      }) => {
        test.skip(!isPhone, "phone layout only");
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await app.open();
        await app.expectSheetAt("peek");

        const boxes = [];
        for (const button of [app.useMyLocation, app.enterAddress, app.pasteListingLink]) {
          await expect(button).toBeInViewport({ ratio: 1 });
          const box = await button.boundingBox();
          if (!box) throw new Error("a start action has no box");
          boxes.push(box);
        }
        expect(boxes.map((box) => box.height)).toEqual([56, 56, 44]);
        // Stacked in order, the third wholly on screen.
        expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
        expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].height);
        expect(boxes[2].y + boxes[2].height).toBeLessThanOrEqual(viewport.height);
        // The map still shows between the pill and the sheet.
        const pill = await search.pill.boundingBox();
        const sheet = await app.sheet.boundingBox();
        if (!pill || !sheet) throw new Error("no pill or sheet");
        expect(sheet.y - (pill.y + pill.height)).toBeGreaterThanOrEqual(120);
        // Nothing scrolls sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
          viewport.width,
        );
      });
    });
  }
});
