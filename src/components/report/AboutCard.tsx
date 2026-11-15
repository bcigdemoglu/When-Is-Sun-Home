import { useId, useState } from "react";

import type { Observer } from "@/lib/types";

import { formatCount } from "./format";
import { Glyph } from "./parts";
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

/** "384 buildings nearby — heights: 321 surveyed, 8 from floor counts, 55 estimated". */
export function buildingStatsText(stats: NonNullable<BuildingDataStatus["stats"]>): string {
  if (stats.total === 0) return "No buildings found nearby";
  const noun = stats.total === 1 ? "building" : "buildings";
  return `${formatCount(stats.total)} ${noun} nearby — heights: ${formatCount(stats.tagged)} surveyed, ${formatCount(stats.levels)} from floor counts, ${formatCount(stats.default)} estimated`;
}

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
      <h2 id={headingId} className="text-base/[22px] font-semibold text-ink">
        About these numbers
      </h2>
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
            {buildingLine} Estimated heights can be off by a floor or two, which shifts shadow
            times.
          </li>
          <li>
            <strong className="font-semibold text-ink">Ground.</strong>{" "}
            {terrainText(terrain, hasTerrain)}
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
    </section>
  );
}

function formatHeight(meters: number): string {
  return `${Math.round(meters * 10) / 10} m`;
}
