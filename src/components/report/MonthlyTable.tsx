import { formatClock, formatHours, formatPercent } from "./format";
import { useReport } from "./parts";
import type { MonthDetail } from "./summary";

/**
 * The table twin of the year charts: one row of numbers per month. Sized to
 * fit a phone-width card without scrolling sideways.
 */
export function MonthlyTable({ year, details }: { year: number; details: MonthDetail[] }) {
  const { hour12 } = useReport();
  const clock = (minute: number | null) => (minute === null ? "—" : formatClock(minute, hour12));
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs/4 tabular-nums">
        <caption className="sr-only">
          Direct sun by month in {year}: average hours per day, share of daylight, and typical first
          and last time of direct sun
        </caption>
        <thead>
          <tr className="border-b border-line align-bottom text-ink-2">
            <th scope="col" className="py-1.5 pr-1 font-medium">
              Month
            </th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">
              Sun
              <span className="block font-normal">h / day</span>
            </th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">
              Daylight
              <span className="block font-normal">h / day</span>
            </th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">
              Share
            </th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">
              First sun
            </th>
            <th scope="col" className="py-1.5 pl-1 text-right font-medium">
              Last sun
            </th>
          </tr>
        </thead>
        <tbody>
          {details.map((month) => (
            <tr key={month.month} className="border-b border-line/60 text-ink-2 last:border-b-0">
              <th scope="row" className="py-1.5 pr-1 font-medium text-ink">
                <span aria-hidden="true">{month.label}</span>
                <span className="sr-only">{month.longLabel}</span>
              </th>
              <td className="px-1 py-1.5 text-right font-semibold text-ink">
                {formatHours(month.avgSunHours)}
              </td>
              <td className="px-1 py-1.5 text-right">{formatHours(month.avgDaylightHours)}</td>
              <td className="px-1 py-1.5 text-right">{formatPercent(month.sunFraction)}</td>
              <td className="px-1 py-1.5 text-right whitespace-nowrap">
                {clock(month.firstMinute)}
              </td>
              <td className="py-1.5 pl-1 text-right whitespace-nowrap">
                {clock(month.lastMinute)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
