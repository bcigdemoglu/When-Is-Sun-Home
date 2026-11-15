/**
 * Journey 6 — the viewpoint: yard or window, floor, facing, field of view,
 * height, the pin-on-a-building warning, and that the answer follows.
 */
import { FIXTURE_PIN, FIXTURE_QUERY, expect, test } from "./fixtures";

const PIN = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}`;
/**
 * A spot inside a building footprint of the fixture tiles: the centre of the
 * 8 m house just south-west of the fixture pin (found by probing the fixture
 * data for the footprint nearest to the pin).
 */
const ON_A_ROOF = "lat=37.79103&lng=-122.43018&d=2026-06-21&t=1500";

/** "7 h 28 m" → 448. */
function minutes(duration: string): number {
  const match = /^(?:(\d+) h)?\s*(?:(\d+) m)?$/.exec(duration.trim());
  if (!match) throw new Error(`not a duration: ${duration}`);
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

test.describe("Viewpoint", () => {
  test("yard ↔ window changes the question and the answer", async ({ app, viewpoint, page }) => {
    await app.openPlace(FIXTURE_QUERY);
    await expect(viewpoint.toggle).toContainText("Yard · ground");
    await expect(app.summaryFigure).toHaveText("12 h 27 m");

    await viewpoint.open();
    await expect(viewpoint.reset).toBeDisabled();
    await viewpoint.chooseMode("Window");

    // A window on the ground floor facing south with a normal view, by default.
    await expect(viewpoint.floorName).toHaveText("Ground floor");
    await expect(
      viewpoint.facing.getByRole("button", { name: "Face south", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(viewpoint.fieldOfView.getByRole("radio", { name: "Normal" })).toBeChecked();
    await expect(viewpoint.panel).toContainText(
      "The sun counts while it is between the east and the west.",
    );
    await viewpoint.close();

    await expect(viewpoint.toggle).toContainText("Window · ground floor · facing S");
    await expect(app.hero.getByRole("heading")).toHaveText("Sun through this window · average day");
    // Pinned with the numbers in answer.spec.ts (same setup, window instead of yard):
    // a south window only sees the sun between east and west, 7 h 28 m on 21 June.
    await expect(app.summaryFigure).toHaveText("7 h 28 m");
    await expect(app.heroFigure).toHaveText("4.9h");
    await expect(page).toHaveURL(/&m=w/);

    await viewpoint.open();
    await viewpoint.chooseMode("Yard / open air");
    await viewpoint.close();
    await expect(viewpoint.toggle).toContainText("Yard · ground");
    await expect(app.hero.getByRole("heading")).toHaveText("Direct sun · average day");
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(page).not.toHaveURL(/&m=w/);
  });

  test("a higher floor sees more winter sun; the floor stepper has a floor", async ({
    app,
    viewpoint,
    page,
  }) => {
    // The shortest day: at ground level the houses to the south take all the sun.
    await app.openPlace(`${PIN}&d=2026-12-21&t=1200&m=w`);
    await expect(app.summaryFigure).toHaveText("0 m");

    await viewpoint.open();
    await expect(viewpoint.floorName).toHaveText("Ground floor");
    await expect(viewpoint.floorDown).toBeDisabled();
    await viewpoint.press(viewpoint.floorUp);
    await expect(viewpoint.floorName).toHaveText("2nd floor");
    await expect(viewpoint.panel).toContainText("Eye level 4.5 m up");
    await viewpoint.press(viewpoint.floorUp);
    await expect(viewpoint.floorName).toHaveText("3rd floor");
    await expect(viewpoint.panel).toContainText("Eye level 7.5 m up");
    await expect(viewpoint.floorDown).toBeEnabled();
    await viewpoint.close();

    await expect(viewpoint.toggle).toContainText("Window · 3rd floor · facing S");
    await expect(page).toHaveURL(/&m=w&h=7\.5/);
    await expect(app.summaryFigure).not.toHaveText("0 m");
    expect(minutes((await app.summaryFigure.textContent()) ?? "")).toBeGreaterThan(4 * 60);

    await viewpoint.open();
    await viewpoint.press(viewpoint.floorDown);
    await viewpoint.press(viewpoint.floorDown);
    await expect(viewpoint.floorName).toHaveText("Ground floor");
    await viewpoint.close();
    await expect(app.summaryFigure).toHaveText("0 m");
  });

  test("a north window gets no winter sun, a south one does", async ({ app, viewpoint, page }) => {
    // Third floor (clear of the neighbours), shortest day, noon.
    await app.openPlace(`${PIN}&d=2026-12-21&t=1200&m=w&h=7.5`);
    await expect(viewpoint.toggle).toContainText("Window · 3rd floor · facing S");
    const south = minutes((await app.summaryFigure.textContent()) ?? "");
    expect(south).toBeGreaterThan(4 * 60);
    await expect(app.summaryStatus).toContainText("At 12:00 PM: in sun");
    const southAverage = Number.parseFloat((await app.heroFigure.textContent()) ?? "");

    await viewpoint.open();
    await viewpoint.face("north");
    await expect(viewpoint.panel).toContainText("N 0°");
    await expect(viewpoint.panel).toContainText(
      "The sun counts while it is between the west and the east.",
    );
    await viewpoint.close();

    // In December the sun never comes round to the north at this latitude.
    await expect(viewpoint.toggle).toContainText("Window · 3rd floor · facing N");
    await expect(app.summaryFigure).toHaveText("0 m");
    await expect(app.summaryStatus).toContainText("outside this window’s view");
    await expect(page).toHaveURL(/&dir=0/);
    // Over the year a north window gets a fraction of what a south one does.
    const northAverage = Number.parseFloat((await app.heroFigure.textContent()) ?? "");
    expect(northAverage).toBeLessThan(southAverage / 2);

    // East: morning sun only — so at noon it is already out of view.
    await viewpoint.open();
    await viewpoint.face("east");
    await viewpoint.close();
    const east = minutes((await app.summaryFigure.textContent()) ?? "");
    expect(east).toBeGreaterThan(0);
    expect(east).toBeLessThan(south);

    // The slider is for the degrees in between.
    await viewpoint.open();
    await viewpoint.facingSlider.fill("200");
    await expect(viewpoint.facingSlider).toHaveAttribute("aria-valuetext", /^200 degrees, /);
    await expect(page).toHaveURL(/&dir=200/);
  });

  test("a narrower field of view sees less sun", async ({ app, viewpoint, page }) => {
    await app.openPlace(`${FIXTURE_QUERY}&m=w`);
    const normal = minutes((await app.summaryFigure.textContent()) ?? "");

    await viewpoint.open();
    await viewpoint.chooseSegment(viewpoint.fieldOfView, "Narrow");
    await expect(viewpoint.fieldOfViewSlider).toHaveValue("90");
    await viewpoint.close();
    await expect(page).toHaveURL(/&fov=90/);
    await expect(app.summaryFigure).not.toHaveText("7 h 28 m");
    const narrow = minutes((await app.summaryFigure.textContent()) ?? "");
    expect(narrow).toBeLessThan(normal / 2);
    // At 3 PM in June the sun is already west of a narrow south view.
    await expect(app.summaryStatus).toContainText("outside this window’s view");

    await viewpoint.open();
    await viewpoint.chooseSegment(viewpoint.fieldOfView, "Wide");
    await expect(viewpoint.fieldOfViewSlider).toHaveValue("270");
    await viewpoint.close();
    await expect(page).toHaveURL(/&fov=270/);
    await expect
      .poll(async () => minutes((await app.summaryFigure.textContent()) ?? ""))
      .toBeGreaterThan(normal);

    // A value between the presets selects none of them.
    await viewpoint.open();
    await viewpoint.fieldOfViewSlider.fill("120");
    await expect(viewpoint.fieldOfView.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(viewpoint.panel).toContainText("120°.");
  });

  test("yard height: presets and slider; “Reset viewpoint” goes back to the ground", async ({
    app,
    viewpoint,
    page,
  }) => {
    await app.openPlace(FIXTURE_QUERY);
    await viewpoint.open();
    const ground = viewpoint.heightPresets.getByRole("button", { name: "Ground: 1 m" });
    const roof = viewpoint.heightPresets.getByRole("button", { name: "Roof: 9 m" });
    await expect(ground).toHaveAttribute("aria-pressed", "true");

    await viewpoint.press(roof);
    await expect(roof).toHaveAttribute("aria-pressed", "true");
    await expect(viewpoint.height).toHaveAttribute("aria-valuetext", "9 m above ground");
    await viewpoint.close();
    await expect(viewpoint.toggle).toContainText("Yard · 9 m up");
    await expect(page).toHaveURL(/&h=9/);
    // From the roof the neighbours shade far less (pinned: 13 h 35 m against 12 h 27 m).
    await expect(app.summaryFigure).toHaveText("13 h 35 m");
    await expect(app.heroFigure).toHaveText("10.0h");

    await viewpoint.open();
    await viewpoint.height.fill("3");
    await expect(
      viewpoint.heightPresets.getByRole("button", { name: "Deck: 3 m" }),
    ).toHaveAttribute("aria-pressed", "true");

    await expect(viewpoint.reset).toBeEnabled();
    await viewpoint.press(viewpoint.reset);
    await expect(ground).toHaveAttribute("aria-pressed", "true");
    await expect(viewpoint.reset).toBeDisabled();
    await viewpoint.close();
    await expect(viewpoint.toggle).toContainText("Yard · ground");
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(page).not.toHaveURL(/&h=/);
  });

  test("a pin inside a building footprint is called out", async ({
    app,
    viewpoint,
    report,
    isPhone,
  }) => {
    await app.openPlace(ON_A_ROOF);

    // In the report, next to the numbers it affects …
    await expect(app.hero).toContainText(
      "The pin is on a building: that building itself is ignored.",
    );
    // … and with the controls, with what to do about it.
    await viewpoint.open();
    await expect(viewpoint.pinOnBuildingWarning).toBeVisible();
    await expect(viewpoint.pinOnBuildingWarning).toContainText(
      "Drag the pin into the yard for a meaningful result.",
    );
    // "Roof" knows this building: 8 m of house plus eye height.
    await expect(
      viewpoint.heightPresets.getByRole("button", { name: /^Roof: / }),
    ).toHaveAccessibleName("Roof: 9.5 m");

    // A window belongs on a building: no warning there.
    await viewpoint.chooseMode("Window");
    await expect(viewpoint.pinOnBuildingWarning).toHaveCount(0);
    await viewpoint.chooseMode("Yard / open air");
    await expect(viewpoint.pinOnBuildingWarning).toBeVisible();
    await viewpoint.close();

    // The fixture pin itself is in the open: nothing of the sort.
    await app.openPlace(FIXTURE_QUERY);
    await app.waitForAnswer();
    await expect(app.hero).not.toContainText("The pin is on a building");
    await viewpoint.open();
    await expect(viewpoint.pinOnBuildingWarning).toHaveCount(0);
    await viewpoint.close();
    if (isPhone) await app.moveSheetTo("full");
    await report.show(report.about);
  });

  test("the map layer switches are remembered in the link", async ({ app, viewpoint, page }) => {
    await app.openPlace(FIXTURE_QUERY);
    await viewpoint.open();
    const buildings3d = viewpoint.panel.getByRole("switch", { name: /^3D buildings/ });
    const shadows = viewpoint.panel.getByRole("switch", { name: /^Shadows/ });
    await expect(buildings3d).toBeChecked();
    await expect(shadows).toBeChecked();

    // The inputs are visually hidden: people press the row.
    await viewpoint.press(
      viewpoint.panel.getByText("Show the shade buildings cast at the selected time"),
    );
    await expect(shadows).not.toBeChecked();
    await expect(page).toHaveURL(/&sh=0/);
    await viewpoint.press(viewpoint.panel.getByText("Draw buildings at their real height"));
    await expect(buildings3d).not.toBeChecked();
    await expect(page).toHaveURL(/&b=0&sh=0/);

    await page.reload();
    await app.waitForAnswer();
    await viewpoint.open();
    await expect(buildings3d).not.toBeChecked();
    await expect(shadows).not.toBeChecked();
  });
});
