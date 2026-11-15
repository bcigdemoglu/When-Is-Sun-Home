import fc from "fast-check";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { Observer, Place } from "@/lib/types";
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  defaultSettings,
  isSettings,
  isValidIsoDate,
  mergeSettings,
  normalizeFacingDeg,
  normalizeFovDeg,
  normalizeHeightM,
  normalizeLat,
  normalizeLng,
  normalizeMinuteOfDay,
  normalizePlaceName,
  sanitizeSettings,
  settingsSchema,
  type Settings,
} from "../schema";
import { arbJunk, arbSettings, arbWildPatch } from "./arbitraries";

const NYC: Place = { lat: 40.7128, lng: -74.006, name: "New York" };

describe("types", () => {
  test("Settings matches the shared contract", () => {
    expectTypeOf<Settings["observer"]>().toEqualTypeOf<Observer>();
    expectTypeOf<NonNullable<Settings["place"]>>().toEqualTypeOf<Place>();
    expectTypeOf<Settings["date"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Settings["minuteOfDay"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Settings["layers"]>().toEqualTypeOf<{
      buildings3d: boolean;
      shadows: boolean;
      trees: boolean;
    }>();
  });
});

describe("defaults", () => {
  test("are what the product specifies", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      place: null,
      date: null,
      minuteOfDay: null,
      observer: { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
      // Trees are an extra a person asks for: off until then.
      layers: { buildings3d: true, shadows: true, trees: false },
    });
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  test("cannot be mutated by accident", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.observer)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.layers)).toBe(true);
  });

  test("defaultSettings() hands out independent copies", () => {
    const a = defaultSettings();
    const b = defaultSettings();
    expect(a).toEqual(DEFAULT_SETTINGS);
    expect(a).not.toBe(b);
    expect(a.observer).not.toBe(b.observer);
    a.observer.fovDeg = 90;
    a.layers.shadows = false;
    expect(b.observer.fovDeg).toBe(180);
    expect(DEFAULT_SETTINGS.layers.shadows).toBe(true);
  });

  test("sanitizeSettings never returns the frozen defaults themselves", () => {
    const s = sanitizeSettings(undefined);
    expect(Object.isFrozen(s.observer)).toBe(false);
    expect(Object.isFrozen(s.layers)).toBe(false);
  });
});

