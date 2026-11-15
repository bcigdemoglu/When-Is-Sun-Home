/**
 * Harness-only: pretend the geocoders are in a given state, without touching
 * the network. Wraps `window.fetch` for the two geocoder hosts; everything
 * else passes through.
 */

export type GeocoderMode = "live" | "down" | "fixture";

const PHOTON_HOST = "photon.komoot.io";
const NOMINATIM_HOST = "nominatim.openstreetmap.org";

/** What the canned Nominatim knows: answers shaped like the real ones. */
function nominatimFixture(url: URL): unknown {
  if (url.pathname.startsWith("/reverse")) {
    return {
      place_id: 2,
      osm_type: "way",
      osm_id: 262106873,
      lat: url.searchParams.get("lat") ?? "37.793",
      lon: url.searchParams.get("lon") ?? "-122.4395",
      name: "",
      address: {
        house_number: "2698",
        road: "Pacific Avenue",
        city: "San Francisco",
        state: "California",
        country: "United States",
        country_code: "us",
      },
    };
  }
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  if (q.includes("nowhere")) return [];
  const address = (house: string, road: string, quarter: string) => ({
    house_number: house,
    road,
    quarter,
    city: "San Francisco",
    state: "California",
    postcode: "94115",
    country: "United States",
    country_code: "us",
  });
  return [
    {
      place_id: 11,
      osm_type: "way",
      osm_id: 468450103,
      lat: "37.7931118",
      lon: "-122.4372316",
      name: "",
      address: address("2550", "Pacific Avenue", "Pacific Heights"),
    },
    {
      place_id: 12,
      osm_type: "way",
      osm_id: 262106873,
      lat: "37.7929911",
      lon: "-122.4395109",
      name: "",
      address: address("2698", "Pacific Avenue", "Pacific Heights"),
    },
    {
      place_id: 13,
      osm_type: "way",
      osm_id: 8915437,
      lat: "37.7935",
      lon: "-122.4301",
      name: "Pacific Avenue",
      address: {
        road: "Pacific Avenue",
        city: "San Francisco",
        state: "California",
        country: "United States",
        country_code: "us",
      },
    },
  ];
}

/**
 * Install the simulation. Returns a function that removes it. With both
 * modes "live" nothing is installed.
 */
export function simulateGeocoders(photon: GeocoderMode, nominatim: GeocoderMode): () => void {
  if (photon === "live" && nominatim === "live") return () => {};
  const realFetch = window.fetch;

  const simulated: typeof fetch = async (input, init) => {
    let url: URL | null = null;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      // not an absolute URL: not a geocoder
    }
    const mode =
      url?.hostname === PHOTON_HOST
        ? photon
        : url?.hostname === NOMINATIM_HOST
          ? nominatim
          : "live";
    if (!url || mode === "live") return realFetch(input, init);
    // A little latency, so loading states can be seen.
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (mode === "down" || url.hostname === PHOTON_HOST) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(nominatimFixture(url)), {
      headers: { "content-type": "application/json" },
    });
  };

  window.fetch = simulated;
  return () => {
    if (window.fetch === simulated) window.fetch = realFetch;
  };
}

export function geocoderMode(value: string | undefined, fallback: GeocoderMode): GeocoderMode {
  return value === "live" || value === "down" || value === "fixture" ? value : fallback;
}
