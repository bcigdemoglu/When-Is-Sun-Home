/**
 * The base of every browser test: `test` and `expect` from here, never from
 * `@playwright/test` directly.
 *
 * What a test gets without asking:
 *
 *  - NO third-party network. Building tiles, terrain, aerial photos, tree heights, both
 *    geocoders and the basemap are all answered from fixtures (see `mocks`); any other request
 *    that leaves localhost is aborted AND fails the test, so nothing can pass
 *    by quietly reaching a real service.
 *  - An error guard: an uncaught exception in the page or a `console.error`
 *    fails the test. Nothing is allowed by default; a mock switch that breaks
 *    a service on purpose allows that service's failed-request lines only.
 *  - A page object per area of the app (`app`, `search`, `places`, `share`,
 *    `timeBar`, `viewpoint`, `report`).
 *
 * Time: tests that depend on "today" or "now" opt in with
 * `test.use({ now: SUMMER_NOON })`; the page's clock then starts there and
 * keeps running, so debounces, toasts and animations behave normally.
 */
import path from "node:path";
import { test as base, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import {
  BUILDING_TILE_URL,
  TERRAIN_TILE_URL,
  TILEJSON_URL,
  mockBuildingData,
  mockFlatTerrain,
  mockImagery,
  mockTrees,
} from "./helpers/mockMapData";
import { AppPage } from "./pages/app";
import { PlacesPage } from "./pages/places";
import { ReportPage } from "./pages/report";
import { SearchPage } from "./pages/search";
import { SharePage } from "./pages/share";
import { TimeBarPage } from "./pages/timeBar";
import { ViewpointPage } from "./pages/viewpoint";

export { expect };

// ─── Fixed points the suite is built on ────────────────────────────────────

/** The pin the building fixtures were taken around (Pacific Heights, San Francisco). */
export const FIXTURE_PIN = { lat: 37.7912, lng: -122.4301 } as const;
/** How the app writes that pin. */
export const FIXTURE_PIN_LABEL = "37.7912° N, 122.4301° W";
/** What the mocked geocoder calls any spot it is asked about (see `PhotonMock`). */
export const MOCK_ADDRESS = "2200 Sacramento Street, San Francisco";
/** Buildings the fixture tiles hold around `FIXTURE_PIN` (see `helpers/mockMapData.ts`). */
export const FIXTURE_BUILDING_COUNT = "3,632";
/** The report's footnote for the fixture pin once buildings and (flat) terrain are in. */
export const FIXTURE_ESTIMATE_NOTE = `Estimate: includes shade from ${FIXTURE_BUILDING_COUNT} nearby buildings and the hills around, but not trees, fences or clouds.`;
/** The same footnote where the tiles hold no buildings (every place but the fixture area). */
export const NO_BUILDINGS_NOTE =
  "Estimate: no buildings nearby; includes shade from the hills around, but not trees, fences or clouds.";
/**
 * Listing links for the mocked geocoders (see `PhotonMock`, `NominatimMock`).
 * Real shapes, and never requested: only the address inside them is used.
 */
export const LISTING = {
  /** Photon knows this house: pasting the link opens it. */
  zillow: "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
  zillowAddress: "2220 Clay St San Francisco, CA 94115",
  zillowPlace: "2220 Clay Street, San Francisco, California, United States",
  /** The same listing as a sentence from a share sheet. */
  zillowShared:
    "Check out this home I found on Zillow!\nhttps://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/?utm_source=txtshare",
  /** A listing by its number alone: no address in the link. */
  zpidOnly: "https://www.zillow.com/homedetails/15075413_zpid/",
  /** The geocoders know "2140 Pacific Avenue" in three towns, not number 2141: not clear. */
  unclear:
    "https://www.zillow.com/homedetails/2141-Pacific-Ave-San-Francisco-CA-94115/15070000_zpid/",
  unclearAddress: "2141 Pacific Ave San Francisco, CA 94115",
  /** Only Nominatim knows this one, and only by working the number out along the street. */
  approximate: "https://www.redfin.com/TX/Richardson/212-Murray-Ln-75080/home/31234567",
  approximatePlace: "212 Murray Lane, Richardson, Texas, United States",
  /** Nobody knows this one. */
  unknown:
    "https://www.realtor.com/realestateandhomes-detail/15903-Smithland-Dr_Houston_TX_77084_M80001-12345",
  unknownAddress: "15903 Smithland Dr, Houston, TX 77084",
} as const;

/** The summer solstice at 3 pm: the pinned date and time most tests use. */
export const FIXTURE_QUERY = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}&d=2026-06-21&t=1500`;
/** 21 June 2026, 12:00 in San Francisco (PDT, UTC−7): "now" for live-mode tests. */
export const SUMMER_NOON = "2026-06-21T19:00:00Z";

// ─── The error guard ───────────────────────────────────────────────────────

/**
 * There is NO standing allowlist: in an ordinary test not a single
 * `console.error` is tolerated. The only errors ever expected are the lines
 * Chromium itself logs for a request that failed ("Failed to load resource:
 * …"), and only for requests a test made fail on purpose — each mock switch
 * that breaks something (`mocks.terrain.fail()`, `mocks.buildings.fail()`,
 * `mocks.photon.down()`, `mocks.nominatim.down()`, the "blocked" basemap)
 * allows exactly its own host's lines, for that test alone.
 */
const failedRequestTo = (...hosts: RegExp[]): RegExp =>
  new RegExp(`Failed to load resource.*(${hosts.map((host) => host.source).join("|")})`);

/** Collects what must not happen during a test; checked when the test ends. */
export class ErrorGuard {
  /** Uncaught exceptions and unexpected `console.error` lines so far. */
  readonly problems: string[] = [];
  /** Requests that tried to leave localhost without a mock. */
  readonly strayRequests: string[] = [];
  private readonly expected: RegExp[] = [];

  /**
   * For the rare test that provokes an error on purpose: messages matching
   * `pattern` are expected from here on.
   */
  allow(pattern: RegExp): void {
    this.expected.push(pattern);
  }

  /** Hand over (and forget) the stray requests so far: for the test that provokes one on purpose. */
  takeStrayRequests(): string[] {
    return this.strayRequests.splice(0);
  }

  /** Start watching a page (the test's own, or a visitor's). */
  watch(page: Page): void {
    const report = (text: string) => {
      if (!this.expected.some((pattern) => pattern.test(text))) this.problems.push(text);
    };
    page.on("pageerror", (error) => report(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      report(`console.error: ${message.text()} (${message.location().url})`);
    });
  }
}

// ─── Geocoding: Photon (as you type) and Nominatim (the fallback) ─────────

const GEOCODER_FIXTURES = path.join(__dirname, "fixtures");
const PHOTON_URL = /^https:\/\/photon\.komoot\.io\//;
const NOMINATIM_URL = /^https:\/\/nominatim\.openstreetmap\.org\//;
/** Mocked cross-origin answers need this, or the browser withholds them from the page. */
const CORS = { "access-control-allow-origin": "*" };

function serverError(route: Route): Promise<void> {
  return route.fulfill({ status: 503, contentType: "text/plain", headers: CORS, body: "mocked" });
}

/**
 * Photon, the search-as-you-type geocoder, mocked. By default a search whose
 * text contains "pacific" answers three addresses (the first is the fixture
 * pin, "2140 Pacific Avenue"), one that contains "clay" answers Clay Street
 * and then the house "2220 Clay Street" (at the fixture pin; see
 * `LISTING`), anything else answers nothing, and a reverse lookup names every
 * spot `MOCK_ADDRESS`.
 */
export class PhotonMock {
  /** The `q` of every search request the page sent, in order. */
  readonly searches: string[] = [];
  /** "lat,lon" of every reverse lookup the page sent, in order. */
  readonly reverseLookups: string[] = [];
  private isDown = false;
  private knowsAddresses = true;

  constructor(private readonly guard: ErrorGuard) {}

  /**
   * The whole service answers HTTP 503 from now on (search and reverse).
   * The app then leaves it alone for a minute and falls back to Nominatim.
   */
  down(): void {
    this.isDown = true;
    this.guard.allow(failedRequestTo(/photon\.komoot\.io/));
  }
  up(): void {
    this.isDown = false;
  }
  /** Reverse lookups cleanly find no address: a dropped pin stays unnamed. */
  noAddresses(): void {
    this.knowsAddresses = false;
  }

  async handle(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const json = (file: string) =>
      route.fulfill({
        path: path.join(GEOCODER_FIXTURES, "photon", file),
        contentType: "application/json",
        headers: CORS,
      });

    if (url.pathname.startsWith("/reverse")) {
      this.reverseLookups.push(`${url.searchParams.get("lat")},${url.searchParams.get("lon")}`);
      if (this.isDown) return serverError(route);
      return json(this.knowsAddresses ? "reverse-sacramento.json" : "empty.json");
    }
    const query = url.searchParams.get("q") ?? "";
    this.searches.push(query);
    if (this.isDown) return serverError(route);
    if (/clay/i.test(query)) return json("search-clay.json");
    return json(/pacific/i.test(query) ? "search-pacific.json" : "empty.json");
  }
}

/** What the mocked Nominatim calls any spot it is asked about. */
export const NOMINATIM_MOCK_ADDRESS = "2698 Pacific Avenue, San Francisco";

/**
 * Nominatim, the geocoder the app falls back to when Photon is down — only
 * for a search the person submitted (a pasted listing link counts), and for
 * naming a dropped pin. Mocked: a search whose text contains "pacific"
 * answers two addresses (the first is the fixture pin, "2550 Pacific
 * Avenue"), one that contains "murray" answers "212 Murray Lane" as a house
 * number worked out along the street (which Photon does not know), anything
 * else answers nothing, and a reverse lookup names every spot
 * `NOMINATIM_MOCK_ADDRESS`.
 */
export class NominatimMock {
  /** The `q` of every search request the page sent, in order. */
  readonly searches: string[] = [];
  /** "lat,lon" of every reverse lookup the page sent, in order. */
  readonly reverseLookups: string[] = [];
  private isDown = false;
  private findsNothing = false;

  constructor(private readonly guard: ErrorGuard) {}

  /** Every request answers HTTP 503 from now on. */
  down(): void {
    this.isDown = true;
    this.guard.allow(failedRequestTo(/nominatim\.openstreetmap\.org/));
  }
  up(): void {
    this.isDown = false;
  }
  /** Searches match nothing and reverse lookups know no address. */
  nothingFound(): void {
    this.findsNothing = true;
  }

  async handle(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const file = (name: string) =>
      route.fulfill({
        path: path.join(GEOCODER_FIXTURES, "nominatim", name),
        contentType: "application/json",
        headers: CORS,
      });
    const body = (value: unknown) =>
      route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(value),
      });

    if (url.pathname.startsWith("/reverse")) {
      this.reverseLookups.push(`${url.searchParams.get("lat")},${url.searchParams.get("lon")}`);
      if (this.isDown) return serverError(route);
      // "Nothing here" is a 200 with an error body, as the real service answers.
      return this.findsNothing ? body({ error: "Unable to geocode" }) : file("reverse.json");
    }
    const query = url.searchParams.get("q") ?? "";
    this.searches.push(query);
    if (this.isDown) return serverError(route);
    if (this.findsNothing) return body([]);
    if (/murray/i.test(query)) return file("search-murray.json");
    return /pacific/i.test(query) ? file("search.json") : body([]);
  }
}

// ─── Buildings and the basemap ─────────────────────────────────────────────

/**
 * Switches for the building-data mock, for the tests about slow or failing
 * data. They act on every request for building tiles: the sun computation's
 * and the map's own (the buildings it draws in view).
 */
export class BuildingDataMock {
  private held: (() => void)[] = [];
  private holding = false;
  private failing = false;

  constructor(
    private readonly page: Page,
    private readonly guard: ErrorGuard,
  ) {}

  /** Installed once, in front of the fixture tiles. */
  async install(): Promise<void> {
    const gate = async (route: Route) => {
      if (this.failing) return route.abort("failed");
      if (this.holding) await new Promise<void>((resolve) => this.held.push(resolve));
      return route.fallback();
    };
    await this.page.route(TILEJSON_URL, gate);
    await this.page.route(BUILDING_TILE_URL, gate);
  }

  /** Building requests wait until `release()`: the app stays in "checking nearby buildings". */
  hold(): void {
    this.holding = true;
  }
  release(): void {
    this.holding = false;
    for (const resolve of this.held.splice(0)) resolve();
  }
  /** Every source of building data fails (the fallbacks always do in tests). */
  fail(): void {
    this.failing = true;
    // The tiles, then the app's own route (mocked: 503), then the Overpass servers.
    this.guard.allow(
      failedRequestTo(/tiles\.openfreemap\.org/, /\/api\/buildings/, /\/api\/interpreter/),
    );
  }
  recover(): void {
    this.failing = false;
  }
}

/**
 * Switches for the terrain mock. By default the ground is flat and loads at
 * once (see `mockFlatTerrain`), so reports read "… and the hills around".
 */
export class TerrainMock {
  private held: (() => void)[] = [];
  private holding = false;
  private failing = false;

  constructor(
    private readonly page: Page,
    private readonly guard: ErrorGuard,
  ) {}

  /** Installed once, in front of the flat tiles. */
  async install(): Promise<void> {
    await this.page.route(TERRAIN_TILE_URL, async (route) => {
      if (this.failing) return route.abort("failed");
      if (this.holding) await new Promise<void>((resolve) => this.held.push(resolve));
      return route.fallback();
    });
  }

  /** Every elevation tile request fails: the app assumes flat ground and says so. */
  fail(): void {
    this.failing = true;
    this.guard.allow(failedRequestTo(/elevation-tiles-prod/));
  }
  /** Elevation tiles wait until `release()`: terrain stays "loading". */
  hold(): void {
    this.holding = true;
  }
  release(): void {
    this.holding = false;
    for (const resolve of this.held.splice(0)) resolve();
  }
}

/** The basemap's hosts. Nothing the app computes comes from there: it is decoration. */
const BASEMAP_URL = /^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//;
const BASEMAP_STYLE_URL = /^https:\/\/basemaps\.cartocdn\.com\/gl\/[^/]+\/style\.json/;
/** A valid style with nothing in it: the map loads at once and draws only the app's own layers. */
const EMPTY_STYLE = JSON.stringify({ version: 8, name: "test", sources: {}, layers: [] });

export type BasemapMode = "empty" | "blocked";

async function mockBasemap(page: Page, mode: BasemapMode): Promise<void> {
  await page.route(BASEMAP_URL, (route) => {
    if (mode === "empty" && BASEMAP_STYLE_URL.test(route.request().url())) {
      return route.fulfill({ contentType: "application/json", headers: CORS, body: EMPTY_STYLE });
    }
    return route.abort("failed");
  });
}

const isLocal = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

// ─── Putting it together ───────────────────────────────────────────────────

export interface Mocks {
  photon: PhotonMock;
  nominatim: NominatimMock;
  buildings: BuildingDataMock;
  terrain: TerrainMock;
}

interface InstallOptions {
  basemap: BasemapMode;
  now: string | null;
  guard: ErrorGuard;
}

/**
 * `next dev` draws its own floating badge (bottom left) over the page — on a
 * phone, right on top of the time bar's day button. It is not part of the
 * app and does not exist in a production build, so it is hidden.
 */
async function hideDevIndicator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    });
  });
}

/**
 * Everything a page needs before it first navigates: the mocks, the error
 * guard and (optionally) the clock. Used for the test's own page and for the
 * pages of any further "visitor" context.
 */
async function prepare(page: Page, options: InstallOptions): Promise<Mocks> {
  const { guard } = options;
  // Registered first, so it only sees what no mock below claimed.
  await page.route(
    (url) => !isLocal(url) && /^https?:$/.test(url.protocol),
    (route) => {
      guard.strayRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    },
  );
  await mockBasemap(page, options.basemap);
  if (options.basemap === "blocked") guard.allow(failedRequestTo(/basemaps\.cartocdn\.com/));
  await mockFlatTerrain(page);
  await mockImagery(page);
  await mockTrees(page);
  const terrain = new TerrainMock(page, guard);
  await terrain.install();
  await mockBuildingData(page);
  const buildings = new BuildingDataMock(page, guard);
  await buildings.install();
  const photon = new PhotonMock(guard);
  await page.route(PHOTON_URL, (route) => photon.handle(route));
  const nominatim = new NominatimMock(guard);
  await page.route(NOMINATIM_URL, (route) => nominatim.handle(route));

  guard.watch(page);
  await hideDevIndicator(page);
  if (options.now !== null) await page.clock.install({ time: new Date(options.now) });
  return { photon, nominatim, buildings, terrain };
}

/** A second person: a fresh browser context (no storage, no cache) with the same mocks. */
export interface Visitor {
  context: BrowserContext;
  page: Page;
  app: AppPage;
  report: ReportPage;
  mocks: Mocks;
}

interface Options {
  /**
   * "empty" (default): the basemap style loads but has nothing in it, so the
   * map becomes ready without any tiles. "blocked": every basemap request
   * fails, as on a network that cannot reach the map's CDN.
   */
  basemap: BasemapMode;
  /** ISO instant the page's clock starts at, or null for the real clock. */
  now: string | null;
}

interface Fixtures {
  errorGuard: ErrorGuard;
  mocks: Mocks;
  app: AppPage;
  search: SearchPage;
  places: PlacesPage;
  share: SharePage;
  timeBar: TimeBarPage;
  viewpoint: ViewpointPage;
  report: ReportPage;
  /** True in the "mobile" project (the phone layout: bottom sheet, search takeover). */
  isPhone: boolean;
  /** Opens the app as somebody else would: new context, same device, same mocks. */
  newVisitor: () => Promise<Visitor>;
}

export const test = base.extend<Options & Fixtures>({
  // 12-hour clocks, month-first dates: the app follows the browser's locale.
  locale: "en-US",
  basemap: ["empty", { option: true }],
  now: [null, { option: true }],

  errorGuard: [
    async ({}, use, testInfo) => {
      const guard = new ErrorGuard();
      await use(guard);
      // Only when the test body itself went through: otherwise its own error is the useful one.
      if (testInfo.status === "passed") {
        expect(guard.strayRequests, "requests that left localhost without a mock").toEqual([]);
        expect(guard.problems, "uncaught page errors / console.error").toEqual([]);
      }
    },
    { auto: true },
  ],

  mocks: [
    async ({ page, basemap, now, errorGuard }, use) => {
      await use(await prepare(page, { basemap, now, guard: errorGuard }));
    },
    { auto: true },
  ],

  isPhone: async ({}, use, testInfo) => {
    await use(testInfo.project.name === "mobile");
  },

  app: async ({ page, isPhone }, use) => {
    await use(new AppPage(page, isPhone));
  },
  search: async ({ page, isPhone }, use) => {
    await use(new SearchPage(page, isPhone));
  },
  places: async ({ page, isPhone }, use) => {
    await use(new PlacesPage(page, isPhone));
  },
  share: async ({ page, isPhone }, use) => {
    await use(new SharePage(page, isPhone));
  },
  timeBar: async ({ page, isPhone }, use) => {
    await use(new TimeBarPage(page, isPhone));
  },
  viewpoint: async ({ page, isPhone }, use) => {
    await use(new ViewpointPage(page, isPhone));
  },
  report: async ({ page, isPhone }, use) => {
    await use(new ReportPage(page, isPhone));
  },

  newVisitor: async (
    {
      browser,
      baseURL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale,
      basemap,
      now,
      errorGuard,
      isPhone,
    },
    use,
  ) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext({
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        locale,
      });
      contexts.push(context);
      const page = await context.newPage();
      const mocks = await prepare(page, { basemap, now, guard: errorGuard });
      return {
        context,
        page,
        mocks,
        app: new AppPage(page, isPhone),
        report: new ReportPage(page, isPhone),
      };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});
