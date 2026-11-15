"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeftIcon, ClearIcon, SearchIcon } from "@/components/places/icons";
import { showToast } from "@/components/ui/toast";
import {
  IMPRECISE_ACCURACY_M,
  impreciseMessage,
  useGeolocation,
  type GeolocationState,
} from "@/hooks/useGeolocation";
import type { LatLng, Place } from "@/lib/types";
import {
  formatPlaceCoordinates,
  selectSavedEntry,
  useHydratePlaces,
  usePlaces,
} from "@/state/places";
import { SearchResults } from "./SearchResults";
import type { PlaceSelection, SearchExperienceProps } from "./types";
import { useSearchController } from "./useSearchController";

const PLACEHOLDER = "Search an address";

/** What the idle field calls the current place: its saved name, its address, or its coordinates. */
function usePlaceLabel(place: Place | null): string | null {
  const savedLabel = usePlaces((state) => selectSavedEntry(state, place)?.label ?? null);
  if (!place) return null;
  return savedLabel ?? place.name ?? formatPlaceCoordinates(place);
}

function warnIfImprecise(accuracyM: number | null): void {
  if (accuracyM !== null && accuracyM > IMPRECISE_ACCURACY_M) {
    showToast(impreciseMessage(accuracyM));
  }
}

/**
 * The way into the app: find a place by address, by standing on it, by
 * tapping the map, or by going back to one looked at before.
 *
 * - "overlay" (phones): a pill; tapping it opens a full-screen search with
 *   the keyboard up.
 * - "panel" (desktop): an inline field whose list drops down in place; `/`
 *   focuses it.
 */
export function SearchExperience(props: SearchExperienceProps) {
  useHydratePlaces();
  return props.variant === "overlay" ? <OverlaySearch {...props} /> : <PanelSearch {...props} />;
}

// ─── Phones: pill + full-screen overlay ────────────────────────────────────

function OverlaySearch({
  place,
  onSelect,
  onChooseOnMap,
  onClear,
  className = "",
}: SearchExperienceProps) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  /** True between tapping "use my location" and the answer, unless search was closed meanwhile. */
  const awaitingLocation = useRef(false);
  const label = usePlaceLabel(place);

  const close = () => {
    awaitingLocation.current = false;
    setOpen(false);
    // Back to where the user came from; a button does not raise the keyboard.
    pillRef.current?.focus({ preventScroll: true });
  };

  const geo = useGeolocation((spot: LatLng, accuracyM: number | null) => {
    if (!awaitingLocation.current) return;
    onSelect({ place: spot, source: "location" });
    warnIfImprecise(accuracyM);
    close();
  });

  return (
    <div className={className}>
      <div className="flex h-13 items-center rounded-full border border-line bg-surface shadow-float">
        <button
          ref={pillRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={label ? `${PLACEHOLDER}. Showing ${label}` : PLACEHOLDER}
          className={`flex h-full min-w-0 flex-1 items-center gap-3 rounded-full pl-4 text-left ${
            place ? "pr-1" : "pr-5"
          }`}
          onClick={() => setOpen(true)}
        >
          <SearchIcon className="shrink-0 text-ink-2" />
          <span
            className={`truncate text-[16px] leading-[22px] ${
              label ? "font-medium text-ink" : "text-ink-2"
            }`}
          >
            {label ?? PLACEHOLDER}
          </span>
        </button>
        {place && (
          <button
            type="button"
            aria-label="Clear this place"
            className="mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-2"
            onClick={onClear}
          >
            <ClearIcon width={22} height={22} />
          </button>
        )}
      </div>
      {open &&
        createPortal(
          <SearchOverlay
            place={place}
            initialText={label ?? ""}
            geo={geo.state}
            onLocate={() => {
              awaitingLocation.current = true;
              geo.locate();
            }}
            onPick={(selection) => {
              onSelect(selection);
              close();
            }}
            onChooseOnMap={() => {
              onChooseOnMap();
              close();
            }}
            onClose={close}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Sizes the overlay to the part of the screen that is actually visible: the
 * on-screen keyboard shrinks the VISUAL viewport only, so `100dvh` would
 * leave the end of the list under the keyboard. Written straight to CSS
 * variables — no re-render per resize.
 */
function useVisualViewportBox(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!element || !viewport) return;
    const update = () => {
      // Pinch-zoomed: the layout viewport is the better box again.
      if (Math.abs(viewport.scale - 1) > 0.01) {
        element.style.removeProperty("--vv-height");
        element.style.removeProperty("--vv-top");
        return;
      }
      element.style.setProperty("--vv-height", `${viewport.height}px`);
      element.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [ref]);
}

/** The page behind a full-screen overlay must not scroll with it. */
function useBodyScrollLock(): void {
  useLayoutEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, []);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex="0"]';

interface SearchOverlayProps {
  place: Place | null;
  /** Shown selected in the field, so typing replaces it. */
  initialText: string;
  geo: GeolocationState;
  onLocate: () => void;
  onPick: (selection: PlaceSelection) => void;
  onChooseOnMap: () => void;
  onClose: () => void;
}

function SearchOverlay({
  place,
  initialText,
  geo,
  onLocate,
  onPick,
  onChooseOnMap,
  onClose,
}: SearchOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  /** Null until the user edits: the field shows the current place, the list its start state. */
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? initialText;

  const search = useSearchController({
    query: draft ?? "",
    place,
    geo,
    onLocate,
    onPick,
    onChooseOnMap,
  });

  useVisualViewportBox(rootRef);
  useBodyScrollLock();

  // Synchronously with the tap that opened the overlay, so phones raise the keyboard.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep focus inside the dialog.
    const root = rootRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !root.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !root.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-search-overlay=""
      className="fixed inset-x-0 top-0 z-[1000] flex h-[var(--vv-height,100dvh)] translate-y-[var(--vv-top,0px)] flex-col bg-page text-ink transition-opacity duration-150 ease-out motion-reduce:transition-none starting:opacity-0"
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} className="sr-only">
        Find a place
      </h2>
      <div className="flex shrink-0 items-center gap-1 pt-[max(8px,env(safe-area-inset-top))] pr-[max(12px,env(safe-area-inset-right))] pb-2 pl-[max(4px,env(safe-area-inset-left))]">
        <button
          type="button"
          aria-label="Back"
          className="grid size-12 shrink-0 place-items-center rounded-full text-ink"
          onClick={onClose}
        >
          <ArrowLeftIcon width={24} height={24} />
        </button>
        <div className="flex h-13 min-w-0 flex-1 items-center rounded-full border border-line bg-surface has-[input:focus]:border-ink-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={PLACEHOLDER}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={search.listId}
            aria-activedescendant={search.activeOptionId}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            className="h-full min-w-0 flex-1 rounded-full bg-transparent pr-2 pl-5 text-[16px] leading-[22px] text-ink outline-none! placeholder:text-ink-3"
            value={value}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              search.onKeyDown(event);
            }}
          />
          {value !== "" && (
            <button
              type="button"
              aria-label="Clear search text"
              className="mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-2"
              // Keep the keyboard up: the field stays focused.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft("");
                inputRef.current?.focus({ preventScroll: true });
              }}
            >
              <ClearIcon width={22} height={22} />
            </button>
          )}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-[env(safe-area-inset-right)] pb-[max(16px,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]"
        // Scrolling the results puts the keyboard away, as in the maps apps.
        onTouchMove={() => inputRef.current?.blur()}
      >
        <SearchResults {...search.results} />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {search.announcement}
      </p>
    </div>
  );
}

