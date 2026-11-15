import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { DEFAULT_OBSERVER, observerSchema } from "../schema";
import { arbJunk, arbObserver } from "../__tests__/arbitraries";
import {
  PLACES_LIMITS,
  VISIT_REFRESH_MS,
  canSave,
  cleanLabel,
  cleanNote,
  clearRecents,
  defaultPlaceLabel,
  entryAddress,
  entryLabel,
  formatPlaceCoordinates,
  placeEntryId,
  recordVisit,
  removeRecent,
  rename,
  reorder,
  sanitizeEntry,
  sanitizePlacesData,
  sanitizeSummary,
  save,
  setNote,
  shareList,
  unionPlaces,
  unsave,
  type PlacesData,
} from "./model";
import type { PlaceEntry } from "./types";

const YARD: Observer = { ...DEFAULT_OBSERVER };
const WINDOW: Observer = { mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 };

function summary(avg: number, overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    year: 2026,
    avgSunHoursPerDay: avg,
    sunFraction: 0.5,
    totalSunHours: Math.round(avg * 365),
    monthlySunHours: [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1],
    monthlyDaylightHours: [9, 10, 12, 13, 14, 15, 15, 14, 12, 11, 10, 9],
    bestMonth: 5,
    worstMonth: 0,
    ...overrides,
  };
}

const ELM: Place = { lat: 37.79, lng: -122.43, name: "12 Elm St, Springfield, CA" };
const OAK: Place = { lat: 37.8, lng: -122.44, name: "7 Oak Ave, Springfield, CA" };
const PIN: Place = { lat: -33.87, lng: 151.21 };

const empty = (): PlacesData => ({ saved: [], recent: [] });

/** `count` distinct places. */
const places = (count: number): Place[] =>
  Array.from({ length: count }, (_, i) => ({ lat: 10 + i * 0.001, lng: 20, name: `Place ${i}` }));

describe("ids and labels", () => {
  test("the id rounds to five decimals and never says -0", () => {
    expect(placeEntryId({ lat: 37.123456, lng: -122.000004 })).toBe("37.12346,-122.00000");
    expect(placeEntryId({ lat: -0.000001, lng: 0.000001 })).toBe("0.00000,0.00000");
    expect(placeEntryId({ lat: -0, lng: 0 })).toBe("0.00000,0.00000");
  });

  test("the default label is the first part of the address, else the coordinates", () => {
    expect(defaultPlaceLabel(ELM)).toBe("12 Elm St");
    expect(defaultPlaceLabel({ lat: 1, lng: 2, name: "  ,  nowhere" })).toBe("1.0000° N, 2.0000° E");
    expect(defaultPlaceLabel(PIN)).toBe("33.8700° S, 151.2100° E");
    expect(formatPlaceCoordinates({ lat: 0, lng: 0 })).toBe("0.0000° N, 0.0000° E");
  });

  test("labels and notes are trimmed, collapsed and cut without splitting a surrogate pair", () => {
    expect(cleanLabel("  Elm \n St   backyard ")).toBe("Elm St backyard");
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(42)).toBeNull();
    expect(cleanLabel("x".repeat(100))).toHaveLength(60);
    const emoji = `${"x".repeat(59)}🏠`;
    expect(cleanLabel(emoji)).toBe("x".repeat(59));
    expect(cleanNote("n".repeat(400))).toHaveLength(280);
    expect(cleanNote(" \n ")).toBeNull();
  });

  test("the address line says what the label does not", () => {
    const base = recordVisit(empty(), ELM, YARD, null, 1).recent[0];
    expect(entryLabel(base)).toBe("12 Elm St");
    expect(entryAddress(base)).toBe("Springfield, CA");
    expect(entryAddress({ ...base, label: "Backyard" })).toBe("12 Elm St, Springfield, CA");
    const pin = recordVisit(empty(), PIN, YARD, null, 1).recent[0];
    expect(entryAddress(pin)).toBe("Pinned on the map");
    expect(entryAddress({ ...pin, label: "Bondi flat" })).toBe("33.8700° S, 151.2100° E");
    const short = { ...base, place: { ...ELM, name: "12 Elm St" } };
    expect(entryAddress(short)).toBe("37.7900° N, 122.4300° W");
    expect(entryLabel({ ...base, label: "  " })).toBe("12 Elm St");
  });
});

