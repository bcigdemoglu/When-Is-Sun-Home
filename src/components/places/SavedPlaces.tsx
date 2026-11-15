"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { showToast } from "@/components/ui/toast";
import { useMinuteClock } from "@/hooks/useNow";
import {
  PLACES_LIMITS,
  entryAddress,
  entryLabel,
  useHydratePlaces,
  usePlaces,
  type PlaceEntry,
} from "@/state/places";
import { CompareView, MAX_COMPARED } from "./CompareView";
import { MonthBars } from "./MonthBars";
import { unsaveWithUndo } from "./actions";
import { bestLeastLine, commonMonthlyMax, formatHours } from "./format";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  CompareIcon,
  HeartIcon,
  PencilIcon,
  TrashIcon,
} from "./icons";
import { openRenameDialog } from "./renameDialog";
import type { SavedPlacesProps } from "./types";

const TEXT_BUTTON =
  "flex h-11 items-center rounded-lg px-3 text-[14px] leading-[18px] font-medium text-accent";

/** The big number on the right of a row: average direct sun per day. */
function Metric({ entry, size }: { entry: PlaceEntry; size: "large" | "small" }) {
  if (!entry.summary) {
    return (
      <span
        className={`shrink-0 text-ink-3 ${size === "large" ? "text-[28px] leading-[30px]" : "text-[17px] leading-[22px]"}`}
        aria-label="Sun hours not worked out yet"
      >
        —
      </span>
    );
  }
  const hours = formatHours(entry.summary.avgSunHoursPerDay);
  if (size === "small") {
    return (
      <span
        className="shrink-0 text-[17px] leading-[22px] font-semibold text-ink tabular-nums"
        aria-label={`${hours} hours of direct sun on an average day`}
      >
        {hours} h
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 flex-col items-end"
      aria-label={`${hours} hours of direct sun on an average day`}
    >
      <span className="text-[28px] leading-[30px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {hours}
        <span className="ml-0.5 text-[15px] font-medium tracking-normal text-ink-2">h</span>
      </span>
      <span className="text-[11px] leading-[14px] text-ink-3">a day</span>
    </span>
  );
}

interface NoteEditorProps {
  label: string;
  initial: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}

function NoteEditor({ label, initial, onSave, onCancel }: NoteEditorProps) {
  const [text, setText] = useState(initial);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const countId = useId();

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  return (
    <form
      className="px-4 pt-1 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}
    >
      <textarea
        ref={fieldRef}
        aria-label={`Note for ${label}`}
        aria-describedby={countId}
        rows={2}
        maxLength={PLACES_LIMITS.noteMaxLength}
        placeholder="Lovely garden, noisy road…"
        className="block w-full resize-none rounded-xl border border-line bg-page px-3 py-2.5 text-[16px] leading-[22px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSave(text);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <span id={countId} className="flex-1 text-[12px] leading-[16px] text-ink-3 tabular-nums">
          {text.length} / {PLACES_LIMITS.noteMaxLength}
        </span>
        <button
          type="button"
          className="h-11 rounded-full px-4 text-[14px] leading-[18px] font-medium text-ink-2 hover:bg-surface-2"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-11 rounded-full bg-ink px-5 text-[14px] leading-[18px] font-medium text-surface"
        >
          Save note
        </button>
      </div>
    </form>
  );
}

interface SavedRowProps {
  entry: PlaceEntry;
  active: boolean;
  ticked: boolean;
  /** Scale shared by every sparkline in the list. */
  max: number;
  currentMonth: number | null;
  editingNote: boolean;
  onOpen: () => void;
  onTick: (ticked: boolean) => void;
  onEditNote: (editing: boolean) => void;
}

function SavedRow({
  entry,
  active,
  ticked,
  max,
  currentMonth,
  editingNote,
  onOpen,
  onTick,
  onEditNote,
}: SavedRowProps) {
  const setNote = usePlaces((state) => state.setNote);
  const label = entryLabel(entry);

  return (
    <li
      data-entry-id={entry.id}
      className={`rounded-card border bg-surface ${active ? "border-accent" : "border-line"}`}
    >
      <div className="flex items-stretch">
        <label className="group relative flex w-12 shrink-0 cursor-pointer justify-center pt-3.5">
          <input
            type="checkbox"
            className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={`Compare ${label}`}
            checked={ticked}
            onChange={(event) => onTick(event.currentTarget.checked)}
          />
          <span
            aria-hidden="true"
            className={`grid size-[22px] place-items-center rounded-md border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
              ticked ? "border-ink bg-ink text-surface" : "border-ink-3 bg-surface text-transparent"
            }`}
          >
            <CheckIcon width={16} height={16} strokeWidth={2.25} />
          </span>
        </label>
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          aria-label={`Open ${label}`}
          className="min-w-0 flex-1 rounded-r-card py-3 pr-4 text-left"
          onClick={onOpen}
        >
          <span className="flex items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[17px] leading-[22px] font-semibold text-ink">
                {label}
              </span>
              <span className="truncate text-[13px] leading-[18px] text-ink-2">
                {entryAddress(entry)}
              </span>
            </span>
            <Metric entry={entry} size="large" />
          </span>
          <span className="mt-2 flex h-6 items-center gap-2.5">
            {entry.summary ? (
              <>
                <MonthBars
                  values={entry.summary.monthlySunHours}
                  max={max}
                  currentMonth={currentMonth}
                  height={22}
                />
                <span className="min-w-0 truncate text-[12px] leading-[16px] text-ink-2 tabular-nums">
                  {bestLeastLine(entry.summary)}
                </span>
              </>
            ) : (
              <span className="truncate text-[12px] leading-[16px] text-ink-3">
                Open it once to work out its sun hours
              </span>
            )}
          </span>
          {active && <span className="sr-only">On screen now</span>}
        </button>
      </div>
      {editingNote ? (
        <NoteEditor
          label={label}
          initial={entry.note ?? ""}
          onSave={(note) => {
            setNote(entry.id, note);
            onEditNote(false);
          }}
          onCancel={() => onEditNote(false)}
        />
      ) : (
        <button
          type="button"
          aria-label={entry.note ? `Edit note for ${label}: ${entry.note}` : `Add a note to ${label}`}
          className="-mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-b-card pr-4 pb-2 pl-12 text-left text-[13px] leading-[18px]"
          onClick={() => onEditNote(true)}
        >
          {entry.note ? (
            <span className="line-clamp-2 text-ink-2">“{entry.note}”</span>
          ) : (
            <>
              <PencilIcon width={15} height={15} className="shrink-0 text-ink-3" />
              <span className="text-ink-3">Add a note</span>
            </>
          )}
        </button>
      )}
    </li>
  );
}

interface EditRowProps {
  entry: PlaceEntry;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
}

function EditRow({ entry, index, count, onMove }: EditRowProps) {
  const renameRef = useRef<HTMLButtonElement>(null);
  const label = entryLabel(entry);
  const first = index === 0;
  const last = index === count - 1;
  const arrow = "grid size-11 shrink-0 place-items-center rounded-full text-ink";

  return (
    <li
      data-entry-id={entry.id}
      className="flex items-center rounded-card border border-line bg-surface py-1.5 pr-1 pl-1"
    >
      {/* aria-disabled, not disabled: the button keeps focus when a move makes it the end. */}
      <button
        type="button"
        aria-label={`Move ${label} up`}
        aria-disabled={first}
        className={`${arrow} ${first ? "opacity-30" : "hover:bg-surface-2"}`}
        onClick={() => !first && onMove(-1)}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        aria-disabled={last}
        className={`${arrow} ${last ? "opacity-30" : "hover:bg-surface-2"}`}
        onClick={() => !last && onMove(1)}
      >
        <ChevronDownIcon />
      </button>
      <span className="flex min-w-0 flex-1 flex-col px-2">
        <span className="truncate text-[16px] leading-[22px] font-semibold text-ink">{label}</span>
        <span className="truncate text-[13px] leading-[18px] text-ink-2">
          {entryAddress(entry)}
        </span>
      </span>
      <button
        ref={renameRef}
        type="button"
        aria-label={`Rename ${label}`}
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
        onClick={() => openRenameDialog(entry.id, { returnFocus: renameRef.current })}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        aria-label={`Remove ${label} from saved places`}
        className="grid size-11 shrink-0 place-items-center rounded-full text-danger hover:bg-surface-2"
        onClick={() => unsaveWithUndo(entry)}
      >
        <TrashIcon />
      </button>
    </li>
  );
}

function RecentRow({
  entry,
  active,
  onOpen,
}: {
  entry: PlaceEntry;
  active: boolean;
  onOpen: () => void;
}) {
  const removeRecent = usePlaces((state) => state.removeRecent);
  const label = entryLabel(entry);
  return (
    <li data-entry-id={entry.id} className="flex items-stretch">
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={`Open ${label}`}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left"
        onClick={onOpen}
      >
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full border ${
            active ? "border-accent text-accent" : "border-line text-ink-2"
          }`}
        >
          <ClockIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] leading-[22px] font-medium text-ink">{label}</span>
          <span className="truncate text-[13px] leading-[18px] text-ink-2">
            {entryAddress(entry)}
          </span>
        </span>
        <Metric entry={entry} size="small" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${label} from recent places`}
        className="mr-1 grid w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink"
        onClick={() => removeRecent(entry.id)}
      >
        <CloseIcon width={18} height={18} />
      </button>
    </li>
  );
}

