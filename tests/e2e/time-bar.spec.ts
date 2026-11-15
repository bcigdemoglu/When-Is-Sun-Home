/**
 * Journey 5 — the time bar: the slider (keyboard, shortcuts), the day menu,
 * previous / next day, "back to now" and play / pause. The summary's status
 * line is checked along the way: it must follow every change.
 */
import { FIXTURE_PIN, SUMMER_NOON, expect, test } from "./fixtures";

/** A date that is neither "today" (see `now`) nor one of the menu's key dates. */
const MARCH_MORNING = `lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}&d=2026-03-10&t=0900`;

test.describe("Time bar", () => {
  // "Today" and "now" are 21 June 2026, 12:00 in San Francisco.
  test.use({ now: SUMMER_NOON });

  test("the slider steps by keyboard and the status follows the time", async ({
    app,
    timeBar,
    page,
  }) => {
    await app.openPlace(MARCH_MORNING);
    await expect(timeBar.dayButton).toHaveAccessibleName(
      "Tue, Mar 10, 9:00 AM PDT. Change the day",
    );
    await expect(app.summaryStatus).toHaveText("At 9:00 AM: in shade · sun returns at 1:11 PM");

    await timeBar.slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(timeBar.slider).toHaveValue("541");
    await expect(timeBar.dayButton).toContainText("9:01 AM");
    // While stepping, a readout above the thumb says the time and the state. It
    // lingers for a second after a key; any key (here one that changes nothing)
    // brings it back, so a slow machine cannot miss it.
    await expect(async () => {
      await page.keyboard.press("Shift");
      await expect(timeBar.readout).toHaveText(/9:01 AM\s*In shade/, { timeout: 800 });
    }).toPass();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(timeBar.slider).toHaveValue("539");
    await expect(app.summaryStatus).toContainText("At 8:59 AM: in shade");

    await page.keyboard.press("End");
    await expect(timeBar.slider).toHaveValue("1439");
    await expect(timeBar.slider).toHaveAttribute("aria-valuetext", "11:59 PM PDT, night");
    await expect(app.summaryStatus).toHaveText("At 11:59 PM: sun is down · rises the next day");
    await page.keyboard.press("Home");
    await expect(timeBar.slider).toHaveValue("0");
    await expect(app.summaryStatus).toHaveText("At 12:00 AM: sun is down · rises 7:32 AM");

    // Straight to the afternoon: in the sun.
    await timeBar.slider.fill("840");
    await expect(timeBar.slider).toHaveAttribute("aria-valuetext", "2:00 PM PDT, in sun");
    await expect(app.summaryStatus).toContainText("At 2:00 PM: in sun · until");
    // The day's total does not depend on the time of day.
    await expect(app.summaryFigure).toHaveText("4 h 39 m");
    await expect(page).toHaveURL(/d=2026-03-10&t=1400/);
  });

  test("desktop: ← → move the time 5 minutes, Shift+← → an hour, away from any field", async ({
    app,
    timeBar,
    search,
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "keyboard shortcuts belong to the desktop layout");
    await app.openPlace(MARCH_MORNING);

    await page.keyboard.press("ArrowRight");
    await expect(timeBar.slider).toHaveValue("545");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(timeBar.slider).toHaveValue("605");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(timeBar.slider).toHaveValue("540");

    // Not while typing: the arrows belong to the text field then.
    await page.keyboard.press("/");
    await expect(search.field).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(timeBar.slider).toHaveValue("540");

    // And not while a dialog is open.
    await timeBar.openMenu();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(timeBar.menu).toBeHidden();
    await expect(timeBar.slider).toHaveValue("540");
  });

  test("the day menu offers today, the solstices, the equinoxes and a date picker", async ({
    app,
    timeBar,
    page,
  }) => {
    await app.openPlace(MARCH_MORNING);
    await timeBar.openMenu();

    await expect(timeBar.menu.getByText("Tue, Mar 10, 2026")).toBeVisible();
    await expect(timeBar.menuRow("Back to now")).toContainText("12:00 PM");
    await expect(timeBar.menuRow("Today")).toContainText("Sun, Jun 21");
    // The June solstice of 2026 falls at 1:24 AM Pacific time on the 21st: the 20th and the 21st are equally long to the minute.
    await expect(timeBar.menuRow("Longest day")).toContainText(/(Sat, Jun 20|Sun, Jun 21)/);
    await expect(timeBar.menuRow("Shortest day")).toContainText("Mon, Dec 21");
    await expect(timeBar.menuRow("March equinox")).toContainText("Fri, Mar 20");
    await expect(timeBar.menuRow("September equinox")).toContainText("Tue, Sep 22");
    await expect(timeBar.datePicker).toHaveValue("2026-03-10");
    await expect(timeBar.menu).toContainText("Times are in Los Angeles time (PDT, UTC−7).");

    // Shortest day: the time of day is kept, the date and every number move.
    await timeBar.press(timeBar.menuRow("Shortest day"));
    await expect(timeBar.menu).toBeHidden();
    await expect(timeBar.dayButton).toHaveAccessibleName(
      "Mon, Dec 21, 9:00 AM PST. Change the day",
    );
    await expect(app.summaryCaption).toContainText("on Mon, Dec 21");
    await expect(app.summaryFigure).toHaveText("0 m");
    await expect(page).toHaveURL(/d=2026-12-21&t=0900/);

    await timeBar.chooseDay("September equinox");
    await expect(app.summaryCaption).toContainText("on Tue, Sep 22");
    await timeBar.chooseDay("March equinox");
    await expect(app.summaryCaption).toContainText("on Fri, Mar 20");
    await timeBar.chooseDay("Longest day");
    await expect(app.summaryCaption).toContainText(/on (Sat, Jun 20|Sun, Jun 21)/);

    // Today: the date follows the clock again, the chosen time of day stays.
    await timeBar.chooseDay("Today");
    await expect(timeBar.dayButton).toHaveAccessibleName("Today, 9:00 AM PDT. Change the day");
    await expect(app.summaryCaption).toContainText("on Sun, Jun 21");
    await expect(page).toHaveURL(/lng=-122\.43010(&n=[^&]+)?&t=0900(&s=[^&]+)?$/);

    // Pick a date: the menu stays open, the current row is marked.
    await timeBar.openMenu();
    await expect(timeBar.menuRow("Today")).toHaveAttribute("aria-current", "date");
    await timeBar.datePicker.fill("2026-09-01");
    await expect(timeBar.menu.getByText("Tue, Sep 1, 2026")).toBeVisible();
    await expect(timeBar.menuRow("Today")).not.toHaveAttribute("aria-current", "date");
    await timeBar.closeMenu();
    await expect(timeBar.dayButton).toHaveAccessibleName("Tue, Sep 1, 9:00 AM PDT. Change the day");
    await expect(page).toHaveURL(/d=2026-09-01&t=0900/);
  });

  test("previous / next day step the date, across a month boundary", async ({
    app,
    timeBar,
    page,
  }) => {
    await app.openPlace(`lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}&d=2026-03-01&t=0900`);

    await timeBar.stepDay("Previous day");
    await expect(app.summaryCaption).toContainText("on Sat, Feb 28");
    await timeBar.stepDay("Next day");
    await timeBar.stepDay("Next day");
    await expect(app.summaryCaption).toContainText("on Mon, Mar 2");
    if (await timeBar.menu.isVisible()) {
      await expect(timeBar.menu.getByText("Mon, Mar 2, 2026")).toBeVisible();
      await timeBar.closeMenu();
    }
    await expect(timeBar.dayButton).toHaveAccessibleName("Mon, Mar 2, 9:00 AM PST. Change the day");
    await expect(page).toHaveURL(/d=2026-03-02&t=0900/);
  });

  test("“Back to now” returns to the live view", async ({ app, timeBar, page }) => {
    await app.openPlace(MARCH_MORNING);
    await expect(app.summaryCaption).toContainText("on Tue, Mar 10");
    await expect(timeBar.backToNow).toBeVisible();

    await timeBar.press(timeBar.backToNow);

    // The clock was started at noon and runs: allow it the first minutes.
    await expect(timeBar.dayButton).toHaveAccessibleName(/^Today, 12:0\d PM PDT\. Change the day$/);
    await expect(app.summaryCaption).toContainText("today");
    await expect(app.summaryStatus).toHaveText("In sun now · until 6:59 PM");
    await expect(app.summaryFigure).toHaveText("12 h 27 m");
    await expect(timeBar.backToNow).toHaveCount(0);
    // A live link pins neither date nor time.
    await expect(page).not.toHaveURL(/[?&](d|t)=/);

    // Moving the slider leaves "now" (the date stays today), and the way back reappears.
    await timeBar.slider.fill("600");
    await expect(timeBar.backToNow).toBeVisible();
    await expect(timeBar.dayButton).toHaveAccessibleName("Today, 10:00 AM PDT. Change the day");
    await expect(app.summaryStatus).toContainText("At 10:00 AM: in sun");

    // The menu has the same way back.
    await timeBar.openMenu();
    await timeBar.press(timeBar.menuRow("Back to now"));
    await expect(timeBar.menu).toBeHidden();
    await expect(app.summaryStatus).toHaveText("In sun now · until 6:59 PM");
  });

  test("a link without date and time opens live", async ({ app, timeBar }) => {
    await app.openPlace(`lat=${FIXTURE_PIN.lat}&lng=${FIXTURE_PIN.lng}`);

    await expect(timeBar.dayButton).toHaveAccessibleName(/^Today, 12:0\d PM PDT\. Change the day$/);
    await expect(app.summaryCaption).toContainText("today");
    await expect(app.summaryStatus).toHaveText("In sun now · until 6:59 PM");
    await expect(timeBar.backToNow).toHaveCount(0);
  });

  test("play sweeps the day and stops when the slider is used", async ({ app, timeBar, page }) => {
    await app.openPlace(MARCH_MORNING);
    await expect(timeBar.play).toHaveAccessibleName("Play the day, sunrise to sunset");

    await timeBar.press(timeBar.play);
    await expect(timeBar.pause).toBeVisible();
    // The time moves on its own …
    await expect.poll(() => timeBar.minute()).toBeGreaterThan(560);
    // … and the status line moves with it (it started in the shade at 9:00).
    await expect(app.summaryStatus).not.toHaveText(/^At 9:00 AM/);
    await expect(app.summaryCaption).toContainText("on Tue, Mar 10");

    // Pause holds it.
    await timeBar.press(timeBar.pause);
    await expect(timeBar.play).toBeVisible();
    const paused = await timeBar.minute();
    await timeBar.openMenu();
    await timeBar.closeMenu();
    expect(await timeBar.minute()).toBe(paused);

    // Play again, then take the slider: the animation lets go at once.
    await timeBar.press(timeBar.play);
    await expect(timeBar.pause).toBeVisible();
    await timeBar.slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(timeBar.play).toBeVisible();
    const taken = await timeBar.minute();
    await timeBar.openMenu();
    await timeBar.closeMenu();
    expect(await timeBar.minute()).toBe(taken);
  });

  test("play can run through the year instead, and choosing a day stops it", async ({
    app,
    timeBar,
  }) => {
    await app.openPlace(MARCH_MORNING);
    await timeBar.openMenu();
    await timeBar.chooseSegment(timeBar.playModes, "Through the year");
    await timeBar.closeMenu();
    await expect(timeBar.play).toHaveAccessibleName("Play through the year");

    await timeBar.press(timeBar.play);
    await expect(timeBar.pause).toBeVisible();
    // The date moves, the time of day stays.
    await expect(timeBar.dayButton).not.toHaveAccessibleName(/^Tue, Mar 10/);
    await expect(timeBar.slider).toHaveValue("540");

    await timeBar.chooseDay("Shortest day");
    await expect(timeBar.play).toBeVisible();
    await expect(timeBar.dayButton).toHaveAccessibleName(
      "Mon, Dec 21, 9:00 AM PST. Change the day",
    );
  });
});
