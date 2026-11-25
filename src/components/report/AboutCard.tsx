import { useId, useState, type ReactNode } from "react";

import type { Observer } from "@/lib/types";

import { formatCount } from "./format";
import { Glyph, SectionTitle } from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import type { BuildingDataStatus, SunReportProps } from "./types";

type TerrainStatus = NonNullable<SunReportProps["terrain"]>;

interface AboutCardProps {
  buildings: BuildingDataStatus;
  terrain: TerrainStatus;
  /** Whether hills actually appear in the skyline. */
  hasTerrain: boolean;
  observer: Observer;
  pinOnBuilding: boolean;
  stepMinutes: number | null;
  /** IANA zone of the place, shown so the clock times are unambiguous. */
  timeZone: string;
}

/**
 * How many buildings were used and how their heights are known, worded so it
 * holds for both building sources:
 *  - "384 buildings nearby — 329 with a mapped height, 55 estimated from their neighbours"
 *  - "384 buildings nearby — 329 with a mapped height (8 of them from floor counts), 55 estimated"
 *
 * `tagged` and `levels` both mean the map data carries a height (vector tiles
 * cannot tell the two apart and report every one as `tagged`); `default` means
 * it carries none and the height was estimated.
 */
export function buildingStatsText(stats: NonNullable<BuildingDataStatus["stats"]>): string {
  if (stats.total === 0) return "No buildings found nearby";
  const noun = stats.total === 1 ? "building" : "buildings";
  const head = `${formatCount(stats.total)} ${noun} nearby`;
  const mapped = stats.tagged + stats.levels;
  if (stats.default === 0) return `${head}, all with a mapped height`;
  if (mapped === 0) return `${head}, all with an estimated height`;
  const floors =
    stats.levels > 0 ? ` (${formatCount(stats.levels)} of them from floor counts)` : "";
  // Without floor counts the data comes from map tiles, where a missing height
  // is filled in from the buildings around it.
  const estimated =
    stats.levels > 0
      ? `${formatCount(stats.default)} estimated`
      : `${formatCount(stats.default)} estimated from their neighbours`;
  return `${head} \u2014 ${formatCount(mapped)} with a mapped height${floors}, ${estimated}`;
}

/**
 * Trees are not in the numbers, anywhere. The one thing the app does know
 * about them is a picture: the map's Trees layer (see `trees.ts`).
 */
export const TREES_ABOUT_SENTENCE =
  "Never part of these numbers; in Oregon, the Trees switch under Viewpoint draws measured tree heights on the map.";

/** What the ground-height data means for the numbers, in one sentence. */
export function terrainText(terrain: TerrainStatus, hasTerrain: boolean): string {
  if (terrain === "ready" || hasTerrain) return "Hills and slopes around the spot are included.";
  if (terrain === "loading") {
    return "Ground heights are still loading; until they arrive flat ground is assumed.";
  }
  if (terrain === "error") {
    return "Ground heights could not be loaded, so flat ground is assumed and hills are not included.";
  }
  return "Flat ground is assumed: hills are not included.";
}

/**
 * A short, honest account of what the numbers are and what they leave out.
 * The gist is always visible; the detail opens on demand.
 */
export function AboutCard({
  buildings,
  terrain,
  hasTerrain,
  observer,
  pinOnBuilding,
  stepMinutes,
  timeZone,
}: AboutCardProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const regionId = useId();

  const buildingLine =
    buildings.status === "ready"
      ? buildings.stats
        ? `${buildingStatsText(buildings.stats)}.`
        : "Footprints and heights of the surrounding buildings are included."
      : buildings.status === "error"
        ? "Building data could not be loaded, so no buildings are included."
        : "Building data is still loading; until it arrives no buildings are included.";

  return (
    <section
      id={REPORT_SECTION_IDS.about}
      aria-labelledby={headingId}
      className="report-section rounded-[20px] border border-line bg-surface p-4"
    >
      <SectionTitle
        id={REPORT_SECTION_IDS.about}
        headingId={headingId}
        title="About these numbers"
      />
      <p className="mt-1 text-[15px]/[22px] text-ink-2">
        These are estimates from building and terrain height data. Trees, fences, clouds and new
        construction aren{"’"}t included, so real sun can be lower. Best used to compare places,
        then confirmed on a sunny day.
      </p>

      <button
        type="button"
        className="-mx-1 mt-1 flex min-h-11 cursor-pointer items-center gap-1 rounded px-1 text-[15px]/[22px] font-medium text-ink underline decoration-line underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide the details" : "How it is worked out"}
        <Glyph
          name="chevron"
          className={`text-ink-2 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div id={regionId} hidden={!open}>
        <ul className="flex list-disc flex-col gap-2 pt-1 pl-5 text-[13px]/5 text-ink-2 marker:text-ink-3">
          <li>
            <strong className="font-semibold text-ink">Clear-sky geometry.</strong> Where the sun
            is, and what stands in its way. Weather is not part of it.
          </li>
          <li>
            <strong className="font-semibold text-ink">Buildings from OpenStreetMap.</strong>{" "}
            {buildingLine} An estimated height can be off by a floor or two, which shifts shadow
            times.
          </li>
          <li>
            <strong className="font-semibold text-ink">Ground.</strong>{" "}
            {terrainText(terrain, hasTerrain)}
          </li>
          <li>
            <strong className="font-semibold text-ink">Trees.</strong> {TREES_ABOUT_SENTENCE}
          </li>
          <li>
            <strong className="font-semibold text-ink">One point, not the whole yard.</strong> The
            analysis is for the pinned spot
            {observer.mode === "window"
              ? `, ${formatHeight(observer.heightM)} above the ground, looking out of a window`
              : observer.heightM > 0
                ? `, ${formatHeight(observer.heightM)} above the ground`
                : " at ground level"}
            . A few metres away the answer can differ.
            {pinOnBuilding && " The pin sits on a building; that building itself is ignored."}
          </li>
          <li>
            Times are local clock times at this place ({timeZone.replace(/_/g, " ")})
            {stepMinutes ? `, sampled every ${stepMinutes} minutes across the year` : ""}.
          </li>
        </ul>
      </div>

      {/* Attribution the data sources require: always visible, not behind the toggle. */}
      <p className="mt-2 border-t border-line pt-3 text-xs/4 text-ink-3">
        Building data {"\u00a9"}{" "}
        <SourceLink href="https://www.openstreetmap.org/copyright">
          OpenStreetMap contributors
        </SourceLink>
        , via <SourceLink href="https://openmaptiles.org/">OpenMapTiles</SourceLink> /{" "}
        <SourceLink href="https://openfreemap.org/">OpenFreeMap</SourceLink>; terrain from
        Mapzen/AWS Terrain Tiles.
      </p>
    </section>
  );
}

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noreferrer"
      className="rounded-sm text-ink-2 underline decoration-line underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </a>
  );
}

function formatHeight(meters: number): string {
  return `${Math.round(meters * 10) / 10} m`;
}
