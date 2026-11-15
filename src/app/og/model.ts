/**
 * What a link preview says about a shared place — worked out from the query
 * string ALONE. Nothing here fetches or computes sun data: the headline
 * numbers travel in the link itself (the `s` parameter, see
 * `@/state/urlCodec`), so the preview is cheap, cacheable for ever and
 * identical to what the sender saw.
 *
 * Every function is pure, server-safe and never throws: `/og` is a public
 * endpoint and `generateMetadata` runs on every shared link, so garbage in
 * the query string must degrade to a generic card, not to an error.
 */
import {
  bestWorstLine,
  coordinatesLabel,
  shortPlaceName,
  truncate,
  viewpointLabel,
} from "@/components/share/describe";
import type { Place, PlaceSummary } from "@/lib/types";
import { DEFAULT_SETTINGS, type Settings } from "@/state/schema";
import {
  SUMMARY_URL_KEY,
  encodeSummaryParam,
  formatSunHours,
  overlayUrlSettings,
  searchParamsToSettings,
  searchParamsToSummary,
  settingsToSearchParams,
} from "@/state/urlCodec";

export const SITE_NAME = "When Is Sun Home?";
export const SITE_TAGLINE = "Hours of direct sun for any backyard or window";
export const OG_SIZE = { width: 1200, height: 630 } as const;
/** Bump when the card's design changes, so that caches fetch the new image. */
export const OG_VERSION = "1";

const LABEL_MAX_CHARS = 30;

export type OgCard =
  | { kind: "brand" }
  | {
      kind: "place";
      /** Short place label, already truncated. */
      label: string;
      /** "Backyard · ground level", "Window · 2nd floor · facing S". */
      viewpoint: string;
      /** Null when the link carries no (valid) summary. */
      summary: PlaceSummary | null;
    };

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Next's `searchParams` object as `URLSearchParams` (first value of each key). */
export function toUrlSearchParams(record: SearchParamsRecord | null | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!record) return params;
  try {
    for (const [key, value] of Object.entries(record)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") params.set(key, first);
    }
  } catch {
    // an exotic object: treat as no parameters
  }
  return params;
}

/**
 * Everything the font bundled with `next/og` (Geist Regular) cannot draw:
 * anything outside Latin, Latin Extended-A, Vietnamese, basic Cyrillic and
 * common punctuation. The ranges mirror the font's character map.
 *
 * Why it matters: for a character the font lacks, `next/og` downloads a
 * fallback font from Google Fonts at request time, sending those characters of
 * the place name along. The card must neither depend on the network nor pass
 * anybody's address on, so such characters never reach the renderer.
 */
const NOT_RENDERABLE =
  /[^\u0020-\u007E\u00A0-\u00AC\u00AE-\u0113\u0116-\u012B\u012E-\u0137\u0139-\u013E\u0141-\u0148\u014A-\u014D\u0150-\u017E\u0218-\u021B\u0400-\u045F\u1EA0-\u1EF9\u2013\u2014\u2018-\u201A\u201C-\u201E\u2026]/gu;

/** `text` reduced to what the card's font can draw (possibly ""). */
export function renderableText(text: string): string {
  return text.normalize("NFC").replace(NOT_RENDERABLE, "").replace(/\s+/g, " ").trim();
}

/**
 * What to call the place on the card: its short name, else its coordinates.
 * A name mostly written in a script the card cannot draw (see
 * `NOT_RENDERABLE`) also gives way to the coordinates.
 */
export function placeLabel(place: Place): string {
  const name = shortPlaceName(place);
  if (name !== null) {
    const drawable = renderableText(name);
    if (drawable !== "" && Array.from(drawable).length * 2 >= Array.from(name).length) {
      return truncate(drawable, LABEL_MAX_CHARS);
    }
  }
  return coordinatesLabel(place);
}

interface SharedView {
  settings: Settings;
  place: Place;
  summary: PlaceSummary | null;
}

/** The place a link pins, with its viewpoint and summary; null if it pins none. */
function sharedView(params: URLSearchParams, now?: Date): SharedView | null {
  const patch = searchParamsToSettings(params, { now });
  if (!patch.place) return null;
  const settings = overlayUrlSettings(DEFAULT_SETTINGS, patch);
  if (!settings.place) return null;
  return {
    settings,
    place: settings.place,
    summary: searchParamsToSummary(params, { now }),
  };
}

/** What the `/og` image shows for a query string. Never throws. */
export function ogCardFromParams(params: URLSearchParams, now?: Date): OgCard {
  try {
    const view = sharedView(params, now);
    if (!view) return { kind: "brand" };
    return {
      kind: "place",
      label: placeLabel(view.place),
      viewpoint: viewpointLabel(view.settings.observer),
      summary: view.summary,
    };
  } catch {
    return { kind: "brand" };
  }
}

/**
 * Path + query of the preview image for a view: only what the card shows
 * (place, viewpoint, summary) — not the date, time or map layers, so that
 * links to the same spot share one cached image.
 */
export function ogImagePath(settings: Settings, summary: PlaceSummary | null): string {
  const params = settingsToSearchParams({
    ...settings,
    date: null,
    minuteOfDay: null,
    layers: DEFAULT_SETTINGS.layers,
  });
  const encoded = summary ? encodeSummaryParam(summary) : "";
  if (encoded !== "") params.set(SUMMARY_URL_KEY, encoded);
  params.set("v", OG_VERSION);
  return `/og?${params.toString()}`;
}

export interface ShareMetadata {
  title: string;
  description: string;
  /** Relative; resolved against `metadataBase`. */
  imagePath: string;
  imageAlt: string;
}

/**
 * Title, description and preview image for a link that pins a place; null for
 * a link that does not (the site's default metadata applies). Never throws.
 */
export function shareMetadataFromParams(params: URLSearchParams, now?: Date): ShareMetadata | null {
  try {
    const view = sharedView(params, now);
    if (!view) return null;
    const { settings, place, summary } = view;
    const name = truncate(shortPlaceName(place) ?? "This spot", 60);
    const viewpoint = viewpointLabel(settings.observer);
    const imagePath = ogImagePath(settings, summary);

    if (!summary) {
      return {
        title: `${name}: when does it get direct sun? · ${SITE_NAME}`,
        description:
          "See when this spot gets direct sun, hour by hour through the year, with the shade of nearby buildings and hills taken into account.",
        imagePath,
        imageAlt: `${name}: see when this spot gets direct sun.`,
      };
    }

    const percent = `${Math.round(summary.sunFraction * 100)}% of possible daylight`;
    if (!(summary.avgSunHoursPerDay > 0)) {
      return {
        title: `${name}: no direct sun · ${SITE_NAME}`,
        description: `No direct sun at any time of year (${viewpoint.toLowerCase()}). A clear-sky estimate from building and terrain data. Open the link for the full year.`,
        imagePath,
        imageAlt: `${name}: no direct sun at any time of year.`,
      };
    }
    const average = formatSunHours(summary.avgSunHoursPerDay);
    const range = bestWorstLine(summary, ", ");
    const answer = `${average} of direct sun on an average day${range ? ` (${range})` : ""}`;
    return {
      title: `${name}: ${average} of direct sun a day · ${SITE_NAME}`,
      description: `${answer}. ${percent}. A clear-sky estimate from building and terrain data. Open the link for the full year, hour by hour.`,
      imagePath,
      imageAlt: `${name}: ${answer}.`,
    };
  } catch {
    return null;
  }
}
