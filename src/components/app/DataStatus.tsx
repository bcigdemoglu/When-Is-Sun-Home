"use client";

import { Button } from "@/components/ui/Button";
import { WarningIcon } from "@/components/ui/icons";
import type { UseBuildingsResult } from "@/lib/buildings/useBuildings";

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded-full border-2 border-line border-t-accent motion-safe:animate-spin"
    />
  );
}

const count = (n: number) => n.toLocaleString("en-US");

interface DataStatusProps {
  buildings: Pick<UseBuildingsResult, "status" | "stats" | "error" | "isFetching" | "refetch">;
}

/**
 * Says where the shade in the numbers comes from — and, above all, when it is
 * missing: while buildings are loading or after they failed to load, every
 * figure describes an unobstructed sky. The ordinary states all take the same
 * two lines, so nothing below jumps when the data arrives.
 */
export function DataStatus({ buildings }: DataStatusProps) {
  const { status, stats, error, isFetching, refetch } = buildings;
  const frame = "flex min-h-10 items-center gap-2.5 text-[13px] leading-5";

  if (status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-danger p-3 text-sm text-ink"
      >
        <WarningIcon className="shrink-0 text-danger" />
        <p className="min-w-48 flex-1">
          <strong className="font-semibold">Building data couldn’t be loaded.</strong> The numbers
          below ignore every building and show unobstructed sun.
        </p>
        <Button variant="primary" onClick={refetch} disabled={isFetching}>
          {isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  if (status !== "ready" || !stats) {
    return (
      <div role="status" className={`${frame} text-ink`}>
        <Spinner />
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Loading nearby buildings…</strong> Until they arrive the
          numbers are provisional: they assume nothing blocks the sun.
        </p>
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div role="status" className={`${frame} text-ink`}>
        <WarningIcon className="shrink-0 text-ink-3" width={18} height={18} />
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">No buildings are mapped around this spot.</strong> The
          results assume an open sky.
        </p>
      </div>
    );
  }

  return (
    <div role="status" className={`${frame} text-ink-2`}>
      {isFetching ? (
        <Spinner />
      ) : (
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-state-blocked" />
      )}
      <p className="min-w-0 flex-1">
        Shade from{" "}
        <span className="font-medium text-ink">
          {count(stats.total)} nearby {stats.total === 1 ? "building" : "buildings"}
        </span>
        . Heights: {count(stats.tagged)} measured, {count(stats.levels)} from floor counts,{" "}
        {count(stats.default)} estimated.
        {error ? " The last refresh failed; showing saved data." : ""}
      </p>
    </div>
  );
}
