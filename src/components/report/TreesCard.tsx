"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { CanopyCover } from "@/components/map/canopySummary";
import type { TreeSurvey } from "@/components/map/trees";
import { addressLabel, parseStreetAddress } from "@/lib/trees/portland";
import type { StreetTreeSummary } from "@/lib/trees/metrics";
import type { Place } from "@/lib/types";

import { formatCount } from "./format";
import { SkeletonText } from "./parts";
import { REPORT_SECTION_IDS } from "./sections";
import {
  CANOPY_HEIGHT_LABELS,
  DIAMETER_CLASS_LABELS,
  NOT_IN_SUN_HOURS,
  OUTSIDE_OREGON_TEXT,
  OUTSIDE_PORTLAND_TEXT,
  PORTLAND_CANOPY,
  backyardUnavailableText,
  blockTitle,
  canopyDefinition,
  diversityLine,
  formatFeet,
  formatInches,
  formatInventoried,
  formatOffset,
  formatShare,
  formatSquareFeet,
  leafText,
  originText,
  sentenceCase,
  sidesText,
  siteText,
  treeHeightText,
  wiresText,
} from "./treesText";
import type { ListedTree, Loadable, TreeReport } from "./treesModel";
import { useTreeReport } from "./useTreeReport";

/** A block needs this many street trees before the 10-20-30 rule says anything. */
const DIVERSITY_MIN_TREES = 10;

/**
 * Has the section been scrolled into view (by the reader, or by its jump
 * tab) for this place? Nothing is fetched before: the section is lazy.
 */
function useOpened(placeKey: string) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Once opened, a place stays opened: scrolling away does not drop what came.
  if (visible && openedFor !== placeKey) setOpenedFor(placeKey);
  return { ref, opened: visible || openedFor === placeKey };
}

interface TreesCardProps {
  place: Place;
}

/**
 * The trees at a pinned address, in four separate parts — in front (on the
 * street), the backyard, this block, the area — from the City of Portland's
 * records and Oregon's laser survey. Information only: trees are never part
 * of the sun hours, which the card says once, at the bottom.
 */
