/**
 * The verdict: one or two short sentences that say, in clock times and month
 * names, what kind of sun a spot gets. Pure — facts are measured from a
 * `YearAnalysis`, classified into a pattern, then worded.
 */
import { SunState, type ObserverMode, type YearAnalysis } from "@/lib/types";

import { formatClockApprox, formatHours, formatPercent, MONTHS_LONG } from "./format";
import { monthSpans } from "./heatmap";
import { hemisphereOf, median, monthDetails, type MonthDetail } from "./summary";

// ─── Facts ─────────────────────────────────────────────────────────────────

export interface MonthFacts {
  month: number;
  avgSunHours: number;
  avgDaylightHours: number;
  /** Typical (median) first and last direct sun, wall-clock minutes; null if never. */
  firstMinute: number | null;
  lastMinute: number | null;
  /** Typical first and last daylight (≈ sunrise / sunset); null in polar night. */
  dawnMinute: number | null;
  duskMinute: number | null;
}

export interface VerdictFacts {
  avgSunHours: number;
  /** Shares of the year's daylight: direct sun / behind something / outside the view. */
  sunFraction: number;
  blockedFraction: number;
  outOfViewFraction: number;
  /** Share of the direct sun that falls before the middle of the day's daylight. */
  morningShare: number;
  /** Typical first / last direct sun over all days that have any. */
  firstMinute: number | null;
  lastMinute: number | null;
  months: MonthFacts[];
  /** Months with the most / least direct sun per day (earliest wins a tie). */
  bestMonth: number;
  worstMonth: number;
}

/** Measure everything the verdict is based on. One pass over the year grid. */
export function verdictFacts(
  year: YearAnalysis,
  details: readonly MonthDetail[] = monthDetails(year),
): VerdictFacts {
  const { state, dayCount, slotsPerDay, stepMinutes } = year;
  const dawn: (number | null)[] = new Array(dayCount).fill(null);
  const dusk: (number | null)[] = new Array(dayCount).fill(null);
  let before = 0;
  let sun = 0;
  let blocked = 0;
  let out = 0;

  for (let day = 0; day < dayCount; day++) {
    const row = day * slotsPerDay;
    let first = -1;
    let last = -1;
    for (let slot = 0; slot < slotsPerDay; slot++) {
      if (state[row + slot] !== SunState.Night) {
        if (first < 0) first = slot;
        last = slot;
      }
    }
    if (first < 0) continue;
    dawn[day] = first * stepMinutes;
    dusk[day] = (last + 1) * stepMinutes;
    const middle = (first + last + 1) / 2;
    for (let slot = first; slot <= last; slot++) {
      const code = state[row + slot];
      if (code === SunState.Sun) {
        sun++;
        // A slot straddling the middle counts half towards the morning.
        if (slot + 0.5 < middle) before++;
        else if (slot + 0.5 === middle) before += 0.5;
      } else if (code === SunState.Blocked) blocked++;
      else if (code === SunState.OutOfView) out++;
    }
  }

  const daylight = sun + blocked + out;
  const spans = monthSpans(year.year);
  const months: MonthFacts[] = spans.map((span) => {
    const detail = details[span.month];
    const end = Math.min(dayCount, span.startDay + span.dayCount);
    const dawns: number[] = [];
    const dusks: number[] = [];
    for (let day = span.startDay; day < end; day++) {
      const a = dawn[day];
      const b = dusk[day];
      if (a !== null && b !== null) {
        dawns.push(a);
        dusks.push(b);
      }
    }
    return {
      month: span.month,
      avgSunHours: detail?.avgSunHours ?? 0,
      avgDaylightHours: detail?.avgDaylightHours ?? 0,
      firstMinute: detail?.firstMinute ?? null,
      lastMinute: detail?.lastMinute ?? null,
      dawnMinute: median(dawns),
      duskMinute: median(dusks),
    };
  });

  const firsts: number[] = [];
  const lasts: number[] = [];
  for (const day of year.days) {
    if (day.firstSunMinute !== null && day.lastSunMinute !== null) {
      firsts.push(day.firstSunMinute);
      lasts.push(day.lastSunMinute);
    }
  }

  let bestMonth = 0;
  let worstMonth = 0;
  for (const m of months) {
    if (m.avgSunHours > months[bestMonth].avgSunHours) bestMonth = m.month;
    if (m.avgSunHours < months[worstMonth].avgSunHours) worstMonth = m.month;
  }

  return {
    avgSunHours: year.annual.avgSunHoursPerDay,
    sunFraction: daylight > 0 ? sun / daylight : 0,
    blockedFraction: daylight > 0 ? blocked / daylight : 0,
    outOfViewFraction: daylight > 0 ? out / daylight : 0,
    morningShare: sun > 0 ? before / sun : 0.5,
    firstMinute: median(firsts),
    lastMinute: median(lasts),
    months,
    bestMonth,
    worstMonth,
  };
}

