import { describe, expect, it } from "vitest";
import { parseListingLink, type ListingAddress } from "./listingLink";

/** What an address link must come out as: [site, shown address, geocoder query]. */
type Expected = [site: string, address: string, query: string];

const ADDRESS_LINKS: [name: string, text: string, expected: Expected][] = [
  // ── Zillow ───────────────────────────────────────────────────────────────
  [
    "Zillow: a house",
    "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
    ["Zillow", "2220 Clay St San Francisco, CA 94115", "2220 Clay St San Francisco, CA 94115"],
  ],
  [
    "Zillow: no scheme, no trailing slash",
    "www.zillow.com/homedetails/6310-Needham-Ln-Austin-TX-78739/29502073_zpid",
    ["Zillow", "6310 Needham Ln Austin, TX 78739", "6310 Needham Ln Austin, TX 78739"],
  ],
  [
    "Zillow: no www at all",
    "zillow.com/homedetails/91-Deaver-St-Asheville-NC-28806/2093253357_zpid/",
    ["Zillow", "91 Deaver St Asheville, NC 28806", "91 Deaver St Asheville, NC 28806"],
  ],
  [
    "Zillow: what the app's Share sends (tracking query)",
    "https://www.zillow.com/homedetails/6333-Town-Hill-Ln-Dallas-TX-75214/26748795_zpid/?utm_campaign=iosappmessage&utm_medium=referral&utm_source=txtshare",
    ["Zillow", "6333 Town Hill Ln Dallas, TX 75214", "6333 Town Hill Ln Dallas, TX 75214"],
  ],
  [
    "Zillow: wrapped in a share sheet's sentence",
    "Check out this home I found on Zillow!\nhttps://www.zillow.com/homedetails/212-Murray-Ln-Richardson-TX-75080/27167977_zpid/?utm_source=txtshare",
    ["Zillow", "212 Murray Ln Richardson, TX 75080", "212 Murray Ln Richardson, TX 75080"],
  ],
  [
    "Zillow: at the end of a sentence, full stop attached",
    "What about zillow.com/homedetails/15903-Smithland-Dr-Houston-TX-77084/251268953_zpid/.",
    ["Zillow", "15903 Smithland Dr Houston, TX 77084", "15903 Smithland Dr Houston, TX 77084"],
  ],
  [
    "Zillow: in brackets, with a fragment",
    "(https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/#image-lightbox)",
    ["Zillow", "2220 Clay St San Francisco, CA 94115", "2220 Clay St San Francisco, CA 94115"],
  ],
  [
    "Zillow: the mobile site, old http",
    "http://m.zillow.com/homedetails/91-Deaver-St-Asheville-NC-28806/2093253357_zpid/?fullpage=true",
    ["Zillow", "91 Deaver St Asheville, NC 28806", "91 Deaver St Asheville, NC 28806"],
  ],
  [
    "Zillow: another subdomain, shouting",
    "HTTPS://MOBILE.ZILLOW.COM/HOMEDETAILS/2220-CLAY-ST-SAN-FRANCISCO-CA-94115/15075413_ZPID/",
    ["Zillow", "2220 CLAY ST SAN FRANCISCO, CA 94115", "2220 CLAY ST SAN FRANCISCO, CA 94115"],
  ],
  [
    "Zillow: a condo — APT stays in the address, not in the query",
    "https://www.zillow.com/homedetails/1440-Broadway-APT-307-San-Francisco-CA-94109/69817587_zpid/",
    [
      "Zillow",
      "1440 Broadway APT 307 San Francisco, CA 94109",
      "1440 Broadway San Francisco, CA 94109",
    ],
  ],
  [
    "Zillow: UNIT",
    "https://www.zillow.com/homedetails/5215-Balboa-Blvd-UNIT-207-Encino-CA-91316/19979864_zpid/",
    ["Zillow", "5215 Balboa Blvd UNIT 207 Encino, CA 91316", "5215 Balboa Blvd Encino, CA 91316"],
  ],
  [
    "Zillow: a # unit, percent-encoded",
    "https://www.zillow.com/homedetails/88-King-St-%2312-San-Francisco-CA-94107/2077512345_zpid/",
    ["Zillow", "88 King St #12 San Francisco, CA 94107", "88 King St San Francisco, CA 94107"],
  ],
  [
    "Zillow: a unit with nothing to mark it is left alone",
    "https://www.zillow.com/homedetails/1805-Browder-St-101-Dallas-TX-75215/339361299_zpid",
    ["Zillow", "1805 Browder St 101 Dallas, TX 75215", "1805 Browder St 101 Dallas, TX 75215"],
  ],
  [
    "Zillow: a hyphenated city (the link cannot tell a hyphen from a space)",
    "https://www.zillow.com/homedetails/1001-W-5th-St-Winston-Salem-NC-27101/6012345_zpid/",
    ["Zillow", "1001 W 5th St Winston Salem, NC 27101", "1001 W 5th St Winston Salem, NC 27101"],
  ],
  [
    "Zillow: St twice — a street type, then a saint",
    "https://www.zillow.com/homedetails/4421-Flora-Pl-Saint-Louis-MO-63110/2939421_zpid/",
    ["Zillow", "4421 Flora Pl Saint Louis, MO 63110", "4421 Flora Pl Saint Louis, MO 63110"],
  ],
  [
    "Zillow: no ZIP in the link",
    "https://www.zillow.com/homedetails/17-Lexington-Rd-Concord-MA/56789012_zpid/",
    ["Zillow", "17 Lexington Rd Concord, MA", "17 Lexington Rd Concord, MA"],
  ],
  [
    "Zillow: the address without its listing number",
    "https://www.zillow.com/homedetails/3366-Peralta-Blvd-Fremont-CA-94536/",
    ["Zillow", "3366 Peralta Blvd Fremont, CA 94536", "3366 Peralta Blvd Fremont, CA 94536"],
  ],
  [
    "Zillow: an address search (_rb), commas and all",
    "https://www.zillow.com/homes/2220-Clay-St,-San-Francisco,-CA-94115_rb/",
    ["Zillow", "2220 Clay St, San Francisco, CA 94115", "2220 Clay St, San Francisco, CA 94115"],
  ],
  [
    "Zillow: an address search with its listing number behind it",
    "https://www.zillow.com/homes/895-Tiffany-St-Bronx-NY-10459_rb/29793211_zpid/",
    ["Zillow", "895 Tiffany St Bronx, NY 10459", "895 Tiffany St Bronx, NY 10459"],
  ],
  [
    "Zillow: an address search, percent-encoded spaces and commas",
    "https://www.zillow.com/homes/714%20W%2022nd%20St%2C%20Austin%2C%20TX%2078705_rb/",
    ["Zillow", "714 W 22nd St, Austin, TX 78705", "714 W 22nd St, Austin, TX 78705"],
  ],

  // ── Redfin ───────────────────────────────────────────────────────────────
  [
    "Redfin: a house",
    "https://www.redfin.com/AL/Birmingham/2529-Comanche-Dr-35244/home/80696773",
    ["Redfin", "2529 Comanche Dr, Birmingham, AL 35244", "2529 Comanche Dr, Birmingham, AL 35244"],
  ],
  [
    "Redfin: a two-word city",
    "https://www.redfin.com/CA/San-Francisco/2220-Clay-St-94115/home/1234567",
    ["Redfin", "2220 Clay St, San Francisco, CA 94115", "2220 Clay St, San Francisco, CA 94115"],
  ],
  [
    "Redfin: a condo's unit has its own part of the link",
    "https://www.redfin.com/CA/San-Francisco/1440-Broadway-94109/unit-307/home/12345678",
    [
      "Redfin",
      "1440 Broadway Unit 307, San Francisco, CA 94109",
      "1440 Broadway, San Francisco, CA 94109",
    ],
  ],
  [
    "Redfin: a lettered unit, query string, no www",
    "redfin.com/NY/New-York/350-W-42nd-St-10036/unit-5B/home/45135122?utm_source=ios_share",
    ["Redfin", "350 W 42nd St Unit 5B, New York, NY 10036", "350 W 42nd St, New York, NY 10036"],
  ],
  [
    "Redfin: a hyphenated city, lower-case state",
    "https://www.redfin.com/nc/Winston-Salem/1001-W-5th-St-27101/home/98765432",
    ["Redfin", "1001 W 5th St, Winston Salem, NC 27101", "1001 W 5th St, Winston Salem, NC 27101"],
  ],
  [
    "Redfin: St Louis",
    "Look: https://www.redfin.com/MO/St-Louis/4421-Flora-Pl-63110/home/93555712, thoughts?",
    ["Redfin", "4421 Flora Pl, St Louis, MO 63110", "4421 Flora Pl, St Louis, MO 63110"],
  ],
  [
    "Redfin: a town called Home",
    "https://www.redfin.com/PA/Home/122-Church-St-15747/home/123456789",
    ["Redfin", "122 Church St, Home, PA 15747", "122 Church St, Home, PA 15747"],
  ],

  // ── Realtor.com ──────────────────────────────────────────────────────────
  [
    "Realtor.com: a house",
    "https://www.realtor.com/realestateandhomes-detail/9504-Quail-Village-Ln_Austin_TX_78758_M89558-38462",
    [
      "Realtor.com",
      "9504 Quail Village Ln, Austin, TX 78758",
      "9504 Quail Village Ln, Austin, TX 78758",
    ],
  ],
  [
    "Realtor.com: with a query string",
    "https://www.realtor.com/realestateandhomes-detail/603-Anfield-Cir_Austin_TX_78738_M89920-40993?from=srp-list-card",
    ["Realtor.com", "603 Anfield Cir, Austin, TX 78738", "603 Anfield Cir, Austin, TX 78738"],
  ],
  [
    "Realtor.com: a two-word city and a unit",
    "https://www.realtor.com/realestateandhomes-detail/1440-Broadway-Apt-307_San-Francisco_CA_94109_M12345-67890",
    [
      "Realtor.com",
      "1440 Broadway Apt 307, San Francisco, CA 94109",
      "1440 Broadway, San Francisco, CA 94109",
    ],
  ],
  [
    "Realtor.com: a rental",
    "realtor.com/rentals/details/5215-Balboa-Blvd-Unit-207_Encino_CA_91316_M19979-86400",
    [
      "Realtor.com",
      "5215 Balboa Blvd Unit 207, Encino, CA 91316",
      "5215 Balboa Blvd, Encino, CA 91316",
    ],
  ],
  [
    "Realtor.com: the address without the listing number",
    "https://www.realtor.com/realestateandhomes-detail/212-Murray-Ln_Richardson_TX_75080",
    ["Realtor.com", "212 Murray Ln, Richardson, TX 75080", "212 Murray Ln, Richardson, TX 75080"],
  ],
  [
    "Realtor.com: a hyphenated city",
    "https://www.realtor.com/realestateandhomes-detail/1001-W-5th-St_Winston-Salem_NC_27101_M55555-12345",
    [
      "Realtor.com",
      "1001 W 5th St, Winston Salem, NC 27101",
      "1001 W 5th St, Winston Salem, NC 27101",
    ],
  ],

  // ── Trulia (links are written small) ─────────────────────────────────────
  [
    "Trulia: /home/",
    "https://www.trulia.com/home/2220-clay-st-san-francisco-ca-94115-15075413",
    ["Trulia", "2220 Clay St San Francisco, CA 94115", "2220 Clay St San Francisco, CA 94115"],
  ],
  [
    "Trulia: /home/ with a compass point and a numbered street",
    "https://www.trulia.com/home/714-w-22nd-st-austin-tx-78705-448842386",
    ["Trulia", "714 W 22nd St Austin, TX 78705", "714 W 22nd St Austin, TX 78705"],
  ],
  [
    "Trulia: /home/ with a unit",
    "trulia.com/home/1440-broadway-apt-307-san-francisco-ca-94109-69817587?mid=0",
    [
      "Trulia",
      "1440 Broadway Apt 307 San Francisco, CA 94109",
      "1440 Broadway San Francisco, CA 94109",
    ],
  ],
  [
    "Trulia: /p/ — the path names the city, so the street is known",
    "https://www.trulia.com/p/ca/fremont/3366-peralta-blvd-fremont-ca-94536--2083375174",
    ["Trulia", "3366 Peralta Blvd, Fremont, CA 94536", "3366 Peralta Blvd, Fremont, CA 94536"],
  ],
  [
    "Trulia: /p/ in the Bronx",
    "https://www.trulia.com/p/ny/bronx/895-tiffany-st-bronx-ny-10459--2008893028",
    ["Trulia", "895 Tiffany St, Bronx, NY 10459", "895 Tiffany St, Bronx, NY 10459"],
  ],
  [
    "Trulia: /p/ with a two-word city and a # unit",
    "https://www.trulia.com/p/ca/san-francisco/88-king-st-%2312-san-francisco-ca-94107--2077512345",
    ["Trulia", "88 King St #12, San Francisco, CA 94107", "88 King St, San Francisco, CA 94107"],
  ],
  [
    "Trulia: /p/ whose slug names another city than its path",
    "https://www.trulia.com/p/ca/los-angeles/5215-balboa-blvd-encino-ca-91316--2082145311",
    ["Trulia", "5215 Balboa Blvd Encino, CA 91316", "5215 Balboa Blvd Encino, CA 91316"],
  ],
];

