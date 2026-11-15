import type { Observer, PlaceSummary } from "@/lib/types";
import { PLACES_STORAGE_KEY, PLACES_STORAGE_VERSION, type PlaceEntry } from "@/state/places";

const DAYLIGHT = [9.8, 10.8, 12, 13.2, 14.3, 14.8, 14.5, 13.6, 12.4, 11.2, 10.1, 9.5];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function summary(monthlySunHours: number[]): PlaceSummary {
  let sun = 0;
  let daylight = 0;
  let best = 0;
  let worst = 0;
  monthlySunHours.forEach((hours, month) => {
    sun += hours * DAYS[month];
    daylight += DAYLIGHT[month] * DAYS[month];
    if (hours > monthlySunHours[best]) best = month;
    if (hours < monthlySunHours[worst]) worst = month;
  });
  return {
    year: 2026,
    avgSunHoursPerDay: Math.round((sun / 365) * 10) / 10,
    sunFraction: Math.round((sun / daylight) * 100) / 100,
    totalSunHours: Math.round(sun),
    monthlySunHours,
    monthlyDaylightHours: DAYLIGHT,
    bestMonth: best,
    worstMonth: worst,
  };
}

const YARD: Observer = { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 };
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 14, 18, 0, 0);

function entry(
  lat: number,
  lng: number,
  name: string | undefined,
  label: string | undefined,
  monthly: number[] | null,
  extra: Partial<PlaceEntry> = {},
): PlaceEntry {
  const place = name === undefined ? { lat, lng } : { lat, lng, name };
  return {
    id: `${lat.toFixed(5)},${lng.toFixed(5)}`,
    place,
    observer: YARD,
    label: label ?? name?.split(",")[0] ?? `${lat.toFixed(4)}° N, ${Math.abs(lng).toFixed(4)}° W`,
    summary: monthly ? summary(monthly) : null,
    savedAt: T0,
    visitedAt: T0,
    ...extra,
  };
}

/** Five saved places with very different years, and four recents. */
export const SEED_SAVED: PlaceEntry[] = [
  // A sunny, open yard.
  entry(
    37.75862,
    -122.43691,
    "412 Elm Street, Noe Valley, San Francisco, CA",
    "Elm St backyard",
    [4.9, 6.1, 7.6, 9.2, 10.4, 10.9, 10.6, 9.7, 8.3, 6.6, 5.2, 4.5],
    { note: "South-facing lawn, quiet street. The neighbour’s oak isn’t in these numbers." },
  ),
  // A north window: next to nothing, and only around midsummer.
  entry(
    37.79251,
    -122.43442,
    "14 Alder Road, Pacific Heights, San Francisco, CA",
    "Alder Rd kitchen window",
    [0, 0, 0, 0.2, 0.9, 1.4, 1.1, 0.4, 0, 0, 0, 0],
    { observer: { mode: "window", heightM: 4.5, facingDeg: 0, fovDeg: 120 } },
  ),
  // Morning sun all year, shade after lunch.
  entry(
    37.80112,
    -122.41019,
    "88 Greenwich Street, Telegraph Hill, San Francisco, CA",
    "Greenwich terrace",
    [2.1, 2.8, 3.6, 4.3, 4.9, 5.2, 5, 4.5, 3.8, 3, 2.3, 1.9],
    {
      observer: { mode: "yard", heightM: 7, facingDeg: 180, fovDeg: 180 },
      note: "Morning coffee spot. Shade from about 1 pm.",
    },
  ),
  // Buildings to the south take the winter sun.
  entry(
    37.79297,
    -122.43935,
    "2550 Pacific Avenue, Pacific Heights, San Francisco, CA",
    undefined,
    [0.4, 1.6, 3.9, 6.4, 8.2, 9.1, 8.7, 7, 4.6, 2.2, 0.7, 0.2],
  ),
  // Saved before its numbers were worked out.
  entry(37.76941, -122.48621, undefined, undefined, null),
];

export const SEED_RECENT: PlaceEntry[] = [
  entry(
    37.77493,
    -122.41942,
    "1 Dr Carlton B Goodlett Place, Civic Center, San Francisco, CA",
    undefined,
    [3.2, 4.4, 5.9, 7.3, 8.1, 8.6, 8.4, 7.6, 6.3, 4.8, 3.5, 2.9],
    { savedAt: null, visitedAt: T0 - HOUR },
  ),
  entry(
    37.80218,
    -122.44879,
    "Marina Boulevard, Marina District, San Francisco, CA",
    undefined,
    [6.8, 7.9, 9.4, 10.8, 11.9, 12.3, 12, 11.1, 9.8, 8.3, 7, 6.4],
    { savedAt: null, visitedAt: T0 - 2 * HOUR },
  ),
  entry(37.7341, -122.4489, undefined, undefined, null, {
    savedAt: null,
    visitedAt: T0 - 5 * HOUR,
  }),
  entry(
    37.76012,
    -122.50511,
    "1830 46th Avenue, Outer Sunset, San Francisco, CA",
    undefined,
    [4.1, 5.2, 6.3, 7.1, 7.4, 7, 6.2, 6, 6.4, 5.9, 4.6, 3.9],
    {
      savedAt: null,
      visitedAt: T0 - 26 * HOUR,
      observer: { mode: "window", heightM: 1.5, facingDeg: 270, fovDeg: 150 },
    },
  ),
];

function announce(): void {
  // The same signal another tab's write would send: the store reloads.
  window.dispatchEvent(
    new StorageEvent("storage", { key: PLACES_STORAGE_KEY, storageArea: window.localStorage }),
  );
}

export function seedPlaces(): void {
  window.localStorage.setItem(
    PLACES_STORAGE_KEY,
    JSON.stringify({
      state: { saved: SEED_SAVED, recent: SEED_RECENT },
      version: PLACES_STORAGE_VERSION,
    }),
  );
  announce();
}

export function clearPlaces(): void {
  window.localStorage.removeItem(PLACES_STORAGE_KEY);
  announce();
}
