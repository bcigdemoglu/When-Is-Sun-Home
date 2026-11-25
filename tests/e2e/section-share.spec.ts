/**
 * Sharing one section of the report: each section's title has a small share
 * button whose link ends in that section's hash (`…#trees`), and opening such
 * a link shows the report scrolled to that section — on phones with the sheet
 * at full — then drops the hash from the address bar.
 */
import type { Page } from "@playwright/test";
import { FIXTURE_QUERY, expect, test } from "./fixtures";
import { mockTreesHouseBuildings } from "./helpers/mockMapData";
import { stubNativeShare } from "./pages/share";

/**
 * 2124 NE 36th Ave, Portland (the Trees tab's mocked house): there the Trees
 * section is long enough to come up under the tabs. (In San Francisco it is
 * two lines, too near the end of the report to scroll that far.)
 */
const HOUSE = "lat=45.53822&lng=-122.62575&d=2026-06-21&t=1500";

/** Where a section rests after a jump: its top this far below the tabs' bottom edge (see AppShell). */
const GAP_BELOW_TABS = 12;

/** The section's top and the jump tabs' bottom edge, px from the top of the screen. */
async function sectionUnderTabs(page: Page, id: string) {
  return page.evaluate((sectionId) => {
    const section = document.getElementById(sectionId)!.getBoundingClientRect();
    const tabs = document
      .querySelector('nav[aria-label="Report sections"]')!
      .getBoundingClientRect();
    return { top: Math.round(section.top), tabsBottom: Math.round(tabs.bottom) };
  }, id);
}

async function expectSectionUnderTabs(page: Page, id: string) {
  await expect
    .poll(async () => {
      const { top, tabsBottom } = await sectionUnderTabs(page, id);
      return Math.abs(top - (tabsBottom + GAP_BELOW_TABS));
    })
    .toBeLessThanOrEqual(2);
}

test.describe("Section share", () => {
  test("desktop: a section's share button opens the popover with a link to that section", async ({
    app,
    share,
    report,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "phones use the system share sheet");
    await app.openPlace(`${FIXTURE_QUERY}&n=Elm+St+backyard`);

    const trees = report.trees.getByRole("button", { name: "Share the Trees section" });
    await trees.click();
    const popover = page.getByRole("dialog", { name: "Share the Trees section" });
    await expect(popover).toBeVisible();
    const field = popover.getByRole("textbox", { name: "Link to this report" });
    const link = new URL(await field.inputValue());
    expect(link.hash).toBe("#trees");
    expect(Object.fromEntries(link.searchParams)).toEqual({
      lat: "37.79120",
      lng: "-122.43010",
      n: "Elm St backyard",
      d: "2026-06-21",
      t: "1500",
      s: expect.stringMatching(/^1\.[0-9a-z.]+$/),
    });
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trees).toBeFocused();

    // Every section has one; the report's own Share button links to no section.
    for (const label of ["Sun hours", "Today", "Year", "Skyline", "Trees", "About"]) {
      await expect(page.getByRole("button", { name: `Share the ${label} section` })).toHaveCount(1);
    }
    const whole = new URL(await share.currentLink());
    expect(whole.hash).toBe("");
    expect(whole.search).toBe(link.search);
  });

  test("phone: a section's share button hands its link to the system share sheet", async ({
    app,
    report,
    share,
    page,
    isPhone,
  }) => {
    test.skip(!isPhone, "desktop uses the popover");
    await stubNativeShare(page);
    await app.openPlace(`${FIXTURE_QUERY}&n=Elm+St+backyard`);
    await app.moveSheetTo("full");

    const button = report.trees.getByRole("button", { name: "Share the Trees section" });
    await report.show(button);
    await button.tap();
    await expect.poll(() => share.shared()).toHaveLength(1);
    const [shared] = await share.shared();
    expect(shared.title).toBe("Trees at Elm St backyard");
    expect(shared.text).toBe("Street trees, backyard canopy and the trees around Elm St backyard:");
    const link = new URL(shared.url ?? "");
    expect(link.hash).toBe("#trees");
    expect(link.searchParams.get("lat")).toBe("37.79120");
    expect(link.searchParams.get("t")).toBe("1500");

    // A sun section says what the report says.
    const sunHours = report.sunHours.getByRole("button", { name: "Share the Sun hours section" });
    await report.show(sunHours);
    await sunHours.tap();
    await expect.poll(() => share.shared()).toHaveLength(2);
    const second = (await share.shared())[1];
    expect(second.title).toBe("Elm St backyard: 6.4 h of direct sun a day");
    expect(new URL(second.url ?? "").hash).toBe("#sun-hours");
  });

  for (const motion of ["no-preference", "reduce"] as const) {
    test(`phone: a #trees link opens with the sheet at full on the Trees section (motion: ${motion})`, async ({
      app,
      report,
      share,
      mocks,
      page,
      isPhone,
    }) => {
      test.skip(!isPhone, "the sheet is the phone layout");
      mocks.photon.noAddresses();
      await mockTreesHouseBuildings(page);
      await page.emulateMedia({ reducedMotion: motion });
      await stubNativeShare(page);
      await app.open(`${HOUSE}#trees`);
      await app.waitForAnswer();

      await app.expectSheetAt("full");
      await expectSectionUnderTabs(page, "report-trees");
      await expect(report.tab("Trees")).toHaveAttribute("aria-current", "location");
      await expect(report.trees.getByRole("heading", { level: 2, name: "Trees" })).toBeInViewport();
      // The jump opened the section, so its records were asked for and arrived.
      await expect(report.trees).toContainText("Norway maple", { timeout: 15_000 });
      // The hash is used once and dropped; the settings stay.
      await expect(page).toHaveURL(/\?lat=45\.53822&lng=-122\.62575&d=2026-06-21&t=1500[^#]*$/);

      // The section stays put while the rest of the page settles.
      await page.waitForTimeout(2500);
      await expectSectionUnderTabs(page, "report-trees");
      await expect(report.tab("Trees")).toHaveAttribute("aria-current", "location");

      // The report's own Share button does not pass the section on.
      const link = await share.currentLink();
      expect(new URL(link).hash).toBe("");
    });
  }

  test("desktop: a #sun-hours link opens with the panel scrolled to Sun hours", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "the side panel is the desktop layout");
    await app.open(`${FIXTURE_QUERY}#sun-hours`);
    await app.waitForAnswer();

    await expectSectionUnderTabs(page, "report-sun-hours");
    await expect(report.tab("Sun hours")).toHaveAttribute("aria-current", "location");
    await expect(page).toHaveURL(/\?lat=37\.79120&lng=-122\.43010[^#]*&d=2026-06-21&t=1500[^#]*$/);
    // The map and the settings were left alone.
    await expect(page.getByRole("slider", { name: "Time of day", exact: true })).toHaveValue("900");
  });

  test("an unknown hash does nothing", async ({ app, page, isPhone }) => {
    await app.open(`${FIXTURE_QUERY}#report`);
    await app.waitForAnswer();
    await page.waitForTimeout(800);

    if (isPhone) {
      await app.expectSheetAt("peek");
    } else {
      const scrollTop = await page
        .getByRole("complementary")
        .getByRole("main")
        .evaluate((element) => element.scrollTop);
      expect(scrollTop).toBe(0);
    }
    await expect(page).toHaveURL(/#report$/);
  });
});