// ─── Desktop: inline field with a drop-down ────────────────────────────────

function PanelSearch({
  place,
  onSelect,
  onChooseOnMap,
  onClear,
  className = "",
}: SearchExperienceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const awaitingLocation = useRef(false);
  /** Focus arrived by mouse: the click that follows must not undo "select all". */
  const selectOnMouseUp = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const label = usePlaceLabel(place);
  const value = draft ?? label ?? "";

  const close = (blur: boolean) => {
    awaitingLocation.current = false;
    setOpen(false);
    setDraft(null);
    if (blur) inputRef.current?.blur();
  };

  const geo = useGeolocation((spot: LatLng, accuracyM: number | null) => {
    if (!awaitingLocation.current) return;
    onSelect({ place: spot, source: "location" });
    warnIfImprecise(accuracyM);
    close(true);
  });

  const search = useSearchController({
    query: draft ?? "",
    place,
    geo: geo.state,
    onLocate: () => {
      awaitingLocation.current = true;
      geo.locate();
    },
    onPick: (selection) => {
      onSelect(selection);
      close(true);
    },
    onChooseOnMap: () => {
      onChooseOnMap();
      close(true);
    },
  });

  // "/" from anywhere on the page jumps to the search field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target) {
        if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        // Never pull focus out of a modal dialog.
        if (target.closest('[aria-modal="true"]')) return;
      }
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (document.activeElement === input) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (open) {
        // First Escape puts the list away, the second gives the field up.
        event.preventDefault();
        setOpen(false);
        search.resetActive();
      } else if (draft !== null) {
        event.preventDefault();
        setDraft(null);
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (open) search.onKeyDown(event);
  };

  const showingPlace = draft === null && place !== null;

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      <div className="flex h-12 items-center rounded-xl border border-line bg-surface has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent">
        <SearchIcon className="pointer-events-none ml-3.5 shrink-0 text-ink-2" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={PLACEHOLDER}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? search.listId : undefined}
          aria-activedescendant={open ? search.activeOptionId : undefined}
          aria-keyshortcuts="/"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className={`h-full min-w-0 flex-1 truncate bg-transparent pr-2 pl-3 text-[15px] leading-[22px] text-ink outline-none! placeholder:text-ink-3 ${
            showingPlace ? "font-medium" : ""
          }`}
          value={value}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setOpen(true);
          }}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
            selectOnMouseUp.current = true;
          }}
          onMouseUp={(event) => {
            if (!selectOnMouseUp.current) return;
            selectOnMouseUp.current = false;
            event.preventDefault();
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            selectOnMouseUp.current = false;
            onKeyDown(event);
          }}
        />
        {value !== "" ? (
          <button
            type="button"
            aria-label={showingPlace ? "Clear this place" : "Clear search text"}
            className="mr-0.5 grid size-11 shrink-0 place-items-center rounded-lg text-ink-2 hover:text-ink"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (showingPlace) onClear();
              setDraft("");
              inputRef.current?.focus();
            }}
          >
            <ClearIcon />
          </button>
        ) : (
          !open && (
            <kbd
              aria-hidden="true"
              className="mr-3 grid h-6 min-w-6 shrink-0 place-items-center rounded-md border border-line px-1.5 font-sans text-[12px] leading-none font-medium text-ink-3"
            >
              /
            </kbd>
          )
        )}
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(34rem,calc(100dvh-8rem))] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface py-1.5 shadow-float">
          <SearchResults {...search.results} />
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {open ? search.announcement : ""}
      </p>
    </div>
  );
}