describe("normalisers", () => {
  test("latitude is clamped", () => {
    expect(normalizeLat(95)).toBe(90);
    expect(normalizeLat(-123)).toBe(-90);
    expect(normalizeLat(12.5)).toBe(12.5);
  });

  test("longitude is wrapped, in-range values are untouched", () => {
    expect(normalizeLng(190)).toBe(-170);
    expect(normalizeLng(-190)).toBe(170);
    expect(normalizeLng(540)).toBe(-180);
    expect(normalizeLng(360)).toBe(0);
    expect(normalizeLng(180)).toBe(180);
    expect(normalizeLng(-180)).toBe(-180);
    expect(normalizeLng(-74.006)).toBe(-74.006);
  });

  test("facing is whole degrees in [0, 360)", () => {
    expect(normalizeFacingDeg(370)).toBe(10);
    expect(normalizeFacingDeg(-90)).toBe(270);
    expect(normalizeFacingDeg(360)).toBe(0);
    expect(normalizeFacingDeg(359.6)).toBe(0);
    expect(normalizeFacingDeg(-0.2)).toBe(0);
    expect(normalizeFacingDeg(-720)).toBe(0);
    expect(normalizeFacingDeg(123.4)).toBe(123);
  });

  test("field of view, height and minute are clamped", () => {
    expect(normalizeFovDeg(5)).toBe(10);
    expect(normalizeFovDeg(1000)).toBe(360);
    expect(normalizeFovDeg(89.5)).toBe(90);
    expect(normalizeHeightM(-3)).toBe(0);
    expect(normalizeHeightM(999)).toBe(300);
    expect(normalizeHeightM(7.25)).toBe(7.25);
    expect(normalizeMinuteOfDay(1500)).toBe(1439);
    expect(normalizeMinuteOfDay(-1)).toBe(0);
    expect(normalizeMinuteOfDay(719.6)).toBe(720);
  });

  test("no normaliser ever produces -0", () => {
    for (const f of [
      normalizeLat,
      normalizeLng,
      normalizeHeightM,
      normalizeFacingDeg,
      normalizeFovDeg,
      normalizeMinuteOfDay,
    ]) {
      for (const v of [-0, -1e-9, -0.4, -360, -720]) {
        expect(Object.is(f(v), -0), `${f.name}(${v})`).toBe(false);
      }
    }
  });

  test("normalisers stay in range for every finite number", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (v) => {
        const L = SETTINGS_LIMITS;
        expect(normalizeLat(v)).toBeGreaterThanOrEqual(L.lat.min);
        expect(normalizeLat(v)).toBeLessThanOrEqual(L.lat.max);
        expect(normalizeLng(v)).toBeGreaterThanOrEqual(L.lng.min);
        expect(normalizeLng(v)).toBeLessThanOrEqual(L.lng.max);
        const facing = normalizeFacingDeg(v);
        expect(Number.isInteger(facing) && facing >= 0 && facing <= 359).toBe(true);
        const fov = normalizeFovDeg(v);
        expect(Number.isInteger(fov) && fov >= 10 && fov <= 360).toBe(true);
        const minute = normalizeMinuteOfDay(v);
        expect(Number.isInteger(minute) && minute >= 0 && minute <= 1439).toBe(true);
        expect(normalizeHeightM(v)).toBeGreaterThanOrEqual(0);
        expect(normalizeHeightM(v)).toBeLessThanOrEqual(300);
      }),
    );
  });

  test("place names are trimmed, collapsed, repaired and limited", () => {
    expect(normalizePlaceName("  Main   St\n\t12 ")).toBe("Main St 12");
    expect(normalizePlaceName("")).toBeNull();
    expect(normalizePlaceName(" \n ")).toBeNull();
    expect(normalizePlaceName("a\u0000b")).toBe("a b");
    expect(normalizePlaceName("x".repeat(500))).toHaveLength(200);
    // lone surrogates are replaced, valid pairs survive
    expect(normalizePlaceName("a\uD83Cb")).toBe(`a${String.fromCharCode(0xfffd)}b`);
    expect(normalizePlaceName("🏠 home")).toBe("🏠 home");
    // a pair straddling the limit is dropped whole, not cut in half
    const straddling = normalizePlaceName("x".repeat(199) + "🏠");
    expect(straddling).toBe("x".repeat(199));
  });

  test("normalised names are stable and URL-safe", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 400 }), (raw) => {
        const name = normalizePlaceName(raw);
        if (name === null) return;
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(200);
        expect(normalizePlaceName(name)).toBe(name);
        expect(() => encodeURIComponent(name)).not.toThrow();
      }),
    );
  });
});

describe("isValidIsoDate", () => {
  test.each(["2026-01-01", "2026-12-31", "2024-02-29", "2000-02-29", "1900-01-01", "2199-12-31"])(
    "accepts %s",
    (d) => expect(isValidIsoDate(d)).toBe(true),
  );

  test.each([
    "2026-02-30",
    "2025-02-29",
    "1900-02-29", // 1900 was not a leap year
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-1-1",
    "26-01-01",
    "2026/01/01",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
    "1899-12-31",
    "2200-01-01",
    "",
    "today",
  ])("rejects %s", (d) => expect(isValidIsoDate(d)).toBe(false));

  test("agrees with the platform calendar", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2199 }),
        fc.integer({ min: 0, max: 13 }),
        fc.integer({ min: 0, max: 32 }),
        (y, m, d) => {
          const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const date = new Date(Date.UTC(y, m - 1, d));
          const real =
            date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
          expect(isValidIsoDate(iso)).toBe(real);
        },
      ),
    );
  });
});