const NO_ADDRESS_LINKS: [name: string, text: string, site: string, reason: string][] = [
  [
    "Zillow: listing number only",
    "https://www.zillow.com/homedetails/15075413_zpid/",
    "Zillow",
    "id",
  ],
  ["Zillow: listing number under /homes/", "zillow.com/homes/15075413_zpid/", "Zillow", "id"],
  [
    "Zillow: listing number in a share sentence",
    "Saw this one: https://www.zillow.com/homedetails/29502073_zpid/?utm_source=txtshare",
    "Zillow",
    "id",
  ],
  [
    "Zillow: an apartment building, by name",
    "https://www.zillow.com/apartments/madison-tn/hickory-lofts/ChcYNq/",
    "Zillow",
    "building",
  ],
  [
    "Zillow: a building page",
    "https://www.zillow.com/b/davids-test-community-san-diego-ca-9Mmkrx/",
    "Zillow",
    "building",
  ],
  ["Zillow: a building page, code only", "https://www.zillow.com/b/-Ck8zhs", "Zillow", "building"],
  ["Redfin: the app's short link", "https://redf.in/WW4UwK", "Redfin", "short-link"],
  [
    "Redfin: the short link in the app's share text",
    "Check out this home on Redfin! redf.in/AbC123",
    "Redfin",
    "short-link",
  ],
  ["Redfin: listing number only", "https://www.redfin.com/home/194191988", "Redfin", "id"],
  [
    "Redfin: an apartment building, by name",
    "https://www.redfin.com/WA/Seattle/The-Olivian/apartment/42413421",
    "Redfin",
    "building",
  ],
  [
    "Realtor.com: listing number only",
    "https://www.realtor.com/realestateandhomes-detail/M8955838462",
    "Realtor.com",
    "id",
  ],
  [
    "Trulia: a building (its name and address run together)",
    "https://www.trulia.com/building/ascend-at-pioneer-hill-1701-daleside-ln-austin-tx-78754-2758539720",
    "Trulia",
    "building",
  ],
  ["Trulia: listing number only", "https://www.trulia.com/home/448842386", "Trulia", "id"],
];

