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
  about: "report-about",
} as const;

export type ReportSectionId = (typeof REPORT_SECTION_IDS)[keyof typeof REPORT_SECTION_IDS];

export interface ReportSection {
  id: ReportSectionId;
  /** Short label for a tab. */
  label: string;
}

export const REPORT_SECTIONS: readonly ReportSection[] = [
  { id: REPORT_SECTION_IDS.today, label: "Today" },
  { id: REPORT_SECTION_IDS.year, label: "Year" },
  { id: REPORT_SECTION_IDS.sunHours, label: "Sun hours" },
  { id: REPORT_SECTION_IDS.skyline, label: "Skyline" },
  { id: REPORT_SECTION_IDS.about, label: "About" },
];
