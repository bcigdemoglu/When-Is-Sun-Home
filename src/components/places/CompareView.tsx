"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { PlaceEntry } from "@/state/places";
import { entryLabel } from "@/state/places";
import { MonthBars } from "./MonthBars";
import {
  MONTH_INITIALS,
  commonMonthlyMax,
  formatHoursUnit,
  formatShare,
  monthHours,
  monthValue,
  seasonAverages,
  viewpointLabel,
} from "./format";
import { ChevronLeftIcon, StarIcon } from "./icons";

/** Most places that can be compared side by side. */
export const MAX_COMPARED = 4;

interface CompareViewProps {
  /** Two to four saved places, in the order of the list. */
  entries: readonly PlaceEntry[];
  currentMonth: number | null;
  onBack: () => void;
  onOpen: (entry: PlaceEntry) => void;
}

/**
 * Indexes of the best (largest) values in a row. Nothing is "best" when
 * fewer than two places have a number, or when they all have the same one.
 */
export function bestIndexes(values: readonly (number | null)[]): Set<number> {
  const known = values.filter((value): value is number => value !== null);
  const best = new Set<number>();
  if (known.length < 2) return best;
  const max = Math.max(...known);
  if (known.every((value) => value === max)) return best;
  values.forEach((value, index) => {
    if (value === max) best.add(index);
  });
  return best;
}

/**
 * Column width on narrow containers: two places share the width; with three
 * or four, about 2.3 columns show, so the next one peeks in and invites a
 * swipe — until the container is wide enough to fit them all.
 */
const COLUMN_WIDTH: Record<number, string> = {
  2: "[--col:calc(100cqw/2)]",
  3: "[--col:calc(100cqw/2.3)] @sm:[--col:calc(100cqw/3)]",
  4: "[--col:calc(100cqw/2.3)] @lg:[--col:calc(100cqw/4)]",
};

/** Narrow: one column per place. Wide: a first column of row labels, too. */
const GRID =
  "grid w-max min-w-full grid-cols-[repeat(var(--n),var(--col))] @2xl:w-full @2xl:grid-cols-[10rem_repeat(var(--n),minmax(0,1fr))]";

interface NumericRow {
  kind: "number";
  label: string;
  values: (number | null)[];
  format: (value: number, index: number) => string;
  /** Small print under a value (e.g. which months "summer" is there). */
  caption?: (index: number) => string | null;
}

interface TextRow {
  kind: "text";
  label: string;
  cells: (ReactNode | null)[];
}

const EMPTY = (
  <span className="text-ink-3" aria-label="Not known yet">
    —
  </span>
);

/**
 * Saved places side by side. On a narrow container the columns scroll
 * sideways under a header that stays put; on a wide one it is a table with
 * the row labels in a first column. One DOM for both — the layout follows
 * the width of the container, not of the window.
 */
