/**
 * Journey 8 — saving places and coming back to them: save, rename (from the
 * toast and from the list), remove and undo, recents, reopening with the
 * viewpoint, persistence, comparing, and the empty states.
 *
 * On phones the list is a modal sheet, and the rename prompt and the toasts
 * have to work ON TOP of it — the stacking that was broken before.
 */
import { FIXTURE_PIN, expect, test } from "./fixtures";
import type { AppPage } from "./pages/app";
import type { PlacesPage } from "./pages/places";

const DAY = "d=2026-06-21&t=1500";
/** Three spots with clearly different answers, each under a name of its own. */
const YARD = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}&n=Yard+house&${DAY}`;
const ROOF = `lat=37.79103&lng=-122.43018&n=Roof+house&${DAY}`;
const OPEN_FIELD = `lat=37.76956&lng=-122.24604&n=Open+field&${DAY}`;

/** Open a place, wait for its numbers and save it. */
async function openAndSave(app: AppPage, places: PlacesPage, query: string): Promise<void> {
  await app.openPlace(query);
  await places.saveCurrent();
}

test.describe("Save & places", () => {
  test("empty states: nothing saved, nothing recent", async ({ app, places, isPhone }) => {
    await app.open();
    await expect(places.open_).toHaveAccessibleName("Saved places");

    await places.open();
    await expect(places.saved.getByText("No saved places yet.")).toBeVisible();
    await expect(places.saved).toContainText("on a sun report to keep it here and compare.");
    await expect(places.edit).toHaveCount(0);
    await expect(places.recent).toHaveCount(0);
    await expect(places.compare).toHaveCount(0);
    await places.close();

    // The start screen says the same.
    if (isPhone) await app.moveSheetTo("full");
    await expect(app.start.getByText("No saved places yet.")).toBeVisible();
  });

  test("save confirms with a toast whose “Rename” names the place", async ({
    app,
    places,
    search,
    isPhone,
  }) => {
    await app.openPlace(YARD);
    await expect(places.save).toHaveAttribute("aria-pressed", "false");

    await places.press(places.save);
    await expect(places.save).toHaveAttribute("aria-pressed", "true");
    await expect(places.save).toContainText("Saved");
    await expect(places.toast("Saved as “Yard house”")).toBeVisible();
    await expect(places.open_).toHaveAccessibleName("Saved places (1)");

    await places.press(places.toastAction("Rename"));
    await expect(places.renameDialog).toBeVisible();
    await expect(places.renameField).toBeFocused();
    await expect(places.renameField).toHaveValue("Yard house");
    // The old name is selected: typing replaces it.
    await places.page.keyboard.type("Elm St backyard");
    await expect(places.renameField).toHaveValue("Elm St backyard");
    await places.page.keyboard.press("Enter");
    await expect(places.renameDialog).toHaveCount(0);

    // The new name is the place's name everywhere.
    await expect(app.placeTitle).toHaveText("Elm St backyard");
    if (isPhone) await expect(search.pill).toContainText("Elm St backyard");
    else await expect(search.field).toHaveValue("Elm St backyard");
    // Focus goes back to where the rename was started from.
    await expect(places.save).toBeFocused();

    await places.open();
    await expect(places.savedRow("Elm St backyard")).toBeVisible();
    await expect(places.savedRow("Elm St backyard")).toContainText("6.4");
    await expect(places.savedRow("Elm St backyard")).toHaveAttribute("aria-current", "true");
  });

  test("rename from the list: the prompt opens on top, takes focus and typing", async ({
    app,
    places,
    page,
  }) => {
    await openAndSave(app, places, YARD);
    await places.open();
    await places.press(places.edit);
    await places.press(places.renameButton("Yard house"));

    // On phones this prompt sits on top of the Places sheet (itself a modal).
    await expect(places.renameDialog).toBeVisible();
    await expect(places.renameField).toBeFocused();
    await expect(places.renameField).toBeInViewport();
    await page.keyboard.type("Garden side");
    await expect(places.renameField).toHaveValue("Garden side");
    // It can be touched, too: nothing lies over it.
    await places.press(places.renameField);
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await places.press(places.renameDialog.getByRole("button", { name: "Save", exact: true }));

    await expect(places.renameDialog).toHaveCount(0);
    // Still in the list, in edit mode, with the new name — and focus back on the pencil.
    await expect(places.panel).toBeVisible();
    await expect(places.renameButton("Garden side!")).toBeFocused();
    await expect(places.done).toBeVisible();

    // Escape and Cancel leave the name alone; an empty name cannot be saved.
    await places.press(places.renameButton("Garden side!"));
    await page.keyboard.type("Something else");
    await page.keyboard.press("Escape");
    await expect(places.renameDialog).toHaveCount(0);
    await expect(places.panel).toBeVisible();
    await expect(places.renameButton("Garden side!")).toBeVisible();

    await places.press(places.renameButton("Garden side!"));
    await places.renameField.fill("   ");
    await page.keyboard.press("Enter");
    await expect(places.renameDialog).toBeVisible();
    await places.press(places.renameDialog.getByRole("button", { name: "Cancel" }));
    await expect(places.renameDialog).toHaveCount(0);

    await places.press(places.done);
    await expect(places.savedRow("Garden side!")).toBeVisible();
    await places.close();
    await expect(app.placeTitle).toHaveText("Garden side!");
  });

  test("remove from the list, then “Undo” puts it back with its name", async ({ app, places }) => {
    await openAndSave(app, places, YARD);
    await places.press(places.toastAction("Rename"));
    await places.renameTo("Elm St backyard");
    await openAndSave(app, places, ROOF);

    await places.open();
    await expect(places.saved.getByRole("listitem")).toHaveCount(2);
    await places.press(places.edit);
    await places.press(places.removeButton("Elm St backyard"));

    await expect(places.saved.getByRole("listitem")).toHaveCount(1);
    await expect(places.toast("Removed “Elm St backyard” from saved places")).toBeVisible();
    // The toast is usable although a modal sheet is open (phones).
    await places.press(places.toastAction("Undo"));

    await expect(places.saved.getByRole("listitem")).toHaveCount(2);
    // Back in its old position (first), under its own name.
    await expect(places.saved.getByRole("listitem").first()).toContainText("Elm St backyard");
    await places.press(places.done);
    await expect(places.savedRow("Elm St backyard")).toContainText("6.4");
    await places.close();
    await expect(places.open_).toHaveAccessibleName("Saved places (2)");
  });

  test("the heart un-saves as well, also with undo", async ({ app, places }) => {
    await openAndSave(app, places, YARD);
    await expect(places.toast("Saved as “Yard house”")).toBeVisible();

    await places.press(places.save);
    await expect(places.save).toHaveAttribute("aria-pressed", "false");
    await expect(places.toast("Removed “Yard house” from saved places")).toBeVisible();
    await expect(places.open_).toHaveAccessibleName("Saved places");

    await places.press(places.toastAction("Undo"));
    await expect(places.save).toHaveAttribute("aria-pressed", "true");
    await expect(places.open_).toHaveAccessibleName("Saved places (1)");
  });

  test("places looked at show up as recents, with their hours, and can be cleared", async ({
    app,
    places,
    search,
    isPhone,
  }) => {
    await app.openPlace(YARD);
    await places.open();
    // A place counts as looked at after a moment on screen.
    await expect(places.recentRow("Yard house")).toBeVisible();
    await expect(places.recentRow("Yard house")).toContainText("6.4 h");
    await places.close();

    await app.openPlace(OPEN_FIELD);
    await places.open();
    await expect(places.recent.getByRole("listitem")).toHaveCount(2);
    // Newest first; the one on screen is marked.
    await expect(places.recent.getByRole("listitem").first()).toContainText("Open field");
    await expect(places.recentRow("Open field")).toHaveAttribute("aria-current", "true");
    await places.close();

    // The search list offers them too.
    await search.open();
    const recents = search.list.getByRole("group", { name: "Recent" });
    await expect(recents.getByRole("option")).toHaveCount(2);
    await expect(recents.getByRole("option").first()).toHaveAccessibleName(/^Open field, /);
    // Picking one opens it.
    await search.press(recents.getByRole("option", { name: /^Yard house/ }));
    await search.expectClosed();
    await expect(app.placeTitle).toHaveText("Yard house");
    if (isPhone) await app.expectSheetAt("peek");

    // A saved place is not a recent any more.
    await places.saveCurrent();
    await places.open();
    await expect(places.savedRow("Yard house")).toBeVisible();
    await expect(places.recentRow("Yard house")).toHaveCount(0);
    await expect(places.recentRow("Open field")).toBeVisible();

    // One can be removed, or all cleared.
    await places.press(
      places.recent.getByRole("button", { name: "Remove Open field from recent places" }),
    );
    await expect(places.recent).toHaveCount(0);
  });

  test("reopening a saved place restores the pin AND its viewpoint", async ({
    app,
    places,
    viewpoint,
    timeBar,
    page,
    isPhone,
  }) => {
    // Saved as a 2nd-floor window facing east …
    await openAndSave(app, places, `${ROOF}&m=w&h=4.5&dir=90&fov=90`);
    await expect(viewpoint.toggle).toContainText("Window · 2nd floor · facing E");
    const roofSun = await app.summaryFigure.textContent();

    // … then somewhere else, as a yard.
    await app.openPlace(`${OPEN_FIELD}&m=y&h=1&dir=180&fov=180`);
    await expect(viewpoint.toggle).toContainText("Yard · ground");
    await expect(app.summaryFigure).not.toHaveText(roofSun ?? "");

    await places.open();
    await expect(places.savedRow("Roof house")).toContainText("Roof house");
    await places.press(places.savedRow("Roof house"));

    await expect(places.panel).toBeHidden();
    await expect(app.placeTitle).toHaveText("Roof house");
    await expect(viewpoint.toggle).toContainText("Window · 2nd floor · facing E");
    await expect(page).toHaveURL(/lat=37\.79103&lng=-122\.43018&n=Roof\+house/);
    await expect(page).toHaveURL(/&m=w&h=4\.5&dir=90&fov=90/);
    await app.waitForAnswer();
    await expect(app.summaryFigure).toHaveText(roofSun ?? "");
    await expect(places.save).toHaveAttribute("aria-pressed", "true");
    // The day and time on screen are not part of a place: they stay.
    await expect(timeBar.dayButton).toHaveAccessibleName(/^Sun, Jun 21, 3:00 PM/);
    if (isPhone) await app.expectSheetAt("peek");
  });

  test("saved places survive a reload and open from the start screen", async ({
    app,
    places,
    search,
    page,
    isPhone,
  }) => {
    await openAndSave(app, places, YARD);
    await places.press(places.toastAction("Rename"));
    await places.renameTo("Elm St backyard");
    // The numbers are stored with the place once they are in.
    await places.open();
    await expect(places.savedRow("Elm St backyard")).toContainText("6.4");
    await places.close();

    await page.reload();
    await app.waitForAnswer();
    await expect(app.placeTitle).toHaveText("Elm St backyard");
    await expect(places.save).toHaveAttribute("aria-pressed", "true");
    await expect(places.open_).toHaveAccessibleName("Saved places (1)");

    // Back at the start screen the place is one tap away, with its number.
    await app.press(search.clearPlace);
    await app.expectStartScreen();
    if (isPhone) await app.moveSheetTo("full");
    const row = app.start.getByRole("button", { name: "Open Elm St backyard", exact: true });
    await expect(row).toContainText("6.4");
    await expect(row).toContainText("Best Jul 12.6 · Least Jan 0.0");
    await app.press(row);
    await expect(app.placeTitle).toHaveText("Elm St backyard");
    await app.waitForAnswer();
    await expect(app.heroFigure).toHaveText("6.4h");
  });

  test("two or three saved places compare side by side, best values starred", async ({
    app,
    places,
    page,
    isPhone,
  }) => {
    await openAndSave(app, places, YARD);
    await openAndSave(app, places, ROOF);
    await openAndSave(app, places, OPEN_FIELD);

    await places.open();
    await expect(places.saved).toContainText("Tick two or more to compare them side by side.");
    await expect(places.savedRow("Yard house")).toContainText("6.4");
    await expect(places.savedRow("Roof house")).toContainText("3.0");
    await expect(places.savedRow("Open field")).toContainText("12.0");

    // A note travels into the comparison.
    await places.press(places.saved.getByRole("button", { name: "Add a note to Roof house" }));
    const note = places.saved.getByRole("textbox", { name: "Note for Roof house" });
    await expect(note).toBeFocused();
    await page.keyboard.type("Noisy road");
    await page.keyboard.press("Enter");
    await expect(
      places.saved.getByRole("button", { name: "Edit note for Roof house: Noisy road" }),
    ).toBeVisible();

    await places.tick("Yard house");
    await expect(places.compareTick("Yard house")).toBeChecked();
    await expect(places.panel.getByText("Tick one more place to compare")).toBeVisible();
    await expect(places.compare).toHaveCount(0);
    await places.tick("Roof house");
    await expect(places.compare).toHaveText("Compare 2 places");

    await places.press(places.compare);
    await expect(places.compareView).toBeVisible();
    await expect(
      places.compareTable.getByRole("columnheader").filter({ hasText: /house/ }),
    ).toHaveText(["Yard house", "Roof house"]);
    const rowNames = places.compareTable.getByRole("rowheader");
    await expect(rowNames).toContainText([
      "Average day",
      "Share of daylight",
      "Sunniest month",
      "Least sun",
      "Summer average (Jun–Aug)",
      "Winter average (Dec–Feb)",
      "Through the year",
      "Viewpoint",
      "Note",
    ]);
    const row = (name: string) =>
      places.compareTable.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
    // The yard has more sun on average: it gets the star.
    await expect(row("Average day").getByRole("cell")).toHaveText(["6.4 h(best)", "3.0 h"]);
    await expect(row("Share of daylight").getByRole("cell")).toHaveText(["53%(best)", "25%"]);
    // … but the roof wins the winter.
    await expect(row("Least sun").getByRole("cell").nth(1)).toContainText("(best)");
    await expect(row("Least sun").getByRole("cell").nth(0)).not.toContainText("(best)");
    await expect(row("Viewpoint").getByRole("cell")).toHaveText(["Yard · ground", "Yard · ground"]);
    await expect(row("Note").getByRole("cell").nth(1)).toHaveText("Noisy road");

    // Back, add the third, compare three.
    await places.press(places.compareView.getByRole("button", { name: "Back to saved places" }));
    await expect(places.compareTick("Yard house")).toBeChecked();
    await places.tick("Open field");
    await expect(places.compare).toHaveText("Compare 3 places");
    await places.press(places.compare);
    await expect(
      places.compareTable.getByRole("columnheader").filter({ hasText: /house|field/ }),
    ).toHaveCount(3);
    await expect(row("Average day").getByRole("cell")).toHaveText([
      "6.4 h",
      "3.0 h",
      "12.0 h(best)",
    ]);

    // "Open" under a column opens that place.
    await places.press(places.compareView.getByRole("button", { name: "Open Roof house" }));
    await expect(places.panel).toBeHidden();
    await expect(app.placeTitle).toHaveText("Roof house");
    if (isPhone) await app.expectSheetAt("peek");
  });

  test("at most four places compare at once, and the fifth tick says so", async ({
    app,
    places,
  }) => {
    // Saving works before the numbers are in, so there is no need to wait for five reports.
    for (let index = 0; index < 5; index++) {
      await app.open(`lat=${40 + index}&lng=-100&n=Place+${index + 1}`);
      await places.saveCurrent();
    }
    await places.open();
    await expect(places.saved.getByRole("listitem")).toHaveCount(5);

    for (const index of [1, 2, 3, 4]) await places.tick(`Place ${index}`);
    await expect(places.compare).toHaveText("Compare 4 places");

    await places.tick("Place 5");
    await expect(
      places.toast("You can compare up to 4 places at a time. Untick one first."),
    ).toBeVisible();
    await expect(places.compareTick("Place 5")).not.toBeChecked();
    await expect(places.compare).toHaveText("Compare 4 places");

    // Unticking one makes room.
    await places.tick("Place 1");
    await expect(places.compareTick("Place 1")).not.toBeChecked();
    await places.tick("Place 5");
    await expect(places.compareTick("Place 5")).toBeChecked();
    await expect(places.compare).toHaveText("Compare 4 places");
  });

  test("the list can be reordered in edit mode", async ({ app, places }) => {
    await app.open("lat=40&lng=-100&n=First");
    await places.saveCurrent();
    await app.open("lat=41&lng=-100&n=Second");
    await places.saveCurrent();
    await places.open();
    const rows = places.saved.getByRole("listitem");
    const order = await rows.allInnerTexts();

    await places.press(places.edit);
    const lastName = /Second/.test(order[1]) ? "Second" : "First";
    await places.press(places.saved.getByRole("button", { name: `Move ${lastName} up` }));
    await expect(rows.first()).toContainText(lastName);
    // Said aloud for screen readers.
    await expect(
      places.panel.getByRole("status").filter({ hasText: "moved to position" }),
    ).toHaveText(`${lastName} moved to position 1 of 2`);
    // At the top it cannot go further up.
    await expect(places.saved.getByRole("button", { name: `Move ${lastName} up` })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