// ─── Classification ────────────────────────────────────────────────────────

/**
 * The pattern, checked in this order:
 *  - "none"          no direct sun at all (< 3 min a day on average)
 *  - "open"          nothing in the way: ≥ 97% of the daylight is direct sun
 *  - "mostly-shaded" < 2 h a day on average, or < 20% of the daylight
 *  - "seasonal"      a dark season (< 1 h a day in the worst month) and a
 *                    sunny one (≥ 3 h a day in the best)
 *  - "morning"       ≥ 66% of the sun comes before the middle of the day
 *  - "afternoon"     ≥ 66% comes after it
 *  - "bright"        at least 4 h a day even in the worst month
 *  - "part-day"      everything else
 */
export type VerdictKind =
  "none" | "open" | "mostly-shaded" | "seasonal" | "morning" | "afternoon" | "bright" | "part-day";

export function classifyVerdict(facts: VerdictFacts): VerdictKind {
  const best = facts.months[facts.bestMonth]?.avgSunHours ?? 0;
  const worst = facts.months[facts.worstMonth]?.avgSunHours ?? 0;
  if (facts.avgSunHours < 0.05) return "none";
  if (facts.sunFraction >= 0.97) return "open";
  if (facts.avgSunHours < 2 || facts.sunFraction < 0.2) return "mostly-shaded";
  if (worst < 1 && best >= 3) return "seasonal";
  if (facts.morningShare >= 0.66) return "morning";
  if (facts.morningShare <= 0.34) return "afternoon";
  if (worst >= 4) return "bright";
  return "part-day";
}

// ─── Wording ───────────────────────────────────────────────────────────────

/**
 * A set of months as a phrase: "all year", "in June", "in June and July",
 * "from April to September" (the longest run, wrapping over New Year:
 * "from November to January"). Empty set → "".
 */
