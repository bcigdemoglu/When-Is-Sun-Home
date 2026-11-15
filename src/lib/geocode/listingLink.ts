/**
 * The address inside a pasted real-estate listing link.
 *
 * A listing's address is spelled out in its link
 * ("zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/"),
 * so the link alone says where the house is. This module only READS the text
 * it is given: nothing is ever requested from a listing site — they forbid
 * automated access, and it is not needed.
 *
 * Pure and dependency-free: no React, no DOM, no network.
 *
 * Shapes understood (the first listing link found in the text wins):
 *
 *  - Zillow      /homedetails/<street-city-ST-zip>/<zpid>_zpid/
 *                /homes/<street,-city,-ST-zip>_rb/        (an address search)
 *  - Redfin      /<ST>/<City>/<street-zip>/home/<id>      (+ /unit-<n>/)
 *  - Realtor.com /realestateandhomes-detail/<street>_<city>_<ST>_<zip>_M<id>
 *  - Trulia      /home/<street-city-st-zip>-<id>
 *                /p/<st>/<city>/<street-city-st-zip>--<id>
 *
 * A link to a listing that does not spell the address out (an id-only link,
 * Redfin's "redf.in" short links, a whole apartment building known by its
 * name) is still recognised: it comes back as `kind: "no-address"`, so the
 * search can say what to do instead of looking the link's text up as if it
 * were an address.
 */

export type ListingSite = "Zillow" | "Redfin" | "Realtor.com" | "Trulia";

/** A listing link that spells its address out. */
export interface ListingAddress {
  kind: "address";
  site: ListingSite;
  /** Identifies this link's address: two links to the same listing share it. */
  key: string;
  /**
   * The address as the link gives it, unit included, for showing:
   * "1440 Broadway APT 307 San Francisco, CA 94109". A comma stands only
   * where the link's own structure separates two parts — Zillow's does not
   * say where the street ends and the city begins, so none is put there.
   */
  address: string;
  /** What a geocoder is asked: the same without the unit (geocoders know buildings, not flats). */
  query: string;
  /**
   * A second question for when the first finds nothing: street, state and ZIP
   * without the city. A listing's city is its postal one, which is often not
   * the municipality a map files the street under ("Encino" is Los Angeles).
   * Null when it would be no different, or cannot be built. Where the link
   * does not separate street and city this is a guess at the boundary — good
   * enough to ask with, never shown, and every answer is checked against the
   * whole address afterwards (see `./listingMatch`).
   */
  streetQuery: string | null;
  /** "2220"; null when the address does not start with a number. */
  houseNumber: string | null;
  /**
   * The words after the house number up to the state, lower-cased, without
   * the unit: the street, then (unless `street` is given) the city as well.
   */
  words: string[];
  /** The street's words alone, where the link separates street and city; else null. */
  street: string[] | null;
  /** The city as the link names it, where the link sets it apart; else null. */
  city: string | null;
  /** Two-letter state, upper-cased; null if the link has none. */
  state: string | null;
  /** Five-digit ZIP; null if the link has none. */
  postcode: string | null;
}

/** A link to a listing whose address is not in the link. */
export interface ListingWithoutAddress {
  kind: "no-address";
  site: ListingSite;
  /**
   * - "id": the link names the listing by number only.
   * - "short-link": a shortened link (redf.in); the address is behind it.
   * - "building": a whole building or community, known by its name.
   */
  reason: "id" | "short-link" | "building";
}

export type ListingLink = ListingAddress | ListingWithoutAddress;

// ─── Vocabulary ────────────────────────────────────────────────────────────

/** USPS two-letter codes: the states, DC and the territories. */
export const US_STATE_CODES: ReadonlySet<string> = new Set(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT " +
    "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP"
  ).split(" "),
);

/** Words that introduce a unit: the next word is its number. */
const UNIT_DESIGNATORS: ReadonlySet<string> = new Set([
  "apt",
  "unit",
  "ste",
  "suite",
  "lot",
  "spc",
  "trlr",
  "num",
  "#",
]);

