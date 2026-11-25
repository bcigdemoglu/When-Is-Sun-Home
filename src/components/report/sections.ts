/**
 * The report's jump targets. Each id is the `id` of a section element the
 * report renders, in reading order — the shell can offer them as anchor tabs
 * (`document.getElementById(id)?.scrollIntoView()`); the report itself renders
 * no navigation.
 *
 * Sections honour `scroll-margin-top: var(--report-anchor-offset, 12px)`, so a
 * shell with a sticky header can set that custom property on any ancestor.
 */
export const REPORT_SECTION_IDS = {
  today: "report-today",
  year: "report-year",
  sunHours: "report-sun-hours",
  skyline: "report-skyline",
  trees: "report-trees",
  about: "report-about",
} as const;

export type ReportSectionId = (typeof REPORT_SECTION_IDS)[keyof typeof REPORT_SECTION_IDS];

export interface ReportSection {
  id: ReportSectionId;
  /** Short label for a tab. */
  label: string;
  /**
   * The section's name in a link: `/?…#trees` opens the report at that
   * section (see `sectionFromHash`). Lowercase, stable — shared links carry it.
   */
  slug: string;
}

export const REPORT_SECTIONS: readonly ReportSection[] = [
  // Sun hours first: how much sun, month by month, is what people come for.
  { id: REPORT_SECTION_IDS.sunHours, label: "Sun hours", slug: "sun-hours" },
  { id: REPORT_SECTION_IDS.today, label: "Today", slug: "today" },
  { id: REPORT_SECTION_IDS.year, label: "Year", slug: "year" },
  { id: REPORT_SECTION_IDS.skyline, label: "Skyline", slug: "skyline" },
  // Information only: trees are never part of the sun hours.
  { id: REPORT_SECTION_IDS.trees, label: "Trees", slug: "trees" },
  { id: REPORT_SECTION_IDS.about, label: "About", slug: "about" },
];

/**
 * The section a URL hash names (`"#trees"`, `"trees"`, `"#Sun-Hours"`), or
 * null for an empty or unknown hash. Case-insensitive; a leading `#` is optional.
 */
export function sectionFromHash(hash: string | null | undefined): ReportSection | null {
  if (typeof hash !== "string") return null;
  let slug = hash.trim().replace(/^#/, "");
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // a stray "%": compare it as it is
  }
  slug = slug.trim().toLowerCase();
  if (slug === "") return null;
  return REPORT_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/**
 * `href` with its hash replaced by `#slug`, or with no hash at all for null.
 * Works on absolute and relative links alike; everything before the hash is
 * left exactly as it was.
 */
export function withSectionHash(href: string, slug: string | null): string {
  const hashAt = href.indexOf("#");
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  return slug ? `${base}#${slug}` : base;
}
