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
      let takesTouches = true;
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).pointerEvents === "none") takesTouches = false;
      }
      return {
        position: style.position,
        overflowY: style.overflowY,
        scrolls: element.scrollHeight > element.clientHeight,
        // iOS Safari cannot touch-scroll under `pointer-events: none` (WebKit bug 183870).
        takesTouches,
        // The map's own element arrives later (it is loaded lazily); its slot is there at once.
        holdsTheMap: element.firstElementChild?.classList.contains("sheet-map") === true,
      };
    });
    expect(sheet).toEqual({
      position: "fixed",
      overflowY: "auto",
      scrolls: true,
      takesTouches: true,
      holdsTheMap: true,
    });
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

test("moving the map away from the pin loads the buildings there", async ({ page, isMobile }) => {
  // The map draws every building in view from OpenFreeMap's zoom-14 tiles,
  // the same ones the sun computation reads around the pin. This pin is in
  // the middle of tile 14/2620/6331, so that tile is all the computation
  // needs; the next tile east (column 2621) starts 900 m away.
  const errors = collectPageErrors(page);
  const TILE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/14\/(\d+)\/(\d+)\.pbf/;
  const answered: { column: number; status: number }[] = [];
  page.on("response", (response) => {
    const match = TILE.exec(response.url());
    if (match) answered.push({ column: Number(match[1]), status: response.status() });
  });
  const east = () => answered.filter((tile) => tile.column >= 2621);

  await page.goto("/?lat=37.7968&lng=-122.4199");
  const estimate = page.getByText(/includes shade from [0-9,]+ nearby buildings/).first();
  await expect(estimate).toBeAttached({ timeout: 60_000 });
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // The pin's own tile has been answered, to the computation and to the map.
  await expect.poll(() => answered.length, { timeout: 30_000 }).toBeGreaterThan(1);
  expect(east()).toEqual([]);

  // Drag east, most of a screen at a time: a finger on the phone, a mouse on
  // the desktop, along a line near the top of the map (clear of the pin).
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width - 16;
  const y = box.y + Math.min(260, box.height * 0.3);
  const dx = Math.round(box.width * 0.85);
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  for (let drags = 0; drags < 40 && east().length === 0; drags++) {
    if (touch) {
      const at = (step: number) => [{ x: Math.round(x - (dx * step) / 6), y: Math.round(y) }];
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
      for (let step = 1; step <= 6; step++) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(step) });
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - dx, y, { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(250);
  }

  // The tiles beyond the pin's surroundings were asked for, and arrived.
  expect(east().length).toBeGreaterThan(0);
  expect(answered.filter((tile) => tile.status !== 200 && tile.status !== 204)).toEqual([]);
  // The answer for the pin is untouched, and nothing complains.
  await expect(estimate).toBeAttached();
  await expect(
    page.getByText(/Building data couldn.t be loaded|Couldn.t load building/),
  ).toHaveCount(0);
  await expect(page.getByText("The map can’t be shown")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Satellite view shows real aerial photos", async ({ page }) => {
  // Two public USGS services, no key: a cached base that answers at once, and
  // the detailed photos, cut to order — a piece nobody asked for lately can
  // take half a minute, so only the asking is checked for those.
  const errors = collectPageErrors(page);
  await page.goto(PLACE);
  await expect(page.getByText(/of direct sun/).first()).toBeVisible();
  const satellite = page.getByRole("button", { name: "Map. Switch to satellite photo" });
  await expect(satellite).toBeEnabled({ timeout: 30_000 });

  const basePicture = page.waitForResponse(
    (response) => response.url().startsWith("https://basemap.nationalmap.gov/"),
    { timeout: 30_000 },
  );
  const detailAsked = page.waitForRequest(
    (request) => request.url().startsWith("https://imagery.nationalmap.gov/"),
    { timeout: 30_000 },
  );
  await satellite.click();
  const picture = await basePicture;
  expect(picture.status()).toBe(200);
  expect(picture.headers()["content-type"]).toMatch(/^image\//);
  expect((await detailAsked).url()).toContain("/USGSNAIPPlus/ImageServer/exportImage?bbox=");

  await expect(
    page.getByRole("button", { name: "Satellite photo. Switch to map" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText(
    "Imagery: USGS The National Map",
  );
  await expect(page.getByText("The map can’t be shown")).toHaveCount(0);
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

  const image = await request.get(`/og?lat=37.7912&lng=-122.4301&s=${summary}&v=2`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});

test("developer harness pages are not reachable", async ({ request }) => {
  expect((await request.get("/dev/places?seed=1")).status()).toBe(404);
});

test.describe("going to a place from the start screen", () => {
  test("the map travels to a searched place and stops with the pin in view", async ({
    page,
    isMobile,
  }) => {
    // Regression: the flight to the first place was cancelled by the camera
    // adjusting for the sheet appearing, leaving the map short of the place.
    await page.goto("/");
    await expect(page.getByText("Where do you want sun?").first()).toBeVisible();
    // Give the map time to load at its world view, as a person would.
    await expect(page.locator(".maplibregl-canvas")).toBeAttached({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    if (isMobile) await page.getByRole("button", { name: "Enter an address" }).first().click();
    const field = page.getByRole("combobox").first();
    await field.click();
    // Typed coordinates are resolved in the app itself: no geocoding service involved.
    await field.fill("37.7912, -122.4301");
    await page
      .getByRole("option")
      .filter({ hasText: /37\.79/ })
      .first()
      .click();
    await expect(page.getByText(/of direct sun/).first()).toBeVisible();

    const marker = page.locator(".maplibregl-marker").first();
    await expect(marker).toBeAttached({ timeout: 30_000 });
    // Let the camera come to rest (same pin position in two looks a second
    // apart), THEN judge: the pin must sit near the middle of the visible map.
    const offCentre = () =>
      marker.evaluate((pin) => {
        const map = document.querySelector(".maplibregl-map")!.getBoundingClientRect();
        const box = pin.getBoundingClientRect();
        return {
          dx: (box.x + box.width / 2 - (map.x + map.width / 2)) / map.width,
          dy: (box.y + box.height / 2 - (map.y + map.height / 2)) / map.height,
        };
      });
    let previous = await offCentre();
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(1000);
          const now = await offCentre();
          const still =
            Math.abs(now.dx - previous.dx) < 0.002 && Math.abs(now.dy - previous.dy) < 0.002;
          previous = now;
          return still;
        },
        { timeout: 30_000, intervals: [100] },
      )
      .toBe(true);
    expect(Math.abs(previous.dx), "pin is off to the side").toBeLessThan(0.34);
    expect(Math.abs(previous.dy), "pin is too high or low").toBeLessThan(0.34);
  });
});

test.describe("going to a place from a listing link", () => {
  /** A real-shaped Zillow link. It is never requested: only the address in it is read. */
  const ZILLOW =
    "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/";
  /** 2220 Clay Street, San Francisco (the block between Buchanan and Webster). */
  const CLAY_STREET = { lat: 37.7914, lng: -122.4304 };
  const GEOCODER = /^https:\/\/(photon\.komoot\.io|nominatim\.openstreetmap\.org)\//;
  const LISTING_SITE = /(^|\.)(zillow\.com|redfin\.com|redf\.in|realtor\.com|trulia\.com)$/i;

  test("pasting a Zillow link lands on the listing's street", async ({ page, isMobile }) => {
    const errors = collectPageErrors(page);
    let geocoderAnswers = 0;
    const listingRequests: string[] = [];
    page.on("response", (response) => {
      if (GEOCODER.test(response.url()) && response.ok()) geocoderAnswers += 1;
    });
    page.on("request", (request) => {
      if (LISTING_SITE.test(new URL(request.url()).hostname)) listingRequests.push(request.url());
    });

    await page.goto("/");
    await expect(page.getByText("Where do you want sun?").first()).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: "Enter an address" }).first().click();
    const field = page.getByRole("combobox").first();
    await field.click();
    // The whole link at once, as a paste puts it there.
    await field.fill(ZILLOW);

    // The place opens by itself — no row is tapped. Both geocoders are public
    // services that may be throttled or down: if neither answered at all,
    // there is nothing to judge, and that is not this app's failure.
    const settled = page
      .getByText("Couldn’t search — check your connection.")
      .or(page.getByRole("option", { name: /^Edit this address/ }));
    const opened = await expect
      .poll(
        async () =>
          new URL(page.url()).searchParams.has("lat") ? "opened" : (await settled.count()) > 0,
        { timeout: 45_000 },
      )
      .not.toBe(false)
      .then(
        () => new URL(page.url()).searchParams.has("lat"),
        () => false,
      );
    test.skip(!opened && geocoderAnswers === 0, "the public geocoders could not be reached");
    expect(opened, "the link's house was not opened, although a geocoder answered").toBe(true);

    const url = new URL(page.url());
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const metresOff = Math.hypot(
      (lat - CLAY_STREET.lat) * 111_320,
      (lng - CLAY_STREET.lng) * 111_320 * Math.cos((CLAY_STREET.lat * Math.PI) / 180),
    );
    expect(metresOff, "the pin is not on the listing's block").toBeLessThan(150);
    // Named by the geocoder; nothing of the link is in the page's address.
    expect(url.searchParams.get("n")).toMatch(/Clay Street/);
    expect(url.search).not.toMatch(/zillow|zpid/i);
    await expect(page.getByText(/of direct sun/).first()).toBeVisible();
    // The listing site was never asked for anything.
    expect(listingRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
});
