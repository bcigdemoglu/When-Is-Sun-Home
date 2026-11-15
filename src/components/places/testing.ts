/** Shared fixtures for the places component tests. */
import type { Observer, Place, PlaceSummary } from "@/lib/types";

export const YARD: Observer = { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 };
export const NORTH_WINDOW: Observer = { mode: "window", heightM: 4.5, facingDeg: 0, fovDeg: 120 };

export const ELM: Place = { lat: 37.75, lng: -122.43, name: "412 Elm Street, Noe Valley" };
export const ALDER: Place = { lat: 37.79, lng: -122.434, name: "14 Alder Road, Pacific Heights" };
export const OAK: Place = { lat: 37.76, lng: -122.44, name: "7 Oak Avenue, Cole Valley" };
export const PIN: Place = { lat: 37.7694, lng: -122.4862 };
export const SYDNEY: Place = { lat: -33.87, lng: 151.21, name: "5 Bondi Road, Sydney" };
export const MARINA: Place = { lat: 37.8, lng: -122.45, name: "Marina Boulevard, San Francisco" };
export const PIER: Place = { lat: 37.81, lng: -122.41, name: "Pier 39, San Francisco" };

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function summaryOf(monthlySunHours: number[]): PlaceSummary {
  let total = 0;
  let best = 0;
  let worst = 0;
  monthlySunHours.forEach((hours, month) => {
    total += hours * DAYS[month];
    if (hours > monthlySunHours[best]) best = month;
    if (hours < monthlySunHours[worst]) worst = month;
  });
  return {
    year: 2026,
    avgSunHoursPerDay: Math.round((total / 365) * 10) / 10,
    sunFraction: Math.round((total / (12 * 365)) * 100) / 100,
    totalSunHours: Math.round(total),
    monthlySunHours,
    monthlyDaylightHours: Array(12).fill(12),
    bestMonth: best,
    worstMonth: worst,
  };
}

/** A sunny yard: 7.8 h a day, best June 10.9, least December 4.5. */
export const SUNNY = summaryOf([4.9, 6.1, 7.6, 9.2, 10.4, 10.9, 10.6, 9.7, 8.3, 6.6, 5.2, 4.5]);
/** A north window: sun only around midsummer. */
export const DIM = summaryOf([0, 0, 0, 0.2, 0.9, 1.4, 1.1, 0.4, 0, 0, 0, 0]);
/** Southern hemisphere: most sun in December and January. */
export const AUSTRAL = summaryOf([9.8, 9, 7.5, 6, 4.8, 4.1, 4.4, 5.6, 7, 8.2, 9.1, 9.9]);