describe("recordVisit", () => {
  test("adds a recent at the front, newest first, capped", () => {
    let data = empty();
    places(PLACES_LIMITS.recent + 3).forEach((place, i) => {
      data = recordVisit(data, place, YARD, null, i);
    });
    expect(data.recent).toHaveLength(PLACES_LIMITS.recent);
    expect(data.recent[0].place.name).toBe(`Place ${PLACES_LIMITS.recent + 2}`);
    expect(data.recent.every((entry) => entry.savedAt === null)).toBe(true);
    expect(data.saved).toEqual([]);
  });

  test("revisiting moves the recent to the front and refreshes it", () => {
    let data = recordVisit(empty(), ELM, YARD, null, 1);
    data = recordVisit(data, OAK, YARD, null, 2);
    data = recordVisit(data, ELM, WINDOW, summary(4), 3);
    expect(data.recent.map((entry) => entry.label)).toEqual(["12 Elm St", "7 Oak Ave"]);
    expect(data.recent[0]).toMatchObject({ observer: WINDOW, visitedAt: 3 });
    expect(data.recent[0].summary?.avgSunHoursPerDay).toBe(4);
  });

  test("never replaces a stored summary with null", () => {
    let data = recordVisit(empty(), ELM, YARD, summary(6.4), 1);
    data = recordVisit(data, ELM, WINDOW, null, 2);
    expect(data.recent[0].summary?.avgSunHoursPerDay).toBe(6.4);
    data = recordVisit(data, ELM, WINDOW, { ...summary(2), monthlySunHours: [1] }, 3);
    expect(data.recent[0].summary?.avgSunHoursPerDay).toBe(6.4);
  });

  test("a place that gains a name gets it, and an automatic label follows", () => {
    const bare = { lat: ELM.lat, lng: ELM.lng };
    let data = recordVisit(empty(), bare, YARD, null, 1);
    expect(data.recent[0].label).toBe("37.7900° N, 122.4300° W");
    data = recordVisit(data, ELM, YARD, null, 2);
    expect(data.recent[0].place.name).toBe(ELM.name);
    expect(data.recent[0].label).toBe("12 Elm St");
    // Losing the name again (a link without one) keeps what is known.
    data = recordVisit(data, bare, YARD, null, 3);
    expect(data.recent[0].place.name).toBe(ELM.name);
  });

  test("a label the user chose is not replaced by a later name", () => {
    const bare = { lat: ELM.lat, lng: ELM.lng };
    let { data } = save(empty(), bare, YARD, null, "Backyard", 1);
    data = recordVisit(data, ELM, YARD, null, 2);
    expect(data.saved[0].label).toBe("Backyard");
    expect(data.saved[0].place.name).toBe(ELM.name);
  });

  test("a saved place is refreshed where it is and stays out of the recents", () => {
    let data = empty();
    for (const place of [ELM, OAK, PIN]) data = save(data, place, YARD, null, undefined, 1).data;
    data = recordVisit(data, OAK, WINDOW, summary(3), 5 + VISIT_REFRESH_MS);
    expect(data.saved.map((entry) => entry.place.lat)).toEqual([ELM.lat, OAK.lat, PIN.lat]);
    expect(data.saved[1]).toMatchObject({ observer: WINDOW, visitedAt: 5 + VISIT_REFRESH_MS });
    expect(data.saved[1].savedAt).toBe(1);
    expect(data.recent).toEqual([]);
  });

  test("identical data changes nothing — the very same object comes back", () => {
    const first = recordVisit(empty(), ELM, YARD, summary(6.4), 1000);
    const again = recordVisit(first, { ...ELM }, { ...YARD }, summary(6.4), 1500);
    expect(again).toBe(first);
    const saved = save(first, ELM, YARD, null, undefined, 2000).data;
    expect(recordVisit(saved, ELM, YARD, summary(6.4), 2500)).toBe(saved);
    expect(recordVisit(saved, ELM, YARD, null, 2500)).toBe(saved);
  });

  test("a visit much later refreshes the visit time", () => {
    const first = recordVisit(empty(), ELM, YARD, null, 1000);
    const later = recordVisit(first, ELM, YARD, null, 1000 + VISIT_REFRESH_MS);
    expect(later).not.toBe(first);
    expect(later.recent[0].visitedAt).toBe(1000 + VISIT_REFRESH_MS);
    expect(later.recent[0].place).toBe(first.recent[0].place);
  });

  test("ignores places that cannot exist", () => {
    const data = empty();
    expect(recordVisit(data, { lat: 95, lng: 0 }, YARD, null, 1)).toBe(data);
    expect(recordVisit(data, { lat: NaN, lng: 0 }, YARD, null, 1)).toBe(data);
    expect(recordVisit(data, null as unknown as Place, YARD, null, 1)).toBe(data);
  });

  test("repairs an observer outside the limits", () => {
    const wild = { mode: "window", heightM: 9999, facingDeg: 370, fovDeg: 1 } as Observer;
    const data = recordVisit(empty(), ELM, wild, null, 1);
    expect(observerSchema.safeParse(data.recent[0].observer).success).toBe(true);
    expect(data.recent[0].observer).toEqual({
      mode: "window",
      heightM: 300,
      facingDeg: 10,
      fovDeg: 10,
    });
  });
});

