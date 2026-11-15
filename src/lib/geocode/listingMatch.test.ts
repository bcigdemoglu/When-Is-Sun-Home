import { describe, expect, it } from "vitest";
import { parseListingLink, type ListingAddress } from "./listingLink";
import { canonicalWords, findListingMatch, listingAgreement } from "./listingMatch";
import type { PlaceSuggestion, SuggestionAddress } from "./types";

const link = (text: string): ListingAddress => {
  const parsed = parseListingLink(text);
  if (parsed?.kind !== "address") throw new Error(`not an address link: ${text}`);
  return parsed;
};
const zillow = (slug: string) => link(`https://www.zillow.com/homedetails/${slug}/1_zpid/`);

let serial = 0;
/** A geocoder result; the shapes below are what Photon and Nominatim really answered. */
function result(
  address: Partial<SuggestionAddress>,
  extra: Partial<PlaceSuggestion> = {},
): PlaceSuggestion {
  serial += 1;
  const label = [address.houseNumber, address.street].filter(Boolean).join(" ") || "Somewhere";
  return {
    id: `W${serial}`,
    lat: 37.79143,
    lng: -122.43044,
    name: label,
    label,
    detail: "",
    address: { places: [], countryCode: "us", ...address },
    ...extra,
  };
}

const CLAY = zillow("2220-Clay-St-San-Francisco-CA-94115");
const CLAY_HOUSE = {
  houseNumber: "2220",
  street: "Clay Street",
  places: ["San Francisco"],
  state: "California",
  postcode: "94115",
};

describe("canonicalWords", () => {
  it.each([
    ["Clay Street", ["clay", "st"]],
    ["West 5th Street", ["w", "5th", "st"]],
    ["Saint Charles Avenue", ["st", "charles", "ave"]],
    ["St. Charles Ave", ["st", "charles", "ave"]],
    ["Fifth Avenue", ["5th", "ave"]],
    ["Martin Luther King Junior Boulevard", ["martin", "luther", "king", "jr", "blvd"]],
    ["O'Farrell Street", ["ofarrell", "st"]],
    ["Winston-Salem", ["winston", "salem"]],
  ])("%s", (text, words) => {
    expect(canonicalWords(text)).toEqual(words);
  });
});

