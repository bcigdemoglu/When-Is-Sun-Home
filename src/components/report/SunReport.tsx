import { Card } from "@/components/ui/Card";
import type { SunReportProps } from "./types";

/** Placeholder — replaced by the real report. Keeps the shell compiling. */
export function SunReport({ year }: SunReportProps) {
  return (
    <Card title="Sun report">
      <p className="text-sm text-ink-2">
        {year
          ? `${year.annual.avgSunHoursPerDay.toFixed(1)} h of direct sun per day`
          : "Computing…"}
      </p>
    </Card>
  );
}