describe("save / unsave", () => {
  test("moves a recent to the end of the saved list, keeping what is known about it", () => {
    let data = recordVisit(empty(), ELM, YARD, summary(6.4), 1);
    data = save(data, OAK, YARD, null, undefined, 2).data;
    const result = save(data, { lat: ELM.lat, lng: ELM.lng }, YARD, null, undefined, 3);
    expect(result.entry).toMatchObject({ label: "12 Elm St", savedAt: 3, visitedAt: 3 });
    expect(result.entry.summary?.avgSunHoursPerDay).toBe(6.4);
    expect(result.data.saved.map((entry) => entry.label)).toEqual(["7 Oak Ave", "12 Elm St"]);
    expect(result.data.recent).toEqual([]);
  });

  test("labels: the one given, else the address, else the coordinates", () => {
    expect(save(empty(), ELM, YARD, null, "  Elm St backyard ", 1).entry.label).toBe(
      "Elm St backyard",
    );
    expect(save(empty(), ELM, YARD, null, "   ", 1).entry.label).toBe("12 Elm St");
    expect(save(empty(), PIN, YARD, null, undefined, 1).entry.label).toBe(
      "33.8700° S, 151.2100° E",
    );
  });

  test("saving a saved place again keeps its position and can rename it", () => {
    let data = save(empty(), ELM, YARD, null, undefined, 1).data;
    data = save(data, OAK, YARD, null, undefined, 2).data;
    const same = save(data, ELM, YARD, null, undefined, 3);
    expect(same.data).toBe(data);
    expect(same.entry).toBe(data.saved[0]);
    const renamed = save(data, ELM, YARD, summary(5), "Front room", 4);
    expect(renamed.data.saved.map((entry) => entry.label)).toEqual(["Front room", "7 Oak Ave"]);
    expect(renamed.entry.savedAt).toBe(1);
    expect(renamed.entry.summary?.avgSunHoursPerDay).toBe(5);
  });

  test("refuses when the list is full and returns the unsaved entry", () => {
    let data = empty();
    for (const place of places(PLACES_LIMITS.saved)) {
      data = save(data, place, YARD, null, undefined, 1).data;
    }
    expect(canSave(data)).toBe(false);
    const fresh = save(data, ELM, YARD, summary(2), undefined, 2);
    expect(fresh.data).toBe(data);
    expect(fresh.entry).toMatchObject({ savedAt: null, label: "12 Elm St" });

    const withRecent = recordVisit(data, OAK, YARD, summary(3), 3);
    const known = save(withRecent, OAK, YARD, null, undefined, 4);
    expect(known.data).toBe(withRecent);
    expect(known.entry).toBe(withRecent.recent[0]);
    // …but a place that is already saved can still be updated.
    expect(save(data, places(1)[0], YARD, null, "Renamed", 5).entry.label).toBe("Renamed");
  });

  test("an unusable place is not stored", () => {
    const data = empty();
    const result = save(data, { lat: 200, lng: 0 }, YARD, null, undefined, 1);
    expect(result.data).toBe(data);
    expect(result.entry.savedAt).toBeNull();
  });

  test("unsave makes it the newest recent, label and note included", () => {
    let data = recordVisit(empty(), OAK, YARD, null, 1);
    data = save(data, ELM, YARD, summary(6.4), "Backyard", 2).data;
    data = setNote(data, data.saved[0].id, "Lovely garden");
    data = unsave(data, data.saved[0].id);
    expect(data.saved).toEqual([]);
    expect(data.recent.map((entry) => entry.label)).toEqual(["Backyard", "7 Oak Ave"]);
    expect(data.recent[0]).toMatchObject({ savedAt: null, note: "Lovely garden" });
    expect(unsave(data, "nope")).toBe(data);
    // Saving again restores it with its note.
    const back = save(data, ELM, YARD, null, undefined, 9).data;
    expect(back.saved[0]).toMatchObject({ label: "Backyard", note: "Lovely garden", savedAt: 9 });
  });
});

