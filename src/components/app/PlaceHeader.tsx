"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  formatCoordinates,
  utcOffsetLabel,
  zoneAbbreviation,
  zoneCity,
} from "@/components/shared/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CheckIcon, ResetIcon, ShareIcon } from "@/components/ui/icons";
import { clearBuildingCache } from "@/lib/buildings/cache";
import type { Place } from "@/lib/types";
import { buildShareUrl, pickSettings, useSettings } from "@/state";
import { Brand } from "./Brand";

const COPIED_MS = 2200;

type ShareState = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; url: string };

/** Copies a link to exactly what is on screen; shows the link to copy by hand if it cannot. */
function useShareLink() {
  const [share, setShare] = useState<ShareState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const url = buildShareUrl(pickSettings(useSettings.getState()), window.location.href);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setShare({ kind: "copied" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShare({ kind: "idle" }), COPIED_MS);
    } catch {
      setShare({ kind: "manual", url });
    }
  };

  return { share, copy, dismiss: () => setShare({ kind: "idle" }) };
}

interface PlaceHeaderProps {
  place: Place;
  timeZone: string;
  /** The selected wall-clock date and minute, to name the zone as it is then. */
  date: string;
  minuteOfDay: number;
}

/** Which place this is, in which time zone, plus the share link and reset. */
export function PlaceHeader({ place, timeZone, date, minuteOfDay }: PlaceHeaderProps) {
  const queryClient = useQueryClient();
  const { share, copy, dismiss } = useShareLink();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const abbreviation = zoneAbbreviation(timeZone, date, minuteOfDay);
  const offset = utcOffsetLabel(timeZone, date, minuteOfDay);
  const zoneDetail = [abbreviation, offset].filter((part, index, all) => part && all.indexOf(part) === index);

  const reset = async () => {
    setConfirmingReset(false);
    useSettings.getState().reset({ keepPlace: true });
    await clearBuildingCache();
    // Fetch the buildings afresh rather than trusting what is in memory.
    void queryClient.invalidateQueries({ queryKey: ["buildings"] });
  };

  return (
    <Card>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
        <Brand />
        {confirmingReset ? (
          <div
            role="group"
            aria-label="Confirm reset"
            className="flex flex-wrap items-center gap-2"
            onKeyDown={(event) => {
              if (event.key === "Escape") setConfirmingReset(false);
            }}
          >
            <span className="text-sm text-ink-2">Reset date, viewpoint and saved map data?</span>
            <Button variant="primary" autoFocus onClick={reset}>
              Reset
            </Button>
            <Button onClick={() => setConfirmingReset(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={copy} aria-label="Copy a link to this view">
              {share.kind === "copied" ? (
                <CheckIcon width={18} height={18} />
              ) : (
                <ShareIcon width={18} height={18} />
              )}
              {share.kind === "copied" ? "Copied" : "Share"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingReset(true)}>
              <ResetIcon width={18} height={18} />
              Reset
            </Button>
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {share.kind === "copied" ? "Link copied to the clipboard" : ""}
      </p>

      {share.kind === "manual" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            readOnly
            aria-label="Link to this view. Copy it by hand."
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-ink"
            value={share.url}
            ref={(element) => {
              // Copying failed: at least hand over the link ready to copy.
              element?.focus();
              element?.select();
            }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button onClick={dismiss}>Done</Button>
        </div>
      )}

      <h2 className="mt-2 line-clamp-2 text-lg leading-snug font-semibold text-ink">
        {place.name ?? "Dropped pin"}
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        <span className="tabular-nums">{formatCoordinates(place.lat, place.lng)}</span>
        <span aria-hidden="true"> · </span>
        <span title={timeZone}>
          {zoneCity(timeZone)} time{zoneDetail.length > 0 ? ` (${zoneDetail.join(", ")})` : ""}
        </span>
      </p>
    </Card>
  );
}
