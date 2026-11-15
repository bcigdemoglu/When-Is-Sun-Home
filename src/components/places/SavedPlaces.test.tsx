// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "@/components/ui/toast";
import { PLACES_LIMITS, placeEntryId, usePlaces } from "@/state/places";
import { SavedPlaces } from "./SavedPlaces";
import { closeRenameDialog } from "./renameDialog";
import {
  ALDER,
  AUSTRAL,
  DIM,
  ELM,
  MARINA,
  NORTH_WINDOW,
  OAK,
  PIER,
  PIN,
  SUNNY,
  SYDNEY,
  YARD,
  summaryOf,
} from "./testing";

const MORNING = summaryOf([2.1, 2.8, 3.6, 4.3, 4.9, 5.2, 5, 4.5, 3.8, 3, 2.3, 1.9]);

/** Four saved places (one without numbers yet) and two recents. */
function seed() {
  const places = usePlaces.getState();
  places.save(ELM, YARD, SUNNY, "Elm St backyard");
  places.setNote(placeEntryId(ELM), "South-facing lawn");
  places.save(ALDER, NORTH_WINDOW, DIM, "Alder Rd kitchen");
  places.save(OAK, YARD, MORNING);
  places.save(PIN, YARD, null);
  places.recordVisit(PIER, YARD, null);
  places.recordVisit(MARINA, YARD, SUNNY);
}

function setup(activeId: string | null = null) {
  const onOpen = vi.fn();
  const user = userEvent.setup();
  const view = render(<SavedPlaces activeId={activeId} onOpen={onOpen} className="mine" />);
  return { onOpen, user, view };
}

const savedLabels = () => usePlaces.getState().saved.map((entry) => entry.label);
const toasts = () => useToasts.getState().toasts;
const savedSection = () => screen.getByRole("region", { name: "Saved places" });
const rows = () => within(savedSection()).getAllByRole("listitem");
const tick = (name: RegExp) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  localStorage.clear();
  usePlaces.setState({ saved: [], recent: [] });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  act(() => closeRenameDialog());
  cleanup();
});

describe("SavedPlaces — empty", () => {
  it("explains how to save a place, in the app's own words", () => {
    const { view } = setup();
    expect(screen.getByText("No saved places yet.")).toBeInTheDocument();
    expect(savedSection()).toHaveTextContent(
      "Tap the heart on a sun report to keep it here and compare.",
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent" })).not.toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveClass("mine");
  });

  it("still lists recents when nothing is saved", () => {
    usePlaces.getState().recordVisit(PIER, YARD, null);
    setup();
    expect(screen.getByText("No saved places yet.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Recent" })).getAllByRole("listitem"),
    ).toHaveLength(1);
  });
});