describe("rename, notes, order, recents", () => {
  const three = (): PlacesData => {
    let data = empty();
    for (const place of [ELM, OAK, PIN]) data = save(data, place, YARD, null, undefined, 1).data;
    return data;
  };
  const ids = (data: PlacesData) => data.saved.map((entry) => entry.id);

  test("rename trims, caps at 60 and ignores an empty label", () => {
    const data = three();
    const id = data.saved[1].id;
    expect(rename(data, id, "  Oak   Ave flat ").saved[1].label).toBe("Oak Ave flat");
    expect(rename(data, id, "y".repeat(80)).saved[1].label).toHaveLength(60);
    expect(rename(data, id, "   ")).toBe(data);
    expect(rename(data, id, "7 Oak Ave")).toBe(data);
    expect(rename(data, "nope", "x")).toBe(data);
  });

  test("setNote trims, caps at 280 and an empty note removes it", () => {
    const data = three();
    const id = data.saved[0].id;
    const noted = setNote(data, id, "  noisy road ");
    expect(noted.saved[0].note).toBe("noisy road");
    expect(setNote(noted, id, "noisy road")).toBe(noted);
    expect(setNote(data, id, "z".repeat(500)).saved[0].note).toHaveLength(280);
    const cleared = setNote(noted, id, "  ");
    expect("note" in cleared.saved[0]).toBe(false);
    expect(setNote(data, id, "")).toBe(data);
  });

  test("reorder ignores unknown and repeated ids and keeps omitted ones at the end", () => {
    const data = three();
    const [a, b, c] = ids(data);
    expect(ids(reorder(data, [c, a, b]))).toEqual([c, a, b]);
    expect(ids(reorder(data, [c, "nope", c]))).toEqual([c, a, b]);
    expect(ids(reorder(data, [b]))).toEqual([b, a, c]);
    expect(reorder(data, [a, b, c])).toBe(data);
    expect(reorder(data, [])).toBe(data);
    expect(reorder(data, null as unknown as string[])).toBe(data);
  });

  test("recents can be removed one by one or all at once", () => {
    let data = recordVisit(empty(), ELM, YARD, null, 1);
    data = recordVisit(data, OAK, YARD, null, 2);
    const one = removeRecent(data, data.recent[1].id);
    expect(one.recent.map((entry) => entry.label)).toEqual(["7 Oak Ave"]);
    expect(removeRecent(data, "nope")).toBe(data);
    expect(clearRecents(data).recent).toEqual([]);
    expect(clearRecents(empty()).recent).toEqual([]);
    const none = empty();
    expect(clearRecents(none)).toBe(none);
  });
});

