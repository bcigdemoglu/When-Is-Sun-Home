"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CloseIcon, SearchIcon } from "@/components/ui/icons";
import type { PlaceSuggestion } from "@/lib/geocode/photon";
import { usePlaceSearch } from "@/lib/geocode/usePlaceSearch";
import type { LatLng } from "@/lib/types";

interface SearchBoxProps {
  /** Prefer results near this point (the current pin). */
  bias?: LatLng | null;
  onSelect(suggestion: PlaceSuggestion): void;
  className?: string;
}

/**
 * Address / place search as an ARIA combobox: type, pick with the arrow keys
 * and Enter (or a tap), Escape to dismiss. "37.79, -122.43" works too.
 */
export function SearchBox({ bias, onSelect, className = "" }: SearchBoxProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  /** Id of the highlighted suggestion; survives the list refreshing around it. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;

  const { suggestions, status, isStale } = usePlaceSearch(text, bias);
  const activeIndex = activeId === null ? -1 : suggestions.findIndex((s) => s.id === activeId);
  const showPanel = open && status !== "idle";
  const showList = showPanel && suggestions.length > 0;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  let message: string | null = null;
  if (showPanel && suggestions.length === 0) {
    if (status === "loading") message = "Searching…";
    else if (status === "error")
      message = "Search isn’t available right now. You can still tap the map to drop the pin.";
    else message = "No places found. Try a street address, a city, or “lat, lng”.";
  }

  const choose = (suggestion: PlaceSuggestion) => {
    onSelect(suggestion);
    setText("");
    setOpen(false);
    setActiveId(null);
    // Dismisses the on-screen keyboard so the map is visible again.
    inputRef.current?.blur();
  };

  const move = (delta: 1 | -1) => {
    if (suggestions.length === 0) return;
    const count = suggestions.length;
    const next = activeIndex < 0 ? (delta > 0 ? 0 : count - 1) : (activeIndex + delta + count) % count;
    setActiveId(suggestions[next].id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Leave keys alone while an IME is composing text.
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case "Enter": {
        if (!showList) break;
        event.preventDefault();
        // No highlight: take the best match, but never a stale one.
        const picked = activeIndex >= 0 ? suggestions[activeIndex] : isStale ? null : suggestions[0];
        if (picked) choose(picked);
        break;
      }
      case "Escape":
        if (open && status !== "idle") {
          event.preventDefault();
          setOpen(false);
          setActiveId(null);
        } else if (text !== "") {
          event.preventDefault();
          setText("");
        }
        break;
    }
  };

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex h-11 items-center rounded-xl border border-line bg-surface shadow-md">
        <SearchIcon className="pointer-events-none ml-3 shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search for an address or place"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={message ? statusId : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search address or place"
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-ink-3"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setOpen(true);
            setActiveId(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {text !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            className="mr-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:text-ink"
            onClick={() => {
              setText("");
              setActiveId(null);
              inputRef.current?.focus();
            }}
          >
            <CloseIcon width={18} height={18} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Places"
              className={`max-h-[min(22rem,50svh)] overflow-y-auto py-1 ${isStale ? "opacity-60" : ""}`}
            >
              {suggestions.map((suggestion, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={suggestion.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    className={`flex min-h-11 cursor-pointer flex-col justify-center px-3.5 py-1.5 ${
                      active ? "bg-surface-2" : ""
                    }`}
                    // Keep focus in the input so the list does not close before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveId(suggestion.id)}
                    onClick={() => choose(suggestion)}
                  >
                    <span className="truncate text-sm font-medium text-ink">{suggestion.label}</span>
                    {suggestion.detail && (
                      <span className="truncate text-xs text-ink-2">{suggestion.detail}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p
            id={statusId}
            role="status"
            aria-live="polite"
            className={message ? "px-3.5 py-3 text-sm text-ink-2" : "sr-only"}
          >
            {message ??
              (showList
                ? `${suggestions.length} ${suggestions.length === 1 ? "place" : "places"} found`
                : "")}
          </p>
        </div>
      )}
    </div>
  );
}
