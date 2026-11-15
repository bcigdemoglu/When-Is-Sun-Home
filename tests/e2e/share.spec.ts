/**
 * Journey 9 — sharing: the desktop popover (link, Copy, QR code, the
 * day-and-time choice), the system share sheet on phones, and — the point of
 * it all — that the link shows the recipient the very same report.
 */
import { FIXTURE_PIN, FIXTURE_QUERY, MOCK_ADDRESS, SUMMER_NOON, expect, test } from "./fixtures";
import { stubClipboard, stubNativeShare } from "./pages/share";

const PIN = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}`;

test.describe("Share", () => {
  test("desktop: the popover has the link, a Copy button that confirms, and a QR code", async ({
    app,
    share,
    page,
    context,
    isPhone,
  }) => {
    test.skip(isPhone, "phones use the system share sheet");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await app.openPlace(`${FIXTURE_QUERY}&n=Elm+St+backyard`);

    await expect(share.button).toHaveAttribute("aria-expanded", "false");
    await share.button.click();
    await expect(share.popover).toBeVisible();
    await expect(share.button).toHaveAttribute("aria-expanded", "true");
    await expect(share.copy).toBeFocused();

    // The card a chat app will show: the place, the viewpoint, the number.
    await expect(share.popover).toContainText("Elm St backyard");
    await expect(share.popover).toContainText("Yard · ground");
    await expect(share.popover).toContainText("Direct sun · average day");
    await expect(share.popover).toContainText("6.4");
    await expect(share.popover).toContainText("12.6 h in July · none in January");

    // The link: place, name, day and time, plus the headline numbers (`s`) for the preview.
    const link = new URL(await share.link.inputValue());
    expect(link.origin + link.pathname).toBe(new URL("/", page.url()).href);
    expect(Object.fromEntries(link.searchParams)).toEqual({
      lat: "37.79120",
      lng: "-122.43010",
      n: "Elm St backyard",
      d: "2026-06-21",
      t: "1500",
      s: expect.stringMatching(/^1\.[0-9a-z.]+$/),
    });
    await expect(share.link).toHaveAttribute("readonly", "");
    await expect(share.qrCode).toBeVisible();
    await expect(share.popover).toContainText("Open on your phone");

    await share.copy.click();
    await expect(share.copy).toHaveText("Copied");
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link.href);
    // The confirmation steps back after a moment.
    await expect(share.copy).toHaveText("Copy link");
  });

  test("desktop: the day-and-time choice changes the link", async ({ app, share, isPhone }) => {
    test.skip(isPhone, "phones use the system share sheet");
    await app.openPlace(FIXTURE_QUERY);
    await share.button.click();

    // A pinned day and time is included by default …
    await expect(share.includeDateTime).toBeChecked();
    await expect(share.popover).toContainText("Opens on Sun, Jun 21 at 3:00 PM.");
    await expect(share.link).toHaveValue(/&d=2026-06-21&t=1500&/);

    // … and can be left out: the link then opens on "today, now".
    await share.includeDateTime.uncheck();
    await expect(share.popover).toContainText("Opens on the current day and time.");
    await expect(share.link).not.toHaveValue(/[?&](d|t)=/);
    await expect(share.link).toHaveValue(/[?&]s=/);

    await share.includeDateTime.check();
    await expect(share.link).toHaveValue(/&d=2026-06-21&t=1500&/);
  });

  test("desktop: Escape closes the popover and returns focus; a click elsewhere closes it too", async ({
    app,
    share,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "phones use the system share sheet");
    await app.openPlace(FIXTURE_QUERY);

    await share.button.click();
    await expect(share.popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(share.popover).toHaveCount(0);
    await expect(share.button).toBeFocused();
    await expect(share.button).toHaveAttribute("aria-expanded", "false");

    // The Share button toggles; its own Close button closes; so does a click on the page.
    await share.button.click();
    await expect(share.popover).toBeVisible();
    await share.button.click();
    await expect(share.popover).toHaveCount(0);

    await share.button.click();
    await share.close.click();
    await expect(share.popover).toHaveCount(0);
    await expect(share.button).toBeFocused();

    await share.button.click();
    await expect(share.popover).toBeVisible();
    await app.heroFigure.click();
    await expect(share.popover).toHaveCount(0);
    // Not a modal: the page behind kept working.
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
  });

  test.describe("live view", () => {
    test.use({ now: SUMMER_NOON });

    test("desktop: a live view shares a live link unless the day and time are asked for", async ({
      app,
      share,
      isPhone,
    }) => {
      test.skip(isPhone, "phones use the system share sheet");
      await app.openPlace(PIN);
      await share.button.click();

      await expect(share.includeDateTime).not.toBeChecked();
      await expect(share.link).not.toHaveValue(/[?&](d|t)=/);

      await share.includeDateTime.check();
      await expect(share.popover).toContainText(/Opens on Sun, Jun 21 at 12:0\d PM\./);
      await expect(share.link).toHaveValue(/&d=2026-06-21&t=120\d&/);
    });
  });

  test("phone: one tap hands title, text and link to the system share sheet", async ({
    app,
    share,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "desktop uses the popover");
    await stubNativeShare(page);
    await app.openPlace(`${FIXTURE_QUERY}&n=Elm+St+backyard`);

    await share.button.tap();
    await expect.poll(() => share.shared()).toHaveLength(1);
    const [shared] = await share.shared();
    expect(shared.title).toBe("Elm St backyard: 6.4 h of direct sun a day");
    expect(shared.text).toBe(
      "Elm St backyard: 6.4 h of direct sun on an average day (12.6 h in July, none in January). See the full year:",
    );
    const link = new URL(shared.url ?? "");
    expect(link.origin).toBe(new URL(page.url()).origin);
    expect(Object.fromEntries(link.searchParams)).toEqual({
      lat: "37.79120",
      lng: "-122.43010",
      n: "Elm St backyard",
      d: "2026-06-21",
      t: "1500",
      s: expect.stringMatching(/^1\.[0-9a-z.]+$/),
    });
    // No popover on phones, and nothing to confirm: the system sheet did the talking.
    await expect(share.popover).toHaveCount(0);
    await expect(share.toast("Link copied")).toHaveCount(0);
  });

  test("phone: closing the share sheet is not an error; a broken one copies the link instead", async ({
    app,
    share,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "desktop uses the popover");
    await stubNativeShare(page, "dismissed");
    await stubClipboard(page);
    await app.openPlace(FIXTURE_QUERY);

    await share.button.tap();
    await expect.poll(() => share.shared()).toHaveLength(1);
    await expect(share.popover).toHaveCount(0);
    expect(await share.copied()).toEqual([]);

    // Same phone, but the sheet refuses (as inside some in-app browsers).
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")),
      });
    });
    await share.button.tap();
    await expect(share.toast("Link copied")).toBeVisible();
    const copied = await share.copied();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("lat=37.79120&lng=-122.43010");
    expect(copied[0]).toContain("&d=2026-06-21&t=1500");
  });

  test("the link shows somebody else the same place, viewpoint, moment and numbers", async ({
    app,
    share,
    places,
    viewpoint,
    timeBar,
    page,
    newVisitor,
    isPhone,
  }) => {
    if (isPhone) await stubNativeShare(page);
    // A 2nd-floor window facing east with a narrow view, on the September equinox at 10:30 …
    await app.openPlace(`${PIN}&d=2026-09-22&t=1030&m=w&h=4.5&dir=90&fov=90`);
    // … saved under the sender's own name for it.
    await places.saveCurrent();
    await places.press(places.toastAction("Rename"));
    await places.renameTo("Elm St backyard");
    // Wait for the saved numbers, so the link is taken from a settled page.
    await expect(app.placeTitle).toHaveText("Elm St backyard");

    const sent = {
      daySun: await app.summaryFigure.textContent(),
      status: await app.summaryStatus.textContent(),
      average: await app.heroFigure.textContent(),
      share: await app.hero.locator(":scope > p").nth(1).textContent(),
    };
    const link = await share.currentLink();

    const visitor = await newVisitor();
    await visitor.app.openLink(link);

    await expect(visitor.app.placeTitle).toHaveText("Elm St backyard");
    await expect(visitor.page.getByRole("button", { name: /^Viewpoint/ }).first()).toContainText(
      "Window · 2nd floor · facing E",
    );
    await expect(
      visitor.page.getByRole("slider", { name: "Time of day", exact: true }),
    ).toHaveValue("630");
    await expect(
      visitor.page.getByRole("button", { name: /Change the day$/ }),
    ).toHaveAccessibleName("Tue, Sep 22, 10:30 AM PDT. Change the day");
    await expect(visitor.app.summaryCaption).toContainText("on Tue, Sep 22");
    // The very same numbers, computed afresh on the other side.
    await expect(visitor.app.summaryFigure).toHaveText(sent.daySun ?? "");
    await expect(visitor.app.summaryStatus).toHaveText(sent.status ?? "");
    await expect(visitor.app.heroFigure).toHaveText(sent.average ?? "");
    await expect(visitor.app.hero.locator(":scope > p").nth(1)).toHaveText(sent.share ?? "");
    await expect(visitor.app.hero.getByRole("heading")).toHaveText(
      "Sun through this window · average day",
    );
    // It is their browser: the place is not in THEIR saved list.
    await expect(visitor.page.getByRole("button", { name: "Save this place" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The preview numbers (`s`) are for link cards only: the address bar drops them.
    await expect(visitor.page).toHaveURL(
      /\?lat=37\.79120&lng=-122\.43010&n=Elm\+St\+backyard&d=2026-09-22&t=1030&m=w&h=4\.5&dir=90&fov=90$/,
    );

    // Sender's side, for the record: the viewpoint and moment were what was sent.
    await expect(viewpoint.toggle).toContainText("Window · 2nd floor · facing E");
    await expect(timeBar.slider).toHaveValue("630");
  });

  test("an unnamed pin travels without a name: the recipient sees the address, not coordinates as a name", async ({
    app,
    share,
    page,
    mocks,
    newVisitor,
    isPhone,
  }) => {
    if (isPhone) await stubNativeShare(page);
    // The sender's pin never got an address (no lookup result): on screen, coordinates stand in.
    mocks.photon.noAddresses();
    await app.openPlace(FIXTURE_QUERY);
    await expect(app.placeTitle).toHaveText("37.7912° N, 122.4301° W");

    const link = new URL(await share.currentLink());
    // No `n` at all — never the coordinates dressed up as a name.
    expect(link.searchParams.has("n")).toBe(false);
    expect([...link.searchParams.keys()]).toEqual(["lat", "lng", "d", "t", "s"]);
    if (isPhone) {
      const [shared] = await share.shared();
      expect(shared.title).toBe("This spot: 6.4 h of direct sun a day");
      expect(shared.text).not.toContain("37.79");
    }

    // The recipient's app is free to look the address up — and does.
    const visitor = await newVisitor();
    await visitor.app.openLink(link.href);
    await expect(visitor.app.placeTitle).toHaveText(MOCK_ADDRESS);
    expect(visitor.mocks.photon.reverseLookups).toEqual(["37.7912,-122.4301"]);
    await expect(visitor.app.heroFigure).toHaveText("6.4h");
  });
});
