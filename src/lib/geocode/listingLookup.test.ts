import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseListingLink, type ListingAddress } from "./listingLink";
import { lookUpListing } from "./listingLookup";
import { resetNominatimLimiter } from "./nominatim";
import { getPhotonHealth, reportPhotonFailure, resetPhotonHealth } from "./photonHealth";

const link = (text: string): ListingAddress => {
  const parsed = parseListingLink(text);
  if (parsed?.kind !== "address") throw new Error(`not an address link: ${text}`);
  return parsed;
};

/** A Zillow link: street and city run together, the city guessed away for the second question. */
const MURRAY = link("https://www.zillow.com/homedetails/212-Murray-Ln-Richardson-TX-75080/1_zpid/");
const WHOLE = "212 Murray Ln Richardson, TX 75080";
const STREET_ONLY = "212 Murray Ln, TX 75080";

interface PhotonHit {
  housenumber?: string;
  street?: string;
  name?: string;
  city?: string;
  postcode?: string;
}
function photon(...hits: PhotonHit[]): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: hits.map((properties, index) => ({
      type: "Feature",
      properties: {
        osm_type: "W",
        osm_id: 100 + index,
        state: "Texas",
        countrycode: "US",
        country: "United States",
        ...properties,
      },
      geometry: { type: "Point", coordinates: [-96.7574, 32.9496] },
    })),
  });
}

interface NominatimHit {
  house_number?: string;
  road: string;
  city?: string;
  postcode?: string;
  /** A house number worked out along the street (see `isInterpolated`). */
  interpolated?: boolean;
}
function nominatim(...hits: NominatimHit[]): string {
  return JSON.stringify(
    hits.map(({ interpolated, ...address }, index) => ({
      osm_type: "way",
      osm_id: 200 + index,
      lat: "32.9496",
      lon: "-96.7574",
      category: interpolated ? "place" : address.house_number ? "building" : "highway",
      type: interpolated ? "house" : address.house_number ? "yes" : "residential",
      name: address.house_number ? "" : address.road,
      address: { ...address, state: "Texas", country: "United States", country_code: "us" },
    })),
  );
}

const MURRAY_HOUSE = {
  housenumber: "212",
  street: "Murray Lane",
  city: "Richardson",
  postcode: "75080",
};
const MURRAY_STREET = { name: "Murray Lane", city: "Richardson", postcode: "75080" };

type Answers = Record<string, string | Error | number>;

/** A `fetch` that answers by service and question, and records what was asked. */
function services(photonAnswers: Answers, nominatimAnswers: Answers = {}) {
  const asked: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(String(input));
    const isPhoton = url.hostname === "photon.komoot.io";
    const question = url.searchParams.get("q") ?? "";
    asked.push(`${isPhoton ? "photon" : "nominatim"}: ${question}`);
    const answer = (isPhoton ? photonAnswers : nominatimAnswers)[question];
    if (answer instanceof Error) throw answer;
    if (typeof answer === "number") return new Response("mocked", { status: answer });
    return new Response(answer ?? (isPhoton ? photon() : "[]"));
  });
  return { asked, fetchImpl };
}