describe("sanitizeSettings", () => {
  test("never throws and always yields valid Settings, whatever the input", () => {
    fc.assert(
      fc.property(fc.anything({ withBigInt: true, withDate: true, withMap: true }), (input) => {
        const s = sanitizeSettings(input);
        expect(settingsSchema.safeParse(s).success).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  test("yields valid Settings for almost-right input with junk in any field", () => {
    fc.assert(
      fc.property(arbWildPatch, (input) => {
        expect(isSettings(sanitizeSettings(input))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  test("valid Settings round-trip unchanged", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        expect(isSettings(s)).toBe(true);
        expect(sanitizeSettings(s)).toEqual(s);
      }),
      { numRuns: 500 },
    );
  });

  test("survives a JSON round-trip (what localStorage does)", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
      }),
    );
  });

  test("is idempotent", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), arbWildPatch), (input) => {
        const once = sanitizeSettings(input);
        expect(sanitizeSettings(once)).toEqual(once);
      }),
    );
  });

  test("one junk field never disturbs the valid ones", () => {
    fc.assert(
      fc.property(
        arbSettings,
        fc.constantFrom("place", "date", "minuteOfDay", "observer", "layers"),
        fc.anything(),
        (valid, key, junk) => {
          const out = sanitizeSettings({ ...valid, [key]: junk });
          for (const other of Object.keys(valid) as (keyof Settings)[]) {
            if (other !== key) expect(out[other]).toEqual(valid[other]);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  test.each([undefined, null, 42, "settings", [], true, () => {}, Symbol("s")])(
    "non-objects give the defaults: %s",
    (input) => expect(sanitizeSettings(input)).toEqual(DEFAULT_SETTINGS),
  );

  test("a bad fovDeg does not discard a good place", () => {
    const s = sanitizeSettings({ place: NYC, observer: { fovDeg: "wide", mode: "window" } });
    expect(s.place).toEqual(NYC);
    expect(s.observer).toEqual({ mode: "window", heightM: 1, facingDeg: 180, fovDeg: 180 });
  });

  test("each observer field falls back on its own", () => {
    const s = sanitizeSettings({
      observer: { mode: "balcony", heightM: 12, facingDeg: null, fovDeg: 90 },
    });
    expect(s.observer).toEqual({ mode: "yard", heightM: 12, facingDeg: 180, fovDeg: 90 });
  });

  test("numbers are clamped and normalised, not rejected", () => {
    const s = sanitizeSettings({
      place: { lat: 95, lng: 190 },
      minuteOfDay: 1500,
      observer: { mode: "window", heightM: -4, facingDeg: 370, fovDeg: 3 },
    });
    expect(s.place).toEqual({ lat: 90, lng: -170 });
    expect(s.minuteOfDay).toBe(1439);
    expect(s.observer).toEqual({ mode: "window", heightM: 0, facingDeg: 10, fovDeg: 10 });
  });

  test("NaN, infinities and numeric strings are not numbers", () => {
    const s = sanitizeSettings({
      place: { lat: "40.7", lng: -74 },
      minuteOfDay: NaN,
      observer: { heightM: Infinity, facingDeg: "90", fovDeg: -Infinity },
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  test("-0 never reaches the output", () => {
    const s = sanitizeSettings({
      place: { lat: -0, lng: -0 },
      minuteOfDay: -0,
      observer: { heightM: -0, facingDeg: -0, fovDeg: 180 },
    });
    expect(Object.is(s.place?.lat, 0)).toBe(true);
    expect(Object.is(s.place?.lng, 0)).toBe(true);
    expect(Object.is(s.minuteOfDay, 0)).toBe(true);
    expect(Object.is(s.observer.heightM, 0)).toBe(true);
    expect(Object.is(s.observer.facingDeg, 0)).toBe(true);
  });

  test("dates must be real calendar dates", () => {
    expect(sanitizeSettings({ date: "2026-06-21" }).date).toBe("2026-06-21");
    expect(sanitizeSettings({ date: "2024-02-29" }).date).toBe("2024-02-29");
    expect(sanitizeSettings({ date: "2026-02-30" }).date).toBeNull();
    expect(sanitizeSettings({ date: "2025-02-29" }).date).toBeNull();
    expect(sanitizeSettings({ date: 20260621 }).date).toBeNull();
    expect(sanitizeSettings({ date: new Date(0) }).date).toBeNull();
  });

  test("a place needs both coordinates", () => {
    expect(sanitizeSettings({ place: { lat: 40 } }).place).toBeNull();
    expect(sanitizeSettings({ place: { lng: 40 } }).place).toBeNull();
    expect(sanitizeSettings({ place: [40, -74] }).place).toBeNull();
    expect(sanitizeSettings({ place: "40,-74" }).place).toBeNull();
  });

  test("an unusable place name is dropped, the place is kept", () => {
    expect(sanitizeSettings({ place: { lat: 1, lng: 2, name: 42 } }).place).toEqual({
      lat: 1,
      lng: 2,
    });
    expect(sanitizeSettings({ place: { lat: 1, lng: 2, name: "   " } }).place).toEqual({
      lat: 1,
      lng: 2,
    });
    const long = sanitizeSettings({ place: { lat: 1, lng: 2, name: "x".repeat(1000) } }).place;
    expect(long?.name).toHaveLength(200);
    expect(sanitizeSettings({ place: { lat: 1, lng: 2 } }).place).not.toHaveProperty("name");
  });

  test("unknown keys are dropped at every level", () => {
    const s = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      zoom: 13,
      setPlace: () => {},
      place: { lat: 1, lng: 2, extra: true },
      observer: { ...DEFAULT_SETTINGS.observer, floor: 3 },
      layers: { ...DEFAULT_SETTINGS.layers, blockage: true },
    });
    expect(Object.keys(s).sort()).toEqual(["date", "layers", "minuteOfDay", "observer", "place"]);
    expect(s.place).toEqual({ lat: 1, lng: 2 });
    expect(Object.keys(s.observer).sort()).toEqual(["facingDeg", "fovDeg", "heightM", "mode"]);
    expect(Object.keys(s.layers).sort()).toEqual(["buildings3d", "shadows", "trees"]);
  });

  test("layers must be booleans", () => {
    expect(
      sanitizeSettings({ layers: { buildings3d: 0, shadows: false, trees: "1" } }).layers,
    ).toEqual({
      buildings3d: true,
      shadows: false,
      trees: false,
    });
    expect(sanitizeSettings({ layers: "none" }).layers).toEqual({
      buildings3d: true,
      shadows: true,
      trees: false,
    });
    expect(sanitizeSettings({ layers: { trees: true } }).layers).toEqual({
      buildings3d: true,
      shadows: true,
      trees: true,
    });
  });

  test("settings stored before there was a Trees layer have it off", () => {
    const stored = {
      ...DEFAULT_SETTINGS,
      place: NYC,
      layers: { buildings3d: false, shadows: true },
    };
    expect(sanitizeSettings(stored).layers).toEqual({
      buildings3d: false,
      shadows: true,
      trees: false,
    });
  });

  test("hostile objects fall back instead of throwing", () => {
    const throwing = {
      get place(): never {
        throw new Error("boom");
      },
    };
    expect(sanitizeSettings(throwing)).toEqual(DEFAULT_SETTINGS);

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(sanitizeSettings(proxy)).toEqual(DEFAULT_SETTINGS);
  });

  test("even a hostile field does not take a good one down with it", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const s = sanitizeSettings({
      place: NYC,
      observer: proxy,
      get layers(): never {
        throw new Error("boom");
      },
      date: "2026-06-21",
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, place: NYC, date: "2026-06-21" });

    const merged = mergeSettings(
      { ...DEFAULT_SETTINGS, place: NYC },
      {
        observer: proxy,
        get date(): never {
          throw new Error("boom");
        },
        minuteOfDay: 90,
      },
    );
    expect(merged).toEqual({ ...DEFAULT_SETTINGS, place: NYC, minuteOfDay: 90 });
  });

  test("the fallback argument replaces the defaults, leaf by leaf", () => {
    const current: Settings = {
      place: NYC,
      date: "2026-06-21",
      minuteOfDay: 600,
      observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 120 },
      layers: { buildings3d: false, shadows: true, trees: true },
    };
    const s = sanitizeSettings(
      { date: "nope", minuteOfDay: null, observer: { fovDeg: 60, heightM: NaN } },
      current,
    );
    expect(s).toEqual({
      place: NYC,
      date: "2026-06-21",
      minuteOfDay: null,
      observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 60 },
      layers: { buildings3d: false, shadows: true, trees: true },
    });
    expect(s.place).not.toBe(current.place);
  });
});

describe("mergeSettings", () => {
  const base: Settings = {
    place: NYC,
    date: "2026-06-21",
    minuteOfDay: 600,
    observer: { mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 120 },
    layers: { buildings3d: false, shadows: true, trees: false },
  };

  test("an empty patch changes nothing", () => {
    expect(mergeSettings(base, {})).toEqual(base);
  });

  test("observer and layers are merged leaf by leaf", () => {
    const s = mergeSettings(base, { observer: { fovDeg: 45 }, layers: { shadows: false } });
    expect(s.observer).toEqual({ mode: "window", heightM: 7.5, facingDeg: 90, fovDeg: 45 });
    expect(s.layers).toEqual({ buildings3d: false, shadows: false, trees: false });
    expect(mergeSettings(base, { layers: { trees: true } }).layers).toEqual({
      buildings3d: false,
      shadows: true,
      trees: true,
    });
    expect(s.place).toEqual(NYC);
  });

  test("null clears, undefined leaves alone", () => {
    const s = mergeSettings(base, { place: null, date: undefined, minuteOfDay: null });
    expect(s.place).toBeNull();
    expect(s.date).toBe("2026-06-21");
    expect(s.minuteOfDay).toBeNull();
  });

  test("patch values are normalised", () => {
    const s = mergeSettings(base, { minuteOfDay: 5000, observer: { facingDeg: -90 } });
    expect(s.minuteOfDay).toBe(1439);
    expect(s.observer.facingDeg).toBe(270);
  });

  test("unusable patch values keep the base value instead of resetting to a default", () => {
    const s = mergeSettings(base, {
      place: { lat: NaN, lng: 0 },
      date: "2026-02-30",
      minuteOfDay: NaN,
      observer: { heightM: NaN, mode: "balcony" as never },
      layers: { shadows: "yes" as never },
    });
    expect(s).toEqual(base);
  });

  test("never throws and always yields valid Settings", () => {
    fc.assert(
      fc.property(arbSettings, fc.oneof(arbWildPatch, arbJunk), (s, patch) => {
        expect(isSettings(mergeSettings(s, patch as never))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  test("merging a full valid Settings over anything yields exactly that Settings", () => {
    fc.assert(
      fc.property(arbSettings, arbSettings, (a, b) => {
        expect(mergeSettings(a, b)).toEqual(b);
      }),
    );
  });

  test("does not mutate its arguments", () => {
    const frozenBase = Object.freeze({
      ...base,
      observer: Object.freeze({ ...base.observer }),
      layers: Object.freeze({ ...base.layers }),
      place: Object.freeze({ ...NYC }),
    });
    const patch = Object.freeze({ observer: Object.freeze({ fovDeg: 30 }) });
    expect(() => mergeSettings(frozenBase, patch)).not.toThrow();
    expect(frozenBase.observer.fovDeg).toBe(120);
  });
});
