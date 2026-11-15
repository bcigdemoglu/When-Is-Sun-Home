import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURES = path.join(__dirname, "..", "fixtures");
const OVERPASS_FIXTURE = path.join(FIXTURES, "pacific-heights.overpass.json");
const BUILDINGS_FIXTURE = path.join(FIXTURES, "pacific-heights.buildings.json");

/** Serve building data from the fixture and keep the ground flat, so results are deterministic. */
async function mockData(page: Page) {
  // The app asks its own cached route first, then Overpass directly.
  await page.route(/\/api\/buildings/, (route) =>
    route.fulfill({ path: BUILDINGS_FIXTURE, contentType: "application/json" }),
  );
  await page.route(/\/api\/interpreter/, (route) =>
    route.fulfill({ path: OVERPASS_FIXTURE, contentType: "application/json" }),
  );
  await page.route(/elevation-tiles-prod/, (route) => route.abort());
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("a shared link opens straight into a sun report", async ({ page }) => {
  const errors = collectErrors(page);
  await mockData(page);

  await page.goto("/?lat=37.7912&lng=-122.4301&d=2026-06-21&t=1500");

  await expect(page.getByText(/h \/ day/).first()).toBeVisible();
  await expect(page.getByText(/384 nearby buildings/).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("rapid slider changes neither crash nor flood the history API", async ({ page }) => {
  const errors = collectErrors(page);
  await mockData(page);
  await page.addInitScript(() => {
    const original = history.replaceState.bind(history);
    (window as unknown as { __replaceCalls: number }).__replaceCalls = 0;
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      (window as unknown as { __replaceCalls: number }).__replaceCalls++;
      return original(...args);
    };
  });

  await page.goto("/?lat=37.7912&lng=-122.4301&d=2026-06-21&t=1500");
  await expect(page.getByText(/384 nearby buildings/).first()).toBeVisible({ timeout: 30_000 });

  const sliders = page.locator('input[type="range"]');
  const count = await sliders.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const slider = sliders.nth(i);
    if (!(await slider.isVisible())) continue;
    await slider.focus();
    for (let step = 0; step < 40; step++) await page.keyboard.press("ArrowRight");
    for (let step = 0; step < 40; step++) await page.keyboard.press("ArrowLeft");
  }

  await expect(page.getByText(/h \/ day/).first()).toBeVisible();
  const replaceCalls = await page.evaluate(
    () => (window as unknown as { __replaceCalls: number }).__replaceCalls,
  );
  // Safari throws after 100 calls in 30 s; stay far below it.
  expect(replaceCalls).toBeLessThan(60);
  expect(errors).toEqual([]);
});
