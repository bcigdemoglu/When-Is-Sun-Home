import { describe, expect, it, vi } from "vitest";
import {
  IMAGERY_ATTRIBUTION,
  IMAGERY_BASE,
  IMAGERY_BASE_SOURCE_ID,
  IMAGERY_DETAIL,
  IMAGERY_DETAIL_PROTOCOL,
  IMAGERY_DETAIL_SOURCE_ID,
  IMAGERY_RETRY_WAITS_MS,
  NO_AERIAL_PHOTOS_MESSAGE,
  cameraPitch,
  hasAerialPhotos,
  imageryDetailUrl,
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
  const detailTemplate = imageryDetailUrl(IMAGERY_DETAIL.tiles[0]);
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
    expect(imageryDetailUrl(ASKED)).toBe(FETCHED);
    expect(imageryDetailUrl(FETCHED)).toBe(FETCHED);
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
