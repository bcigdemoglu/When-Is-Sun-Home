import { describe, expect, it, vi } from "vitest";
import {
  IMAGERY_ATTRIBUTION,
  IMAGERY_BASE,
  IMAGERY_BASE_SOURCE_ID,
  IMAGERY_DETAIL,
  IMAGERY_DETAIL_PROTOCOL,
  IMAGERY_DETAIL_SOURCE_ID,
  IMAGERY_REGIONAL_PROTOCOL,
  IMAGERY_RETRY_WAITS_MS,
  NoSuchPictureError,
  REGIONAL_IMAGERY,
  REGIONAL_PARALLEL_REQUESTS,
  REGIONAL_RETRY_WAITS_MS,
  createLimiter,
  isFullyCoveredTile,
  loadRegionalImagery,
  needsImageryDetail,
  regionCoversAround,
  regionalImageryAt,
  NO_AERIAL_PHOTOS_MESSAGE,
  cameraPitch,
  hasAerialPhotos,
  imageryRequestUrl,
  imageryRetryWaitMs,
  loadImageryDetail,
  showsImagery,
} from "./imagery";
import { labelAnchorId } from "./mapData";
import { PLACE_PITCH } from "./pinMove";

const SAN_FRANCISCO = { lat: 37.7912, lng: -122.4301 };
const ISTANBUL = { lat: 41.0082, lng: 28.9784 };

