"use client";

import type { MouseEvent, ReactNode } from "react";
import { formatHours } from "@/components/places/format";
import {
  ClockIcon,
  CloseIcon,
  CoordinatesIcon,
  HeartIcon,
  LocationArrowIcon,
  MapPinPlusIcon,
  PinIcon,
  SpinnerIcon,
} from "@/components/places/icons";
import type { GeolocationState } from "@/hooks/useGeolocation";
import { entryAddress, entryLabel, type PlaceEntry } from "@/state/places";
import {
  highlightParts,
  type SearchRow,
  type SearchSection,
  type SuggestionsState,
} from "./rows";

export interface SearchResultsProps {
  listId: string;
  sections: readonly SearchSection[];
  /** What was typed (trimmed); marks the matching parts of each row in bold. */
  query: string;
  activeKey: string | null;
  /** DOM id of the option for a row key (for `aria-activedescendant`). */
  optionId: (key: string) => string;
  geo: GeolocationState;
  suggestions: SuggestionsState;
  /** The address rows belong to an earlier query (still loading the new one). */
  stale: boolean;
  onActivate: (row: SearchRow) => void;
  onHover?: (key: string) => void;
  onRemoveRecent: (entry: PlaceEntry) => void;
  onClearRecents: () => void;
  onRetry: () => void;
}

/** What the "use my location" row says under its title. */
export function locationSubtitle(geo: GeolocationState): { text: string; problem: boolean } {
  if (geo.status === "locating") return { text: "Finding you…", problem: false };
  if (geo.status === "error") {
    switch (geo.problem) {
      case "denied":
        return {
          text: "Location is off for this site — allow it in your browser’s site settings, then try again",
          problem: true,
        };
      case "timeout":
        return { text: "That took too long — tap to try again", problem: true };
      case "unavailable":
        return { text: "Couldn’t find you just now — tap to try again", problem: true };
      default:
        return {
          text: "This browser can’t share its location — search or choose on the map",
          problem: true,
        };
    }
  }
  return { text: "Find the spot you’re standing on", problem: false };
}

/** Keeps focus (and the on-screen keyboard) in the text field while a row is pressed. */
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