/** Run a lookup to its end: Nominatim's one-per-second limiter runs on the (fake) clock. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const watched = pending.finally(() => {
    done = true;
  });
  watched.catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(250);
  return watched;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPhotonHealth();
  resetNominatimLimiter();
});

afterEach(() => {
  vi.useRealTimers();
  resetPhotonHealth();
});

describe("lookUpListing", () => {
  it("asks Photon once when it knows the house, and nobody else", async () => {
    const { asked, fetchImpl } = services({ [WHOLE]: photon(MURRAY_STREET, MURRAY_HOUSE) });
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(asked).toEqual([`photon: ${WHOLE}`]);
    expect(found.match).toMatchObject({ label: "212 Murray Lane" });
    // The house leads the list, whatever the geocoder ranked first.
    expect(found.suggestions.map((s) => s.label)).toEqual(["212 Murray Lane", "Murray Lane"]);
  });

  it("asks again without the city when the whole address finds nothing (a postal city)", async () => {
    const { asked, fetchImpl } = services({ [STREET_ONLY]: photon(MURRAY_HOUSE) });
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(asked).toEqual([`photon: ${WHOLE}`, `photon: ${STREET_ONLY}`]);
    expect(found.match).toMatchObject({ label: "212 Murray Lane" });
  });

  it("turns to Nominatim when Photon only knows the street, and takes its worked-out house", async () => {
    const { asked, fetchImpl } = services(
      { [WHOLE]: photon(MURRAY_STREET), [STREET_ONLY]: photon(MURRAY_STREET) },
      {
        [WHOLE]: nominatim({
          house_number: "212",
          road: "Murray Lane",
          city: "Richardson",
          postcode: "75080",
          interpolated: true,
        }),
      },
    );
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(asked).toEqual([`photon: ${WHOLE}`, `photon: ${STREET_ONLY}`, `nominatim: ${WHOLE}`]);
    expect(found.match).toMatchObject({ label: "212 Murray Lane", approximate: true });
    expect(found.suggestions).toHaveLength(1);
  });

  it("asks all four questions for a house on no map — and no more", async () => {
    const { asked, fetchImpl } = services({}, {});
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(asked).toEqual([
      `photon: ${WHOLE}`,
      `photon: ${STREET_ONLY}`,
      `nominatim: ${WHOLE}`,
      `nominatim: ${STREET_ONLY}`,
    ]);
    expect(found).toEqual({ match: null, suggestions: [] });
  });

  it("lists what the first question found when nothing is clearly the house", async () => {
    const { fetchImpl } = services(
      { [WHOLE]: photon(MURRAY_STREET, { ...MURRAY_HOUSE, housenumber: "214" }) },
      { [STREET_ONLY]: nominatim({ road: "Murray Lane", city: "Richardson", postcode: "75080" }) },
    );
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(found.match).toBeNull();
    expect(found.suggestions.map((s) => s.label)).toEqual(["Murray Lane", "214 Murray Lane"]);
  });

  it("asks one question per service when the link allows no second one", async () => {
    const broadway = link(
      "https://www.zillow.com/homedetails/1440-Broadway-San-Francisco-CA-94109/1_zpid/",
    );
    expect(broadway.streetQuery).toBeNull();
    const { asked, fetchImpl } = services({}, {});
    await settle(lookUpListing(broadway, { fetchImpl }));
    expect(asked).toEqual([
      "photon: 1440 Broadway San Francisco, CA 94109",
      "nominatim: 1440 Broadway San Francisco, CA 94109",
    ]);
  });

  it("goes on to Nominatim when Photon cannot be reached, and leaves Photon alone after", async () => {
    const { asked, fetchImpl } = services(
      { [WHOLE]: new TypeError("Failed to fetch") },
      { [WHOLE]: nominatim({ house_number: "212", road: "Murray Lane", postcode: "75080" }) },
    );
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));

    expect(asked).toEqual([`photon: ${WHOLE}`, `nominatim: ${WHOLE}`]);
    expect(found.match).toMatchObject({ id: "nominatim:W200" });
    expect(found.match?.approximate).toBeUndefined();
    expect(getPhotonHealth()).toBe("down");
  });

  it("does not ask Photon at all while it is resting", async () => {
    reportPhotonFailure();
    const { asked, fetchImpl } = services(
      {},
      { [WHOLE]: nominatim({ house_number: "212", road: "Murray Lane", postcode: "75080" }) },
    );
    const found = await settle(lookUpListing(MURRAY, { fetchImpl }));
    expect(asked).toEqual([`nominatim: ${WHOLE}`]);
    expect(found.match).not.toBeNull();
  });

  it("an answer from Photon marks it as up again", async () => {
    const { fetchImpl } = services({ [WHOLE]: photon(MURRAY_HOUSE) });
    await settle(lookUpListing(MURRAY, { fetchImpl, services: { photon: true, nominatim: true } }));
    expect(getPhotonHealth()).toBe("up");
  });

  it("rejects when no service could be asked at all", async () => {
    const { asked, fetchImpl } = services({ [WHOLE]: 503 }, { [WHOLE]: 503 });
    await expect(settle(lookUpListing(MURRAY, { fetchImpl }))).rejects.toThrow("HTTP 503");
    // One try each: a failing service is not asked its second question.
    expect(asked).toEqual([`photon: ${WHOLE}`, `nominatim: ${WHOLE}`]);
  });

  it("still answers when one service failed and the other found nothing", async () => {
    const { fetchImpl } = services({ [WHOLE]: 503 }, {});
    await expect(settle(lookUpListing(MURRAY, { fetchImpl }))).resolves.toEqual({
      match: null,
      suggestions: [],
    });
  });

  it("stops at once when aborted, and that is not a verdict on Photon", async () => {
    const controller = new AbortController();
    const { asked, fetchImpl } = services({});
    controller.abort();
    await expect(
      settle(lookUpListing(MURRAY, { fetchImpl, signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(asked).toEqual([]);
    expect(getPhotonHealth()).toBe("up");
  });

  it("never sends anything but the address — and never to a listing site", async () => {
    const { fetchImpl } = services({}, {});
    await settle(lookUpListing(MURRAY, { fetchImpl }));
    for (const [input] of fetchImpl.mock.calls) {
      const url = new URL(String(input));
      expect(["photon.komoot.io", "nominatim.openstreetmap.org"]).toContain(url.hostname);
      expect(url.toString()).not.toMatch(/zillow|zpid|homedetails/i);
    }
  });
});
