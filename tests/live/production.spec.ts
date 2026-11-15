/**
 * Post-deployment checks against the real site and real data sources.
 *
 * These exist because a production deployment once shipped new JavaScript
 * with a stale stylesheet: every pre-merge check passed, and the phone layout
 * was unusable. They assert the things only a deployed build can prove.
 */
import { expect, test, type Page } from "@playwright/test";

/** A yard in San Francisco with dense, well-mapped surroundings. */
const PLACE = "/?lat=37.7912&lng=-122.4301";

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("the stylesheet matches the app: the layout is laid out, not unstyled", async ({
  page,
  isMobile,
}) => {
  await page.goto(PLACE);
  const save = page.getByRole("button", { name: "Save this place" }).first();
  await expect(save).toBeVisible();

  if (isMobile) {
    // The bottom sheet is a fixed scroller; without its CSS it is a tall static box.
    const sheet = await page.locator(".sheet-scroller").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        overflowY: style.overflowY,
        scrolls: element.scrollHeight > element.clientHeight,
      };
    });
    expect(sheet).toEqual({ position: "fixed", overflowY: "auto", scrolls: true });
  }

  // The button must be the thing under its own centre (nothing covers it, it is not clipped away).
  const onTop = await save.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === button || button.contains(hit));
  });
  expect(onTop).toBe(true);
});

test("a pinned place gets real building data and an answer", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(PLACE);

  await expect(page.getByText(/of direct sun/).first()).toBeVisible();
  // Building footprints come from OpenFreeMap tiles; hundreds surround this pin.
  const estimate = page.getByText(/includes shade from [0-9,]+ nearby buildings/).first();
  await expect(estimate).toBeAttached({ timeout: 60_000 });
  const count = Number(
    ((await estimate.textContent()) ?? "").match(/([0-9,]+) nearby/)?.[1].replace(/,/g, "") ?? 0,
  );
  expect(count).toBeGreaterThan(500);

  await expect(
    page.getByText(/Building data couldn.t be loaded|Couldn.t load building/),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a shared link shows the answer in its preview", async ({ request }) => {
  const summary = "1.1t1i401u9.00011p3a3j3h3i3f2e0d0000.2p2z3a3n3x423z3q3f322s2m";
  const page = await request.get(`${PLACE}&n=Pacific+Ave+backyard&s=${summary}`, {
    headers: { "user-agent": "Signal" },
  });
  const html = await page.text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toMatch(/<meta property="og:title" content="[^"]*6\.5 h of direct sun/);
  expect(head).toMatch(/<meta property="og:image" content="[^"]*\/og\?/);

  const image = await request.get(`/og?lat=37.7912&lng=-122.4301&s=${summary}&v=1`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});

test("developer harness pages are not reachable", async ({ request }) => {
  expect((await request.get("/dev/places?seed=1")).status()).toBe(404);
});