export function CompareView({ entries, currentMonth, onBack, onOpen }: CompareViewProps) {
  const headRef = useRef<HTMLDivElement>(null);
  const count = entries.length;
  const summaries = entries.map((entry) => entry.summary);
  const seasons = entries.map((entry) =>
    entry.summary ? seasonAverages(entry.summary, entry.place.lat) : null,
  );
  // One scale for every chart, so the shapes can be compared.
  const max = commonMonthlyMax(summaries);

  const hemispheres = new Set(entries.map((entry) => (entry.place.lat < 0 ? "south" : "north")));
  const mixed = hemispheres.size > 1;
  const south = !mixed && hemispheres.has("south");
  const summerMonths = south ? "Dec–Feb" : "Jun–Aug";
  const winterMonths = south ? "Jun–Aug" : "Dec–Feb";

  const rows: (NumericRow | TextRow)[] = [
    {
      kind: "number",
      label: "Average day",
      values: summaries.map((summary) => summary?.avgSunHoursPerDay ?? null),
      format: formatHoursUnit,
    },
    {
      kind: "number",
      label: "Share of daylight",
      values: summaries.map((summary) => summary?.sunFraction ?? null),
      format: formatShare,
    },
    {
      kind: "number",
      label: "Sunniest month",
      values: summaries.map((summary) => (summary ? monthHours(summary, "best") : null)),
      format: (_, index) => monthValue(summaries[index]!, "best"),
    },
    {
      kind: "number",
      label: "Least sun",
      values: summaries.map((summary) => (summary ? monthHours(summary, "least") : null)),
      format: (_, index) => monthValue(summaries[index]!, "least"),
    },
    {
      kind: "number",
      label: mixed ? "Summer average" : `Summer average (${summerMonths})`,
      values: seasons.map((season) => season?.summer ?? null),
      format: formatHoursUnit,
      caption: (index) => (mixed ? (seasons[index]?.summerMonths ?? null) : null),
    },
    {
      kind: "number",
      label: mixed ? "Winter average" : `Winter average (${winterMonths})`,
      values: seasons.map((season) => season?.winter ?? null),
      format: formatHoursUnit,
      caption: (index) => (mixed ? (seasons[index]?.winterMonths ?? null) : null),
    },
    {
      kind: "text",
      label: "Through the year",
      cells: entries.map((entry) =>
        entry.summary ? (
          <div key={entry.id}>
            <MonthBars
              stretch
              values={entry.summary.monthlySunHours}
              max={max}
              currentMonth={currentMonth}
              height={48}
            />
            <div
              aria-hidden="true"
              className="mt-1 grid grid-cols-12 text-center text-[9px] leading-[12px] font-medium text-ink-3"
            >
              {MONTH_INITIALS.map((initial, month) => (
                <span key={month}>{initial}</span>
              ))}
            </div>
          </div>
        ) : (
          <p key={entry.id} className="text-[12px] leading-[16px] text-ink-3">
            No numbers yet. Open this place once to work them out.
          </p>
        ),
      ),
    },
    {
      kind: "text",
      label: "Viewpoint",
      cells: entries.map((entry) => viewpointLabel(entry.observer)),
    },
    {
      kind: "text",
      label: "Note",
      cells: entries.map((entry) => entry.note ?? null),
    },
  ];

  const gridStyle = { "--n": count } as CSSProperties;
  const gridClass = `${GRID} ${COLUMN_WIDTH[count] ?? COLUMN_WIDTH[4]}`;

  return (
    <section
      aria-label={`Compare ${count} places`}
      className="overflow-clip rounded-card border border-line bg-surface"
    >
      <div className="flex h-13 items-center gap-1 border-b border-line pr-4 pl-1">
        <button
          type="button"
          aria-label="Back to saved places"
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink"
          onClick={onBack}
        >
          <ChevronLeftIcon width={22} height={22} />
        </button>
        <h2 className="text-[17px] leading-[22px] font-semibold">Compare {count} places</h2>
      </div>

      <div role="table" aria-label="Sun at the places you picked" className="@container">
        <div
          ref={headRef}
          role="rowgroup"
          className="sticky top-[var(--places-sticky-top,0px)] z-10 overflow-hidden border-b border-line bg-surface"
        >
          <div role="row" className={gridClass} style={gridStyle}>
            <div role="columnheader" className="hidden @2xl:block">
              <span className="sr-only">Measure</span>
            </div>
            {entries.map((entry) => (
              <div
                key={entry.id}
                role="columnheader"
                title={entryLabel(entry)}
                className="flex min-h-14 items-center px-3 py-2"
              >
                <span className="line-clamp-2 text-[14px] leading-[18px] font-semibold break-words">
                  {entryLabel(entry)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          role="rowgroup"
          className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
          onScroll={(event) => {
            // The header is a separate strip (so it can stay put vertically): keep it aligned.
            if (headRef.current) headRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        >
          <div className={gridClass} style={gridStyle}>
            {rows.map((row, rowIndex) => {
              const best = row.kind === "number" ? bestIndexes(row.values) : null;
              const divider = rowIndex === 0 ? "" : "border-t border-line";
              return (
                <div key={row.label} role="row" className="contents">
                  <div
                    role="rowheader"
                    className={`col-span-full px-3 pt-3 text-[12px] leading-[16px] font-medium text-ink-2 @2xl:sticky @2xl:left-0 @2xl:z-[1] @2xl:col-span-1 @2xl:bg-surface @2xl:py-3 ${divider}`}
                  >
                    <span className="sticky left-3 inline-block">{row.label}</span>
                  </div>
                  {entries.map((entry, index) => {
                    let content: ReactNode;
                    if (row.kind === "number") {
                      const value = row.values[index];
                      const caption = row.caption?.(index) ?? null;
                      content =
                        value === null ? (
                          EMPTY
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 text-[17px] leading-[22px] font-semibold whitespace-nowrap tabular-nums">
                              {row.format(value, index)}
                              {best?.has(index) && (
                                <>
                                  <StarIcon width={14} height={14} className="text-accent" />
                                  <span className="sr-only">(best)</span>
                                </>
                              )}
                            </span>
                            {caption && (
                              <span className="block text-[11px] leading-[14px] text-ink-3">
                                {caption}
                              </span>
                            )}
                          </>
                        );
                    } else {
                      const cell = row.cells[index];
                      content =
                        cell === null ? (
                          EMPTY
                        ) : typeof cell === "string" ? (
                          <span className="block text-[13px] leading-[18px] break-words text-ink-2">
                            {cell}
                          </span>
                        ) : (
                          cell
                        );
                    }
                    return (
                      <div
                        key={entry.id}
                        role="cell"
                        className={`min-w-0 snap-start px-3 pt-1 pb-3 @2xl:py-3 ${
                          divider ? "@2xl:border-t @2xl:border-line" : ""
                        }`}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div role="row" className="contents">
              <div
                role="rowheader"
                className="col-span-full border-t border-line @2xl:col-span-1"
              >
                <span className="sr-only">Open</span>
              </div>
              {entries.map((entry) => (
                <div key={entry.id} role="cell" className="snap-start px-3 py-3 @2xl:border-t @2xl:border-line">
                  <button
                    type="button"
                    aria-label={`Open ${entryLabel(entry)}`}
                    className="h-11 w-full rounded-full border border-line text-[14px] leading-[18px] font-medium text-ink hover:bg-surface-2"
                    onClick={() => onOpen(entry)}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
