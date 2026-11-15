/**
 * What exactly gets shared: the current settings, with the place under the
 * name the user knows it by, and (optionally) the day and time on screen.
 * Pure — the clock and the settings are passed in.
 */
import { nowInZone, timeZoneAt } from "@/lib/solar/timezone";
import type { Place, PlaceSummary } from "@/lib/types";
import { mergeSettings, type Settings } from "@/state/schema";
import { buildShareUrl } from "@/state/urlCodec";

/** True while both date and time follow the clock ("today, now"). */
export function isLiveView(settings: Settings): boolean {
  return settings.date === null && settings.minuteOfDay === null;
}

/**
 * The date and minute the user is looking at, at the place: what the settings
 * pin, and the place's current date / time for whatever they leave to the
 * clock.
 */
export function viewedDateTime(
  settings: Settings,
  place: Place,
  now: Date = new Date(),
): { date: string; minuteOfDay: number } {
  if (settings.date !== null && settings.minuteOfDay !== null) {
    return { date: settings.date, minuteOfDay: settings.minuteOfDay };
  }
  const current = nowInZone(timeZoneAt(place.lat, place.lng), now);
  return {
    date: settings.date ?? current.date,
    minuteOfDay: settings.minuteOfDay ?? current.minuteOfDay,
  };
}

export interface ShareLinkInput {
  /** The store's current settings (`pickSettings(useSettings.getState())`). */
  settings: Settings;
  place: Place;
  /**
   * The place's real name — the user's saved label, or its address — which
   * becomes the name in the link. Pass "" for an unnamed pin: the link then
   * carries no name at all (never a coordinate string dressed up as one), and
   * whoever opens it gets the address looked up afresh.
   */
  label: string;
  /** Pin the day and time on screen into the link, or let it open on "today, now". */
  includeDateTime: boolean;
  /** Headline numbers for the link preview; leave out for a QR code. */
  summary?: PlaceSummary | null;
  /** The page's own URL (`window.location.href`); path and hash are kept. */
  base: string;
  now?: Date;
}

/** The settings a link will reproduce for its recipient. */
export function sharedSettings(input: ShareLinkInput): Settings {
  const { settings, place, label, includeDateTime, now } = input;
  const name = label.trim() === "" ? place.name : label;
  const named = mergeSettings(settings, {
    // No `name` key at all for an unnamed pin (an explicit `undefined` would do too,
    // but this way the shared settings say what they mean).
    place: name ? { lat: place.lat, lng: place.lng, name } : { lat: place.lat, lng: place.lng },
  });
  if (!includeDateTime) return { ...named, date: null, minuteOfDay: null };
  return { ...named, ...viewedDateTime(settings, place, now) };
}

/** The link itself. */
export function shareLink(input: ShareLinkInput): string {
  return buildShareUrl(sharedSettings(input), input.base, {
    summary: input.summary ?? null,
    includeDateTime: input.includeDateTime,
  });
}