const NOT_LISTINGS: [name: string, text: string][] = [
  // Look-alike hosts: the address would parse, the host must not.
  [
    "a host that only starts with zillow.com",
    "https://zillow.com.evil.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
  ],
  [
    "a host that only ends in zillow.com",
    "https://notzillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
  ],
  [
    "zillow.com in the path of another host",
    "evil.com/zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
  ],
  [
    "zillow.com as the user name of another host",
    "https://www.zillow.com@evil.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
  ],
  [
    "a look-alike inside another site's query string",
    "https://evil.com/?next=https://zillow.com.evil.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/1_zpid/",
  ],
  [
    "another country's realtor site",
    "https://www.realtor.ca/real-estate/26543210/123-main-st-toronto",
  ],
  ["a look-alike of the short link", "https://redf.in.example.org/WW4UwK"],
  [
    "a different top-level domain",
    "https://www.redfin.co/CA/San-Francisco/2220-Clay-St-94115/home/1",
  ],
  ["not a web link", "zillow://homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/"],
  // Other pages of the same sites.
  ["Zillow's home page", "https://www.zillow.com/"],
  ["Zillow: a city's listings", "https://www.zillow.com/san-francisco-ca/"],
  ["Zillow: a city search (_rb)", "https://www.zillow.com/homes/for_sale/Austin,-TX_rb/"],
  ["Zillow: a ZIP search (_rb)", "https://www.zillow.com/homes/94115_rb/"],
  ["Zillow: a region id", "https://www.zillow.com/homes/20330_rid/"],
  ["Zillow: mortgage rates", "https://www.zillow.com/mortgage-rates/"],
  ["Zillow: an agent's profile", "https://www.zillow.com/profile/some-agent"],
  ["Redfin: a city", "https://www.redfin.com/city/17151/CA/San-Francisco"],
  ["Redfin: a ZIP's condos", "https://www.redfin.com/zipcode/94163/condos/page-6"],
  ["Redfin: the news", "https://www.redfin.com/news/redfin-posts-open-letter/"],
  ["Redfin: the short-link host alone", "https://redf.in/"],
  ["Realtor.com: a search", "https://www.realtor.com/realestateandhomes-search/San-Francisco_CA"],
  ["Realtor.com: agents", "https://www.realtor.com/realestateagents/san-francisco_ca"],
  ["Trulia: rentals in a city", "https://www.trulia.com/for_rent/New_York,NY/"],
  ["Trulia: a city", "https://www.trulia.com/CA/San_Francisco/"],
  // Not links at all.
  ["an address", "2220 Clay St, San Francisco, CA 94115"],
  ["coordinates", "37.7912, -122.4301"],
  ["the site's name", "zillow"],
  ["an e-mail address", "agent@zillow.com"],
  ["nothing", ""],
  ["a link to somewhere else", "https://example.com/homedetails/2220-Clay-St/1_zpid/"],
];