describe("sanitizePlacesData", () => {
  const entry = (place: Place, extra: Record<string, unknown> = {}) => ({
    id: "whatever",
    place,
    observer: YARD,
    label: "Label",
    summary: summary(5),
    savedAt: 10,
    visitedAt: 20,
    ...extra,
  });

  test("anything that is not places data becomes two empty lists", () => {
    for (const junk of [undefined, null, 42, "x", [], { saved: "no", recent: 7 }]) {
      expect(sanitizePlacesData(junk)).toEqual({ saved: [], recent: [] });
    }
  });

  test("a corrupt entry is dropped and the good ones around it are kept", () => {
    const data = sanitizePlacesData({
      saved: [
        entry(ELM),
        null,
        "junk",
        entry({ lat: 91, lng: 0 }),
        entry({ lat: 1, lng: Number.NaN }),
        { place: { lat: "1", lng: 2 } },
        entry(OAK, { label: 7, note: 9, savedAt: "yesterday" }),
      ],
      recent: [entry(PIN, { savedAt: 99, visitedAt: -5 })],
    });
    expect(data.saved.map((e) => e.id)).toEqual([placeEntryId(ELM), placeEntryId(OAK)]);
    expect(data.saved[1]).toMatchObject({ label: "7 Oak Ave", savedAt: 20, visitedAt: 20 });
    expect("note" in data.saved[1]).toBe(false);
    expect(data.recent[0]).toMatchObject({ savedAt: null, visitedAt: 99 });
  });

  test("the id always comes from the coordinates", () => {
    const data = sanitizePlacesData({ saved: [entry(ELM, { id: "evil" })], recent: [] });
    expect(data.saved[0].id).toBe(placeEntryId(ELM));
  });

  test("a bad summary becomes null and a bad observer is repaired", () => {
    const bad = [
      { ...summary(5), monthlySunHours: [1, 2, 3] },
      { ...summary(5), monthlyDaylightHours: [...Array(11).fill(1), null] },
      { ...summary(5), avgSunHoursPerDay: "6" },
      { ...summary(5), bestMonth: 12 },
      { ...summary(5), sunFraction: 2 },
      "summary",
      [],
    ];
    for (const value of bad) expect(sanitizeSummary(value)).toBeNull();
    expect(sanitizeSummary(summary(5))).toEqual(summary(5));
    expect(sanitizeSummary({ ...summary(5), extra: true })).toEqual(summary(5));

    const data = sanitizePlacesData({
      saved: [entry(ELM, { summary: bad[0], observer: { mode: "tent", heightM: -4 } })],
    });
    expect(data.saved[0].summary).toBeNull();
    expect(data.saved[0].observer).toEqual({ ...DEFAULT_OBSERVER, heightM: 0 });
  });

  test("duplicates are dropped; a place in both lists stays saved; caps apply", () => {
    const many = places(PLACES_LIMITS.saved + 5).map((place) => entry(place));
    const data = sanitizePlacesData({
      saved: [entry(ELM), entry(ELM, { label: "Again" }), ...many],
      recent: [entry(ELM), ...places(20).map((place) => entry({ ...place, lng: 30 }))],
    });
    expect(data.saved).toHaveLength(PLACES_LIMITS.saved);
    expect(data.saved[0].label).toBe("Label");
    expect(data.recent).toHaveLength(PLACES_LIMITS.recent);
    expect(data.recent.some((e) => e.id === placeEntryId(ELM))).toBe(false);
  });

  test("hostile input (throwing getters) cannot take the good entries down", () => {
    const hostile = {
      get place(): Place {
        throw new Error("boom");
      },
    };
    const data = sanitizePlacesData({ saved: [hostile, entry(ELM)], recent: [hostile] });
    expect(data.saved).toHaveLength(1);
    expect(data.recent).toEqual([]);
    const worse = {
      get saved(): unknown {
        throw new Error("boom");
      },
    };
    expect(sanitizePlacesData(worse)).toEqual({ saved: [], recent: [] });
  });

  test("canonical data survives a JSON round trip unchanged", () => {
    let data = recordVisit(empty(), OAK, WINDOW, summary(2), 5);
    data = save(data, ELM, YARD, summary(6.4), "Backyard", 6).data;
    data = setNote(data, data.saved[0].id, "note");
    expect(sanitizePlacesData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(sanitizeEntry(data.saved[0], "saved")).toEqual(data.saved[0]);
  });
});

describe("sharing and merging", () => {
  test("shareList keeps identities of what did not change", () => {
    let data = recordVisit(empty(), ELM, YARD, null, 1);
    data = recordVisit(data, OAK, YARD, null, 2);
    const copy = sanitizePlacesData(JSON.parse(JSON.stringify(data)));
    expect(shareList(data.recent, copy.recent)).toBe(data.recent);
    const changed = [copy.recent[0], { ...copy.recent[1], label: "Other" }];
    const shared = shareList(data.recent, changed);
    expect(shared).not.toBe(data.recent);
    expect(shared[0]).toBe(data.recent[0]);
    expect(shared[1]).toBe(changed[1]);
    expect(shareList(data.recent, [copy.recent[1], copy.recent[0]])[0]).toBe(data.recent[1]);
    expect(shareList(data.recent, [])).toEqual([]);
  });

  test("unionPlaces folds early activity into what was stored", () => {
    let stored = save(empty(), ELM, YARD, null, undefined, 1).data;
    stored = recordVisit(stored, OAK, YARD, null, 2);
    expect(unionPlaces(stored, empty())).toBe(stored);

    let early = save(empty(), OAK, YARD, summary(3), undefined, 5).data;
    early = recordVisit(early, PIN, YARD, null, 6);
    const merged = unionPlaces(stored, early);
    expect(merged.saved.map((e) => e.label)).toEqual(["12 Elm St", "7 Oak Ave"]);
    expect(merged.recent.map((e) => e.id)).toEqual([placeEntryId(PIN)]);
  });
});

// ─── Properties ────────────────────────────────────────────────────────────

/** A small pool of positions so that actions collide on the same entries. */
const POOL: Place[] = Array.from({ length: 40 }, (_, i) => ({
  lat: -60 + i * 3.123456,
  lng: -170 + i * 8.654321,
}));

const arbPoolPlace: fc.Arbitrary<Place> = fc
  .tuple(
    fc.integer({ min: 0, max: POOL.length - 1 }),
    fc.option(fc.constantFrom("1 A St, Town", "B Road", "C, D, E"), { nil: undefined }),
  )
  .map(([index, name]) => (name === undefined ? POOL[index] : { ...POOL[index], name }));

const arbHours = fc.integer({ min: 0, max: 240 }).map((tenths) => tenths / 10);

const arbSummary: fc.Arbitrary<PlaceSummary> = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  avgSunHoursPerDay: arbHours,
  sunFraction: fc.integer({ min: 0, max: 100 }).map((percent) => percent / 100),
  totalSunHours: fc.integer({ min: 0, max: 5000 }),
  monthlySunHours: fc.array(arbHours, { minLength: 12, maxLength: 12 }),
  monthlyDaylightHours: fc.array(arbHours, { minLength: 12, maxLength: 12 }),
  bestMonth: fc.integer({ min: 0, max: 11 }),
  worstMonth: fc.integer({ min: 0, max: 11 }),
});