export function TreesCard({ place }: TreesCardProps) {
  const headingId = useId();
  const placeKey = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  const { ref, opened } = useOpened(placeKey);
  const { report, survey, retry } = useTreeReport(place, opened);
  const { region } = report;

  return (
    <section
      ref={ref}
      id={REPORT_SECTION_IDS.trees}
      aria-labelledby={headingId}
      className="report-section rounded-[20px] border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-base/[22px] font-semibold text-ink">
        Trees
      </h2>
      {region === "elsewhere" ? (
        <p className="mt-1 text-[15px]/[22px] text-ink-2">{OUTSIDE_OREGON_TEXT}</p>
      ) : (
        <>
          <p className="mt-1 text-[15px]/[22px] text-ink-2">
            {region === "portland"
              ? "Street trees from the city's inventory, tree heights and canopy from the state's laser survey."
              : `Tree heights and canopy from the state's laser survey. ${OUTSIDE_PORTLAND_TEXT}`}
          </p>
          <FrontPart report={report} survey={survey} onRetry={retry} />
          <BackyardPart report={report} onRetry={retry} survey={survey} />
          <BlockPart report={report} onRetry={retry} survey={survey} />
          <AreaPart report={report} onRetry={retry} survey={survey} />
          <details className="group mt-4 border-t border-line pt-3 text-xs/4 text-ink-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-ink underline decoration-line underline-offset-4 [&::-webkit-details-marker]:hidden">
              What tree canopy cover means
            </summary>
            <p className="pb-1">{canopyDefinition(survey)}</p>
          </details>
        </>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs/4 text-ink-3">
        {NOT_IN_SUN_HOURS}
        {region !== "elsewhere" && (
          <>
            {" "}
            {region === "portland" && (
              <>
                Street trees: City of Portland, Parks &amp; Recreation Urban Forestry inventory
                (2022–2024). Heritage trees and neighborhoods: City of Portland. Lot lines: City of
                Portland / Metro RLIS taxlots.{" "}
              </>
            )}
            Tree heights: Oregon DOGAMI lidar{survey ? ` (${survey.year})` : ""}.
            {region === "portland" && (
              <>
                {" "}
                City-wide figure:{" "}
                <a
                  href={PORTLAND_CANOPY.url}
                  rel="noreferrer"
                  className="rounded-sm text-ink-2 underline decoration-line underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  City of Portland canopy update
                </a>
                .
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}

// ─── Parts ─────────────────────────────────────────────────────────────────

interface PartProps {
  report: TreeReport;
  survey: TreeSurvey | null;
  onRetry(): void;
}

function Part({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-4 border-t border-line pt-4">
      <h3 id={id} className="text-[15px]/[22px] font-semibold text-ink">
        {title}
      </h3>
      {caption && <p className="text-xs/4 text-ink-2">{caption}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** "Couldn't load …" with a way to try again; never louder than that. */
function Failed({ what, onRetry }: { what: string; onRetry(): void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[15px]/[22px] text-ink-2">
      Couldn{"’"}t load {what}.
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 cursor-pointer items-center rounded px-1 font-medium text-ink underline decoration-line underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
      >
        Try again
      </button>
    </p>
  );
}

function Waiting() {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      <SkeletonText width="70%" className="h-4" />
      <SkeletonText width="45%" className="h-4" />
    </div>
  );
}

/** The four states of a part's data, the ready one rendered by `children`. */
function Loaded<T>({
  value,
  what,
  onRetry,
  children,
}: {
  value: Loadable<T>;
  what: string;
  onRetry(): void;
  children: (value: T) => ReactNode;
}) {
  if (value.state === "loading") return <Waiting />;
  if (value.state === "error") return <Failed what={what} onRetry={onRetry} />;
  if (value.state === "none") return null;
  return <>{children(value.value)}</>;
}

/** Up to three figures side by side. */
function Figures({ items }: { items: { value: ReactNode; label: string }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-xl bg-surface-2 px-3 py-2">
          <dd className="truncate text-lg/6 font-semibold text-ink tabular-nums">{item.value}</dd>
          <dt className="text-xs/4 text-ink-2">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Label / value rows. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, value]) => value !== "" && value !== null && value !== undefined);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]/5">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-2">{label}</dt>
          <dd className="min-w-0 text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A bar of shares in tree-token colours, with its legend in words. */
function ShareBar({ label, parts }: { label: string; parts: { name: string; share: number }[] }) {
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${parts.map((part) => `${part.name} ${formatShare(part.share)}`).join(", ")}`}
        className="flex h-2.5 overflow-hidden rounded-[3px] bg-surface-2"
      >
        {parts.map((part, i) =>
          part.share > 0 ? (
            <span
              key={part.name}
              style={{
                width: `${part.share * 100}%`,
                backgroundColor: `var(--tree-${[2, 3, 5, 6][i] ?? 6})`,
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 text-xs/4 text-ink-2" aria-hidden="true">
        {parts.map((part, i) => (
          <li key={part.name} className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-[2px]"
              style={{ backgroundColor: `var(--tree-${[2, 3, 5, 6][i] ?? 6})` }}
            />
            {part.name} <span className="text-ink tabular-nums">{formatShare(part.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "53 ft W of the pin". */
const whereText = (distanceM: number, bearingDeg: number) => {
  const offset = formatOffset(distanceM, bearingDeg);
  return offset === "at the pin" ? offset : `${offset} of the pin`;
};

/** "1408 NE KNOTT ST" → "1408 NE Knott St". */
const heritageAddress = (text: string) => {
  const parsed = parseStreetAddress(text);
  return parsed ? addressLabel(parsed) : text;
};

const canopyValue = (cover: CanopyCover | null) =>
  cover && cover.cover !== null ? formatShare(cover.cover) : "–";

// ─── In front ──────────────────────────────────────────────────────────────

function TreeEntry({
  tree,
  survey,
  heading,
}: {
  tree: ListedTree;
  survey: TreeSurvey | null;
  heading?: string;
}) {
  const height = treeHeightText(tree.heightFt, survey);
  const facts: [string, string][] = [
    ["Trunk", tree.diameterIn !== null ? `${formatInches(tree.diameterIn)} across` : ""],
    ["Condition", tree.condition],
    ["Mature size", tree.matureSize],
    ["Leaves", leafText(tree.functionalType)],
    ["Wires above", wiresText(tree.wires)],
    ["Planted in", siteText(tree.siteType, tree.siteWidthFt)],
    ["Where", whereText(tree.distanceM, tree.bearingDeg)],
    ["Inventoried", formatInventoried(tree.inventoried)],
  ];
  const origin = originText(tree.scientific);
  return (
    <li className="rounded-xl bg-surface-2 p-3">
      {heading && <p className="mb-1 text-xs/4 font-medium text-ink-2">{heading}</p>}
      <p className="text-[15px]/[22px] font-semibold text-ink">{sentenceCase(tree.common)}</p>
      {tree.scientific && <p className="text-xs/4 text-ink-2 italic">{tree.scientific}</p>}
      {height && <p className="mt-1 text-[13px]/5 font-medium text-ink">{height}</p>}
      {origin && <p className="text-xs/4 text-ink-2">{origin}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {facts
          .filter(([, value]) => value !== "")
          .map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs/4 text-ink-2">{label}</dt>
              <dd className="text-[13px]/[18px] text-ink tabular-nums">{value}</dd>
            </div>
          ))}
      </dl>
    </li>
  );
}

function FrontPart({ report, survey, onRetry }: PartProps) {
  const { front, region } = report;
  return (
    <Part
      title="In front, on the street"
      caption={
        front.state === "ready" && front.value.address
          ? `Street trees recorded at ${addressLabel(front.value.address)}`
          : "Street trees in the public right-of-way"
      }
    >
      {region !== "portland" ? (
        <p className="text-[15px]/[22px] text-ink-2">{OUTSIDE_PORTLAND_TEXT}</p>
      ) : (
        <Loaded value={front} what="street trees" onRetry={onRetry}>
          {(section) =>
            section.trees.length > 0 ? (
              <>
                <ul className="flex flex-col gap-2">
                  {section.trees.map((tree) => (
                    <TreeEntry key={tree.id} tree={tree} survey={survey} />
                  ))}
                </ul>
                {section.count > section.trees.length && (
                  <p className="mt-2 text-xs/4 text-ink-2">
                    And {formatCount(section.count - section.trees.length)} more at this address.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[15px]/[22px] text-ink-2">
                  {section.address
                    ? "No street tree recorded in front of this address."
                    : "This spot has no street address, so no tree is “in front”."}
                </p>
                {section.nearest && (
                  <ul className="mt-2">
                    <TreeEntry
                      tree={section.nearest}
                      survey={survey}
                      heading={`Nearest street tree, ${formatOffset(section.nearest.distanceM, section.nearest.bearingDeg)}`}
                    />
                  </ul>
                )}
              </>
            )
          }
        </Loaded>
      )}
    </Part>
  );
}

// ─── Backyard ──────────────────────────────────────────────────────────────

function BackyardPart({ report, survey, onRetry }: PartProps) {
  const { backyard, region } = report;
  return (
    <Part
      title="Backyard"
      caption={`Laser survey${survey ? `, ${survey.year}` : ""}: private trees are not in the city's inventory`}
    >
      {region !== "portland" ? (
        <p className="text-[15px]/[22px] text-ink-2">
          Lot lines are only available in the City of Portland.
        </p>
      ) : (
        <Loaded value={backyard} what="the lot" onRetry={onRetry}>
          {({ canopy, lotSqFt }) => {
            if (!canopy) {
              return <p className="text-[15px]/[22px] text-ink-2">No lot found under the pin.</p>;
            }
            const yard = canopy.backyard;
            const lotLine = canopy.lot ? (
              <p className="mt-2 text-[13px]/5 text-ink-2">
                Whole lot{lotSqFt ? ` (${formatSquareFeet(lotSqFt)})` : ""}:{" "}
                <span className="text-ink">{canopyValue(canopy.lot)} canopy cover</span>
                {canopy.lot.tallestFt !== null && <>, tallest {formatFeet(canopy.lot.tallestFt)}</>}
              </p>
            ) : null;
            if (yard.kind === "unavailable") {
              return (
                <>
                  <p className="text-[15px]/[22px] text-ink-2">
                    {backyardUnavailableText(yard.reason)}
                  </p>
                  {lotLine}
                </>
              );
            }
            return (
              <>
                <Figures
                  items={[
                    { value: canopyValue(yard.cover), label: "canopy cover" },
                    {
                      value: yard.cover.tallestFt !== null ? formatFeet(yard.cover.tallestFt) : "–",
                      label: "tallest tree",
                    },
                    {
                      value: yard.crowns > 0 ? `≈ ${yard.crowns}` : "0",
                      label: yard.crowns === 1 ? "tree crown" : "tree crowns",
                    },
                  ]}
                />
                <p className="mt-2 text-[13px]/5 text-ink-2">
                  {[
                    sidesText(yard.sides),
                    `${formatSquareFeet(yard.yardSqFt)} of ground behind the house`,
                  ]
                    .filter((part) => part !== "")
                    .join(". ")}
                  . Includes branches reaching over from next door; crowns counted roughly, from the
                  tops of the canopy (20 ft and taller).
                </p>
                {lotLine}
              </>
            );
          }}
        </Loaded>
      )}
    </Part>
  );
}

// ─── This block ────────────────────────────────────────────────────────────

function StreetTreeFacts({
  summary,
  extra = [],
}: {
  summary: StreetTreeSummary;
  /** Rows that go first (the block's wires and planting sites). */
  extra?: [string, ReactNode][];
}) {
  const top = summary.species.slice(0, 3);
  const conditionText = summary.condition
    .map((entry) => `${formatCount(entry.count)} ${entry.name.toLowerCase()}`)
    .join(", ");
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ...extra,
          [
            "Species",
            top.length > 0 ? (
              <>
                {top.map((entry) => (
                  <span key={entry.name} className="block">
                    {sentenceCase(entry.common ?? entry.name)} {formatShare(entry.share)}
                  </span>
                ))}
              </>
            ) : (
              ""
            ),
          ],
          [
            "Trunks",
            summary.averageDiameterIn !== null && summary.largestDiameterIn !== null
              ? `average ${formatInches(summary.averageDiameterIn)}, largest ${formatInches(summary.largestDiameterIn)}`
              : "",
          ],
          [
            "Leaves",
            summary.deciduousShare !== null && summary.evergreenShare !== null
              ? `${formatShare(summary.deciduousShare)} deciduous, ${formatShare(summary.evergreenShare)} evergreen`
              : "",
          ],
          ["Large when grown", summary.largeShare !== null ? formatShare(summary.largeShare) : ""],
          ["Condition", conditionText],
        ]}
      />
      {summary.measured > 0 && (
        <ShareBar
          label="Trunk diameter"
          parts={DIAMETER_CLASS_LABELS.map((name, i) => ({
            name,
            share: summary.diameterClasses[i] / summary.measured,
          }))}
        />
      )}
    </div>
  );
}

function Diversity({ summary }: { summary: StreetTreeSummary }) {
  const { diversity } = summary;
  const levels = [
    ["Species", diversity.species, "10%"],
    ["Genus", diversity.genus, "20%"],
    ["Family", diversity.family, "30%"],
  ] as const;
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-[13px]/5 font-semibold text-ink">
        10-20-30 diversity rule: {diversity.pass ? "met" : "not met"}
      </p>
      <p className="text-xs/4 text-ink-2">
        No species over 10% of the trees, no genus over 20%, no family over 30%.
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-[13px]/5">
        {levels.map(([name, level, limit]) => (
          <li key={name} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 text-ink">{diversityLine(name, level)}</span>
            <span className="shrink-0 text-xs font-medium text-ink-2">
              {level.pass ? `within ${limit}` : `over ${limit}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockPart({ report, onRetry }: PartProps) {
  const { block, region } = report;
  return (
    <Part
      title="This block"
      caption={
        block.state === "ready" && block.value
          ? `${blockTitle(block.value.block)}, both sides of the street`
          : "Both sides of the street, the same hundred-block"
      }
    >
      {region !== "portland" ? (
        <p className="text-[15px]/[22px] text-ink-2">{OUTSIDE_PORTLAND_TEXT}</p>
      ) : (
        <Loaded value={block} what="this block's trees" onRetry={onRetry}>
          {(section) => {
            if (!section) {
              return (
                <p className="text-[15px]/[22px] text-ink-2">
                  No block to show: no street address here and no street tree nearby.
                </p>
              );
            }
            const lots = section.lotsCanopy;
            return (
              <div className="flex flex-col gap-3">
                <Figures
                  items={[
                    { value: formatCount(section.summary.total), label: "street trees" },
                    {
                      value:
                        lots.state === "ready" ? (
                          canopyValue(lots.value)
                        ) : lots.state === "loading" ? (
                          <SkeletonText width="2.5rem" />
                        ) : (
                          "–"
                        ),
                      label: "canopy over its lots",
                    },
                    {
                      value: section.tallestFt !== null ? formatFeet(section.tallestFt) : "–",
                      label: "tallest street tree",
                    },
                  ]}
                />
                {section.summary.total > 0 && (
                  <>
                    <StreetTreeFacts
                      summary={section.summary}
                      extra={[
                        [
                          "Under wires",
                          section.wires.known > 0
                            ? `${formatCount(section.wires.under)} of ${formatCount(section.wires.known)}`
                            : "",
                        ],
                        ["Planted in", siteText(section.sites.type ?? "", section.sites.widthFt)],
                      ]}
                    />
                    {section.summary.total >= DIVERSITY_MIN_TREES ? (
                      <Diversity summary={section.summary} />
                    ) : (
                      <p className="text-xs/4 text-ink-2">
                        Too few trees on one block for the 10-20-30 diversity rule; see the area
                        below.
                      </p>
                    )}
                  </>
                )}
                {section.lotCount > 0 && (
                  <p className="text-xs/4 text-ink-2">
                    Canopy over the {formatCount(section.lotCount)}{" "}
                    {section.lotCount === 1 ? "lot" : "lots"} of this block, buildings cut out.
                    Trees per 100 ft of street are not shown: the length of the block is not in the
                    records.
                  </p>
                )}
              </div>
            );
          }}
        </Loaded>
      )}
    </Part>
  );
}

// ─── The area ──────────────────────────────────────────────────────────────

function AreaPart({ report, onRetry }: PartProps) {
  const { area, region } = report;
  const canopy = area.canopy;
  const streetTrees = area.streetTrees;
  return (
    <Part title="The area" caption="About a quarter mile around the pin (1,300 ft)">
      <div className="flex flex-col gap-3">
        <Loaded value={canopy} what="the area's canopy" onRetry={onRetry}>
          {(cover) => (
            <div className="flex flex-col gap-3">
              <Figures
                items={[
                  { value: canopyValue(cover), label: "canopy cover" },
                  {
                    value:
                      streetTrees.state === "ready" ? (
                        formatCount(streetTrees.value.total)
                      ) : streetTrees.state === "loading" ? (
                        <SkeletonText width="2.5rem" />
                      ) : (
                        "–"
                      ),
                    label: "street trees",
                  },
                  {
                    value: cover.tallestFt !== null ? formatFeet(cover.tallestFt) : "–",
                    label: "tallest tree",
                  },
                ]}
              />
              {cover.heightShares && (
                <ShareBar
                  label="Canopy by height"
                  parts={CANOPY_HEIGHT_LABELS.map((name, i) => ({
                    name,
                    share: cover.heightShares?.[i] ?? 0,
                  }))}
                />
              )}
            </div>
          )}
        </Loaded>

        {region === "portland" && (
          <Loaded value={area.neighborhood} what="the neighborhood" onRetry={onRetry}>
            {(hood) =>
              hood && (
                <p className="text-[13px]/5 text-ink-2">
                  {hood.name}:{" "}
                  {hood.canopy.state === "ready" ? (
                    <span className="text-ink">{canopyValue(hood.canopy.value)} canopy cover</span>
                  ) : hood.canopy.state === "loading" ? (
                    <SkeletonText width="6rem" />
                  ) : hood.canopy.state === "none" ? (
                    "too large to measure here"
                  ) : (
                    "canopy cover could not be measured"
                  )}
                  . {PORTLAND_CANOPY.text}, by its own method.
                </p>
              )
            }
          </Loaded>
        )}

        {region === "portland" ? (
          <Loaded value={streetTrees} what="the area's street trees" onRetry={onRetry}>
            {(summary) =>
              summary.total > 0 ? (
                <>
                  <StreetTreeFacts summary={summary} />
                  <Diversity summary={summary} />
                </>
              ) : (
                <p className="text-[15px]/[22px] text-ink-2">No street trees recorded nearby.</p>
              )
            }
          </Loaded>
        ) : (
          <p className="text-[13px]/5 text-ink-2">{OUTSIDE_PORTLAND_TEXT}</p>
        )}

        {region === "portland" && (
          <Loaded value={area.heritage} what="heritage trees" onRetry={onRetry}>
            {(trees) => (
              <div>
                <p className="text-[13px]/5 font-semibold text-ink">Nearest Heritage Trees</p>
                {trees.length === 0 ? (
                  <p className="text-[13px]/5 text-ink-2">None within 1.5 miles.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1.5 text-[13px]/5">
                    {trees.map((tree) => (
                      <li key={`${tree.lat},${tree.lng}`}>
                        <span className="text-ink">{sentenceCase(tree.common)}</span>
                        {tree.scientific && (
                          <span className="text-ink-2 italic"> {tree.scientific}</span>
                        )}
                        <span className="block text-ink-2">
                          {[
                            formatOffset(tree.distanceM, tree.bearingDeg),
                            tree.heightFt ? `${formatFeet(tree.heightFt)} tall` : "",
                            tree.diameterIn ? `trunk ${formatInches(tree.diameterIn)}` : "",
                            heritageAddress(tree.address),
                            tree.yearDesignated ? `designated ${tree.yearDesignated}` : "",
                          ]
                            .filter((part) => part !== "")
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Loaded>
        )}
      </div>
    </Part>
  );
}