describe("SavedPlaces — the list", () => {
  it("shows each saved place with its name, address, headline number and year", () => {
    seed();
    setup();
    expect(within(savedSection()).getByLabelText("4 saved")).toHaveTextContent("4");
    const [elm, alder, , pin] = rows();
    expect(elm).toHaveTextContent("Elm St backyard");
    expect(elm).toHaveTextContent("412 Elm Street, Noe Valley");
    expect(
      within(elm).getByLabelText("7.8 hours of direct sun on an average day"),
    ).toHaveTextContent("7.8ha day");
    expect(elm).toHaveTextContent("Best Jun 10.9 · Least Dec 4.5");
    expect(elm).toHaveTextContent("“South-facing lawn”");
    expect(alder).toHaveTextContent("Best Jun 1.4 · Least Jan 0");

    // A place saved before its numbers were worked out.
    expect(pin).toHaveTextContent("37.7694° N, 122.4862° W");
    expect(pin).toHaveTextContent("Pinned on the map");
    expect(within(pin).getByLabelText("Sun hours not worked out yet")).toHaveTextContent("—");
    expect(pin).toHaveTextContent("Open it once to work out its sun hours");
    expect(within(pin).queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws a 12-month sparkline on one scale for the whole list", () => {
    seed();
    setup();
    const [elm, alder] = rows();
    const bars = (row: HTMLElement) =>
      Array.from(within(row).getByRole("img").querySelectorAll("rect"));
    expect(bars(elm)).toHaveLength(12);
    expect(within(elm).getByRole("img")).toHaveAccessibleName(/Jan 4\.9, Feb 6\.1.*Dec 4\.5/);
    const height = (rect: Element) => Number(rect.getAttribute("height"));
    // June of the sunniest place fills the chart (22 px)…
    expect(height(bars(elm)[5])).toBe(22);
    // …and the dim window is drawn against the same 10.9 h, not its own best.
    expect(height(bars(alder)[5])).toBeCloseTo((1.4 / 10.9) * 22, 5);
    // No sun at all still leaves a stub on the baseline.
    expect(height(bars(alder)[0])).toBe(1.5);
  });

  it("marks the place that is on screen", () => {
    seed();
    setup(placeEntryId(ALDER));
    const current = screen.getByRole("button", { name: "Open Alder Rd kitchen" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current.closest("li")).toHaveClass("border-accent");
    expect(screen.getByRole("button", { name: "Open Elm St backyard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens saved and recent places with their entry", async () => {
    seed();
    const { user, onOpen } = setup();
    await user.click(screen.getByRole("button", { name: "Open Alder Rd kitchen" }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ place: ALDER, observer: NORTH_WINDOW, label: "Alder Rd kitchen" }),
    );
    await user.click(screen.getByRole("button", { name: "Open Marina Boulevard" }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ place: MARINA, savedAt: null }),
    );
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("lists recents newest first with their hours, removable one by one or all at once", async () => {
    seed();
    const { user } = setup();
    const recent = screen.getByRole("region", { name: "Recent" });
    const items = within(recent).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Marina BoulevardSan Francisco7.8 h",
      "Pier 39San Francisco—",
    ]);
    await user.click(screen.getByRole("button", { name: "Remove Pier 39 from recent places" }));
    expect(usePlaces.getState().recent.map((entry) => entry.label)).toEqual(["Marina Boulevard"]);
    await user.click(screen.getByRole("button", { name: "Clear recent places" }));
    expect(usePlaces.getState().recent).toEqual([]);
    expect(screen.queryByRole("region", { name: "Recent" })).not.toBeInTheDocument();
    expect(savedLabels()).toHaveLength(4);
  });

  it("updates when the store changes underneath it", () => {
    seed();
    setup();
    act(() => usePlaces.getState().recordVisit(PIN, YARD, DIM));
    expect(rows()[3]).toHaveTextContent("Best Jun 1.4 · Least Jan 0");
  });
});

describe("SavedPlaces — notes", () => {
  it("adds a note from the row", async () => {
    seed();
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Add a note to Alder Rd kitchen" }));
    const field = screen.getByRole("textbox", { name: "Note for Alder Rd kitchen" });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("maxlength", String(PLACES_LIMITS.noteMaxLength));
    await user.keyboard("Dark but quiet");
    expect(screen.getByText("14 / 280")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(usePlaces.getState().saved[1].note).toBe("Dark but quiet");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(rows()[1]).toHaveTextContent("“Dark but quiet”");
  });

  it("edits a note in place: Enter saves, Escape leaves it alone, empty removes it", async () => {
    seed();
    const { user } = setup();
    const open = () =>
      user.click(screen.getByRole("button", { name: /^(Edit note for|Add a note to) Elm St/ }));

    await open();
    const field = screen.getByRole("textbox", { name: "Note for Elm St backyard" });
    expect(field).toHaveValue("South-facing lawn");
    await user.keyboard(", big oak{Enter}");
    expect(usePlaces.getState().saved[0].note).toBe("South-facing lawn, big oak");

    await open();
    await user.keyboard(" and more{Escape}");
    expect(usePlaces.getState().saved[0].note).toBe("South-facing lawn, big oak");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(usePlaces.getState().saved[0].note).toBe("South-facing lawn, big oak");

    await open();
    await user.clear(screen.getByRole("textbox"));
    await user.keyboard("{Enter}");
    expect(usePlaces.getState().saved[0].note).toBeUndefined();
    expect(screen.getByRole("button", { name: "Add a note to Elm St backyard" })).toBeVisible();
  });

  it("one note is edited at a time", async () => {
    seed();
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Add a note to Alder Rd kitchen" }));
    await user.click(screen.getByRole("button", { name: "Add a note to 7 Oak Avenue" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveAccessibleName("Note for 7 Oak Avenue");
  });
});

describe("SavedPlaces — edit mode", () => {
  const enterEdit = async () => {
    seed();
    const utils = setup();
    await utils.user.click(screen.getByRole("button", { name: "Edit" }));
    return utils;
  };

  it("swaps the rows for reorder, rename and remove controls, and back", async () => {
    const { user } = await enterEdit();
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Move .* up$/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^Rename / })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^Remove .* from saved places$/ })).toHaveLength(
      4,
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("reorders with the up and down buttons and says where the place went", async () => {
    const { user } = await enterEdit();
    const down = screen.getByRole("button", { name: "Move Elm St backyard down" });
    await user.click(down);
    expect(savedLabels()).toEqual([
      "Alder Rd kitchen",
      "Elm St backyard",
      "7 Oak Avenue",
      "37.7694° N, 122.4862° W",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Elm St backyard moved to position 2 of 4",
    );
    // The same button is still under the finger / focus.
    expect(down).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Move 7 Oak Avenue up" }));
    await user.click(screen.getByRole("button", { name: "Move 7 Oak Avenue up" }));
    expect(savedLabels()[0]).toBe("7 Oak Avenue");
    expect(rows()[0]).toHaveTextContent("7 Oak Avenue");
  });

  it("the ends cannot move further, and say so without losing focus", async () => {
    const { user } = await enterEdit();
    const up = screen.getByRole("button", { name: "Move Elm St backyard up" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).not.toBeDisabled();
    await user.click(up);
    expect(savedLabels()[0]).toBe("Elm St backyard");
    expect(
      screen.getByRole("button", { name: "Move 37.7694° N, 122.4862° W down" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Move Alder Rd kitchen up" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("removes a place with a toast that can undo it — name, note and position intact", async () => {
    const { user } = await enterEdit();
    await user.click(
      screen.getByRole("button", { name: "Remove Elm St backyard from saved places" }),
    );
    expect(savedLabels()).toEqual(["Alder Rd kitchen", "7 Oak Avenue", "37.7694° N, 122.4862° W"]);
    expect(toasts().at(-1)).toMatchObject({
      message: "Removed “Elm St backyard” from saved places",
      action: { label: "Undo" },
    });
    expect(usePlaces.getState().recent[0].label).toBe("Elm St backyard");
    act(() => toasts().at(-1)!.action!.onAction());
    expect(savedLabels()[0]).toBe("Elm St backyard");
    expect(usePlaces.getState().saved[0]).toMatchObject({ note: "South-facing lawn" });
  });

  it("leaves edit mode by itself when the last place is removed", async () => {
    usePlaces.getState().save(ELM, YARD, null);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: /^Remove / }));
    expect(screen.getByText("No saved places yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("renames through the dialog and returns focus to the row", async () => {
    const { user } = await enterEdit();
    const rename = screen.getByRole("button", { name: "Rename 7 Oak Avenue" });
    await user.click(rename);
    const dialog = await screen.findByRole("dialog", { name: "Name this place" });
    expect(dialog).toHaveTextContent("Cole Valley");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("7 Oak Avenue");
    await user.keyboard("Oak Ave flat{Enter}");
    expect(savedLabels()[2]).toBe("Oak Ave flat");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Oak Ave flat" })).toHaveFocus();
  });
});

describe("SavedPlaces — compare", () => {
  const compareButton = () => screen.queryByRole("button", { name: /^Compare \d places$/ });

  it("every saved row has a compare checkbox; two ticks bring up the button", async () => {
    seed();
    const { user } = setup();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByText("Tick two or more to compare them side by side.")).toBeInTheDocument();
    expect(compareButton()).not.toBeInTheDocument();

    await user.click(tick(/Compare Elm St backyard/));
    expect(compareButton()).not.toBeInTheDocument();
    expect(screen.getByText("Tick one more place to compare")).toBeInTheDocument();

    await user.click(tick(/Compare Alder Rd kitchen/));
    expect(compareButton()).toHaveTextContent("Compare 2 places");
    await user.click(tick(/Compare 7 Oak Avenue/));
    expect(compareButton()).toHaveTextContent("Compare 3 places");
    await user.click(tick(/Compare Elm St backyard/));
    expect(compareButton()).toHaveTextContent("Compare 2 places");
    expect(tick(/Compare Elm St backyard/)).not.toBeChecked();
  });

  it("a single saved place is not offered for comparison in words", () => {
    usePlaces.getState().save(ELM, YARD, SUNNY);
    setup();
    expect(screen.queryByText(/tick two or more/i)).not.toBeInTheDocument();
  });

  it("compares at most four: a fifth tick explains why and does not stick", async () => {
    seed();
    usePlaces.getState().save(SYDNEY, YARD, AUSTRAL);
    const { user } = setup();
    for (const name of [/Elm St/, /Alder Rd/, /7 Oak/, /37\.7694/]) await user.click(tick(name));
    expect(compareButton()).toHaveTextContent("Compare 4 places");
    expect(toasts()).toEqual([]);
    await user.click(tick(/5 Bondi Road/));
    expect(tick(/5 Bondi Road/)).not.toBeChecked();
    expect(compareButton()).toHaveTextContent("Compare 4 places");
    expect(toasts().at(-1)?.message).toBe(
      "You can compare up to 4 places at a time. Untick one first.",
    );
  });

  it("a ticked place that is removed elsewhere no longer counts", async () => {
    seed();
    const { user } = setup();
    await user.click(tick(/Elm St/));
    await user.click(tick(/Alder Rd/));
    act(() => usePlaces.getState().unsave(placeEntryId(ALDER)));
    expect(compareButton()).not.toBeInTheDocument();
    expect(screen.getByText("Tick one more place to compare")).toBeInTheDocument();
  });

  const openCompare = async (names: RegExp[]) => {
    const utils = setup();
    for (const name of names) await utils.user.click(tick(name));
    await utils.user.click(compareButton()!);
    return utils;
  };
  const row = (name: string | RegExp) =>
    within(screen.getByRole("rowheader", { name }).closest('[role="row"]') as HTMLElement);
  const cells = (name: string | RegExp) =>
    row(name)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);

  it("replaces the list with a table of the picked places, and back again", async () => {
    seed();
    const { user } = await openCompare([/Elm St/, /Alder Rd/, /7 Oak/]);
    expect(screen.getByRole("heading", { name: "Compare 3 places" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Saved places" })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent)
        .slice(1),
    ).toEqual(["Elm St backyard", "Alder Rd kitchen", "7 Oak Avenue"]);

    await user.click(screen.getByRole("button", { name: "Back to saved places" }));
    expect(savedSection()).toBeInTheDocument();
    // The ticks are still there.
    expect(tick(/Elm St/)).toBeChecked();
    expect(compareButton()).toHaveTextContent("Compare 3 places");
  });

  it("shows the headline rows and stars the best value in each", async () => {
    seed();
    await openCompare([/Elm St/, /Alder Rd/, /7 Oak/]);
    expect(cells("Average day")).toEqual(["7.8 h(best)", "0.3 h", "3.6 h"]);
    expect(cells("Share of daylight")).toEqual(["65%(best)", "3%", "30%"]);
    expect(cells("Sunniest month")).toEqual(["Jun · 10.9 h(best)", "Jun · 1.4 h", "Jun · 5.2 h"]);
    // "Best" in the least-sun row is the place that keeps the most.
    expect(cells("Least sun")).toEqual(["Dec · 4.5 h(best)", "Jan · 0.0 h", "Dec · 1.9 h"]);
    expect(cells("Summer average (Jun–Aug)")).toEqual(["10.4 h(best)", "1.0 h", "4.9 h"]);
    expect(cells("Winter average (Dec–Feb)")).toEqual(["5.1 h(best)", "0.0 h", "2.3 h"]);
    expect(cells("Viewpoint")).toEqual([
      "Yard · ground",
      "Window · 2nd floor · facing N",
      "Yard · ground",
    ]);
    expect(cells("Note")).toEqual(["South-facing lawn", "—", "—"]);
  });

  it("draws every place's year on one common scale", async () => {
    seed();
    await openCompare([/Alder Rd/, /7 Oak/]);
    const charts = row("Through the year").getAllByRole("img");
    expect(charts).toHaveLength(2);
    const june = (chart: HTMLElement) =>
      Number(chart.querySelector('rect[data-month="5"]')!.getAttribute("height"));
    // The largest month of the two (5.2 h) fills the 48 px; the other is drawn against it.
    expect(june(charts[1])).toBe(48);
    expect(june(charts[0])).toBeCloseTo((1.4 / 5.2) * 48, 5);
  });

  it("flips summer and winter for a place south of the equator", async () => {
    seed();
    usePlaces.getState().save(SYDNEY, YARD, AUSTRAL);
    await openCompare([/Elm St/, /5 Bondi Road/]);
    // Mixed hemispheres: the row label stays neutral, each cell says which months.
    expect(cells("Summer average")).toEqual(["10.4 h(best)Jun–Aug", "9.6 hDec–Feb"]);
    expect(cells("Winter average")).toEqual(["5.1 h(best)Dec–Feb", "4.7 hJun–Aug"]);
  });

  it("labels the seasons with southern months when every place is in the south", async () => {
    usePlaces.getState().save(SYDNEY, YARD, AUSTRAL);
    usePlaces
      .getState()
      .save({ lat: -37.81, lng: 144.96, name: "1 Yarra St, Melbourne" }, YARD, DIM);
    await openCompare([/5 Bondi Road/, /1 Yarra St/]);
    expect(cells("Summer average (Dec–Feb)")[0]).toBe("9.6 h(best)");
    expect(cells("Winter average (Jun–Aug)")[0]).toBe("4.7 h(best)");
  });

  it("a place without numbers shows dashes, a hint, and takes no star", async () => {
    seed();
    await openCompare([/Elm St/, /37\.7694/]);
    expect(cells("Average day")).toEqual(["7.8 h", "—"]);
    expect(cells("Least sun")).toEqual(["Dec · 4.5 h", "—"]);
    expect(cells("Through the year")[1]).toBe(
      "No numbers yet. Open this place once to work them out.",
    );
    expect(screen.queryByText("(best)")).not.toBeInTheDocument();
  });

  it("has an Open button per column", async () => {
    seed();
    const { user, onOpen } = await openCompare([/Elm St/, /Alder Rd/]);
    await user.click(screen.getByRole("button", { name: "Open Alder Rd kitchen" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ place: ALDER, observer: NORTH_WINDOW }),
    );
  });

  it("falls back to the list when fewer than two compared places remain", async () => {
    seed();
    await openCompare([/Elm St/, /Alder Rd/]);
    act(() => usePlaces.getState().unsave(placeEntryId(ELM)));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(savedSection()).toBeInTheDocument();
  });
});