const arbId = fc.oneof(
  fc.integer({ min: 0, max: POOL.length - 1 }).map((index) => placeEntryId(POOL[index])),
  fc.string({ maxLength: 8 }),
);

type Action =
  | { type: "visit"; place: Place; observer: Observer; summary: PlaceSummary | null }
  | { type: "save"; place: Place; observer: Observer; summary: PlaceSummary | null; label?: string }
  | { type: "unsave"; id: string }
  | { type: "rename"; id: string; label: string }
  | { type: "note"; id: string; note: string }
  | { type: "reorder"; ids: string[] }
  | { type: "removeRecent"; id: string }
  | { type: "clearRecents" };

const arbMaybeSummary = fc.option(arbSummary, { nil: null });

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant("visit" as const),
      place: arbPoolPlace,
      observer: arbObserver,
      summary: arbMaybeSummary,
    }),
  },
  {
    weight: 8,
    arbitrary: fc.record({
      type: fc.constant("save" as const),
      place: arbPoolPlace,
      observer: arbObserver,
      summary: arbMaybeSummary,
      label: fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("unsave" as const), id: arbId }) },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("rename" as const),
      id: arbId,
      label: fc.string({ maxLength: 90 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("note" as const),
      id: arbId,
      note: fc.string({ maxLength: 400 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("reorder" as const),
      ids: fc.array(arbId, { maxLength: 12 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("removeRecent" as const), id: arbId }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("clearRecents" as const) }) },
);

function apply(data: PlacesData, action: Action, now: number): PlacesData {
  switch (action.type) {
    case "visit":
      return recordVisit(data, action.place, action.observer, action.summary, now);
    case "save":
      return save(data, action.place, action.observer, action.summary, action.label, now).data;
    case "unsave":
      return unsave(data, action.id);
    case "rename":
      return rename(data, action.id, action.label);
    case "note":
      return setNote(data, action.id, action.note);
    case "reorder":
      return reorder(data, action.ids);
    case "removeRecent":
      return removeRecent(data, action.id);
    case "clearRecents":
      return clearRecents(data);
  }
}

function expectCanonical(data: PlacesData): void {
  expect(data.saved.length).toBeLessThanOrEqual(PLACES_LIMITS.saved);
  expect(data.recent.length).toBeLessThanOrEqual(PLACES_LIMITS.recent);
  const ids = [...data.saved, ...data.recent].map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of data.saved) expect(entry.savedAt).not.toBeNull();
  for (const entry of data.recent) expect(entry.savedAt).toBeNull();
  for (const entry of [...data.saved, ...data.recent]) {
    expect(entry.id).toBe(placeEntryId(entry.place));
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.label.length).toBeLessThanOrEqual(PLACES_LIMITS.labelMaxLength);
    expect((entry.note ?? "x").length).toBeGreaterThan(0);
    expect((entry.note ?? "").length).toBeLessThanOrEqual(PLACES_LIMITS.noteMaxLength);
  }
  // Canonical data is a fixed point of the sanitiser, also through JSON.
  expect(sanitizePlacesData(JSON.parse(JSON.stringify(data)))).toEqual(data);
}

