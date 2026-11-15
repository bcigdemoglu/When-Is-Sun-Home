import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  isSettings,
  isValidIsoDate,
  mergeSettings,
  type Settings,
} from "../schema";
import {
  buildShareUrl,
  dayOfYearToIsoDate,
  hhmmToMinuteOfDay,
  isEmptyPatch,
  isLegacySearchParams,
  minuteOfDayToHHMM,
  overlayUrlSettings,
  roundSettingsForUrl,
  searchParamsToSettings,
  settingsToSearchParams,
} from "../urlCodec";
import { arbSettings } from "./arbitraries";

/** A fixed "now" in a non-leap year, safe in every time zone. */
const NOW_2026 = new Date(2026, 5, 15, 12);
const NOW_2024 = new Date(2024, 5, 15, 12);

const parse = (query: string, now: Date = NOW_2026) =>
  searchParamsToSettings(new URLSearchParams(query), { now });

const FULL: Settings = {
  place: { lat: 40.7128, lng: -74.006, name: "New York" },
  date: "2026-06-21",
  minuteOfDay: 570,
  observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 120 },
  layers: { buildings3d: false, shadows: false },
};

describe("settingsToSearchParams", () => {
  test("default settings give an empty query string", () => {
    expect(settingsToSearchParams(DEFAULT_SETTINGS).toString()).toBe("");
  });

  test("writes compact, readable keys in a stable order", () => {
    expect(settingsToSearchParams(FULL).toString()).toBe(
      "lat=40.71280&lng=-74.00600&n=New+York&d=2026-06-21&t=0930&m=w&h=7.5&dir=90&fov=120&b=0&sh=0",
    );
  });

  test("omits every field that equals its default", () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      place: { lat: 51.5, lng: -0.12 },
      observer: { ...DEFAULT_SETTINGS.observer, fovDeg: 90 },
    };
    expect(settingsToSearchParams(s).toString()).toBe("lat=51.50000&lng=-0.12000&fov=90");
  });

  test("time is zero-padded HHMM", () => {
    const at = (minuteOfDay: number) =>
      settingsToSearchParams({ ...DEFAULT_SETTINGS, minuteOfDay }).get("t");
    expect(at(0)).toBe("0000");
    expect(at(5)).toBe("0005");
    expect(at(570)).toBe("0930");
    expect(at(720)).toBe("1200");
    expect(at(1439)).toBe("2359");
  });

  test("height has at most one decimal and is omitted when it rounds to the default", () => {
    const h = (heightM: number) =>
      settingsToSearchParams({
        ...DEFAULT_SETTINGS,
        observer: { ...DEFAULT_SETTINGS.observer, heightM },
      }).get("h");
    expect(h(12)).toBe("12");
    expect(h(12.34)).toBe("12.3");
    expect(h(0)).toBe("0");
    expect(h(0.04)).toBe("0");
    expect(h(1.04)).toBeNull();
    expect(h(300)).toBe("300");
  });

  test("coordinates never print as -0.00000", () => {
    const p = settingsToSearchParams({
      ...DEFAULT_SETTINGS,
      place: { lat: -0.000001, lng: -0.0000049 },
    });
    expect(p.get("lat")).toBe("0.00000");
    expect(p.get("lng")).toBe("0.00000");
  });

  test("names with URL-hostile characters survive", () => {
    const name = "Café & Bar #1 / 100% = a+b ? 東京 🏠";
    const s: Settings = { ...DEFAULT_SETTINGS, place: { lat: 1, lng: 2, name } };
    const query = settingsToSearchParams(s).toString();
    expect(parse(query).place).toEqual({ lat: 1, lng: 2, name });
    // and through a real URL, as a browser would do it
    const url = new URL(`https://example.com/?${query}#h`);
    expect(searchParamsToSettings(url.searchParams).place?.name).toBe(name);
  });
});

