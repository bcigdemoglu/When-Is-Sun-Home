"use client";

/**
 * Developer harness for everything about places: the search experience in
 * both variants, the save button, and the saved-places list with compare.
 *
 * Query parameters:
 *   view    "all" (default) | "search" | "panel" | "saved" — which parts to mount
 *   seed    "1" seeds the store on load (5 saved places, 4 recents)
 *   place   "1" starts with a place set (a saved one), "2" with an unsaved one
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { use, useEffect, useState, type ReactNode } from "react";
import { SaveButton } from "@/components/places/SaveButton";
import { SavedPlaces } from "@/components/places/SavedPlaces";
import { SearchExperience } from "@/components/search/SearchExperience";
import type { PlaceSelection } from "@/components/search/types";
import { useToasts } from "@/components/ui/toast";
import type { Observer, Place } from "@/lib/types";
import { placeEntryId, useHydratePlaces, usePlaces } from "@/state/places";
import { SEED_SAVED, clearPlaces, seedPlaces } from "./seed";

type Query = Record<string, string | string[] | undefined>;

const DEFAULT_OBSERVER: Observer = { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 };
const UNSAVED_PLACE: Place = {
  lat: 37.78021,
  lng: -122.42377,
  name: "901 Fulton Street, Alamo Square, San Francisco, CA",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-eyebrow text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function HarnessButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="h-10 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-ink hover:bg-surface-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The app shell renders toasts; here a bare-bones stand-in does. */
function Toasts() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[1050] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex min-h-12 max-w-full items-center gap-3 rounded-full bg-ink py-1 pr-2 pl-5 text-[14px] leading-[18px] text-surface shadow-float"
        >
          <span className="py-2">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="h-10 shrink-0 rounded-full px-3 font-semibold underline underline-offset-2"
              onClick={() => {
                toast.action?.onAction();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Harness({ query }: { query: Query }) {
  const view = first(query.view) ?? "all";
  const shouldSeed = first(query.seed) === "1";
  const startPlace = first(query.place);
  useHydratePlaces();

  const [place, setPlace] = useState<Place | null>(
    startPlace === "1" ? SEED_SAVED[0].place : startPlace === "2" ? UNSAVED_PLACE : null,
  );
  const [observer, setObserver] = useState<Observer>(DEFAULT_OBSERVER);
  const [log, setLog] = useState<string[]>([]);
  const savedCount = usePlaces((state) => state.saved.length);
  const recentCount = usePlaces((state) => state.recent.length);

  useEffect(() => {
    if (shouldSeed) seedPlaces();
  }, [shouldSeed]);

  const note = (line: string) => setLog((lines) => [line, ...lines].slice(0, 12));

  const onSelect = (selection: PlaceSelection) => {
    note(`onSelect ${JSON.stringify(selection)}`);
    setPlace(selection.place);
    if (selection.observer) setObserver(selection.observer);
    usePlaces.getState().recordVisit(selection.place, selection.observer ?? observer, null);
  };
  const search = (variant: "overlay" | "panel") => (
    <SearchExperience
      variant={variant}
      place={place}
      onSelect={onSelect}
      onChooseOnMap={() => note("onChooseOnMap")}
      onClear={() => {
        note("onClear");
        setPlace(null);
      }}
    />
  );
  const shows = (part: string) => view === "all" || view === part;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1100px] flex-col gap-8 bg-page px-4 py-4 text-ink lg:px-6">
      {shows("search") && <div data-harness="overlay">{search("overlay")}</div>}

      {view === "all" && (
        <Section title="Harness">
          <div className="flex flex-wrap items-center gap-2">
            <HarnessButton onClick={seedPlaces}>Seed 5 saved + 4 recent</HarnessButton>
            <HarnessButton onClick={clearPlaces}>Clear storage</HarnessButton>
            <HarnessButton onClick={() => setPlace(UNSAVED_PLACE)}>Set a place</HarnessButton>
            <span className="text-[13px] text-ink-2 tabular-nums">
              {savedCount} saved · {recentCount} recent
            </span>
          </div>
        </Section>
      )}

      {shows("panel") && (
        <Section title="Search — panel variant (desktop)">
          <div className="w-full max-w-[440px] rounded-card border border-line bg-surface p-4">
            {search("panel")}
            <p className="mt-3 text-[13px] leading-[18px] text-ink-3">
              Press / anywhere to focus the field.
            </p>
          </div>
        </Section>
      )}

      {view === "all" && (
        <Section title="Save button">
          <div className="flex flex-wrap items-center gap-3">
            <SaveButton
              variant="pill"
              place={place ?? UNSAVED_PLACE}
              observer={observer}
              summary={null}
            />
            <SaveButton
              variant="icon"
              place={place ?? UNSAVED_PLACE}
              observer={observer}
              summary={null}
            />
            <span className="min-w-0 truncate text-[13px] text-ink-2">
              for {(place ?? UNSAVED_PLACE).name ?? "a pin"}
            </span>
          </div>
        </Section>
      )}

      {shows("saved") && (
        <div data-harness="saved" className="w-full max-w-[1100px]">
          <SavedPlaces
            activeId={place ? placeEntryId(place) : null}
            onOpen={(entry) => {
              note(`onOpen ${JSON.stringify({ id: entry.id, label: entry.label })}`);
              setPlace(entry.place);
              setObserver(entry.observer);
            }}
          />
        </div>
      )}

      {view === "all" && (
        <Section title="Log">
          <ol
            data-harness="log"
            className="flex flex-col gap-1 font-mono text-[12px] leading-[18px] break-all text-ink-2"
          >
            {log.length === 0 && <li className="text-ink-3">Nothing yet.</li>}
            {log.map((line, index) => (
              <li key={`${log.length - index}`}>{line}</li>
            ))}
          </ol>
        </Section>
      )}
      <Toasts />
    </main>
  );
}

export default function DevPlacesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = use(searchParams);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, refetchOnReconnect: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Harness query={query} />
    </QueryClientProvider>
  );
}