describe("properties", () => {
  test("any sequence of actions keeps the lists canonical", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 120 }), (actions) => {
        let data = empty();
        actions.forEach((action, step) => {
          data = apply(data, action, step * 1000);
        });
        expectCanonical(data);
      }),
      { numRuns: 150 },
    );
  });

  test("a summary, once known, is never lost while the entry lives", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 80 }), (actions) => {
        let data = empty();
        actions.forEach((action, step) => {
          const before = new Map(
            [...data.saved, ...data.recent].map((entry) => [entry.id, entry.summary]),
          );
          data = apply(data, action, step * 1000);
          for (const entry of [...data.saved, ...data.recent]) {
            if (before.get(entry.id)) expect(entry.summary).not.toBeNull();
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  test("the saved order only changes by reorder, save (append) and unsave (remove)", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 80 }), (actions) => {
        let data = empty();
        actions.forEach((action, step) => {
          const before = data.saved.map((entry) => entry.id);
          data = apply(data, action, step * 1000);
          const after = data.saved.map((entry) => entry.id);
          if (action.type === "reorder") {
            expect([...after].sort()).toEqual([...before].sort());
          } else if (action.type === "save") {
            expect(after.slice(0, before.length)).toEqual(before);
            expect(after.length - before.length).toBeLessThanOrEqual(1);
          } else if (action.type === "unsave") {
            expect(after).toEqual(before.filter((id) => id !== action.id));
          } else {
            expect(after).toEqual(before);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  test("a saved place is never dropped except by unsave", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 80 }), (actions) => {
        let data = empty();
        actions.forEach((action, step) => {
          const before = data.saved.map((entry) => entry.id);
          data = apply(data, action, step * 1000);
          const after = new Set(data.saved.map((entry) => entry.id));
          for (const id of before) {
            if (action.type === "unsave" && action.id === id) continue;
            expect(after.has(id)).toBe(true);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  test("repeating an action right away changes nothing (no second write)", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 40 }), arbAction, (actions, last) => {
        let data = empty();
        actions.forEach((action, step) => {
          data = apply(data, action, step);
        });
        const once = apply(data, last, 5000);
        // Un-saving twice or clearing twice is trivially idle; a visit / save
        // repeated with the same arguments must be, too.
        expect(apply(once, last, 5001)).toBe(once);
      }),
      { numRuns: 150 },
    );
  });

  test("the sanitiser never throws and always returns canonical data", () => {
    fc.assert(
      fc.property(arbJunk, (junk) => {
        expectCanonical(sanitizePlacesData(junk));
        expectCanonical(sanitizePlacesData({ saved: [junk, { place: junk }], recent: junk }));
      }),
      { numRuns: 300 },
    );
  });

  test("sanitising real data mangled field by field keeps the untouched entries", () => {
    fc.assert(
      fc.property(
        fc.array(arbAction, { maxLength: 40 }),
        fc.constantFrom("place", "observer", "label", "summary", "savedAt", "visitedAt", "note"),
        arbJunk,
        (actions, field, junk) => {
          let data = empty();
          actions.forEach((action, step) => {
            data = apply(data, action, step);
          });
          fc.pre(data.saved.length >= 2);
          const raw = JSON.parse(JSON.stringify(data));
          raw.saved[0][field] = junk;
          const cleaned = sanitizePlacesData(raw);
          expectCanonical(cleaned);
          // Whatever happened to the first entry, the rest are intact.
          for (const entry of data.saved.slice(1)) {
            const kept = cleaned.saved.find((other) => other.id === entry.id);
            // (unless the mangled entry now claims the same spot first)
            if (field !== "place") expect(kept).toEqual(entry);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