describe("hasAerialPhotos", () => {
  it("says yes all over the United States", () => {
    const places: Record<string, [number, number]> = {
      "San Francisco": [37.7912, -122.4301],
      Manhattan: [40.758, -73.9855],
      Seattle: [47.6062, -122.3321],
      "Key West": [24.5551, -81.78],
      Brownsville: [25.9017, -97.4975],
      "San Diego": [32.7157, -117.1611],
      "Miami Beach": [25.7907, -80.13],
      "Palm Beach": [26.7056, -80.0364],
      "Charleston, South Carolina": [32.7765, -79.9311],
      "Myrtle Beach": [33.6891, -78.8867],
      "Cape Hatteras": [35.2505, -75.5288],
      "Madawaska, Maine": [47.3553, -68.3217],
      "Lubec, Maine": [44.8607, -66.984],
      "Angle Inlet, Minnesota": [49.3453, -95.0697],
      "Neah Bay, Washington": [48.3681, -124.6249],
      Anchorage: [61.2181, -149.9003],
      "Utqiagvik, Alaska": [71.2906, -156.7886],
      "Ketchikan, Alaska": [55.3422, -131.6461],
      "Unalaska, Alaska": [53.8741, -166.5322],
      Honolulu: [21.3069, -157.8583],
      "Hilo, Hawaii": [19.7241, -155.0868],
      "Lihue, Hawaii": [21.9811, -159.3711],
      "San Juan, Puerto Rico": [18.4655, -66.1057],
      "Mayagüez, Puerto Rico": [18.2013, -67.1397],
      "St. Thomas": [18.3419, -64.9307],
      "St. Croix": [17.7466, -64.7032],
      Guam: [13.4443, 144.7937],
    };
    for (const [name, [lat, lng]] of Object.entries(places)) {
      expect(hasAerialPhotos({ lat, lng }), name).toBe(true);
    }
  });

  it("says no in the rest of the world", () => {
    const places: Record<string, [number, number]> = {
      Istanbul: [41.0082, 28.9784],
      London: [51.5074, -0.1278],
      "Mexico City": [19.4326, -99.1332],
      Havana: [23.1136, -82.3666],
      Nassau: [25.0443, -77.3504],
      "Freeport, Bahamas": [26.5333, -78.7],
      Bermuda: [32.3078, -64.7505],
      Edmonton: [53.5461, -113.4938],
      Reykjavik: [64.1466, -21.9426],
      Tokyo: [35.6762, 139.6503],
      Sydney: [-33.8688, 151.2093],
      "the Atlantic": [35, -40],
      "0° N, 0° E": [0, 0],
    };
    for (const [name, [lat, lng]] of Object.entries(places)) {
      expect(hasAerialPhotos({ lat, lng }), name).toBe(false);
    }
  });

  it("errs on the side of yes along the borders: nowhere in the U.S. is left out", () => {
    // The boxes are generous. In these the photo is soft or missing, which is
    // better than refusing a place just across the line that has them.
    expect(hasAerialPhotos({ lat: 43.6532, lng: -79.3832 })).toBe(true); // Toronto
    expect(hasAerialPhotos({ lat: 32.5149, lng: -117.0382 })).toBe(true); // Tijuana
  });

  it("understands longitudes of a map that was dragged round the world", () => {
    expect(hasAerialPhotos({ lat: SAN_FRANCISCO.lat, lng: SAN_FRANCISCO.lng + 360 })).toBe(true);
    expect(hasAerialPhotos({ lat: SAN_FRANCISCO.lat, lng: SAN_FRANCISCO.lng - 720 })).toBe(true);
    expect(hasAerialPhotos({ lat: ISTANBUL.lat, lng: ISTANBUL.lng + 360 })).toBe(false);
  });

  it("says no to nonsense", () => {
    expect(hasAerialPhotos({ lat: Number.NaN, lng: -100 })).toBe(false);
    expect(hasAerialPhotos({ lat: 40, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("showsImagery", () => {
  it("draws the photos only when they were chosen", () => {
    expect(showsImagery(false, SAN_FRANCISCO, null)).toBe(false);
    expect(showsImagery(true, SAN_FRANCISCO, null)).toBe(true);
  });

  it("goes by the pinned place, wherever the map is looking", () => {
    expect(showsImagery(true, SAN_FRANCISCO, ISTANBUL)).toBe(true);
    expect(showsImagery(true, ISTANBUL, SAN_FRANCISCO)).toBe(false);
  });

  it("goes by the middle of the map when nothing is pinned", () => {
    expect(showsImagery(true, null, SAN_FRANCISCO)).toBe(true);
    expect(showsImagery(true, null, ISTANBUL)).toBe(false);
    expect(showsImagery(true, null, null)).toBe(false);
  });

  it("a choice remembered from another day never blanks a place outside the U.S.", () => {
    expect(showsImagery(true, ISTANBUL, null)).toBe(false);
  });
});

describe("cameraPitch", () => {
  it("is flat over the photos, and the person's own 2D / 3D choice otherwise", () => {
    expect(cameraPitch(true, false)).toBe(PLACE_PITCH);
    expect(cameraPitch(false, false)).toBe(0);
    expect(cameraPitch(true, true)).toBe(0);
    expect(cameraPitch(false, true)).toBe(0);
  });
});

describe("the imagery sources", () => {
  /** Where the detail is really fetched from (MapLibre asks under our own scheme). */
  const detailTemplate = imageryRequestUrl(IMAGERY_DETAIL.tiles[0]);
  const templates = [...IMAGERY_BASE.tiles, detailTemplate];

  it("are the two public USGS services and nothing else", () => {
    expect(IMAGERY_BASE.tiles).toHaveLength(1);
    expect(IMAGERY_DETAIL.tiles).toHaveLength(1);
    expect(new URL(IMAGERY_BASE.tiles[0]).origin).toBe("https://basemap.nationalmap.gov");
    expect(IMAGERY_DETAIL.tiles[0].startsWith(`${IMAGERY_DETAIL_PROTOCOL}://`)).toBe(true);
    expect(new URL(detailTemplate).origin).toBe("https://imagery.nationalmap.gov");
  });

  it("need no key, token or account", () => {
    for (const template of templates) {
      expect(template).not.toMatch(/key|token|secret|signature|auth|apikey|access/i);
      const url = new URL(template);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
    expect([...new URL(IMAGERY_BASE.tiles[0]).searchParams.keys()]).toEqual([]);
    expect([...new URL(detailTemplate).searchParams.keys()]).toEqual([
      "bbox",
      "bboxSR",
      "imageSR",
      "size",
      "format",
      "f",
    ]);
  });

  it("the base is ordinary map tiles (row before column), down to zoom 16", () => {
    expect(IMAGERY_BASE.tiles[0]).toMatch(
      /\/USGSImageryOnly\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/,
    );
    expect(IMAGERY_BASE.tileSize).toBe(256);
    expect(IMAGERY_BASE.maxzoom).toBe(16);
  });

  it("the detail is asked for by the bounds of a web-mercator tile, 512 px, transparent where empty", () => {
    const url = new URL(detailTemplate);
    expect(url.pathname).toBe("/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage");
    expect(IMAGERY_DETAIL.tiles[0]).toContain("bbox={bbox-epsg-3857}");
    expect(url.searchParams.get("bboxSR")).toBe("3857");
    expect(url.searchParams.get("imageSR")).toBe("3857");
    expect(url.searchParams.get("size")).toBe("512,512");
    expect(url.searchParams.get("format")).toBe("jpgpng");
    expect(url.searchParams.get("f")).toBe("image");
    expect(IMAGERY_DETAIL.tileSize).toBe(512);
    // It takes over where the base runs out.
    expect(IMAGERY_DETAIL.minzoom).toBe(IMAGERY_BASE.maxzoom);
    expect(IMAGERY_DETAIL.maxzoom).toBeGreaterThan(IMAGERY_DETAIL.minzoom);
  });

  it("are ours: the map's own layers are still put below the labels, above them", () => {
    expect(IMAGERY_BASE_SOURCE_ID).not.toBe(IMAGERY_DETAIL_SOURCE_ID);
    expect(
      labelAnchorId([
        { id: "roads", type: "line" },
        { id: "places", type: "symbol" },
        { id: IMAGERY_BASE_SOURCE_ID, type: "raster" },
        { id: IMAGERY_DETAIL_SOURCE_ID, type: "raster" },
      ]),
    ).toBe("places");
  });

  it("are credited to the USGS, with a link", () => {
    expect(IMAGERY_ATTRIBUTION.replace(/<[^>]+>/g, "")).toBe("Imagery: USGS The National Map");
    expect(IMAGERY_ATTRIBUTION).toContain(
      'href="https://www.usgs.gov/programs/national-geospatial-program/national-map"',
    );
    expect(IMAGERY_ATTRIBUTION).toContain('target="_blank" rel="noopener"');
  });

  it("says where photos exist when asked for them elsewhere", () => {
    expect(NO_AERIAL_PHOTOS_MESSAGE).toBe("Aerial photos are only available in the United States.");
  });
});

describe("loading a detail picture", () => {
  const ASKED = `${IMAGERY_DETAIL_PROTOCOL}://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?bbox=1,2,3,4&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image`;
  const FETCHED = ASKED.replace(`${IMAGERY_DETAIL_PROTOCOL}://`, "https://");
  const picture = () => new Response(new Uint8Array([1, 2, 3]));
  /** Waits that take no time, and are written down. */
  function instantPauses() {
    const waits: number[] = [];
    const pause = vi.fn(async (ms: number) => void waits.push(ms));
    return { waits, pause };
  }

  it("is fetched from the real address, over https", async () => {
    expect(imageryRequestUrl(ASKED)).toBe(FETCHED);
    expect(imageryRequestUrl(FETCHED)).toBe(FETCHED);
    const fetchImpl = vi.fn<typeof fetch>(async () => picture());
    const { pause } = instantPauses();
    const { data } = await loadImageryDetail(ASKED, { fetchImpl, pause });
    expect([...new Uint8Array(data)]).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(FETCHED);
    expect(pause).not.toHaveBeenCalled();
  });

  it("is asked for again after a timeout or an error, a little later each time", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }))
      .mockResolvedValueOnce(picture());
    const { waits, pause } = instantPauses();
    const { data } = await loadImageryDetail(ASKED, { fetchImpl, pause });
    expect(data.byteLength).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([...IMAGERY_RETRY_WAITS_MS]);
  });

  it("is given up after the last try, with the reason", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("bad gateway", { status: 502 }));
    const { waits, pause } = instantPauses();
    await expect(loadImageryDetail(ASKED, { fetchImpl, pause })).rejects.toThrow(/HTTP 502/);
    expect(fetchImpl).toHaveBeenCalledTimes(IMAGERY_RETRY_WAITS_MS.length + 1);
    expect(waits).toEqual([...IMAGERY_RETRY_WAITS_MS]);
  });

  it("stops at once when the tile is no longer wanted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const { pause } = instantPauses();
    await expect(
      loadImageryDetail(ASKED, { fetchImpl, pause, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it("stops while waiting to try again, too", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 504 }));
      const loading = loadImageryDetail(ASKED, { fetchImpl, signal: controller.signal });
      const outcome = expect(loading).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(IMAGERY_RETRY_WAITS_MS[0] / 2);
      controller.abort();
      await outcome;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the waits: two more tries, then none", () => {
    expect(imageryRetryWaitMs(1)).toBe(IMAGERY_RETRY_WAITS_MS[0]);
    expect(imageryRetryWaitMs(2)).toBe(IMAGERY_RETRY_WAITS_MS[1]);
    expect(imageryRetryWaitMs(3)).toBeNull();
    expect(IMAGERY_RETRY_WAITS_MS).toHaveLength(2);
  });
});

// ─── Regional photos ───────────────────────────────────────────────────────

const PORTLAND = REGIONAL_IMAGERY.find((region) => region.id === "portland")!;
/** 2124 NE 36th Ave, Portland: the house this was built for. */
const NE_36TH_AVE = { lat: 45.5385, lng: -122.6265 };
const BEAVERTON = { lat: 45.4871, lng: -122.8037 };
/** Across the Columbia: inside the service's box, outside its photos. */
const VANCOUVER_WA = { lat: 45.6387, lng: -122.6615 };
const SALEM = { lat: 44.9429, lng: -123.0351 };

describe("the regional photo sources", () => {
  it("each is a keyless tile service on the host it is meant to be, asked for through our loader", () => {
    const hosts: Record<string, string> = { portland: "www.portlandmaps.com" };
    expect(REGIONAL_IMAGERY.map((region) => region.id).sort()).toEqual(Object.keys(hosts).sort());
    for (const region of REGIONAL_IMAGERY) {
      expect(region.tiles).toHaveLength(1);
      const [template] = region.tiles;
      expect(template.startsWith(`${IMAGERY_REGIONAL_PROTOCOL}://`), region.id).toBe(true);
      const url = new URL(imageryRequestUrl(template));
      expect(url.protocol).toBe("https:");
      expect(url.host).toBe(hosts[region.id]);
      expect(template).not.toMatch(/key|token|secret|signature|auth|apikey|access/i);
      expect([...url.searchParams.keys()]).toEqual([]);
      expect(url.username + url.password).toBe("");
      // Ordinary map tiles; this kind of server wants the row before the column.
      expect(template).toMatch(/\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
    }
  });

  it("each has an id, a map source of ours, sane zooms and bounds, and a credit with a link", () => {
    expect(new Set(REGIONAL_IMAGERY.map((region) => region.id)).size).toBe(REGIONAL_IMAGERY.length);
    expect(new Set(REGIONAL_IMAGERY.map((region) => region.sourceId)).size).toBe(
      REGIONAL_IMAGERY.length,
    );
    for (const region of REGIONAL_IMAGERY) {
      expect(
        labelAnchorId([
          { id: "places", type: "symbol" },
          { id: region.sourceId, type: "raster" },
        ]),
      ).toBe("places");
      expect([IMAGERY_BASE_SOURCE_ID, IMAGERY_DETAIL_SOURCE_ID]).not.toContain(region.sourceId);
      expect(region.tileSize).toBe(256);
      expect(region.minzoom).toBeLessThan(region.maxzoom);
      // Sharper than the national detail, or there would be no point.
      expect(region.maxzoom).toBeGreaterThan(IMAGERY_DETAIL.maxzoom);
      const [west, south, east, north] = region.bounds;
      expect(west).toBeLessThan(east);
      expect(south).toBeLessThan(north);
      expect(hasAerialPhotos({ lat: (south + north) / 2, lng: (west + east) / 2 })).toBe(true);
      expect(region.attribution).toMatch(
        /^Aerial photos: <a href="https:\/\/[^"]+" target="_blank" rel="noopener">[^<]+<\/a>$/,
      );
    }
  });

  it("Portland: the city's summer 2025 flight, down to zoom 21", () => {
    expect(imageryRequestUrl(PORTLAND.tiles[0])).toBe(
      "https://www.portlandmaps.com/arcgis/rest/services/Public/Aerial_Photos_Summer_2025/MapServer/tile/{z}/{y}/{x}",
    );
    expect(PORTLAND.maxzoom).toBe(21);
    expect(PORTLAND.attribution.replace(/<[^>]+>/g, "")).toBe(
      "Aerial photos: City of Portland, summer 2025",
    );
    expect(PORTLAND.attribution).toContain('href="https://www.portlandmaps.com"');
  });
});

describe("where a region's photos cover everything", () => {
  const { coverage } = PORTLAND;

  it("the table lists fully covered coarse tiles as runs of columns per row", () => {
    expect(isFullyCoveredTile(coverage, 2611, 5858)).toBe(true);
    expect(isFullyCoveredTile(coverage, 2587, 5858)).toBe(true);
    expect(isFullyCoveredTile(coverage, 2586, 5858)).toBe(false);
    expect(isFullyCoveredTile(coverage, 2623, 5858)).toBe(false);
    // A row with gaps.
    expect(isFullyCoveredTile(coverage, 2600, 5872)).toBe(true);
    expect(isFullyCoveredTile(coverage, 2601, 5872)).toBe(false);
    expect(isFullyCoveredTile(coverage, 2603, 5872)).toBe(true);
    // No such row.
    expect(isFullyCoveredTile(coverage, 2611, 5840)).toBe(false);
    for (const runs of Object.values(coverage.rows)) {
      let last = -Infinity;
      for (const [from, to] of runs) {
        expect(from).toBeLessThanOrEqual(to);
        expect(from).toBeGreaterThan(last + 1);
        last = to;
      }
    }
  });

  it("covers the house on NE 36th Avenue, and the suburbs", () => {
    expect(regionCoversAround(PORTLAND, NE_36TH_AVE)).toBe(true);
    expect(regionCoversAround(PORTLAND, BEAVERTON)).toBe(true);
    expect(regionCoversAround(PORTLAND, { lat: 45.5229, lng: -122.9898 })).toBe(true); // Hillsboro
    expect(regionCoversAround(PORTLAND, { lat: 45.5001, lng: -122.4302 })).toBe(true); // Gresham
    expect(regionCoversAround(PORTLAND, { lat: 45.4207, lng: -122.6706 })).toBe(true); // Lake Oswego
  });

  it("does not cover Vancouver, Washington, nor anywhere further off", () => {
    expect(regionCoversAround(PORTLAND, VANCOUVER_WA)).toBe(false);
    expect(regionCoversAround(PORTLAND, SALEM)).toBe(false);
    expect(regionCoversAround(PORTLAND, SAN_FRANCISCO)).toBe(false);
    expect(regionCoversAround(PORTLAND, ISTANBUL)).toBe(false);
    expect(regionCoversAround(PORTLAND, { lat: Number.NaN, lng: -122.6 })).toBe(false);
  });

  it("wants the eight tiles around as well: a covered tile on the rim is not enough", () => {
    // 14/2604/5851 is all photo, but north of it there is nothing.
    expect(isFullyCoveredTile(coverage, 2604, 5851)).toBe(true);
    const n = 2 ** coverage.zoom;
    const onTheRim = {
      lng: ((2604 + 0.5) / n) * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (5851 + 0.5)) / n))) * 180) / Math.PI,
    };
    expect(regionCoversAround(PORTLAND, onTheRim)).toBe(false);
  });

  it("that ring is wider than any map at the zooms the national detail is drawn at", () => {
    // A coarse tile is 512 px wide at its own zoom and doubles with each zoom
    // step: with the map's middle anywhere in the centre tile, one more tile
    // each way is covered — more than half of any screen.
    const widthAtDetailZoomPx = 512 * 2 ** (IMAGERY_DETAIL.minzoom - coverage.zoom);
    expect(widthAtDetailZoomPx).toBeGreaterThanOrEqual(2048);
  });

  it("every spot it covers all around is inside the region's bounds (where its photos are drawn)", () => {
    const n = 2 ** coverage.zoom;
    let spots = 0;
    for (const [row, runs] of Object.entries(coverage.rows)) {
      for (const [from, to] of runs) {
        for (let x = from; x <= to; x++) {
          const y = Number(row);
          const spot = {
            lng: ((x + 0.5) / n) * 360 - 180,
            lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI,
          };
          if (!regionCoversAround(PORTLAND, spot)) continue;
          spots++;
          expect(regionalImageryAt(spot)).toBe(PORTLAND);
          const [west, south, east, north] = PORTLAND.bounds;
          expect(spot.lng > west && spot.lng < east && spot.lat > south && spot.lat < north).toBe(
            true,
          );
        }
      }
    }
    expect(spots).toBeGreaterThan(300);
  });
});