describe("listingAgreement — is this result the link's house?", () => {
  it("yes: the same number on the same street in the same ZIP", () => {
    expect(listingAgreement(CLAY, result(CLAY_HOUSE))).toBe("zip");
  });

  it("no without a house number: a street is not a house", () => {
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, houseNumber: undefined }))).toBeNull();
    // Photon's street results carry the name, and no `street`.
    expect(
      listingAgreement(CLAY, result({ places: ["San Francisco"], postcode: "94115" })),
    ).toBeNull();
  });

  it("no for another number on the right street", () => {
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, houseNumber: "2222" }))).toBeNull();
    // What Photon really put first for "2500 Old Stage Rd Central Point".
    expect(
      listingAgreement(
        zillow("2500-Old-Stage-Rd-Central-Point-OR-97502"),
        result({
          houseNumber: "794",
          street: "Old Stage Road",
          places: ["Central Point"],
          state: "Oregon",
          postcode: "97502",
        }),
      ),
    ).toBeNull();
  });

  it("no for the right number on another street, however alike", () => {
    const quail = link(
      "https://www.realtor.com/realestateandhomes-detail/9504-Quail-Village-Ln_Austin_TX_78758_M89558-38462",
    );
    const austin = { houseNumber: "9504", places: ["Austin"], state: "Texas", postcode: "78758" };
    expect(listingAgreement(quail, result({ ...austin, street: "Quail Village Lane" }))).toBe(
      "zip",
    );
    // All three were in Photon's answer, same number, same ZIP.
    expect(listingAgreement(quail, result({ ...austin, street: "Quail Court" }))).toBeNull();
    expect(
      listingAgreement(quail, result({ ...austin, street: "Mountain Quail Road" })),
    ).toBeNull();
    expect(listingAgreement(quail, result({ ...austin, street: "Quail Village" }))).toBeNull();
  });

  it("tells West from East, and a street from its namesake without a compass point", () => {
    const west = zillow("1001-W-5th-St-Winston-Salem-NC-27101");
    const place = {
      houseNumber: "1001",
      places: ["Winston-Salem"],
      state: "North Carolina",
      postcode: "27101",
    };
    expect(listingAgreement(west, result({ ...place, street: "West 5th Street" }))).toBe("zip");
    expect(listingAgreement(west, result({ ...place, street: "East 5th Street" }))).toBeNull();
    expect(listingAgreement(west, result({ ...place, street: "5th Street" }))).toBeNull();
  });

  it("accepts a number that is one of a building's several", () => {
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, houseNumber: "2218;2220" }))).toBe("zip");
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, houseNumber: "2220-2224" }))).toBe("zip");
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, houseNumber: "12220" }))).toBeNull();
  });

  it("goes by the town when the map's ZIP is off (they are mistyped surprisingly often)", () => {
    const fremont = link(
      "https://www.trulia.com/p/ca/fremont/3366-peralta-blvd-fremont-ca-94536--2083375174",
    );
    // OpenStreetMap really has this house under 94636.
    expect(
      listingAgreement(
        fremont,
        result({
          houseNumber: "3366",
          street: "Peralta Boulevard",
          places: ["Fremont"],
          state: "California",
          postcode: "94636",
        }),
      ),
    ).toBe("town");
  });

  it("goes by the ZIP when the listing's town is the postal one", () => {
    // A listing in "Birmingham" that the map files under Indian Valley.
    expect(
      listingAgreement(
        link("https://www.redfin.com/AL/Birmingham/2529-Comanche-Dr-35244/home/80696773"),
        result({
          houseNumber: "2529",
          street: "Comanche Drive",
          places: ["Indian Valley"],
          state: "Alabama",
          postcode: "35244",
        }),
      ),
    ).toBe("zip");
  });

  it("never takes a county for the town of the same name", () => {
    // A listing in the city of Orange; the only "123 Main Street" the geocoder
    // has is in Santa Ana — Orange COUNTY. Not that house.
    const orange = link("https://www.redfin.com/CA/Orange/123-Main-St-92866/home/1234567");
    const santaAna = {
      houseNumber: "123",
      street: "Main Street",
      places: ["Santa Ana"],
      state: "California",
      postcode: "92701",
    };
    expect(listingAgreement(orange, result(santaAna))).toBeNull();
    expect(listingAgreement(orange, result({ ...santaAna, places: ["Orange"] }))).toBe("town");
  });

  it("knows a borough by its plain name", () => {
    const bronx = link(
      "https://www.trulia.com/p/ny/bronx/895-tiffany-st-bronx-ny-10459--2008893028",
    );
    expect(
      listingAgreement(
        bronx,
        result({
          houseNumber: "895",
          street: "Tiffany Street",
          places: ["New York", "The Bronx"],
          state: "New York",
          postcode: "10499", // a wrong ZIP: the borough has to carry it
        }),
      ),
    ).toBe("town");
  });

  it("no when neither ZIP nor town agrees", () => {
    expect(
      listingAgreement(CLAY, result({ ...CLAY_HOUSE, places: ["Oakland"], postcode: "94612" })),
    ).toBeNull();
  });

  it("no when the state or the country contradicts the link", () => {
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, state: "Nevada" }))).toBeNull();
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, countryCode: "ca" }))).toBeNull();
    // A state written as its code is the same state.
    expect(listingAgreement(CLAY, result({ ...CLAY_HOUSE, state: "CA" }))).toBe("zip");
  });

  it("no for a link without a house number, and for a suggestion that is not from a geocoder", () => {
    const unnumbered = zillow("Old-Stage-Rd-Central-Point-OR-97502");
    expect(
      listingAgreement(
        unnumbered,
        result({ houseNumber: "2500", street: "Old Stage Road", postcode: "97502" }),
      ),
    ).toBeNull();
    const coordinates: PlaceSuggestion = {
      id: "coord:1,2",
      lat: 1,
      lng: 2,
      label: "1, 2",
      detail: "",
    };
    expect(listingAgreement(CLAY, coordinates)).toBeNull();
  });

  describe("where the link runs street and city together (Zillow)", () => {
    it("takes the result's street if it is how the words begin and the town is what follows", () => {
      expect(
        listingAgreement(
          zillow("1440-Broadway-San-Francisco-CA-94109"),
          result({
            houseNumber: "1440",
            street: "Broadway",
            places: ["San Francisco"],
            state: "California",
            postcode: "94109",
          }),
        ),
      ).toBe("zip");
    });

    it("reads “St St Louis” right: a street type, then a saint", () => {
      expect(
        listingAgreement(
          zillow("4421-Main-St-St-Louis-MO-63110"),
          result({
            houseNumber: "4421",
            street: "Main Street",
            places: ["Saint Louis"],
            state: "Missouri",
            postcode: "63110",
          }),
        ),
      ).toBe("zip");
    });

    it("never takes the beginning of a longer street name for the street", () => {
      const parkAveSouth = zillow("100-Park-Ave-S-New-York-NY-10017");
      const newYork = {
        houseNumber: "100",
        places: ["New York"],
        state: "New York",
        postcode: "10017",
      };
      // "Park Ave S" is not "Park Avenue", and certainly not a street called "Park".
      expect(
        listingAgreement(parkAveSouth, result({ ...newYork, street: "Park Avenue" })),
      ).toBeNull();
      expect(listingAgreement(parkAveSouth, result({ ...newYork, street: "Park" }))).toBeNull();
      expect(
        listingAgreement(parkAveSouth, result({ ...newYork, street: "Park Avenue South" })),
      ).toBe("zip");
      // "Lake" is not "Lake Shore Dr".
      expect(
        listingAgreement(
          zillow("1000-Lake-Shore-Dr-Chicago-IL-60611"),
          result({
            houseNumber: "1000",
            street: "Lake",
            places: ["Chicago"],
            state: "Illinois",
            postcode: "60611",
          }),
        ),
      ).toBeNull();
    });

    it("accepts a postal town the map does not know, when the street clearly ends before it", () => {
      expect(
        listingAgreement(
          zillow("5215-Balboa-Blvd-Encino-CA-91316"),
          result({
            houseNumber: "5215",
            street: "Balboa Boulevard",
            places: ["Los Angeles"],
            state: "California",
            postcode: "91316",
          }),
        ),
      ).toBe("zip");
    });

    it("is not sure when the words after the street could be a compass point of it", () => {
      // "Dilling St North Hollywood": "Dilling St N", Hollywood — or Dilling St, North Hollywood?
      expect(
        listingAgreement(
          zillow("11222-Dilling-St-North-Hollywood-CA-91602"),
          result({
            houseNumber: "11222",
            street: "Dilling Street",
            places: ["Los Angeles", "Studio City"],
            state: "California",
            postcode: "91602",
          }),
        ),
      ).toBeNull();
      // Where the map knows the town by that name, there is no doubt.
      expect(
        listingAgreement(
          zillow("100-Grand-Ave-South-San-Francisco-CA-94080"),
          result({
            houseNumber: "100",
            street: "Grand Avenue",
            places: ["South San Francisco"],
            state: "California",
            postcode: "94080",
          }),
        ),
      ).toBe("zip");
    });

    it("lets a unit that nothing marks stand between street and city", () => {
      expect(
        listingAgreement(
          zillow("1805-Browder-St-101-Dallas-TX-75215"),
          result({
            houseNumber: "1805",
            street: "Browder Street",
            places: ["Dallas"],
            state: "Texas",
            postcode: "75215",
          }),
        ),
      ).toBe("zip");
    });
  });
});

