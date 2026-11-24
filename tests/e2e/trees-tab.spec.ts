/**
 * The report's Trees tab: what the City of Portland's records and Oregon's
 * laser survey say about the trees at a pinned address, in four separate
 * parts — in front (on the street), the backyard, this block, the area.
 * Information only: never part of the sun hours.
 *
 * The city's services and the canopy heights are mocked (`mockTreeRecords`,
 * real answers taken at 2124 NE 36th Ave); any request to a host the mocks do
 * not know fails the test (see `fixtures.ts`).
 */
import type { Page } from "@playwright/test";
import { FIXTURE_QUERY, expect, test } from "./fixtures";
import {
  CANOPY_WINDOW_URL,
  CITY_TREE_URLS,
  mockTreesHouseBuildings,
  watchTreeSectionRequests,
} from "./helpers/mockMapData";

/** 2124 NE 36th Ave, Portland: the owner's test house. */
const HOUSE = "lat=45.53822&lng=-122.62575&d=2026-06-21&t=1500";
/** Salem, Oregon: tree heights, but no city records. */
const SALEM = "lat=44.9429&lng=-123.0351&d=2026-06-21&t=1500";

const part = (page: Page, name: string) =>
  page.locator("#report-trees").getByRole("region", { name, exact: true });

test.describe("Trees tab", () => {
  test.beforeEach(async ({ mocks }) => {
    mocks.photon.noAddresses();
  });

  test("tells a house hunter about the trees in front, in the backyard, on the block and around", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    await mockTreesHouseBuildings(page);
    const asked = watchTreeSectionRequests(page);
    await app.openPlace(HOUSE);
    if (isPhone) await app.moveSheetTo("full");
    const figure = (await app.summaryFigure.textContent()) ?? "";

    // Lazy: nothing is asked of the city or the survey until the tab is opened.
    await page.waitForTimeout(800);
    expect(asked, "requests before the Trees tab was opened").toEqual([]);

    await report.press(report.tab("Trees"));
    await expect(report.trees.getByRole("heading", { level: 2, name: "Trees" })).toBeInViewport();
    await expect.poll(() => asked.length).toBeGreaterThan(0);

    // Four separate parts, each with its own heading.
    await expect(report.trees.getByRole("heading", { level: 3 })).toHaveText([
      "In front, on the street",
      "Backyard",
      "This block",
      "The area",
    ]);

    // 1. In front: the two Norway maples recorded at the address, with every fact.
    const front = part(page, "In front, on the street");
    await expect(front).toContainText("Street trees recorded at 2124 NE 36th Ave", {
      timeout: 15_000,
    });
    await expect(front.getByRole("listitem")).toHaveCount(2);
    const maple = front.getByRole("listitem").first();
    await expect(maple).toContainText("Norway maple");
    await expect(maple).toContainText("Acer platanoides");
    await expect(maple).toContainText(/About \d+ ft tall \(2014 survey\)/);
    await expect(maple).toContainText("Not native · on the city's nuisance list");
    await expect(maple).toContainText("27.7 in across");
    await expect(maple).toContainText("Good");
    await expect(maple).toContainText("Medium");
    await expect(maple).toContainText("Deciduous broadleaf");
    await expect(maple).toContainText("High-voltage lines");
    await expect(maple).toContainText("Planting strip, 6 ft wide");
    await expect(maple).toContainText(/\d+ ft W of the pin/);
    await expect(maple).toContainText("Jun 2024");

    // 2. Backyard: laser canopy over the lot behind the house.
    const backyard = part(page, "Backyard");
    await expect(backyard).toContainText("Laser survey, 2014");
    await expect(backyard.getByText("canopy cover", { exact: true })).toBeVisible();
    await expect(backyard).toContainText(/\d+%\s*canopy cover/);
    await expect(backyard).toContainText(/\d+ ft\s*tallest tree/);
    await expect(backyard).toContainText("of ground behind the house");
    await expect(backyard).toContainText(/Whole lot \(4,950 sq ft\): \d+% canopy cover/);

    // 3. This block: both sides of the 2100 block.
    const block = part(page, "This block");
    await expect(block).toContainText("2100–2199 NE 36th Ave, both sides of the street");
    await expect(block).toContainText(/2\s*street trees/);
    await expect(block).toContainText(/\d+%\s*canopy over its lots/);
    await expect(block).toContainText("Under wires");
    await expect(block).toContainText("2 of 2");
    await expect(block).toContainText("Norway maple 100%");
    await expect(block).toContainText("Too few trees on one block for the 10-20-30 diversity rule");

    // 4. The area: canopy, street trees, diversity, the neighborhood, heritage trees.
    const area = part(page, "The area");
    await expect(area).toContainText(/\d+%\s*canopy cover/);
    await expect(area).toContainText(/967\s*street trees/);
    await expect(area.getByRole("img", { name: /^Canopy by height: 10–35 ft/ })).toBeAttached();
    await expect(area.getByRole("img", { name: /^Trunk diameter: 0–6 in 26%/ })).toBeAttached();
    await expect(area).toContainText("10-20-30 diversity rule: not met");
    await expect(area).toContainText("Species: Norway maple 9.7%");
    await expect(area).toContainText("Genus: Acer 30.7%");
    await expect(area).toContainText("Family: Sapindaceae 31.5%");
    await expect(area).toContainText(/Grant Park: \d+% canopy cover/);
    await expect(area).toContainText("Portland overall: 32.4% of the city's land area");
    await expect(area).toContainText("Nearest Heritage Trees");
    await expect(area).toContainText(/European white elm[\s\S]*0\.2 mi SW/);

    // The definition, the credits and the one line about the sun hours.
    await expect(report.trees).toContainText("What tree canopy cover means");
    await expect(report.trees).toContainText("Trees are not part of the sun hours in this report.");
    await expect(report.trees).toContainText(
      "Street trees: City of Portland, Parks & Recreation Urban Forestry inventory (2022–2024)",
    );
    await expect(report.trees).toContainText("Lot lines: City of Portland / Metro RLIS taxlots");
    await expect(report.trees).toContainText("Tree heights: Oregon DOGAMI lidar (2014)");
    await expect(report.trees).not.toContainText(/shade/i);

    // Only the city's and the survey's addresses were asked; the sun numbers did not move.
    expect(
      asked.filter(
        (url) =>
          !CITY_TREE_URLS.some((pattern) => pattern.test(url)) && !CANOPY_WINDOW_URL.test(url),
      ),
    ).toEqual([]);
    expect(asked.some((url) => /arcgis\.com|arcgisonline/.test(url))).toBe(false);
    await expect(app.summaryFigure).toHaveText(figure);
  });

  test("outside Oregon it says where tree data exists, and asks nothing", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    const asked = watchTreeSectionRequests(page);
    await app.openPlace(FIXTURE_QUERY);
    if (isPhone) await app.moveSheetTo("full");
    await report.press(report.tab("Trees"));
    await expect(report.trees).toContainText(
      "Tree data is only available in Oregon (tree heights) and the City of Portland (street trees and lots).",
    );
    await expect(report.trees.getByRole("heading", { level: 3 })).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(asked).toEqual([]);
  });

  test("in Oregon outside Portland: the canopy, and a note about the street trees", async ({
    app,
    report,
    page,
    isPhone,
  }) => {
    const asked = watchTreeSectionRequests(page);
    await app.openPlace(SALEM);
    if (isPhone) await app.moveSheetTo("full");
    await report.press(report.tab("Trees"));
    await expect(part(page, "In front, on the street")).toContainText(
      "Street tree records are only available in the City of Portland.",
    );
    // The pattern the mock serves: a quarter of the ground under 30, 60 and 90 ft crowns.
    await expect(part(page, "The area")).toContainText(/2\d%\s*canopy cover/, { timeout: 15_000 });
    await expect(part(page, "The area")).toContainText(/90 ft\s*tallest tree/);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((url) => CITY_TREE_URLS.some((pattern) => pattern.test(url)))).toEqual([]);
  });

  test("a failing server is a quiet line with a way to try again", async ({
    app,
    report,
    mocks,
    page,
    isPhone,
  }) => {
    mocks.trees.fail();
    await app.openPlace(HOUSE);
    if (isPhone) await app.moveSheetTo("full");
    const figure = (await app.summaryFigure.textContent()) ?? "";
    await report.press(report.tab("Trees"));

    const front = part(page, "In front, on the street");
    await expect(front).toContainText("Couldn’t load street trees.", { timeout: 25_000 });
    await expect(part(page, "The area")).toContainText("Couldn’t load the area's canopy.", {
      timeout: 25_000,
    });
    // Quiet: no alert, no toast, and the rest of the report is untouched.
    // (The framework's empty route announcer is an alert too: only alerts with words count.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(app.summaryFigure).toHaveText(figure);

    mocks.trees.recover();
    await report.press(front.getByRole("button", { name: "Try again" }));
    await expect(front).toContainText("Norway maple", { timeout: 15_000 });
    await expect(part(page, "The area")).toContainText(/967\s*street trees/, { timeout: 15_000 });
  });
});
