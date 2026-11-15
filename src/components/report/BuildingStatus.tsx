import { formatCount } from "./format";
import type { BuildingDataStatus } from "./types";

/** "412 buildings nearby — heights: 20 surveyed, 150 from floor counts, 242 estimated". */
export function buildingStatsText(stats: NonNullable<BuildingDataStatus["stats"]>): string {
  if (stats.total === 0) return "No buildings found nearby";
  const noun = stats.total === 1 ? "building" : "buildings";
  return `${formatCount(stats.total)} ${noun} nearby — heights: ${formatCount(stats.tagged)} surveyed, ${formatCount(stats.levels)} from floor counts, ${formatCount(stats.default)} estimated`;
}

/**
 * The state of the building data, always shown in the same slim strip at the
 * top of the report so that going from "loading" to "ready" moves nothing.
 * A failure gets a prominent alert with a retry button instead.
 */
export function BuildingStatus({
  buildings,
  pinOnBuilding,
}: {
  buildings: BuildingDataStatus;
  pinOnBuilding: boolean;
}) {
  if (buildings.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3"
      >
        <p className="min-w-0 flex-1 basis-56 text-sm text-ink">
          <strong className="font-semibold">Building data could not be loaded.</strong> The numbers
          below ignore buildings and assume an open sky, so real sun hours will be lower.
        </p>
        <button
          type="button"
          onClick={buildings.onRetry}
          className="shrink-0 cursor-pointer rounded-lg bg-ink px-3.5 py-1.5 text-sm font-semibold text-surface hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  const loading = buildings.status === "loading" || buildings.status === "idle";
  return (
    <div
      role="status"
      className="flex min-h-[50px] items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-2 text-xs text-ink-2 @lg:min-h-9"
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="size-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent"
          />
          <span>
            <strong className="font-semibold text-ink">Loading surrounding buildings</strong> {"—"}{" "}
            the numbers below assume an open sky for now.
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-state-blocked" />
          <span>
            {buildings.stats && buildings.stats.total > 0
              ? `Shadows from ${formatCount(buildings.stats.total)} nearby ${
                  buildings.stats.total === 1 ? "building" : "buildings"
                } are included.`
              : "No buildings were found nearby, so nothing blocks the sun here."}
            {pinOnBuilding && " The pin is on a building: that building itself is ignored."}
          </span>
        </>
      )}
    </div>
  );
}
