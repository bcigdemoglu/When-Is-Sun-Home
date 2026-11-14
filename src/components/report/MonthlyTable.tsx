import { formatClock, formatHours, formatPercent } from "./format";
import { useReport } from "./parts";
import type { MonthDetail } from "./summary";

/** The table twin of the year charts: one row of numbers per month. */
export function MonthlyTable({ year, details }: { year: number; details: MonthDetail[] }) {
  const { hour12 } = useReport();
  const clock = (minute: number | null) => (minute === null ? "—" : formatClock(minute, hour12));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[21rem] border-collapse text-left text-xs tabular-nums">
        <caption className="sr-only">
          Direct sun by month in {year}: average hours per day, share of daylight, and typical first
          and last time of direct sun
        </caption>
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Month
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Sun, h/day
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Daylight, h/day
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Share
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              First sun
            </th>
            <th scope="col" className="py-1.5 pl-2 text-right font-medium">
              Last sun
            </th>
          </tr>
        </thead>
        <tbody>
          {details.map((month) => (
            <tr key={month.month} className="border-b border-line/60 text-ink-2 last:border-b-0">
              <th scope="row" className="py-1.5 pr-2 font-medium text-ink">
                {month.longLabel}
              </th>
              <td className="px-2 py-1.5 text-right font-semibold text-ink">
                {formatHours(month.avgSunHours)}
              </td>
              <td className="px-2 py-1.5 text-right">{formatHours(month.avgDaylightHours)}</td>
              <td className="px-2 py-1.5 text-right">{formatPercent(month.sunFraction)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {clock(month.firstMinute)}
              </td>
              <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                {clock(month.lastMinute)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
