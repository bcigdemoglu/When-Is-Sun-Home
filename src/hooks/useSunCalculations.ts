import { useMemo } from "react";
import { getSunPosition, getSunTimes, computeArc } from "@/lib/sunPosition";
import type { Location, SunData } from "@/types/sun";

/** Key that only changes when the date (day) changes, not the time-of-day. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function useSunCalculations(
  location: Location | null,
  dateTime: Date
): SunData | null {
  // Arc only depends on location + date (not time-of-day).
  // This avoids recomputing 145 SunCalc calls on every animation tick.
  const dateKeyStr = dayKey(dateTime);
  const arc = useMemo(() => {
    if (!location) return null;
    return computeArc(location.lat, location.lng, dateTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng, dateKeyStr]);

  // Position + times are cheap — recalculate every tick
  return useMemo(() => {
    if (!location || !arc) return null;
    const { lat, lng } = location;
    return {
      position: getSunPosition(lat, lng, dateTime),
      times: getSunTimes(lat, lng, dateTime),
      arc,
    };
  }, [location, dateTime, arc]);
}