describe("regionalImageryAt", () => {
  it("is the region the map is at, or right next to", () => {
    expect(regionalImageryAt(NE_36TH_AVE)).toBe(PORTLAND);
    expect(regionalImageryAt(BEAVERTON)).toBe(PORTLAND);
    // No photos of Vancouver itself, but the city's reach the river: drawn where they are.
    expect(regionalImageryAt(VANCOUVER_WA)).toBe(PORTLAND);
    expect(regionalImageryAt({ lat: NE_36TH_AVE.lat, lng: NE_36TH_AVE.lng - 360 })).toBe(PORTLAND);
  });

  it("is nothing anywhere else: no credit for Portland on a map of another city", () => {
    expect(regionalImageryAt(SAN_FRANCISCO)).toBeNull();
    expect(regionalImageryAt(SALEM)).toBeNull();
    expect(regionalImageryAt({ lat: 47.6062, lng: -122.3321 })).toBeNull(); // Seattle
    expect(regionalImageryAt(ISTANBUL)).toBeNull();
    expect(regionalImageryAt({ lat: Number.NaN, lng: 0 })).toBeNull();
  });
});

describe("needsImageryDetail", () => {
  it("is off where a region's photos cover everything in view", () => {
    expect(needsImageryDetail(NE_36TH_AVE)).toBe(false);
    expect(needsImageryDetail(BEAVERTON)).toBe(false);
  });

  it("is on everywhere else, as before: at the edge of a region and far from any", () => {
    expect(needsImageryDetail(VANCOUVER_WA)).toBe(true);
    expect(needsImageryDetail(SALEM)).toBe(true);
    expect(needsImageryDetail(SAN_FRANCISCO)).toBe(true);
    expect(needsImageryDetail({ lat: 40.758, lng: -73.9855 })).toBe(true);
    expect(needsImageryDetail({ lat: Number.NaN, lng: Number.NaN })).toBe(true);
  });
});

