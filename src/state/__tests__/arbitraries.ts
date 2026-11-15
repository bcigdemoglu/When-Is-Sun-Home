/** fast-check generators shared by the state tests. */
import fc from "fast-check";
import type { Observer, Place } from "@/lib/types";
import {
  SETTINGS_LIMITS as L,
  daysInMonth,
  normalizePlaceName,
  type Layers,
  type Settings,
  type SettingsPatch,
} from "../schema";

const noNegativeZero = (v: number) => (v === 0 ? 0 : v);

const double = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map(noNegativeZero);

/** Canonical place names, including non-BMP characters. */
export const arbName: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ maxLength: 40 }),
    fc.string({ unit: "grapheme", maxLength: 40 }),
    fc.string({ unit: "binary", maxLength: 300 }),
    fc.constantFrom("Kadıköy, İstanbul", "東京都", "São Paulo & Co. #1?=+%", "🏠 home"),
  )
  .map(normalizePlaceName)
  .filter((name): name is string => name !== null);

export const arbPlace: fc.Arbitrary<Place> = fc
  .tuple(
    fc.oneof(double(L.lat.min, L.lat.max), fc.constantFrom(-90, 0, 90)),
    fc.oneof(double(L.lng.min, L.lng.max), fc.constantFrom(-180, 0, 180)),
    fc.option(arbName, { nil: undefined }),
  )
  .map(([lat, lng, name]) => (name === undefined ? { lat, lng } : { lat, lng, name }));

export const arbDate: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: L.year.min, max: L.year.max }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([year, month, day]) => {
    const d = Math.min(day, daysInMonth(year, month));
    return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });

export const arbMinuteOfDay = fc.integer({ min: L.minuteOfDay.min, max: L.minuteOfDay.max });

export const arbObserver: fc.Arbitrary<Observer> = fc.record({
  mode: fc.constantFrom("yard" as const, "window" as const),
  heightM: fc.oneof(double(L.heightM.min, L.heightM.max), fc.constantFrom(0, 1, 1.5, 300)),
  facingDeg: fc.integer({ min: L.facingDeg.min, max: L.facingDeg.max }),
  fovDeg: fc.integer({ min: L.fovDeg.min, max: L.fovDeg.max }),
});

export const arbLayers: fc.Arbitrary<Layers> = fc.record({
  buildings3d: fc.boolean(),
  shadows: fc.boolean(),
  trees: fc.boolean(),
});

/** Arbitrary canonical settings. */
export const arbSettings: fc.Arbitrary<Settings> = fc.record({
  place: fc.option(arbPlace, { nil: null }),
  date: fc.option(arbDate, { nil: null }),
  minuteOfDay: fc.option(arbMinuteOfDay, { nil: null }),
  observer: arbObserver,
  layers: arbLayers,
});

/** Any finite or non-finite number, any type at all: input for "must not break" tests. */
export const arbJunk: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.double(),
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 1e308, -1e308, Number.MAX_SAFE_INTEGER),
  fc.string(),
  fc.constantFrom(null, undefined, "", "2026-02-30", "window", [], {}),
);

/** A patch whose values may be valid or complete junk. */
export const arbWildPatch: fc.Arbitrary<SettingsPatch> = fc.record(
  {
    place: fc.oneof(fc.option(arbPlace, { nil: null }), arbJunk),
    date: fc.oneof(fc.option(arbDate, { nil: null }), arbJunk),
    minuteOfDay: fc.oneof(fc.option(arbMinuteOfDay, { nil: null }), arbJunk),
    observer: fc.oneof(
      fc.record(
        {
          mode: fc.oneof(fc.constantFrom("yard", "window"), arbJunk),
          heightM: arbJunk,
          facingDeg: arbJunk,
          fovDeg: arbJunk,
        },
        { requiredKeys: [] },
      ),
      arbJunk,
    ),
    layers: fc.oneof(
      fc.record({ buildings3d: arbJunk, shadows: arbJunk, trees: arbJunk }, { requiredKeys: [] }),
      arbJunk,
    ),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<SettingsPatch>;
