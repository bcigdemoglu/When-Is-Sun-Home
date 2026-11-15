// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToasts } from "@/components/ui/toast";
import { PLACES_LIMITS, usePlaces } from "@/state/places";
import { SaveButton } from "./SaveButton";
import { closeRenameDialog } from "./renameDialog";
import { ELM, OAK, PIN, SUNNY, YARD } from "./testing";
import type { SaveButtonProps } from "./types";

function setup(props: Partial<SaveButtonProps> = {}) {
  const user = userEvent.setup();
  const view = render(
    <SaveButton place={ELM} observer={YARD} summary={null} variant="pill" {...props} />,
  );
  return { user, view };
}

const button = () => screen.getByRole("button", { name: "Save this place" });
const toasts = () => useToasts.getState().toasts;
const saved = () => usePlaces.getState().saved;
/** Press the action of the latest toast, as the shell's toast would. */
const pressToastAction = () => act(() => toasts().at(-1)!.action!.onAction());

beforeEach(() => {
  localStorage.clear();
  usePlaces.setState({ saved: [], recent: [] });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  act(() => closeRenameDialog());
  cleanup();
});

describe("SaveButton", () => {
  it("is an unpressed toggle that says “Save” for a place that is not kept", () => {
    setup();
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toHaveTextContent("Save");
    expect(button()).not.toHaveTextContent("Saved");
  });

  it("the icon variant has no visible text but the same name", () => {
    setup({ variant: "icon", className: "extra" });
    expect(button()).toHaveTextContent("");
    expect(button()).toHaveClass("extra");
  });

  it("saves in one tap and confirms with a toast that offers to rename", async () => {
    const { user } = setup({ summary: SUNNY });
    await user.click(button());
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({ label: "412 Elm Street", place: ELM, observer: YARD });
    expect(saved()[0].summary).toEqual(SUNNY);
    expect(button()).toHaveAttribute("aria-pressed", "true");
    expect(button()).toHaveTextContent("Saved");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe("Saved as “412 Elm Street”");
    expect(toasts()[0].action?.label).toBe("Rename");
  });

  it("names an address-less pin by its coordinates", async () => {
    const { user } = setup({ place: PIN });
    await user.click(button());
    expect(toasts()[0].message).toBe("Saved as “37.7694° N, 122.4862° W”");
  });

  it("works before the sun numbers are in; they are filled in by the next visit", async () => {
    const { user } = setup({ summary: null });
    await user.click(button());
    expect(saved()[0].summary).toBeNull();
    act(() => usePlaces.getState().recordVisit(ELM, YARD, SUNNY));
    expect(saved()[0].summary).toEqual(SUNNY);
    expect(button()).toHaveAttribute("aria-pressed", "true");
  });

  it("Rename opens a small dialog with the name selected; Enter saves it", async () => {
    const { user } = setup();
    await user.click(button());
    pressToastAction();
    const dialog = await screen.findByRole("dialog", { name: "Name this place" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    expect(field).toHaveValue("412 Elm Street");
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(field).toHaveAttribute("maxlength", String(PLACES_LIMITS.labelMaxLength));
    await user.keyboard("Elm St backyard{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(saved()[0].label).toBe("Elm St backyard");
    // Focus goes back to the button that started it.
    expect(button()).toHaveFocus();
  });

  it("the dialog's Save button saves; Cancel and Escape do not", async () => {
    const { user } = setup();
    await user.click(button());

    pressToastAction();
    await screen.findByRole("dialog");
    await user.keyboard("Changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(saved()[0].label).toBe("412 Elm Street");

    pressToastAction();
    await screen.findByRole("dialog");
    await user.keyboard("Changed{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(saved()[0].label).toBe("412 Elm Street");

    pressToastAction();
    await screen.findByRole("dialog");
    await user.keyboard("  Front room  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved()[0].label).toBe("Front room");
  });

  it("an empty name cannot be saved, and Tab stays in the dialog", async () => {
    const { user } = setup();
    await user.click(button());
    pressToastAction();
    const dialog = await screen.findByRole("dialog");
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Enter}");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Rename still works after the button that saved has gone", async () => {
    const { user, view } = setup();
    await user.click(button());
    view.unmount();
    pressToastAction();
    await screen.findByRole("dialog");
    await user.keyboard("Kept{Enter}");
    expect(saved()[0].label).toBe("Kept");
  });

  it("the dialog closes by itself if the place stops existing", async () => {
    const { user } = setup();
    await user.click(button());
    pressToastAction();
    await screen.findByRole("dialog");
    await act(async () => {
      usePlaces.setState({ saved: [], recent: [] });
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tapping again removes it, with an Undo that restores name, note and position", async () => {
    const places = usePlaces.getState();
    places.save(ELM, YARD, SUNNY, "Elm St backyard");
    places.setNote(saved()[0].id, "Lovely garden");
    places.save(OAK, YARD, null);
    const { user } = setup();
    expect(button()).toHaveAttribute("aria-pressed", "true");

    await user.click(button());
    expect(saved().map((entry) => entry.label)).toEqual(["7 Oak Avenue"]);
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(toasts()[0].message).toBe("Removed “Elm St backyard” from saved places");
    expect(toasts()[0].action?.label).toBe("Undo");
    // It is a recent again, not gone.
    expect(usePlaces.getState().recent.map((entry) => entry.label)).toEqual(["Elm St backyard"]);

    pressToastAction();
    expect(saved().map((entry) => entry.label)).toEqual(["Elm St backyard", "7 Oak Avenue"]);
    expect(saved()[0]).toMatchObject({ note: "Lovely garden" });
    expect(saved()[0].summary).toEqual(SUNNY);
    expect(usePlaces.getState().recent).toEqual([]);
    expect(button()).toHaveAttribute("aria-pressed", "true");
  });

  it("explains a full list instead of saving", async () => {
    const places = usePlaces.getState();
    for (let i = 0; i < PLACES_LIMITS.saved; i++) places.save({ lat: i, lng: i }, YARD, null);
    const { user } = setup();
    await user.click(button());
    expect(saved()).toHaveLength(PLACES_LIMITS.saved);
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe(
      "You’ve saved 30 places, the most this list holds. Remove one to save another.",
    );
    expect(toasts()[0].action).toBeUndefined();
  });

  it("follows the store: saved elsewhere, pressed here", () => {
    setup();
    act(() => {
      usePlaces.getState().save({ lat: ELM.lat, lng: ELM.lng }, YARD, null);
    });
    expect(button()).toHaveAttribute("aria-pressed", "true");
  });
});