/** Street types as listing links abbreviate them: where a street name usually ends. */
const STREET_TYPES: ReadonlySet<string> = new Set(
  (
    "st ave blvd dr ln rd ct pl cir ter way pkwy hwy trl sq loop run path pass row walk aly " +
    "xing cv pt holw bnd rdg vw hl hts mnr trce cres " +
    "street avenue boulevard drive lane road court place circle terrace parkway highway trail " +
    "square alley crossing cove point ridge crescent"
  ).split(" "),
);

const DIRECTIONS: ReadonlySet<string> = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

const ZIP = /^\d{5}$/;
/** A house number: "2220", "2220A", "12B". */
const HOUSE_NUMBER = /^\d+[a-z]?$/i;

// ─── Words of a link ───────────────────────────────────────────────────────

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The words of one part of a link ("2220-Clay-St" → 2220, Clay, St). Hyphens,
 * plus signs and spaces separate words; anything that is not part of a word
 * of an address is dropped. A comma is kept on the word it follows — in
 * Zillow's address searches it is the only thing that separates street and
 * city.
 */
function wordsOf(part: string): string[] {
  return decode(part)
    .split(/[-+\s]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}#.'’/&,]/gu, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

const lower = (words: readonly string[]) => words.map((word) => word.toLowerCase());

/**
 * How a word of an all-lower-case link is written for people: "clay" → Clay,
 * "nw" → NW, "4b" → 4B; ordinals ("22nd") stay as they are.
 */
function titleWord(word: string): string {
  const plain = word.toLowerCase();
  if (DIRECTIONS.has(plain) && plain.length === 2) return plain.toUpperCase();
  if (/^\d/.test(word)) return /^\d+(st|nd|rd|th)$/i.test(word) ? plain : word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Words for showing: as the link wrote them, or title-cased if it wrote everything small. */
function show(words: readonly string[], smallOnly: boolean): string {
  return (smallOnly ? words.map(titleWord) : words).join(" ");
}

// ─── Parts of an address ───────────────────────────────────────────────────

interface Tail {
  /** The words before the state. */
  head: string[];
  state: string | null;
  postcode: string | null;
}

/** Take "… CA 94115" (or "… CA", or a ZIP+4) off the end of an address's words. */
function splitTail(words: readonly string[]): Tail {
  let end = words.length;
  // "94115-1234" arrives as two words.
  if (end >= 3 && /^\d{4}$/.test(words[end - 1]) && ZIP.test(words[end - 2])) end -= 1;
  const last = words[end - 1] ?? "";
  const before = words[end - 2] ?? "";
  if (ZIP.test(last) && US_STATE_CODES.has(before.toUpperCase())) {
    return { head: words.slice(0, end - 2), state: before.toUpperCase(), postcode: last };
  }
  if (end === words.length && US_STATE_CODES.has(last.toUpperCase()) && words.length >= 3) {
    return { head: words.slice(0, end - 1), state: last.toUpperCase(), postcode: null };
  }
  return { head: [...words], state: null, postcode: null };
}

interface Units {
  /** The words without any unit. */
  rest: string[];
  /** Where in `rest` the (first) unit stood, or -1: by then the street has ended. */
  at: number;
  found: boolean;
}

/**
 * Take units out of an address's words: "APT 307", "UNIT 5B", "#12". Only
 * after the house number and one more word, so a street called "Lot" or
 * "Unit" something keeps its name.
 */
function stripUnits(words: readonly string[]): Units {
  const rest: string[] = [];
  let at = -1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const plain = word.toLowerCase().replace(/[.,]/g, "");
    if (i >= 2) {
      if (/^#./.test(word)) {
        if (at < 0) at = rest.length;
        continue;
      }
      if (UNIT_DESIGNATORS.has(plain) && i + 1 < words.length) {
        if (at < 0) at = rest.length;
        i += 1;
        continue;
      }
    }
    rest.push(word);
  }
  return { rest, at, found: at >= 0 };
}

/**
 * A guess at where the street ends in words that run on into the city: after
 * the first street type ("St", "Ave", …) that is not the street's first word,
 * and any compass point right behind it. Zero when there is no telling.
 */
function guessStreetEnd(afterNumber: readonly string[]): number {
  for (let i = 1; i < afterNumber.length; i++) {
    if (!STREET_TYPES.has(afterNumber[i].toLowerCase())) continue;
    let end = i + 1;
    if (end < afterNumber.length - 1 && DIRECTIONS.has(afterNumber[end].toLowerCase())) end += 1;
    return end;
  }
  return 0;
}

interface AddressInput {
  site: ListingSite;
  /** The street line's words, house number first — or, with `city` null, street and city run together. */
  line: string[];
  /** The city, where the link sets it apart. */
  city: string[] | null;
  state: string | null;
  postcode: string | null;
  /** A unit the link gives apart from the street ("unit-5B"). */
  unit?: string[];
}

/** Put the parts together; null if they do not amount to an address. */
function build({ site, line, city, state, postcode, unit }: AddressInput): ListingAddress | null {
  const clean = line.map((word) => word.replace(/,+$/, "")).filter((word) => word !== "");
  const units = stripUnits(clean);
  const rest = units.rest;
  if (rest.length < 2 || !rest.some((word) => /\p{L}/u.test(word))) return null;

  const numbered = HOUSE_NUMBER.test(rest[0]);
  const houseNumber = numbered ? rest[0] : null;
  const afterNumber = numbered ? rest.slice(1) : rest;
  // Everything the link wrote small ("714-w-22nd-st-austin-tx"): written properly for people.
  const smallOnly = ![...clean, ...(city ?? [])].some((word) => /\p{Lu}/u.test(word));

  // Where the street ends: given by the link, marked by a unit, or unknown.
  const unitAt = units.at - (numbered ? 1 : 0);
  let street: string[] | null = null;
  let cityWords = city;
  if (city) street = afterNumber;
  else if (units.found && unitAt >= 1 && unitAt < afterNumber.length) {
    street = afterNumber.slice(0, unitAt);
    cityWords = afterNumber.slice(unitAt);
  }

  const region = [state, postcode].filter(Boolean).join(" ");
  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(", ");
  const unitText = unit && unit.length > 0 ? ` ${show(unit, smallOnly)}` : "";

  const address = join([
    show(clean, smallOnly) + unitText,
    city ? show(city, smallOnly) : null,
    region || null,
  ]);
  const query = join([show(rest, smallOnly), city ? show(city, smallOnly) : null, region || null]);

  // The second question: street, state and ZIP, without the city.
  let streetQuery: string | null = null;
  if (postcode && houseNumber) {
    const end = street ? street.length : guessStreetEnd(afterNumber);
    if (end > 0 && (street !== null || end < afterNumber.length)) {
      const candidate = join([
        show([houseNumber, ...afterNumber.slice(0, end)], smallOnly),
        region,
      ]);
      if (candidate !== query) streetQuery = candidate;
    }
  }

  return {
    kind: "address",
    site,
    key: `${site}|${query.toLowerCase()}`,
    address,
    query,
    streetQuery,
    houseNumber,
    words: lower(city ? [...afterNumber, ...city] : afterNumber),
    street: street ? lower(street) : null,
    city: cityWords ? show(cityWords, smallOnly) : null,
    state,
    postcode,
  };
}

const noAddress = (
  site: ListingSite,
  reason: ListingWithoutAddress["reason"],
): ListingWithoutAddress => ({ kind: "no-address", site, reason });

// ─── The sites ─────────────────────────────────────────────────────────────

/** Street, city, state and ZIP run together with nothing but hyphens between ("…-St-San-Francisco-CA-94115"). */
function runTogether(site: ListingSite, words: string[]): ListingAddress | null {
  const { head, state, postcode } = splitTail(words);
  return build({ site, line: head, city: null, state, postcode });
}

function zillow(segments: string[]): ListingLink | null {
  const [first = "", second = ""] = segments;
  const section = first.toLowerCase();
  const zpid = segments.some((segment) => /^\d+_zpid$/i.test(segment));

  if (section === "homedetails") {
    if (second === "" || /^\d+_zpid$/i.test(second)) return zpid ? noAddress("Zillow", "id") : null;
    return runTogether("Zillow", wordsOf(second)) ?? noAddress("Zillow", "id");
  }

  if (section === "homes") {
    // "…/homes/2220-Clay-St,-San-Francisco,-CA-94115_rb/": what Zillow's own
    // search box makes of a typed address. The same shape names towns and ZIPs
    // ("San-Francisco,-CA_rb"): those are searches, not listings.
    const search = segments.find((segment) => /_rb$/i.test(segment));
    if (search) {
      const words = wordsOf(search.replace(/_rb$/i, ""));
      if (words.length >= 3 && HOUSE_NUMBER.test(words[0])) {
        const parts = splitAtCommas(words);
        if (parts.length >= 3) {
          const tail = splitTail(parts.slice(2).flat());
          if (tail.head.length === 0) {
            return build({
              site: "Zillow",
              line: parts[0],
              city: parts[1],
              state: tail.state,
              postcode: tail.postcode,
            });
          }
        }
        const address = runTogether(
          "Zillow",
          words.map((word) => word.replace(/,+$/, "")),
        );
        if (address) return address;
      }
    }
    return zpid ? noAddress("Zillow", "id") : null;
  }

  // Whole buildings and new-build communities go by a name.
  if (section === "b" || section === "apartments" || section === "community") {
    return second === "" ? null : noAddress("Zillow", "building");
  }
  return zpid ? noAddress("Zillow", "id") : null;
}

/** "2220 Clay St, | San Francisco, | CA 94115" — the parts between the commas. */
function splitAtCommas(words: readonly string[]): string[][] {
  const parts: string[][] = [[]];
  for (const word of words) {
    const bare = word.replace(/,+$/, "");
    if (bare !== "") parts[parts.length - 1].push(bare);
    if (bare !== word) parts.push([]);
  }
  return parts.filter((part) => part.length > 0);
}

function redfin(segments: string[]): ListingLink | null {
  // The last one: a town can be called Home, too.
  const home = segments.map((segment) => segment.toLowerCase()).lastIndexOf("home");
  if (home === 0 && /^\d+$/.test(segments[1] ?? "")) return noAddress("Redfin", "id");

  const state = (segments[0] ?? "").toUpperCase();
  if (!US_STATE_CODES.has(state) || segments.length < 4) return null;
  // "/WA/Seattle/The-Olivian/apartment/123": a building, by its name.
  if (segments.some((segment) => segment.toLowerCase() === "apartment")) {
    return noAddress("Redfin", "building");
  }
  if (home < 3 || !/^\d+$/.test(segments[home + 1] ?? "")) return null;

  const city = wordsOf(segments[1].replace(/_/g, "-"));
  const line = wordsOf(segments[2]);
  const postcode = ZIP.test(line[line.length - 1] ?? "") ? (line.pop() ?? null) : null;
  // "/unit-5B/" (or "/apt-5B/") between the street and "/home/".
  const unitSegment = home === 4 ? wordsOf(segments[3]) : [];
  const unit =
    unitSegment.length >= 2 && UNIT_DESIGNATORS.has(unitSegment[0].toLowerCase())
      ? ["Unit", ...unitSegment.slice(1)]
      : unitSegment.length === 1 && /^#./.test(unitSegment[0])
        ? unitSegment
        : [];
  if (city.length === 0) return null;
  return build({ site: "Redfin", line, city, state, postcode, unit }) ?? noAddress("Redfin", "id");
}

function realtor(segments: string[]): ListingLink | null {
  const section = (segments[0] ?? "").toLowerCase();
  const slug =
    section === "realestateandhomes-detail"
      ? segments[1]
      : section === "rentals" && (segments[1] ?? "").toLowerCase() === "details"
        ? segments[2]
        : undefined;
  if (slug === undefined || slug === "") return null;

  const parts = decode(slug).split("_");
  // "…_M89558-38462": the listing's number, last.
  const id = /^M\d[\d-]*$/i.test(parts[parts.length - 1] ?? "");
  if (id) parts.pop();
  if (parts.length === 0) return noAddress("Realtor.com", "id");

  if (parts.length >= 3) {
    const [street, city, state, zip] = parts;
    const code = state.toUpperCase();
    if (US_STATE_CODES.has(code)) {
      return (
        build({
          site: "Realtor.com",
          line: wordsOf(street),
          city: wordsOf(city),
          state: code,
          postcode: zip !== undefined && ZIP.test(zip) ? zip : null,
        }) ?? noAddress("Realtor.com", "id")
      );
    }
  }
  // No underscores to go by: read it like a run of words.
  return (
    runTogether("Realtor.com", wordsOf(parts.join("-"))) ??
    (id ? noAddress("Realtor.com", "id") : null)
  );
}

function trulia(segments: string[]): ListingLink | null {
  const section = (segments[0] ?? "").toLowerCase();
  if (section === "building") {
    return segments.length > 1 ? noAddress("Trulia", "building") : null;
  }

  if (section === "home") {
    const slug = segments[1] ?? "";
    if (slug === "") return null;
    if (/^\d+$/.test(slug)) return noAddress("Trulia", "id");
    const words = wordsOf(slug);
    // "…-ca-94115-15075413": the listing's number comes last.
    if (words.length >= 2 && /^\d{6,}$/.test(words[words.length - 1])) words.pop();
    return runTogether("Trulia", words) ?? noAddress("Trulia", "id");
  }

  if (section === "p" && segments.length >= 4) {
    // "/p/ca/fremont/3366-peralta-blvd-fremont-ca-94536--2083375174"
    const slug = decode(segments[segments.length - 1]).replace(/--\d+$/, "");
    const tail = splitTail(wordsOf(slug));
    const city = wordsOf(segments[2].replace(/_/g, "-"));
    const head = tail.head;
    // The path names the city: where the slug ends with it, the street is what comes before.
    const endsWithCity =
      city.length > 0 &&
      head.length > city.length &&
      lower(head.slice(-city.length)).join(" ") === lower(city).join(" ");
    const state = tail.state ?? segments[1].toUpperCase();
    const address = build({
      site: "Trulia",
      line: endsWithCity ? head.slice(0, -city.length) : head,
      city: endsWithCity ? city : null,
      state: US_STATE_CODES.has(state) ? state : null,
      postcode: tail.postcode,
    });
    return address ?? noAddress("Trulia", "id");
  }
  return null;
}

// ─── Finding the link in what was pasted ───────────────────────────────────

/** The site a host belongs to: the domain itself or any subdomain of it, nothing that merely contains it. */
function siteOf(hostname: string): ListingSite | "redfin-short" | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (is("zillow.com")) return "Zillow";
  if (is("redfin.com")) return "Redfin";
  if (is("redf.in")) return "redfin-short";
  if (is("realtor.com")) return "Realtor.com";
  if (is("trulia.com")) return "Trulia";
  return null;
}