describe("round trip", () => {
  test("decode(encode(s)) merged over defaults equals s, up to the documented rounding", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const patch = searchParamsToSettings(settingsToSearchParams(s));
        const back = mergeSettings(DEFAULT_SETTINGS, patch);
        expect(back).toEqual(roundSettingsForUrl(s));
        expect(isSettings(back)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  test("the rounding is 5 decimals for lat/lng, 1 for height, nothing else", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const r = roundSettingsForUrl(s);
        expect(r.date).toBe(s.date);
        expect(r.minuteOfDay).toBe(s.minuteOfDay);
        expect(r.layers).toEqual(s.layers);
        expect({ ...r.observer, heightM: 0 }).toEqual({ ...s.observer, heightM: 0 });
        expect(Math.abs(r.observer.heightM - s.observer.heightM)).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(r.place?.name).toBe(s.place?.name);
        if (s.place && r.place) {
          expect(Math.abs(r.place.lat - s.place.lat)).toBeLessThanOrEqual(0.000005 + 1e-12);
          expect(Math.abs(r.place.lng - s.place.lng)).toBeLessThanOrEqual(0.000005 + 1e-12);
        }
        expect(isSettings(r)).toBe(true);
      }),
    );
  });

  test("survives a real URL (string → URL → searchParams)", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const url = new URL(buildShareUrl(s, "https://example.com/app#x"));
        const back = mergeSettings(DEFAULT_SETTINGS, searchParamsToSettings(url.searchParams));
        expect(back).toEqual(roundSettingsForUrl(s));
      }),
      { numRuns: 500 },
    );
  });

  test("encoding is a fixed point after one trip (a reload never changes the URL again)", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const first = settingsToSearchParams(s).toString();
        const back = mergeSettings(
          DEFAULT_SETTINGS,
          searchParamsToSettings(new URLSearchParams(first)),
        );
        expect(settingsToSearchParams(back).toString()).toBe(first);
      }),
      { numRuns: 1000 },
    );
  });

  test("the writer's own output is never mistaken for a legacy link", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        expect(isLegacySearchParams(settingsToSearchParams(s))).toBe(false);
      }),
      { numRuns: 2000 },
    );
    // every minute of the day, explicitly
    for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay++) {
      const p = settingsToSearchParams({ ...DEFAULT_SETTINGS, minuteOfDay });
      expect(isLegacySearchParams(p)).toBe(false);
      expect(searchParamsToSettings(p).minuteOfDay).toBe(minuteOfDay);
    }
  });
});