describe("loading a region's photo", () => {
  const ASKED = `${IMAGERY_REGIONAL_PROTOCOL}://www.portlandmaps.com/arcgis/rest/services/Public/Aerial_Photos_Summer_2025/MapServer/tile/19/187485/83556`;
  const FETCHED = ASKED.replace(`${IMAGERY_REGIONAL_PROTOCOL}://`, "https://");
  const picture = () => new Response(new Uint8Array([9, 8, 7]));
  const noWaiting = () => {
    const waits: number[] = [];
    return { waits, pause: vi.fn(async (ms: number) => void waits.push(ms)) };
  };
  /** Each test its own queue: nothing waits behind another test's pictures. */
  const turn = () => createLimiter(REGIONAL_PARALLEL_REQUESTS);

  it("is fetched from the real address, over https", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => picture());
    const { data } = await loadRegionalImagery(ASKED, { fetchImpl, turn: turn(), ...noWaiting() });
    expect([...new Uint8Array(data)]).toEqual([9, 8, 7]);
    expect(fetchImpl.mock.calls[0][0]).toBe(FETCHED);
  });

  it("where the region has no photo, that is the answer: no second try, and MapLibre is told '404'", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("Not Found", { status: 404 }));
    const { pause } = noWaiting();
    const loading = loadRegionalImagery(ASKED, { fetchImpl, pause, turn: turn() });
    await expect(loading).rejects.toBeInstanceOf(NoSuchPictureError);
    await expect(loading).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it("turned away ('503') or cut off, it is asked for again, a little later each time", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(picture());
    const { waits, pause } = noWaiting();
    const { data } = await loadRegionalImagery(ASKED, { fetchImpl, pause, turn: turn() });
    expect(data.byteLength).toBe(3);
    expect(waits).toEqual(REGIONAL_RETRY_WAITS_MS.slice(0, 2));
  });

  it("is given up when every try failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("busy", { status: 503 }));
    const { waits, pause } = noWaiting();
    await expect(loadRegionalImagery(ASKED, { fetchImpl, pause, turn: turn() })).rejects.toThrow(
      /HTTP 503/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(REGIONAL_RETRY_WAITS_MS.length + 1);
    expect(waits).toEqual([...REGIONAL_RETRY_WAITS_MS]);
  });

  it("a few at a time: the rest wait their turn, first come first served", async () => {
    const limit = 2;
    const queue = createLimiter(limit);
    const started: number[] = [];
    const finish: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          running++;
          most = Math.max(most, running);
          finish.push(() => {
            running--;
            resolve(picture());
          });
        }),
    );
    const all = [0, 1, 2, 3, 4].map((i) =>
      loadRegionalImagery(`${ASKED}${i}`, { fetchImpl, turn: queue }).then(() => started.push(i)),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(limit));
    while (finish.length > 0) {
      finish.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(most).toBe(limit);
    expect(fetchImpl.mock.calls.map(([url]) => String(url).slice(-1))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(started.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("a tile no longer wanted leaves the queue without ever being asked for", async () => {
    const queue = createLimiter(1);
    let release = () => {};
    const fetchImpl = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => (release = () => resolve(picture()))),
    );
    const first = loadRegionalImagery(`${ASKED}0`, { fetchImpl, turn: queue });
    const controller = new AbortController();
    const second = loadRegionalImagery(`${ASKED}1`, {
      fetchImpl,
      turn: queue,
      signal: controller.signal,
    });
    const third = loadRegionalImagery(`${ASKED}2`, { fetchImpl, turn: queue });
    const dropped = expect(second).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await dropped;
    release();
    await first;
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    release();
    await third;
    expect(fetchImpl.mock.calls.map(([url]) => String(url).slice(-1))).toEqual(["0", "2"]);
    // Already aborted on arrival: not even queued.
    await expect(
      loadRegionalImagery(ASKED, { fetchImpl, turn: queue, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