/** `text` with the typed parts in bold; with nothing typed, plain (or medium for titles). */
function Marked({ text, query, title = false }: { text: string; query: string; title?: boolean }) {
  if (query === "") return <span className={title ? "font-medium" : undefined}>{text}</span>;
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <span key={index} className="font-semibold">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function RowIcon({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={`grid size-10 shrink-0 place-items-center rounded-full border border-line ${
        accent ? "text-accent" : "text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

interface OptionProps {
  id: string;
  /** What a screen reader calls the row: its lines, read as one phrase. */
  name: string;
  active: boolean;
  icon: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  /** Right-aligned value (the place's average sun hours). */
  metric?: string | null;
  metricLabel?: string;
  busy?: boolean;
  /** Reserve room on the right so values line up with rows that have a button there. */
  trailingSlot?: boolean;
  onActivate: () => void;
  onHover?: () => void;
}

function Option({
  id,
  name,
  active,
  icon,
  primary,
  secondary,
  metric,
  metricLabel,
  busy = false,
  trailingSlot = false,
  onActivate,
  onHover,
}: OptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-label={name}
      aria-selected={active}
      aria-busy={busy || undefined}
      className={`flex min-h-14 flex-1 cursor-pointer items-center gap-3 py-2 pl-4 ${
        trailingSlot ? "pr-1" : "pr-4"
      } min-w-0 ${active ? "bg-surface-2" : ""}`}
      onMouseDown={keepFocus}
      // A mouse highlights what it points at; a finger does not leave a highlight behind.
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") onHover?.();
      }}
      onClick={onActivate}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] leading-[22px] text-ink">{primary}</span>
        {secondary && <span className="text-[13px] leading-[18px] text-ink-2">{secondary}</span>}
      </span>
      {metric !== undefined && (
        <span
          className="shrink-0 pl-1 text-[15px] leading-[22px] font-semibold text-ink tabular-nums"
          title={metric === null ? undefined : metricLabel}
        >
          {metric === null ? <span className="font-normal text-ink-3">—</span> : metric}
        </span>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true" data-testid="search-skeleton">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-4 py-2">
          <span className="size-10 shrink-0 rounded-full bg-surface-2 motion-safe:animate-pulse" />
          <span className="flex flex-1 flex-col gap-2">
            <span
              className="h-3.5 rounded-full bg-surface-2 motion-safe:animate-pulse"
              style={{ width: `${62 - index * 9}%` }}
            />
            <span
              className="h-3 rounded-full bg-surface-2 motion-safe:animate-pulse"
              style={{ width: `${38 + index * 6}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="type-eyebrow text-ink-3">
      {children}
    </span>
  );
}

/**
 * The list under the search field, the same in the phone overlay and the
 * desktop drop-down: an ARIA listbox whose options are driven from the text
 * field (`aria-activedescendant`), with the status lines after it.
 */
export function SearchResults({
  listId,
  sections,
  query,
  activeKey,
  optionId,
  geo,
  suggestions,
  stale,
  onActivate,
  onHover,
  onRemoveRecent,
  onClearRecents,
  onRetry,
}: SearchResultsProps) {
  const location = locationSubtitle(geo);
  const hasSuggestionSection = sections.some((section) => section.id === "suggestions");

  const renderRow = (row: SearchRow) => {
    const shared = {
      id: optionId(row.key),
      active: row.key === activeKey,
      onActivate: () => onActivate(row),
      onHover: onHover ? () => onHover(row.key) : undefined,
    };
    switch (row.kind) {
      case "location":
        return (
          <Option
            key={row.key}
            {...shared}
            name={`Use my current location. ${location.text}`}
            busy={geo.status === "locating"}
            icon={
              <RowIcon accent>
                {geo.status === "locating" ? <SpinnerIcon /> : <LocationArrowIcon />}
              </RowIcon>
            }
            primary={<span className="font-medium">Use my current location</span>}
            secondary={
              <span className={location.problem ? "text-danger" : undefined}>{location.text}</span>
            }
          />
        );
      case "map":
        return (
          <Option
            key={row.key}
            {...shared}
            name="Choose on the map. Tap the exact spot"
            icon={
              <RowIcon>
                <MapPinPlusIcon />
              </RowIcon>
            }
            primary={<span className="font-medium">Choose on the map</span>}
            secondary="Tap the exact spot — a yard, a balcony, a window"
          />
        );
      case "saved":
      case "recent": {
        const { entry } = row;
        const label = entryLabel(entry);
        const hours = entry.summary ? formatHours(entry.summary.avgSunHoursPerDay) : null;
        const metricLabel =
          hours === null ? undefined : `${hours} hours of direct sun on an average day`;
        const option = (
          <Option
            {...shared}
            name={[label, entryAddress(entry), metricLabel].filter(Boolean).join(", ")}
            trailingSlot
            icon={
              <RowIcon>{row.kind === "saved" ? <HeartIcon /> : <ClockIcon />}</RowIcon>
            }
            primary={<Marked title text={label} query={query} />}
            secondary={
              <span className="block truncate">
                <Marked text={entryAddress(entry)} query={query} />
              </span>
            }
            metric={hours === null ? null : `${hours} h`}
            metricLabel={metricLabel}
          />
        );
        if (row.kind === "saved") {
          // The empty slot keeps the hours in one column with the recents below.
          return (
            <div
              key={row.key}
              role="presentation"
              className={`flex items-stretch ${shared.active ? "bg-surface-2" : ""}`}
            >
              {option}
              <span aria-hidden="true" className="mr-1 w-11 shrink-0" onClick={shared.onActivate} />
            </div>
          );
        }
        return (
          <div
            key={row.key}
            role="presentation"
            className={`flex items-stretch ${shared.active ? "bg-surface-2" : ""}`}
          >
            {option}
            <button
              type="button"
              aria-label={`Remove ${label} from recent places`}
              className="mr-1 grid w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink"
              onMouseDown={keepFocus}
              onClick={() => onRemoveRecent(entry)}
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        );
      }
      case "suggestion": {
        const { suggestion } = row;
        return (
          <Option
            key={row.key}
            {...shared}
            name={[suggestion.label, suggestion.detail].filter(Boolean).join(", ")}
            icon={<RowIcon>{row.coordinates ? <CoordinatesIcon /> : <PinIcon />}</RowIcon>}
            primary={
              row.coordinates ? (
                <span className="font-medium tabular-nums">{suggestion.label}</span>
              ) : (
                <Marked title text={suggestion.label} query={query} />
              )
            }
            secondary={
              suggestion.detail ? <span className="block truncate">{suggestion.detail}</span> : null
            }
          />
        );
      }
    }
  };

  return (
    <>
      <div id={listId} role="listbox" aria-label="Places">
        {sections.map((section) => {
          const titleId = `${listId}-${section.id}`;
          return (
            <div
              key={section.id}
              role="group"
              aria-labelledby={section.title ? titleId : undefined}
              aria-label={section.title ? undefined : "Find a spot"}
              className={
                section.id === "suggestions" && stale ? "opacity-60 transition-opacity" : undefined
              }
            >
              {section.title && (
                <div
                  role="presentation"
                  className="flex h-11 items-end justify-between pr-1 pb-1.5 pl-4"
                >
                  <SectionTitle id={titleId}>{section.title}</SectionTitle>
                  {section.id === "recent" && (
                    <button
                      type="button"
                      aria-label="Clear recent places"
                      className="-mb-1.5 flex h-11 items-end rounded-lg px-3 pb-1.5 text-[13px] leading-[18px] font-medium text-accent"
                      onMouseDown={keepFocus}
                      onClick={onClearRecents}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {section.rows.map(renderRow)}
            </div>
          );
        })}
      </div>

      {suggestions === "loading" && !hasSuggestionSection && (
        <div>
          <div className="flex h-11 items-end pb-1.5 pl-4">
            <span className="type-eyebrow text-ink-3">Addresses</span>
          </div>
          <SkeletonRows />
        </div>
      )}
      {suggestions === "short" && (
        <p className="px-4 py-3 text-[13px] leading-[18px] text-ink-3">
          Keep typing to search addresses.
        </p>
      )}
      {suggestions === "empty" && (
        <p className="px-4 py-3 text-[15px] leading-[22px] text-ink-2">
          No address matches “<span className="font-medium text-ink">{query}</span>”. Check the
          spelling, or choose the spot on the map.
        </p>
      )}
      {suggestions === "error" && (
        <div className="px-4 pt-3 text-[15px] leading-[22px] text-ink-2">
          <p>Couldn’t search — check your connection.</p>
          <button
            type="button"
            className="-mx-2 h-11 rounded-lg px-2 font-medium text-accent"
            onMouseDown={keepFocus}
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      )}
    </>
  );
}