describe("parseListingLink", () => {
  it("has a table worth the name", () => {
    expect(ADDRESS_LINKS.length + NO_ADDRESS_LINKS.length + NOT_LISTINGS.length).toBeGreaterThan(
      80,
    );
  });

  it.each(ADDRESS_LINKS)("%s", (_name, text, [site, address, query]) => {
    const link = parseListingLink(text);
    expect(link).toMatchObject({ kind: "address", site, address, query });
  });

  it.each(NO_ADDRESS_LINKS)("no address — %s", (_name, text, site, reason) => {
    expect(parseListingLink(text)).toEqual({ kind: "no-address", site, reason });
  });

  it.each(NOT_LISTINGS)("not a listing — %s", (_name, text) => {
    expect(parseListingLink(text)).toBeNull();
  });
});

const address = (text: string): ListingAddress => {
  const link = parseListingLink(text);
  if (link?.kind !== "address") throw new Error(`not an address link: ${text}`);
  return link;
};

describe("parseListingLink — the parts", () => {
  it("gives the house number, state and ZIP of a Zillow link, and the words in between as they come", () => {
    const link = address(
      "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
    );
    expect(link).toMatchObject({
      houseNumber: "2220",
      state: "CA",
      postcode: "94115",
      // Zillow does not say where the street ends: no street, no city.
      words: ["clay", "st", "san", "francisco"],
      street: null,
      city: null,
    });
  });

  it("knows street and city where the link separates them", () => {
    expect(
      address("https://www.redfin.com/CA/San-Francisco/2220-Clay-St-94115/home/1234567"),
    ).toMatchObject({
      houseNumber: "2220",
      street: ["clay", "st"],
      city: "San Francisco",
      state: "CA",
      postcode: "94115",
    });
    expect(
      address(
        "https://www.realtor.com/realestateandhomes-detail/9504-Quail-Village-Ln_Austin_TX_78758_M89558-38462",
      ),
    ).toMatchObject({ street: ["quail", "village", "ln"], city: "Austin", postcode: "78758" });
    expect(
      address("https://www.trulia.com/p/ny/bronx/895-tiffany-st-bronx-ny-10459--2008893028"),
    ).toMatchObject({ street: ["tiffany", "st"], city: "Bronx", state: "NY" });
    expect(
      address("https://www.zillow.com/homes/2220-Clay-St,-San-Francisco,-CA-94115_rb/"),
    ).toMatchObject({ street: ["clay", "st"], city: "San Francisco" });
  });

  it("takes a marked unit as the end of the street", () => {
    expect(
      address(
        "https://www.zillow.com/homedetails/1440-Broadway-APT-307-San-Francisco-CA-94109/69817587_zpid/",
      ),
    ).toMatchObject({
      words: ["broadway", "san", "francisco"],
      street: ["broadway"],
      city: "San Francisco",
    });
  });

  it("offers a second question without the city: street, state, ZIP", () => {
    // Known street.
    expect(
      address("https://www.redfin.com/AL/Birmingham/2529-Comanche-Dr-35244/home/80696773")
        .streetQuery,
    ).toBe("2529 Comanche Dr, AL 35244");
    // Zillow: a guess at the street's end — the first street type, and a compass point behind it.
    expect(
      address("https://www.zillow.com/homedetails/5215-Balboa-Blvd-Encino-CA-91316/19979864_zpid/")
        .streetQuery,
    ).toBe("5215 Balboa Blvd, CA 91316");
    expect(
      address("https://www.zillow.com/homedetails/1805-Browder-St-101-Dallas-TX-75215/1_zpid/")
        .streetQuery,
    ).toBe("1805 Browder St, TX 75215");
    expect(
      address("https://www.zillow.com/homedetails/100-Park-Ave-S-New-York-NY-10017/1_zpid/")
        .streetQuery,
    ).toBe("100 Park Ave S, NY 10017");
    expect(
      address("https://www.zillow.com/homedetails/12-Court-St-Brooklyn-NY-11201/1_zpid/")
        .streetQuery,
    ).toBe("12 Court St, NY 11201");
  });

  it("offers no second question when there is no telling where the street ends, or no ZIP", () => {
    expect(
      address("https://www.zillow.com/homedetails/1440-Broadway-San-Francisco-CA-94109/1_zpid/")
        .streetQuery,
    ).toBeNull();
    expect(
      address("https://www.zillow.com/homedetails/17-Lexington-Rd-Concord-MA/56789012_zpid/")
        .streetQuery,
    ).toBeNull();
  });

  it("an address without a house number is still an address, with no number to go by", () => {
    const link = address(
      "https://www.zillow.com/homedetails/Old-Stage-Rd-Central-Point-OR-97502/2061234567_zpid/",
    );
    expect(link.address).toBe("Old Stage Rd Central Point, OR 97502");
    expect(link.houseNumber).toBeNull();
  });

  it("two links to the same listing have the same key; another listing has another", () => {
    const a = address(
      "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
    );
    const b = address(
      "Look! zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/?utm_source=txtshare",
    );
    const c = address(
      "https://www.zillow.com/homedetails/2222-Clay-St-San-Francisco-CA-94115/15075414_zpid/",
    );
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  it("reads the first listing link when the text holds several, skipping pages that are not listings", () => {
    const link = address(
      "https://www.zillow.com/san-francisco-ca/ then https://www.redfin.com/CA/San-Francisco/2220-Clay-St-94115/home/1234567 or https://www.zillow.com/homedetails/1-Main-St-Austin-TX-78701/1_zpid/",
    );
    expect(link.site).toBe("Redfin");
  });

  it("finds a link pasted right behind other text, or carried whole inside another link", () => {
    expect(
      address(
        "pacifichttps://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/",
      ).address,
    ).toBe("2220 Clay St San Francisco, CA 94115");
    // Still the listing's own, whole link: its host is read by the URL parser like any other.
    expect(
      address(
        "https://example.com/out?to=https://www.redfin.com/CA/San-Francisco/2220-Clay-St-94115/home/1234567",
      ).site,
    ).toBe("Redfin");
  });

  it("never throws, whatever is pasted", () => {
    for (const text of [
      "https://www.zillow.com/homedetails/%E0%A4%A/1_zpid/",
      "https://www.zillow.com/homedetails/%/",
      "https://[bad/homedetails/x",
      "https://www.redfin.com/CA//home/",
      "https://www.trulia.com/p/ca/",
      "https://www.realtor.com/realestateandhomes-detail/___",
      "\u0000￿ https://www.zillow.com/homedetails/-----/1_zpid/",
    ]) {
      expect(() => parseListingLink(text)).not.toThrow();
    }
  });
});