export function monthRangePhrase(months: readonly number[]): string {
  const set = new Set(months);
  if (set.size === 0) return "";
  if (set.size === 12) return "all year";
  // Longest circular run of consecutive months.
  let bestStart = 0;
  let bestLength = 0;
  for (let start = 0; start < 12; start++) {
    if (!set.has(start) || set.has((start + 11) % 12)) continue;
    let length = 0;
    while (set.has((start + length) % 12)) length++;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  const first = MONTHS_LONG[bestStart];
  const last = MONTHS_LONG[(bestStart + bestLength - 1) % 12];
  if (bestLength === 1) return `in ${first}`;
  if (bestLength === 2) return `in ${first} and ${last}`;
  return `from ${first} to ${last}`;
}

export interface VerdictOptions {
  /** Latitude of the place: which solstice month is summer. */
  lat: number;
  mode: ObserverMode;
  hour12: boolean;
  /** Whether hills are part of the skyline (they are then named as blockers). */
  hasTerrain?: boolean;
}

export interface Verdict {
  kind: VerdictKind;
  /** One or two short sentences. */
  sentences: string[];
  text: string;
}

/** Sunrise / sunset count as reached when direct sun comes within this of them. */
const HORIZON_SLACK_MINUTES = 25;
/** Below this share of the first-to-last span, the sun comes "on and off". */
const PATCHY_COVERAGE = 0.7;

interface SunSpan {
  /** Full wording: "from about 9 AM to 6:30 PM", "from sunrise to about 1 PM", "around the clock". */
  full: string;
  /** Bare wording for a second clause, when both ends are plain clock times: "9:30 AM to 1:30 PM". */
  bare: string | null;
}

/** When a month typically has direct sun, or null if it has none. */
function sunSpan(m: MonthFacts, hour12: boolean): SunSpan | null {
  if (m.firstMinute === null || m.lastMinute === null || m.avgSunHours < 0.05) return null;
  if (m.firstMinute <= 0 && m.lastMinute >= 1440) return { full: "around the clock", bare: null };
  const atDawn = m.dawnMinute !== null && m.firstMinute - m.dawnMinute <= HORIZON_SLACK_MINUTES;
  const atDusk = m.duskMinute !== null && m.duskMinute - m.lastMinute <= HORIZON_SLACK_MINUTES;
  const first = formatClockApprox(m.firstMinute, hour12);
  const last = formatClockApprox(m.lastMinute, hour12);
  const span = m.lastMinute - m.firstMinute;
  const patchy = span > 0 && (m.avgSunHours * 60) / span < PATCHY_COVERAGE;
  if (patchy) {
    const from = atDawn ? "sunrise" : `about ${first}`;
    const to = atDusk ? "sunset" : atDawn ? `about ${last}` : last;
    return { full: `on and off between ${from} and ${to}`, bare: null };
  }
  if (atDawn && atDusk) return { full: "from sunrise to sunset", bare: null };
  if (atDawn) return { full: `from sunrise to about ${last}`, bare: null };
  if (atDusk) return { full: `from about ${first} to sunset`, bare: null };
  return { full: `from about ${first} to ${last}`, bare: `${first} to ${last}` };
}

/** The two solstice months, summer first, for a latitude. */
function solsticeMonths(lat: number): [number, number] {
  return hemisphereOf(lat) === "north" ? [5, 11] : [11, 5];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * When the sun reaches the spot in the two solstice months, summer first:
 * "Direct sun from about 9 AM to 6:30 PM in June, and 9:30 AM to 1:30 PM in
 * December." With an empty `subject` the sentence starts at "From about…".
 */
function timesSentence(facts: VerdictFacts, options: VerdictOptions, subject: string): string {
  const [summer, winter] = solsticeMonths(options.lat);
  const a = sunSpan(facts.months[summer], options.hour12);
  const b = sunSpan(facts.months[winter], options.hour12);
  const inSummer = `in ${MONTHS_LONG[summer]}`;
  const inWinter = `in ${MONTHS_LONG[winter]}`;
  let body: string;
  if (a && b) {
    body =
      a.full === b.full
        ? `${a.full}, all year`
        : `${a.full} ${inSummer}, and ${b.bare ?? b.full} ${inWinter}`;
  } else if (a) body = `${a.full} ${inSummer}, and none ${inWinter}`;
  else if (b) body = `${b.full} ${inWinter}, and none ${inSummer}`;
  else body = `only outside ${MONTHS_LONG[summer]} and ${MONTHS_LONG[winter]}`;
  return subject ? `${subject} ${body}.` : `${capitalize(body)}.`;
}

/** "The sun does not set in June and July, and does not rise in December." or null. */
function polarSentence(facts: VerdictFacts): string | null {
  const noSet = facts.months.filter((m) => m.avgDaylightHours >= 23).map((m) => m.month);
  const noRise = facts.months.filter((m) => m.avgDaylightHours <= 0.5).map((m) => m.month);
  const parts: string[] = [];
  if (noSet.length) parts.push(`does not set ${monthRangePhrase(noSet)}`);
  if (noRise.length) parts.push(`does not rise ${monthRangePhrase(noRise)}`);
  return parts.length ? `The sun ${parts.join(", and ")}.` : null;
}

function extremesSentence(facts: VerdictFacts): string {
  const best = facts.months[facts.bestMonth];
  const worst = facts.months[facts.worstMonth];
  if (best.avgSunHours - worst.avgSunHours < 0.5) {
    return `About ${formatHours(best.avgSunHours)} h a day in every month.`;
  }
  return `${formatHours(best.avgSunHours)} h a day in ${MONTHS_LONG[best.month]}, ${formatHours(
    worst.avgSunHours,
  )} h in ${MONTHS_LONG[worst.month]}.`;
}

/** Classify and word the verdict. */
export function composeVerdict(facts: VerdictFacts, options: VerdictOptions): Verdict {
  const kind = classifyVerdict(facts);
  const window = options.mode === "window";
  const noun = window ? "window" : "spot";
  const blockers = options.hasTerrain ? "Buildings and hills" : "Buildings";
  const best = facts.months[facts.bestMonth];
  const worst = facts.months[facts.worstMonth];
  const polar = polarSentence(facts);
  const sentences: string[] = [];

  switch (kind) {
    case "none":
      if (window && facts.outOfViewFraction >= 0.5) {
        sentences.push(
          "This window gets no direct sun at any time of year.",
          "The sun never comes into its view.",
        );
      } else {
        sentences.push(
          window
            ? "This window gets no direct sun at any time of year."
            : "No direct sun at any time of year.",
          `${blockers} hide the sun whenever it is up.`,
        );
      }
      break;

    case "open":
      sentences.push("Open sky: direct sun whenever the sun is up, all year.");
      sentences.push(polar ?? extremesSentence(facts));
      break;

    case "mostly-shaded": {
      const sunny = facts.months
        .filter((m) => m.avgSunHours >= Math.max(0.25, best.avgSunHours * 0.5))
        .map((m) => m.month);
      const when = monthRangePhrase(sunny);
      const span = sunSpan(best, options.hour12)?.full;
      sentences.push(window ? "This window is mostly out of the sun." : "Mostly shaded.");
      if (span) {
        const range = when === "all year" || when === "" ? "" : `, ${when}`;
        sentences.push(`Direct sun only ${span}${range}.`);
      }
      break;
    }

    case "seasonal": {
      const sunny = facts.months
        .filter((m) => m.avgSunHours >= best.avgSunHours * 0.5)
        .map((m) => m.month);
      const dark = facts.months.filter((m) => m.avgSunHours < 0.5).map((m) => m.month);
      const peak = `up to ${formatHours(best.avgSunHours)} h a day in ${MONTHS_LONG[best.month]}`;
      sentences.push(
        window
          ? `This window gets direct sun ${monthRangePhrase(sunny)}: ${peak}.`
          : `Sunny ${monthRangePhrase(sunny)}: ${peak}.`,
      );
      sentences.push(
        dark.length
          ? `Almost none ${monthRangePhrase(dark)}.`
          : `Only ${formatHours(worst.avgSunHours)} h a day in ${MONTHS_LONG[worst.month]}.`,
      );
      break;
    }

    case "morning":
    case "afternoon": {
      const morning = kind === "morning";
      const edge = morning ? facts.lastMinute : facts.firstMinute;
      const time = edge === null ? "" : formatClockApprox(edge, options.hour12);
      sentences.push(
        morning
          ? `A morning-sun ${noun}: direct sun until about ${time} most of the year, shade after.`
          : `An afternoon-sun ${noun}: direct sun from about ${time} most of the year, shade before.`,
      );
      if (best.avgSunHours - worst.avgSunHours >= 2) sentences.push(extremesSentence(facts));
      break;
    }

    case "bright":
      sentences.push(
        `Bright all year: at least ${formatHours(worst.avgSunHours)} h of direct sun a day, even in ${
          MONTHS_LONG[worst.month]
        }.`,
        timesSentence(facts, options, ""),
      );
      break;

    default:
      sentences.push(
        timesSentence(facts, options, window ? "This window gets direct sun" : "Direct sun"),
      );
      if (window && facts.outOfViewFraction >= 0.25) {
        sentences.push(
          `For ${formatPercent(facts.outOfViewFraction)} of the daylight the sun is outside its view.`,
        );
      } else if (facts.blockedFraction >= 0.25) {
        sentences.push(`${blockers} take ${formatPercent(facts.blockedFraction)} of the daylight.`);
      }
      break;
  }

  // Polar night is worth saying whatever the pattern.
  if (polar && kind !== "open" && kind !== "none" && sentences.length < 2) sentences.push(polar);

  return { kind, sentences, text: sentences.join(" ") };
}

/** Facts → verdict in one call. */
export function buildVerdict(
  year: YearAnalysis,
  options: VerdictOptions,
  details?: readonly MonthDetail[],
): Verdict {
  return composeVerdict(verdictFacts(year, details), options);
}