describe("searchParamsToSettings (current format)", () => {
  test("an empty query gives an empty patch", () => {
    expect(parse("")).toEqual({});
    expect(isEmptyPatch(parse(""))).toBe(true);
    expect(isEmptyPatch(parse("utm_source=x&foo=bar"))).toBe(true);
  });

  test("returns only the fields that are present", () => {
    expect(parse("fov=90")).toEqual({ observer: { fovDeg: 90 } });
    expect(parse("sh=0")).toEqual({ layers: { shadows: false } });
    expect(parse("d=2026-06-21")).toEqual({ date: "2026-06-21" });
    expect(parse("t=0930")).toEqual({ minuteOfDay: 570 });
    expect(parse("m=w&h=4.5")).toEqual({ observer: { mode: "window", heightM: 4.5 } });
  });

  test("reads a full link", () => {
    expect(parse(settingsToSearchParams(FULL).toString())).toEqual(FULL);
  });

  test("explicit defaults are still returned (they can override stored values)", () => {
    expect(parse("m=y&h=1&dir=180&fov=180&b=1&sh=1")).toEqual({
      observer: { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
      layers: { buildings3d: true, shadows: true },
    });
    expect(parse("m=window").observer).toEqual({ mode: "window" });
    expect(parse("m=yard").observer).toEqual({ mode: "yard" });
  });

  test("a place needs both coordinates; the name alone means nothing", () => {
    expect(parse("lat=40.7")).toEqual({});
    expect(parse("lng=-74")).toEqual({});
    expect(parse("n=Home")).toEqual({});
    expect(parse("lat=40.7&lng=-74")).toEqual({ place: { lat: 40.7, lng: -74 } });
    expect(parse("lat=40.7&lng=-74&n=")).toEqual({ place: { lat: 40.7, lng: -74 } });
    expect(parse("lat=40.7&lng=-74&n=++Home++")).toEqual({
      place: { lat: 40.7, lng: -74, name: "Home" },
    });
  });

  test("numbers are normalised exactly like in the store", () => {
    expect(parse("lat=95&lng=190").place).toEqual({ lat: 90, lng: -170 });
    expect(parse("dir=370&fov=5&h=999").observer).toEqual({
      facingDeg: 10,
      fovDeg: 10,
      heightM: 300,
    });
    expect(parse("dir=-90&fov=89.6&h=-2").observer).toEqual({
      facingDeg: 270,
      fovDeg: 90,
      heightM: 0,
    });
  });

  test.each([
    "lat=abc&lng=-74",
    "lat=40.7&lng=",
    "lat=1e2&lng=2",
    "lat=0x10&lng=2",
    "lat=40,7&lng=2",
    "lat=NaN&lng=Infinity",
    "d=2026-02-30",
    "d=2026-6-21",
    "d=tomorrow",
    "d=",
    "t=2460",
    "t=2400",
    "t=9999",
    "t=12:30",
    "t=noon",
    "t=",
    "t=-5",
    "t=00930",
    "m=x",
    "m=",
    "h=tall",
    "h=",
    "dir=north",
    "fov=wide",
    "b=yes",
    "b=2",
    "sh=true",
    "f=abc",
    "f=-2",
    "f=2.5",
    "z=far",
    "bl=maybe",
    "d=0",
    "d=367",
    "d=999",
    "d=0200",
    "t=1460",
    "t=007",
    `h=${"9".repeat(400)}`,
  ])("invalid value is ignored and is no legacy marker: %s", (query) => {
    expect(isLegacySearchParams(new URLSearchParams(query))).toBe(false);
    expect(parse(query)).toEqual({});
  });

  test("an invalid field does not hide a valid one", () => {
    expect(parse("lat=40.7&lng=-74&fov=wide&dir=90&d=2026-02-30&t=0600")).toEqual({
      place: { lat: 40.7, lng: -74 },
      minuteOfDay: 360,
      observer: { facingDeg: 90 },
    });
  });

  test("duplicate keys: the first one counts", () => {
    expect(parse("fov=90&fov=120").observer).toEqual({ fovDeg: 90 });
  });

  test("ignores a mode value that names an Object.prototype member", () => {
    for (const m of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(searchParamsToSettings(new URLSearchParams({ m }))).toEqual({});
    }
  });

  test("never throws and always produces a patch that merges into valid Settings", () => {
    const key = fc.constantFrom(
      "lat",
      "lng",
      "n",
      "d",
      "t",
      "m",
      "h",
      "dir",
      "fov",
      "b",
      "sh",
      "f",
      "z",
      "bl",
      "x",
    );
    const value = fc.oneof(
      fc.string(),
      fc.string({ unit: "binary" }),
      fc.integer({ min: -2000, max: 3000 }).map(String),
      fc.double().map(String),
      fc.constantFrom("", "0", "1", "y", "w", "0930", "720", "2026-06-21", "-0", "1e999"),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(key, value), { maxLength: 16 }), arbSettings, (pairs, base) => {
        const patch = searchParamsToSettings(new URLSearchParams(pairs), { now: NOW_2026 });
        expect(isSettings(mergeSettings(base, patch))).toBe(true);
        expect(isSettings(overlayUrlSettings(base, patch))).toBe(true);
        // "present AND valid": whatever is in the patch is already canonical
        expect(mergeSettings(DEFAULT_SETTINGS, patch)).toMatchObject(patch);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("legacy links", () => {
  test("detection: what the old app wrote and the new one never does", () => {
    const legacy = (q: string) => isLegacySearchParams(new URLSearchParams(q));
    // legacy-only keys
    expect(legacy("f=3")).toBe(true);
    expect(legacy("z=13.5")).toBe(true);
    expect(legacy("bl=0")).toBe(true);
    // d as a day of year
    expect(legacy("d=1")).toBe(true);
    expect(legacy("d=172")).toBe(true);
    expect(legacy("d=366")).toBe(true);
    // t as minutes: no padding, or impossible as HHMM
    expect(legacy("t=0")).toBe(true);
    expect(legacy("t=45")).toBe(true);
    expect(legacy("t=720")).toBe(true);
    expect(legacy("t=1075")).toBe(true);
    expect(legacy("t=1439")).toBe(false); // valid HHMM 14:39 → ambiguous → current format
    expect(legacy("t=1399")).toBe(true);
    // current format
    expect(legacy("")).toBe(false);
    expect(legacy("lat=40.7&lng=-74&n=Home")).toBe(false);
    expect(legacy("d=2026-06-21&t=0930")).toBe(false);
    expect(legacy("t=1230")).toBe(false);
    expect(legacy("t=0000")).toBe(false);
    expect(legacy("m=w&h=7.5&dir=90&fov=120&b=0&sh=0")).toBe(false);
    // flags shared by both formats are no markers
    expect(legacy("sh=1&b=0&dir=90&fov=120")).toBe(false);
  });

  test("a typical old link converts completely", () => {
    const query = "lat=40.71280&lng=-74.00600&n=New+York&z=15.2&t=870&d=172&b=0&bl=0&sh=1&f=3";
    expect(parse(`${query}&dir=90&fov=120`)).toEqual({
      place: { lat: 40.7128, lng: -74.006, name: "New York" },
      date: "2026-06-21", // day 172 of 2026
      minuteOfDay: 870, // 14:30
      observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 120 },
      layers: { buildings3d: false, shadows: true },
    });
  });

  test("day of year lands in the current year, leap years included", () => {
    expect(parse("d=1").date).toBe("2026-01-01");
    expect(parse("d=59").date).toBe("2026-02-28");
    expect(parse("d=60").date).toBe("2026-03-01");
    expect(parse("d=60", NOW_2024).date).toBe("2024-02-29");
    expect(parse("d=61", NOW_2024).date).toBe("2024-03-01");
    expect(parse("d=365").date).toBe("2026-12-31");
    expect(parse("d=366", NOW_2024).date).toBe("2024-12-31");
    expect(parse("d=366").date).toBe("2026-12-31"); // no day 366 in 2026
  });

  test("the year comes from the injected clock, or the real one", () => {
    expect(parse("d=100", new Date(2031, 0, 1)).date).toBe("2031-04-10");
    const year = new Date().getFullYear();
    expect(searchParamsToSettings(new URLSearchParams("d=1")).date).toBe(`${year}-01-01`);
  });

  test("minutes since midnight become minuteOfDay", () => {
    expect(parse("t=0").minuteOfDay).toBe(0);
    expect(parse("t=45").minuteOfDay).toBe(45);
    expect(parse("t=720").minuteOfDay).toBe(720);
    expect(parse("t=1075").minuteOfDay).toBe(1075);
  });

  test("an ambiguous 4-digit t follows the rest of the link", () => {
    expect(parse("t=1230").minuteOfDay).toBe(12 * 60 + 30); // current format: 12:30
    expect(parse("t=1230&d=200").minuteOfDay).toBe(1230); // legacy: 20:30
    expect(parse("t=1230&f=2").minuteOfDay).toBe(1230);
    expect(parse("t=1230&z=13").minuteOfDay).toBe(1230);
    expect(parse("t=1230&d=2026-07-19").minuteOfDay).toBe(750);
  });

  test("a zero-padded HHMM inside a legacy link is still HHMM", () => {
    expect(parse("t=0930&f=2").minuteOfDay).toBe(570);
  });

  test("floors become eye heights: (floor − 1) × 3 + 1.5", () => {
    expect(parse("f=1").observer?.heightM).toBe(1.5);
    expect(parse("f=2").observer?.heightM).toBe(4.5);
    expect(parse("f=3").observer?.heightM).toBe(7.5);
    expect(parse("f=10").observer?.heightM).toBe(28.5);
    expect(parse("f=0").observer?.heightM).toBe(1.5);
    expect(parse("f=9999").observer?.heightM).toBe(298.5);
  });

  test("old links always meant a window", () => {
    for (const q of ["f=2", "z=14", "bl=1", "d=200", "t=720"]) {
      expect(parse(q).observer?.mode, q).toBe("window");
    }
    expect(parse("lat=1&lng=2&fov=90").observer?.mode).toBeUndefined();
  });

  test("defaults the old writer omitted are restored: noon, 1 January, ground floor", () => {
    expect(parse("lat=40.7&lng=-74&z=15")).toEqual({
      place: { lat: 40.7, lng: -74 },
      date: "2026-01-01",
      minuteOfDay: 720,
      observer: { mode: "window", heightM: 1.5 },
    });
    expect(parse("d=200")).toEqual({
      date: "2026-07-19",
      minuteOfDay: 720,
      observer: { mode: "window", heightM: 1.5 },
    });
  });

  test("z and bl are dropped; the old 'shadows off' default is not carried over", () => {
    const patch = parse("z=15&bl=0");
    expect(patch).not.toHaveProperty("layers");
    expect(parse("z=15&sh=1&b=0").layers).toEqual({ buildings3d: false, shadows: true });
  });

  test("current-format keys win when both are mixed", () => {
    expect(parse("f=3&h=10&m=y&d=2026-06-21").observer).toEqual({ mode: "yard", heightM: 10 });
    expect(parse("f=3&d=2026-06-21").date).toBe("2026-06-21");
  });

  test("a converted legacy link re-encodes in the current format and stays put", () => {
    const converted = overlayUrlSettings(
      DEFAULT_SETTINGS,
      parse("lat=40.7128&lng=-74.006&z=15&t=1230&d=172&f=3&dir=90"),
    );
    const query = settingsToSearchParams(converted).toString();
    expect(query).toBe("lat=40.71280&lng=-74.00600&d=2026-06-21&t=2030&m=w&h=7.5&dir=90");
    const again = searchParamsToSettings(new URLSearchParams(query), { now: NOW_2026 });
    expect(isLegacySearchParams(new URLSearchParams(query))).toBe(false);
    expect(overlayUrlSettings(DEFAULT_SETTINGS, again)).toEqual(converted);
  });

  test("every legacy day/minute converts to something valid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 366 }),
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1990, max: 2100 }),
        (d, t, f, year) => {
          const patch = parse(`lat=1&lng=2&d=${d}&t=${t}&f=${f}`, new Date(year, 6, 1));
          expect(patch.minuteOfDay).toBe(t);
          expect(patch.date?.startsWith(`${year}-`)).toBe(true);
          expect(isValidIsoDate(patch.date ?? "")).toBe(true);
          expect(patch.observer).toEqual({ mode: "window", heightM: (f - 1) * 3 + 1.5 });
          expect(isSettings(overlayUrlSettings(DEFAULT_SETTINGS, patch))).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("time and date helpers", () => {
  test("HHMM ⇄ minute of day", () => {
    for (let m = 0; m < 1440; m++) {
      const text = minuteOfDayToHHMM(m);
      expect(text).toMatch(/^\d{4}$/);
      expect(hhmmToMinuteOfDay(text)).toBe(m);
    }
    expect(hhmmToMinuteOfDay("2400")).toBeNull();
    expect(hhmmToMinuteOfDay("1260")).toBeNull();
    expect(hhmmToMinuteOfDay("930")).toBeNull();
    expect(hhmmToMinuteOfDay("09:30")).toBeNull();
    expect(hhmmToMinuteOfDay("")).toBeNull();
  });

  test.each([2023, 2024, 2026, 2000, 1900, 2100])(
    "dayOfYearToIsoDate walks the calendar of %i",
    (year) => {
      const days = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
      for (let doy = 1; doy <= days; doy++) {
        const expected = new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
        expect(dayOfYearToIsoDate(year, doy)).toBe(expected);
      }
      expect(dayOfYearToIsoDate(year, 400)).toBe(`${year}-12-31`);
      expect(dayOfYearToIsoDate(year, 0)).toBe(`${year}-01-01`);
    },
  );
});

describe("overlayUrlSettings", () => {
  const stored: Settings = {
    place: { lat: 48.8566, lng: 2.3522, name: "Paris" },
    date: "2026-03-20",
    minuteOfDay: 600,
    observer: { mode: "window", heightM: 10.5, facingDeg: 270, fovDeg: 90 },
    layers: { buildings3d: false, shadows: false },
  };

  test("an empty patch keeps the stored settings", () => {
    expect(overlayUrlSettings(stored, {})).toEqual(stored);
  });

  test("without a place the URL overrides field by field", () => {
    expect(overlayUrlSettings(stored, parse("fov=120&sh=1"))).toEqual({
      ...stored,
      observer: { ...stored.observer, fovDeg: 120 },
      layers: { buildings3d: false, shadows: true },
    });
    expect(overlayUrlSettings(stored, parse("d=2026-12-21")).minuteOfDay).toBe(600);
  });

  test("a URL with a place is a complete snapshot: what it omits is the default", () => {
    expect(overlayUrlSettings(stored, parse("lat=40.7128&lng=-74.006&fov=120"))).toEqual({
      ...DEFAULT_SETTINGS,
      place: { lat: 40.7128, lng: -74.006 },
      observer: { ...DEFAULT_SETTINGS.observer, fovDeg: 120 },
    });
  });

  test("the recipient of a shared link sees what the sender saw, whatever they had stored", () => {
    fc.assert(
      fc.property(arbSettings, arbSettings, (sender, recipientStored) => {
        fc.pre(sender.place !== null);
        const link = new URL(buildShareUrl(sender, "https://example.com/"));
        const shown = overlayUrlSettings(
          recipientStored,
          searchParamsToSettings(link.searchParams),
        );
        expect(shown).toEqual(roundSettingsForUrl(sender));
      }),
      { numRuns: 500 },
    );
  });
});

describe("buildShareUrl", () => {
  test("appends the query to an absolute base", () => {
    expect(buildShareUrl(FULL, "https://sun.example/")).toBe(
      "https://sun.example/?lat=40.71280&lng=-74.00600&n=New+York&d=2026-06-21&t=0930&m=w&h=7.5&dir=90&fov=120&b=0&sh=0",
    );
  });

  test("default settings leave no question mark behind", () => {
    expect(buildShareUrl(DEFAULT_SETTINGS, "https://sun.example/")).toBe("https://sun.example/");
    expect(buildShareUrl(DEFAULT_SETTINGS, "https://sun.example/?lat=1&lng=2#top")).toBe(
      "https://sun.example/#top",
    );
  });

  test("replaces an existing query and keeps path and hash", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, minuteOfDay: 60 };
    expect(buildShareUrl(s, "https://sun.example/app/?lat=1&z=3&utm=x#report")).toBe(
      "https://sun.example/app/?t=0100#report",
    );
    expect(buildShareUrl(s, "https://sun.example/app#a?b")).toBe(
      "https://sun.example/app?t=0100#a?b",
    );
  });

  test("works with relative bases and never throws", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, minuteOfDay: 60 };
    expect(buildShareUrl(s, "/")).toBe("/?t=0100");
    expect(buildShareUrl(s, "")).toBe("?t=0100");
    expect(buildShareUrl(s, "/a/b?x=1#h")).toBe("/a/b?t=0100#h");
  });

  test("always produces a parseable URL that decodes to the same settings", () => {
    fc.assert(
      fc.property(
        arbSettings,
        fc.webUrl({ withQueryParameters: true, withFragments: true }),
        (s, base) => {
          const url = new URL(buildShareUrl(s, base));
          const original = new URL(base);
          expect(url.origin).toBe(original.origin);
          expect(url.pathname).toBe(original.pathname);
          expect(url.hash).toBe(original.hash);
          expect(mergeSettings(DEFAULT_SETTINGS, searchParamsToSettings(url.searchParams))).toEqual(
            roundSettingsForUrl(s),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