/**
 * The shortlist: saved places with one comparable number each, the places
 * looked at recently, and — tick two or more — a side-by-side comparison.
 */
export function SavedPlaces({ activeId, onOpen, className = "" }: SavedPlacesProps) {
  const hydrated = useHydratePlaces();
  const saved = usePlaces((state) => state.saved);
  const recent = usePlaces((state) => state.recent);
  const reorder = usePlaces((state) => state.reorder);
  const clearRecents = usePlaces((state) => state.clearRecents);

  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const minuteClock = useMinuteClock();
  const currentMonth = minuteClock === null ? null : new Date(minuteClock * 60_000).getMonth();

  // Ticks only count for places that are still saved.
  const compared = saved.filter((entry) => ticked.includes(entry.id));
  const showCompare = comparing && compared.length >= 2;
  const isEditing = editing && saved.length > 0;
  const max = commonMonthlyMax(saved.map((entry) => entry.summary));

  if (!hydrated) return <div className={className} aria-busy="true" />;

  if (showCompare) {
    return (
      <div className={className}>
        <CompareView
          entries={compared}
          currentMonth={currentMonth}
          onBack={() => setComparing(false)}
          onOpen={onOpen}
        />
      </div>
    );
  }

  const tick = (entry: PlaceEntry, on: boolean) => {
    if (!on) {
      setTicked(ticked.filter((id) => id !== entry.id));
      return;
    }
    if (compared.length >= MAX_COMPARED) {
      showToast(`You can compare up to ${MAX_COMPARED} places at a time. Untick one first.`);
      return;
    }
    // Rebuilt from what is still saved, so stale ticks do not count against the limit.
    setTicked([...compared.map((other) => other.id), entry.id]);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= saved.length) return;
    const ids = saved.map((entry) => entry.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder(ids);
    setAnnouncement(
      `${entryLabel(saved[index])} moved to position ${target + 1} of ${saved.length}`,
    );
  };

  return (
    <div className={className}>
      <section aria-labelledby="saved-places-title">
        <div className="flex min-h-11 items-center gap-2">
          <h2 id="saved-places-title" className="text-[17px] leading-[22px] font-semibold text-ink">
            Saved places
          </h2>
          {saved.length > 0 && (
            <span
              className="text-[15px] leading-[22px] text-ink-3 tabular-nums"
              aria-label={`${saved.length} saved`}
            >
              {saved.length}
            </span>
          )}
          <span className="flex-1" />
          {saved.length > 0 && (
            <button
              type="button"
              aria-pressed={isEditing}
              className={`${TEXT_BUTTON} -mr-3`}
              onClick={() => {
                setEditing(!isEditing);
                setNoteFor(null);
              }}
            >
              {isEditing ? "Done" : "Edit"}
            </button>
          )}
        </div>

        {saved.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-5 py-6 text-center">
            <p className="text-[15px] leading-[22px] font-medium text-ink">No saved places yet.</p>
            <p className="mt-1 text-[15px] leading-[22px] text-ink-2">
              Tap{" "}
              <HeartIcon
                width={17}
                height={17}
                className="-mt-0.5 inline align-middle text-ink"
                aria-hidden="true"
              />
              <span className="sr-only">the heart</span> on a sun report to keep it here and
              compare.
            </p>
          </div>
        ) : isEditing ? (
          <ul className="flex flex-col gap-2">
            {saved.map((entry, index) => (
              <EditRow
                key={entry.id}
                entry={entry}
                index={index}
                count={saved.length}
                onMove={(delta) => move(index, delta)}
              />
            ))}
          </ul>
        ) : (
          <>
            {saved.length >= 2 && (
              <p className="-mt-1 mb-2 text-[13px] leading-[18px] text-ink-3">
                Tick two or more to compare them side by side.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {saved.map((entry) => (
                <SavedRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === activeId}
                  ticked={ticked.includes(entry.id)}
                  max={max}
                  currentMonth={currentMonth}
                  editingNote={noteFor === entry.id}
                  onOpen={() => onOpen(entry)}
                  onTick={(on) => tick(entry, on)}
                  onEditNote={(on) => setNoteFor(on ? entry.id : null)}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-places-title" className="mt-5">
          <div className="flex min-h-11 items-center gap-2">
            <h2
              id="recent-places-title"
              className="flex-1 text-[17px] leading-[22px] font-semibold text-ink"
            >
              Recent
            </h2>
            <button
              type="button"
              aria-label="Clear recent places"
              className={`${TEXT_BUTTON} -mr-3`}
              onClick={clearRecents}
            >
              Clear
            </button>
          </div>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {recent.map((entry) => (
              <RecentRow
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onOpen={() => onOpen(entry)}
              />
            ))}
          </ul>
        </section>
      )}

      {!isEditing && compared.length >= 1 && (
        <div className="pointer-events-none sticky bottom-3 z-10 mt-4 flex justify-center">
          {compared.length >= 2 ? (
            <button
              type="button"
              className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-ink pr-5 pl-4 text-[15px] leading-[22px] font-medium text-surface shadow-float"
              onClick={() => setComparing(true)}
            >
              <CompareIcon />
              Compare {compared.length} places
            </button>
          ) : (
            <p className="pointer-events-auto inline-flex h-12 items-center rounded-full border border-line bg-surface px-5 text-[14px] leading-[18px] text-ink-2 shadow-float">
              Tick one more place to compare
            </p>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