describe("findListingMatch", () => {
  const house = (extra: Partial<PlaceSuggestion> = {}) => result(CLAY_HOUSE, extra);

  it("finds the house wherever it stands in the list", () => {
    const street = result({ places: ["San Francisco"], postcode: "94115" });
    const match = house();
    expect(findListingMatch(CLAY, [street, match])).toBe(match);
  });

  it("is null when nothing is the house — the first result is not good enough", () => {
    expect(findListingMatch(CLAY, [])).toBeNull();
    expect(
      findListingMatch(CLAY, [
        result({ ...CLAY_HOUSE, houseNumber: "2200" }),
        result({ places: ["San Francisco"], postcode: "94115" }),
      ]),
    ).toBeNull();
  });

  it("takes one address found twice for one place (a house and its garage, a point and its building)", () => {
    const garage = house({ lat: 37.79159, lng: -122.43044 });
    const building = house();
    expect(findListingMatch(CLAY, [garage, building])).toBe(garage);
  });

  it("prefers a mapped house to a position worked out along the street", () => {
    const interpolated = house({ lat: 37.79135, lng: -122.42966, approximate: true });
    const mapped = house();
    expect(findListingMatch(CLAY, [interpolated, mapped])).toBe(mapped);
    // Worked out is still better than nothing.
    expect(findListingMatch(CLAY, [interpolated])).toBe(interpolated);
  });

  it("is null when the same address turns up in two different places", () => {
    const here = house();
    const elsewhere = house({ lat: 37.75, lng: -122.41 });
    expect(findListingMatch(CLAY, [here, elsewhere])).toBeNull();
  });

  it("lets the ZIP decide between two places with the same address in one town", () => {
    const broadway = zillow("100-Broadway-New-York-NY-10005");
    const base = {
      houseNumber: "100",
      street: "Broadway",
      places: ["New York"],
      state: "New York",
    };
    const manhattan = result({ ...base, postcode: "10005" }, { lat: 40.70798, lng: -74.01109 });
    const brooklyn = result({ ...base, postcode: "11249" }, { lat: 40.7106, lng: -73.9654 });
    expect(findListingMatch(broadway, [brooklyn, manhattan])).toBe(manhattan);
    // Without a ZIP to go by, two candidates are one too many.
    const noZip = zillow("100-Broadway-New-York-NY");
    expect(findListingMatch(noZip, [brooklyn, manhattan])).toBeNull();
  });
});
