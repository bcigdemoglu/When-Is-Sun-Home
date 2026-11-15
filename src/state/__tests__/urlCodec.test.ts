import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { summarizeYear } from "@/lib/analysis/summary";
import type { PlaceSummary, YearAnalysis } from "@/lib/types";
import {
  DEFAULT_SETTINGS,
  daysInMonth,
  isSettings,
  isValidIsoDate,
  mergeSettings,
  type Settings,
} from "../schema";
import {
  buildShareUrl,
  dayOfYearToIsoDate,
  decodeSummaryParam,
  encodeSummaryParam,
  hhmmToMinuteOfDay,
  isEmptyPatch,
  isLegacySearchParams,
  minuteOfDayToHHMM,
  overlayUrlSettings,
  roundSettingsForUrl,
  searchParamsToSettings,
  searchParamsToSummary,
  settingsToSearchParams,
  shareText,
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
  layers: { buildings3d: false, shadows: false, trees: false },
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

  test("the Trees layer is written only when it is on (off is the default), after the other layers", () => {
    const tr = (trees: boolean) =>
      settingsToSearchParams({
        ...DEFAULT_SETTINGS,
        layers: { ...DEFAULT_SETTINGS.layers, trees },
      }).toString();
    expect(tr(true)).toBe("tr=1");
    expect(tr(false)).toBe("");
    const withTrees: Settings = { ...FULL, layers: { ...FULL.layers, trees: true } };
    expect(settingsToSearchParams(withTrees).toString()).toBe(
      "lat=40.71280&lng=-74.00600&n=New+York&d=2026-06-21&t=0930&m=w&h=7.5&dir=90&fov=120&b=0&sh=0&tr=1",
    );
    expect(parse(settingsToSearchParams(withTrees).toString())).toEqual({
      ...withTrees,
      layers: { buildings3d: false, shadows: false, trees: true },
    });
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
    expect(parse("tr=1")).toEqual({ layers: { trees: true } });
    expect(parse("tr=0")).toEqual({ layers: { trees: false } });
    // Anything else is not a flag, and so not in the patch.
    expect(parse("tr=yes")).toEqual({});
    expect(parse("tr=")).toEqual({});
    expect(parse("d=2026-06-21")).toEqual({ date: "2026-06-21" });
    expect(parse("t=0930")).toEqual({ minuteOfDay: 570 });
    expect(parse("m=w&h=4.5")).toEqual({ observer: { mode: "window", heightM: 4.5 } });
  });

  test("reads a full link", () => {
    // Every field away from its default (the Trees layer's is "off").
    const full: Settings = { ...FULL, layers: { ...FULL.layers, trees: true } };
    expect(parse(settingsToSearchParams(full).toString())).toEqual(full);
  });

  test("explicit defaults are still returned (they can override stored values)", () => {
    expect(parse("m=y&h=1&dir=180&fov=180&b=1&sh=1&tr=0")).toEqual({
      observer: { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
      layers: { buildings3d: true, shadows: true, trees: false },
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
    // nor is the Trees flag, which only the current format has
    expect(legacy("tr=1")).toBe(false);
    expect(legacy("lat=45.5385&lng=-122.6265&tr=1")).toBe(false);
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

  test("an old link never mentions trees, and shows none", () => {
    const patch = parse("lat=40.71280&lng=-74.00600&z=15&t=870&d=172&f=3&sh=1");
    expect(patch.layers).toEqual({ shadows: true });
    const stored: Settings = {
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_SETTINGS.layers, trees: true },
    };
    expect(overlayUrlSettings(stored, patch).layers).toEqual({
      buildings3d: true,
      shadows: true,
      trees: false,
    });
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
    layers: { buildings3d: false, shadows: false, trees: true },
  };

  test("an empty patch keeps the stored settings", () => {
    expect(overlayUrlSettings(stored, {})).toEqual(stored);
  });

  test("without a place the URL overrides field by field", () => {
    expect(overlayUrlSettings(stored, parse("fov=120&sh=1"))).toEqual({
      ...stored,
      observer: { ...stored.observer, fovDeg: 120 },
      layers: { buildings3d: false, shadows: true, trees: true },
    });
    expect(overlayUrlSettings(stored, parse("tr=0")).layers).toEqual({
      buildings3d: false,
      shadows: false,
      trees: false,
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

// ─── Share links: embedded summary, share text ─────────────────────────────

/** Real engine output: a ground-level yard in Pacific Heights, San Francisco, 2026. */
const YARD_SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 6.5,
  sunFraction: 0.54,
  totalSunHours: 2385,
  monthlySunHours: [0, 0.1, 6.1, 11.8, 12.7, 12.5, 12.6, 12.3, 8.6, 1.3, 0, 0],
  monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
  bestMonth: 4,
  worstMonth: 0,
};
const YARD_S = "1.1t1i401u9.00011p3a3j3h3i3f2e0d0000.2p2z3a3n3x423z3q3f322s2m";

/** Real engine output: a south-facing 2nd-floor window at the same pin. */
const WINDOW_SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 4,
  sunFraction: 0.34,
  totalSunHours: 1477,
  monthlySunHours: [3.6, 4.9, 5, 4.9, 3.7, 3.1, 3.4, 4.5, 5.2, 5, 4.3, 1.2],
  monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
  bestMonth: 8,
  worstMonth: 11,
};

const NO_SUN_SUMMARY: PlaceSummary = {
  ...YARD_SUMMARY,
  avgSunHoursPerDay: 0,
  sunFraction: 0,
  totalSunHours: 0,
  monthlySunHours: Array.from({ length: 12 }, () => 0),
  bestMonth: 0,
  worstMonth: 0,
};

/**
 * Summaries exactly as the app produces them: a year of made-up days, boiled
 * down by the engine's own `summarizeYear`.
 */
const arbSummary: fc.Arbitrary<PlaceSummary> = fc
  .record({
    year: fc.integer({ min: 1900, max: 2199 }),
    // per month: typical daylight, share of it that is sun, day-to-day spread
    months: fc.array(
      fc.record({
        daylight: fc.integer({ min: 0, max: 1440 }),
        share: fc.double({ min: 0, max: 1, noNaN: true }),
        spread: fc.integer({ min: 0, max: 120 }),
      }),
      { minLength: 12, maxLength: 12 },
    ),
    noise: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
      minLength: 31,
      maxLength: 31,
    }),
  })
  .map(({ year, months, noise }) => {
    const summaries = months.map((m, index) => {
      const dayCount = daysInMonth(year, index + 1);
      let sunMinutes = 0;
      let daylightMinutes = 0;
      for (let d = 0; d < dayCount; d++) {
        const daylight = Math.min(1440, Math.max(0, Math.round(m.daylight + noise[d] * m.spread)));
        daylightMinutes += daylight;
        sunMinutes +=
          Math.round((daylight * m.share) / 5) * 5 > daylight
            ? daylight
            : Math.round((daylight * m.share) / 5) * 5;
      }
      return { dayCount, sunMinutes, daylightMinutes };
    });
    const days = summaries.reduce((sum, m) => sum + m.dayCount, 0);
    const sun = summaries.reduce((sum, m) => sum + m.sunMinutes, 0);
    const daylight = summaries.reduce((sum, m) => sum + m.daylightMinutes, 0);
    // Only the fields `summarizeYear` reads.
    const analysis = {
      year,
      months: summaries.map((m) => ({
        avgSunHours: m.sunMinutes / m.dayCount / 60,
        avgDaylightHours: m.daylightMinutes / m.dayCount / 60,
      })),
      annual: {
        totalSunHours: sun / 60,
        avgSunHoursPerDay: sun / 60 / days,
        sunFraction: daylight > 0 ? sun / daylight : 0,
      },
    } as unknown as YearAnalysis;
    return summarizeYear(analysis);
  });

describe("summary in the share link (s)", () => {
  test("a real summary encodes to 61 URL-safe characters and back, exactly", () => {
    expect(encodeSummaryParam(YARD_SUMMARY)).toBe(YARD_S);
    expect(YARD_S).toHaveLength(61);
    expect(YARD_S).toMatch(/^[0-9a-z.]+$/);
    expect(decodeSummaryParam(YARD_S, 2026)).toEqual(YARD_SUMMARY);
    expect(decodeSummaryParam(encodeSummaryParam(WINDOW_SUMMARY), 2026)).toEqual(WINDOW_SUMMARY);
    expect(decodeSummaryParam(encodeSummaryParam(NO_SUN_SUMMARY), 2026)).toEqual(NO_SUN_SUMMARY);
  });

  test("survives a URL untouched (nothing to percent-encode)", () => {
    const params = new URLSearchParams({ s: YARD_S });
    expect(params.toString()).toBe(`s=${YARD_S}`);
    expect(new URL(`https://x.example/?s=${YARD_S}`).searchParams.get("s")).toBe(YARD_S);
    expect(encodeURIComponent(YARD_S)).toBe(YARD_S);
  });

  test("every summary the app can produce round-trips exactly", () => {
    fc.assert(
      fc.property(arbSummary, (summary) => {
        const encoded = encodeSummaryParam(summary);
        expect(encoded).toHaveLength(61);
        expect(encoded).toMatch(/^1\.[0-9a-z]{9}\.[0-9a-z]{24}\.[0-9a-z]{24}$/);
        expect(decodeSummaryParam(encoded, summary.year)).toEqual(summary);
      }),
      { numRuns: 2000 },
    );
  });

  test("the year is the caller's: a leap-year reader still accepts the link", () => {
    fc.assert(
      fc.property(arbSummary, fc.integer({ min: 1900, max: 2199 }), (summary, year) => {
        expect(decodeSummaryParam(encodeSummaryParam(summary), year)).toEqual({ ...summary, year });
      }),
      { numRuns: 500 },
    );
    expect(decodeSummaryParam(YARD_S, 2028)).toEqual({ ...YARD_SUMMARY, year: 2028 });
  });

  test.each([
    ["empty", ""],
    ["truncated", YARD_S.slice(0, 60)],
    ["too long", `${YARD_S}0`],
    ["another version", `2${YARD_S.slice(1)}`],
    ["upper case", YARD_S.toUpperCase()],
    ["a character outside base 36", YARD_S.replace("1t1i", "1t-i")],
    ["percent-encoded junk", YARD_S.replace("1t1i", "%2F1i")],
    ["a missing separator", YARD_S.replace(/\./g, "0")],
    ["whitespace around it", ` ${YARD_S.slice(1)}`],
    ["average above 24 h", `1.zz${YARD_S.slice(4)}`],
    ["percentage above 100", `1.1tzz${YARD_S.slice(6)}`],
    ["a month index above 11", `1.1t1ic0${YARD_S.slice(8)}`],
    ["a total above 366 × 24", `1.1t1i40zzz${YARD_S.slice(11)}`],
    ["a month above 24 h", `${YARD_S.slice(0, 12)}zz${YARD_S.slice(14)}`],
    // January: 12.0 h of sun in 9.7 h of daylight
    ["more sun than daylight", `${YARD_S.slice(0, 12)}3c${YARD_S.slice(14)}`],
    // head says "best month: March", the bars say May
    ["a best month that is not the best", `1.1t1i20${YARD_S.slice(8)}`],
    ["a worst month that is not the worst", `1.1t1i44${YARD_S.slice(8)}`],
    // head says 20.0 h a day over bars that average 6.5
    ["a headline the bars contradict", `1.5k${YARD_S.slice(4)}`],
    ["a percentage the bars contradict", `1.1t2n${YARD_S.slice(6)}`],
    ["a yearly total the average contradicts", `1.1t1i40001${YARD_S.slice(11)}`],
  ])("rejects %s", (_label, value) => {
    expect(decodeSummaryParam(value, 2026)).toBeNull();
  });

  test.each([NaN, Infinity, 2026.5, 1899, 2200, "2026" as never, undefined as never])(
    "rejects year %s",
    (year) => {
      expect(decodeSummaryParam(YARD_S, year)).toBeNull();
    },
  );

  test("never throws, whatever the string; what it accepts is self-consistent", () => {
    const check = (value: string) => {
      const summary = decodeSummaryParam(value, 2026);
      if (summary === null) return;
      expect(encodeSummaryParam(summary)).toBe(value);
      expect(summary.monthlySunHours).toHaveLength(12);
      expect(summary.monthlyDaylightHours).toHaveLength(12);
      summary.monthlySunHours.forEach((sun, month) => {
        expect(sun).toBeGreaterThanOrEqual(0);
        expect(sun).toBeLessThanOrEqual(summary.monthlyDaylightHours[month]);
        expect(summary.monthlyDaylightHours[month]).toBeLessThanOrEqual(24);
        expect(sun).toBeLessThanOrEqual(summary.monthlySunHours[summary.bestMonth]);
        expect(sun).toBeGreaterThanOrEqual(summary.monthlySunHours[summary.worstMonth]);
      });
      expect(summary.avgSunHoursPerDay).toBeLessThanOrEqual(
        summary.monthlySunHours[summary.bestMonth] + 0.15,
      );
      expect(summary.sunFraction).toBeLessThanOrEqual(1);
    };
    fc.assert(fc.property(fc.string(), check), { numRuns: 1000 });
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 100 }), check));
    // strings of the right shape, and real values with a few characters changed
    const base36 = fc.constantFrom(..."0123456789abcdefghijklmnopqrstuvwxyz");
    const shaped = fc
      .tuple(
        fc.string({ unit: base36, minLength: 9, maxLength: 9 }),
        fc.string({ unit: base36, minLength: 24, maxLength: 24 }),
        fc.string({ unit: base36, minLength: 24, maxLength: 24 }),
      )
      .map((parts) => `1.${parts.join(".")}`);
    fc.assert(fc.property(shaped, check), { numRuns: 1000 });
    const mutated = fc
      .tuple(
        arbSummary,
        fc.array(fc.tuple(fc.integer({ min: 0, max: 60 }), base36), { minLength: 1, maxLength: 3 }),
      )
      .map(([summary, edits]) => {
        const chars = [...encodeSummaryParam(summary)];
        for (const [at, char] of edits) chars[at] = char;
        return chars.join("");
      });
    fc.assert(fc.property(mutated, check), { numRuns: 2000 });
  });

  test("encodeSummaryParam never throws; a summary without its months gives ''", () => {
    expect(encodeSummaryParam({ ...YARD_SUMMARY, monthlySunHours: [1, 2, 3] })).toBe("");
    expect(encodeSummaryParam({} as never)).toBe("");
    expect(encodeSummaryParam(null as never)).toBe("");
    expect(encodeSummaryParam({ ...YARD_SUMMARY, avgSunHoursPerDay: NaN })).toHaveLength(61);
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        const encoded = encodeSummaryParam(junk as never);
        expect(encoded === "" || encoded.length === 61).toBe(true);
      }),
    );
  });

  test("searchParamsToSummary takes the year from the link's date, else from the clock", () => {
    const at = (query: string) =>
      searchParamsToSummary(new URLSearchParams(query), { now: NOW_2026 });
    expect(at(`s=${YARD_S}`)).toEqual(YARD_SUMMARY);
    expect(at(`lat=1&lng=2&d=2028-06-21&s=${YARD_S}`)?.year).toBe(2028);
    expect(at(`d=172&s=${YARD_S}`)?.year).toBe(2026); // a legacy day of year has no year
    expect(at("lat=1&lng=2")).toBeNull();
    expect(at("s=")).toBeNull();
    expect(at("s=garbage")).toBeNull();
    expect(searchParamsToSummary(new URLSearchParams(`s=${YARD_S}`))?.year).toBe(
      new Date().getFullYear(),
    );
  });

  test("s is not a setting: the settings codec neither reads nor writes it", () => {
    expect(parse(`s=${YARD_S}`)).toEqual({});
    expect(parse(`lat=1&lng=2&fov=90&s=${YARD_S}`)).toEqual(parse("lat=1&lng=2&fov=90"));
    expect(parse("lat=1&lng=2&s=720")).toEqual({ place: { lat: 1, lng: 2 } });
    expect(isLegacySearchParams(new URLSearchParams(`s=${YARD_S}`))).toBe(false);
    fc.assert(
      fc.property(arbSettings, (s) => {
        expect(settingsToSearchParams(s).has("s")).toBe(false);
      }),
    );
  });
});