const WEB_SCHEME = /^https?:\/\//i;
/** "www.zillow.com/…" written without "https://". */
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i;

/** The host is whatever the URL parser says it is: never a look-alike found by pattern. */
function parseUrl(candidate: string): URL | null {
  let text = candidate;
  if (!WEB_SCHEME.test(text)) {
    if (!BARE_HOST.test(text)) return null;
    text = `https://${text}`;
  }
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function readUrl(url: URL): ListingLink | null {
  const site = siteOf(url.hostname);
  if (!site) return null;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  switch (site) {
    case "Zillow":
      return zillow(segments);
    case "Redfin":
      return redfin(segments);
    case "redfin-short":
      // What the Redfin app's Share hands out: "https://redf.in/AbC123".
      return segments.length >= 1 ? noAddress("Redfin", "short-link") : null;
    case "Realtor.com":
      return realtor(segments);
    case "Trulia":
      return trulia(segments);
  }
}

/**
 * The first listing link in `text`, read for its address — or null when the
 * text holds none (then it is an ordinary search).
 *
 * The link may stand anywhere in the text (share sheets wrap it in a
 * sentence), with or without "https://", on any subdomain, with any query
 * string, fragment or trailing punctuation, in any letter case. Other pages
 * of the same sites (a city's search results, the home page) are not
 * listings: null.
 */
export function parseListingLink(text: string): ListingLink | null {
  // Whatever cannot be part of a link separates candidates — and so does the
  // start of a link, so one pasted right behind other text is still found.
  const spaced = text.replace(/https?:\/\//gi, " $&");
  for (const piece of spaced.split(/[\s<>"()[\]{}]+/)) {
    const candidate = piece.replace(/^[^a-z0-9]+/i, "").replace(/[.,;:!?'’”]+$/, "");
    if (candidate.length < 8) continue;
    const url = parseUrl(candidate);
    if (!url) continue;
    const link = readUrl(url);
    if (link) return link;
  }
  return null;
}
