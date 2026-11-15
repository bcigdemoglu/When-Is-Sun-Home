/**
 * The one-line live status of the summary header: what the sun is doing at
 * the selected instant and when that changes next. Pure.
 */
import { SunState, type DayAnalysis, type SunInstant, type SunWindow } from "@/lib/types";

import { formatClock, formatDistance } from "./format";
import { isTerrainBlocker } from "./states";

export type StatusIcon = "sun" | "shade" | "hill" | "night" | "out";

export interface LiveStatus {
  icon: StatusIcon;
  text: string;
}

export interface LiveStatusInput {
  day: DayAnalysis;
  instant: SunInstant;
  minuteOfDay: number;
  /** True when the selected instant is "now"; otherwise the time is spelled out. */
  isLive: boolean;
  hour12: boolean;
  /**
   * Longest text that fits on the line. Longer wordings (the distance to the
   * building, "at") are dropped first; the shortest one is always allowed.
   */
  maxChars?: number;
}

const SEP = " · ";

function windowAt(windows: readonly SunWindow[], minute: number): SunWindow | null {
  return windows.find((w) => minute >= w.startMinute && minute < w.endMinute) ?? null;
}

function nextWindow(windows: readonly SunWindow[], minute: number): SunWindow | null {
  return windows.find((w) => w.startMinute > minute) ?? null;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Examples (live): "In sun now · until 4:10 PM",
 * "Shaded by a building 42 m away · sun returns 2:35 PM",
 * "Behind a hill · sun returns at 2:35 PM", "Sun is down · rises 6:54 AM",
 * "Outside this window’s view · sun returns 2:35 PM".
 * Not live: "At 3:40 PM: in sun · until 4:10 PM".
 */
export function describeLiveStatus(input: LiveStatusInput): LiveStatus {
  const { day, instant, minuteOfDay, isLive, hour12, maxChars = 46 } = input;
  const clock = (minute: number) => formatClock(minute, hour12);
  const prefix = isLive ? "" : `At ${clock(minuteOfDay)}: `;
  const today = isLive ? "today" : "that day";
  const nextDay = isLive ? "tomorrow" : "the next day";

  /** The first wording that fits, else the last (shortest) one. */
  const fit = (candidates: string[]): string => {
    const texts = candidates.map((text) => (isLive ? text : prefix + lowerFirst(text)));
    return texts.find((text) => text.length <= maxChars) ?? texts[texts.length - 1];
  };

  const upcoming = nextWindow(day.windows, minuteOfDay);
  const returns = upcoming
    ? [
        `sun returns ${clock(upcoming.startMinute)}`,
        `sun returns at ${clock(upcoming.startMinute)}`,
      ]
    : [`no more sun ${today}`, `no more sun ${today}`];

  switch (instant.state) {
    case SunState.Sun: {
      const head = isLive ? "In sun now" : "In sun";
      const current = windowAt(day.windows, minuteOfDay);
      if (!current) return { icon: "sun", text: fit([head]) };
      const allDay = current.startMinute <= 0 && current.endMinute >= 1440;
      const tail = allDay ? "all day" : `until ${clock(current.endMinute)}`;
      return { icon: "sun", text: fit([head + SEP + tail, head]) };
    }

    case SunState.Blocked: {
      const blocker = instant.blocker;
      const terrain =
        blocker !== undefined &&
        (blocker.kind ? blocker.kind === "terrain" : isTerrainBlocker(blocker.buildingIndex));
      const what = terrain ? "Behind a hill" : "Shaded by a building";
      const away =
        blocker && blocker.distanceM > 0 ? ` ${formatDistance(blocker.distanceM)} away` : "";
      return {
        icon: terrain ? "hill" : "shade",
        text: fit([
          what + away + SEP + returns[0],
          what + SEP + returns[1],
          what + SEP + returns[0],
          `In shade${SEP}${returns[1]}`,
          `In shade${SEP}${returns[0]}`,
        ]),
      };
    }

    case SunState.OutOfView: {
      const head = "Outside this window\u2019s view";
      return {
        icon: "out",
        text: fit([head + SEP + returns[0], `Outside the view${SEP}${returns[0]}`, head]),
      };
    }

    default: {
      const head = "Sun is down";
      const { sunriseMinute, sunsetMinute } = day;
      if (day.daylightMinutes === 0 || sunriseMinute === null) {
        // Polar night, or the sun never crosses the horizon on this date.
        const never = isLive ? "it does not rise today" : "it does not rise that day";
        return {
          icon: "night",
          text: fit(day.daylightMinutes === 0 ? [head + SEP + never, head] : [head]),
        };
      }
      if (minuteOfDay < sunriseMinute && (sunsetMinute === null || sunriseMinute < sunsetMinute)) {
        return { icon: "night", text: fit([`${head}${SEP}rises ${clock(sunriseMinute)}`, head]) };
      }
      // After sunset: the next sunrise is within a minute or two of this date's.
      return {
        icon: "night",
        text: fit([
          `${head}${SEP}up again around ${clock(sunriseMinute)}`,
          `${head}${SEP}rises ${nextDay}`,
          head,
        ]),
      };
    }
  }
}