describe("buildShareUrl options", () => {
  const BASE = "https://sun.example/";
  const QUERY =
    "lat=40.71280&lng=-74.00600&n=New+York&d=2026-06-21&t=0930&m=w&h=7.5&dir=90&fov=120&b=0&sh=0";

  test("without options (or with empty ones) nothing changes", () => {
    expect(buildShareUrl(FULL, BASE)).toBe(`${BASE}?${QUERY}`);
    expect(buildShareUrl(FULL, BASE, {})).toBe(`${BASE}?${QUERY}`);
    expect(buildShareUrl(FULL, BASE, { summary: null, includeDateTime: true })).toBe(
      `${BASE}?${QUERY}`,
    );
  });

  test("a summary is appended as the last parameter", () => {
    expect(buildShareUrl(FULL, BASE, { summary: YARD_SUMMARY })).toBe(
      `${BASE}?${QUERY}&s=${YARD_S}`,
    );
    expect(buildShareUrl(FULL, "/app?old=1#top", { summary: YARD_SUMMARY })).toBe(
      `/app?${QUERY}&s=${YARD_S}#top`,
    );
  });

  test("includeDateTime: false leaves d and t out, and nothing else", () => {
    const url = buildShareUrl(FULL, BASE, { includeDateTime: false, summary: YARD_SUMMARY });
    expect(url).toBe(
      `${BASE}?lat=40.71280&lng=-74.00600&n=New+York&m=w&h=7.5&dir=90&fov=120&b=0&sh=0&s=${YARD_S}`,
    );
    // the caller's settings are not touched
    expect(FULL.date).toBe("2026-06-21");
  });

  test("no place, no summary; an unusable summary is left out", () => {
    expect(buildShareUrl(DEFAULT_SETTINGS, BASE, { summary: YARD_SUMMARY })).toBe(BASE);
    expect(buildShareUrl(FULL, BASE, { summary: { ...YARD_SUMMARY, monthlySunHours: [] } })).toBe(
      `${BASE}?${QUERY}`,
    );
  });

  test("a share link gives the recipient the sender's view and the sender's numbers", () => {
    fc.assert(
      fc.property(
        arbSettings,
        arbSettings,
        arbSummary,
        fc.boolean(),
        (sender, recipientStored, summary, includeDateTime) => {
          fc.pre(sender.place !== null);
          const link = new URL(buildShareUrl(sender, BASE, { summary, includeDateTime }));
          expect(link.search.length).toBeLessThan(2000);
          const shown = overlayUrlSettings(
            recipientStored,
            searchParamsToSettings(link.searchParams),
          );
          const expected = roundSettingsForUrl(
            includeDateTime ? sender : { ...sender, date: null, minuteOfDay: null },
          );
          expect(shown).toEqual(expected);
          const year = expected.date ? Number(expected.date.slice(0, 4)) : NOW_2026.getFullYear();
          expect(searchParamsToSummary(link.searchParams, { now: NOW_2026 })).toEqual({
            ...summary,
            year,
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("shareText", () => {
  test("says the number first, then the best and the worst month", () => {
    expect(shareText("Elm St backyard", WINDOW_SUMMARY)).toEqual({
      title: "Elm St backyard: 4.0 h of direct sun a day",
      text: "Elm St backyard: 4.0 h of direct sun on an average day (5.2 h in September, 1.2 h in December). See the full year:",
    });
  });

  test("a month without any sun is 'none', not '0.0 h'", () => {
    expect(shareText("Pacific Heights backyard", YARD_SUMMARY).text).toBe(
      "Pacific Heights backyard: 6.5 h of direct sun on an average day (12.7 h in May, none in January). See the full year:",
    );
  });

  test("no summary yet: an invitation instead of numbers", () => {
    expect(shareText("Elm St backyard", null)).toEqual({
      title: "Elm St backyard: see when this spot gets direct sun",
      text: "Elm St backyard: see when this spot gets direct sun.",
    });
  });

  test("a spot that never gets sun says so", () => {
    expect(shareText("North window", NO_SUN_SUMMARY)).toEqual({
      title: "North window: no direct sun",
      text: "North window: no direct sun at any time of year. See the full year:",
    });
  });

  test("the same hours all year: no month comparison", () => {
    const flat: PlaceSummary = {
      ...YARD_SUMMARY,
      avgSunHoursPerDay: 5,
      monthlySunHours: Array.from({ length: 12 }, () => 5),
      bestMonth: 0,
      worstMonth: 0,
    };
    expect(shareText("Atrium", flat).text).toBe(
      "Atrium: 5.0 h of direct sun on an average day. See the full year:",
    );
  });

  test("can mention the day being looked at", () => {
    const options = { date: "2026-06-21", daySunMinutes: 185 };
    expect(shareText("Elm St backyard", WINDOW_SUMMARY, options).text).toBe(
      "Elm St backyard: 4.0 h of direct sun on an average day (5.2 h in September, 1.2 h in December). 3 h 5 m on June 21. See the full year:",
    );
    // both pieces are needed, and the date must be real
    expect(shareText("x", WINDOW_SUMMARY, { date: "2026-06-21" }).text).not.toContain("June 21");
    expect(shareText("x", WINDOW_SUMMARY, { daySunMinutes: 185 }).text).not.toContain("3 h");
    expect(
      shareText("x", WINDOW_SUMMARY, { date: "2026-02-30", daySunMinutes: 185 }).text,
    ).not.toContain("3 h 5 m");
  });

  test("the label is tidied; an empty one becomes 'This spot'", () => {
    expect(shareText("  Elm   St\n", null).title).toBe(
      "Elm St: see when this spot gets direct sun",
    );
    expect(shareText("", WINDOW_SUMMARY).title).toBe("This spot: 4.0 h of direct sun a day");
    expect(shareText(undefined as never, null).text).toBe(
      "This spot: see when this spot gets direct sun.",
    );
  });

  test("the text reads naturally with a URL appended", () => {
    const { text } = shareText("Elm St backyard", WINDOW_SUMMARY);
    expect(`${text} https://sun.example/?lat=1`).toMatch(/See the full year: https:\/\//);
  });

  test("never throws", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.anything(), (label, summary, options) => {
        const result = shareText(label as never, summary as never, options as never);
        expect(typeof result.title).toBe("string");
        expect(typeof result.text).toBe("string");
        expect(result.title.length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.string(), arbSummary, (label, summary) => {
        const { title, text } = shareText(label, summary);
        expect(title).not.toMatch(/NaN|undefined|Infinity/);
        expect(text).not.toMatch(/NaN|undefined|Infinity/);
      }),
    );
  });
});
