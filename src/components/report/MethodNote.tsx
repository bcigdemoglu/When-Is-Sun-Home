import { Card } from "@/components/ui/Card";
import type { HorizonProfile, Observer } from "@/lib/types";

import { buildingStatsText } from "./BuildingStatus";
import type { BuildingDataStatus } from "./types";

interface MethodNoteProps {
  buildings: BuildingDataStatus;
  observer: Observer;
  horizon: HorizonProfile | null;
  pinOnBuilding: boolean;
  stepMinutes: number | null;
}

/** A short, honest account of what the numbers mean and what they leave out. */
export function MethodNote({
  buildings,
  observer,
  horizon,
  pinOnBuilding,
  stepMinutes,
}: MethodNoteProps) {
  const hasTerrain = horizon !== null && horizon.blockerIndex.some((index) => index < -1);
  const buildingLine =
    buildings.status === "ready" && buildings.stats
      ? `${buildingStatsText(buildings.stats)}.`
      : buildings.status === "error"
        ? "Building data could not be loaded, so no buildings are included."
        : "Building data is still loading; until it arrives no buildings are included.";

  return (
    <Card title="About these numbers">
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-ink-2 marker:text-ink-3">
        <li>
          <strong className="font-semibold text-ink">Clear-sky geometry.</strong> This is where the
          sun is and what stands in its way. Clouds, fog and haze are not included, so real sunshine
          will be lower.
        </li>
        <li>
          <strong className="font-semibold text-ink">Buildings from OpenStreetMap.</strong>{" "}
          {buildingLine} Estimated heights can be off by a floor or two, which shifts shadow times.
        </li>
        <li>
          <strong className="font-semibold text-ink">Not modelled:</strong> trees, fences
          {hasTerrain ? "" : ", hills"} and anything built since the map was last updated.
          {hasTerrain && " Hills are included."}
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
          Times are local clock times at this place
          {stepMinutes ? `, sampled every ${stepMinutes} minutes across the year` : ""}.
        </li>
      </ul>
    </Card>
  );
}

function formatHeight(meters: number): string {
  return `${Math.round(meters * 10) / 10} m`;
}
