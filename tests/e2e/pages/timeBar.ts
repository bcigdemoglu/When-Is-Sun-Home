import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

/** The time bar: which day, what time, play. Docked at the bottom on phones, floating over the map on desktop. */
export class TimeBarPage extends PageObject {
  readonly region = this.page.getByRole("region", { name: "Date and time" });
  readonly slider = this.region.getByRole("slider", { name: "Time of day" });
  /** The chip that shows the day and time and opens the day menu. Its name reads "Sun, Jun 21, 3:00 PM PDT. Change the day". */
  readonly dayButton = this.region.getByRole("button", { name: /Change the day$/ });
  readonly backToNow = this.region.getByRole("button", { name: "Back to now" });
  readonly play = this.region.getByRole("button", { name: /^Play / });
  readonly pause = this.region.getByRole("button", { name: "Pause" });
  /** The bubble above the thumb while scrubbing: "3:40 PM · In sun". */
  readonly readout = this.region.locator("output");
  readonly menu = this.page.getByRole("dialog", { name: "Day" });
  readonly datePicker = this.menu.getByLabel("Pick a date");
  readonly playModes = this.menu.getByRole("radiogroup", { name: "What the play button animates" });

  /** Minutes since midnight the slider is at. */
  async minute(): Promise<number> {
    return Number(await this.slider.inputValue());
  }

  async openMenu(): Promise<void> {
    await this.press(this.dayButton);
    await expect(this.menu).toBeVisible();
  }

  async closeMenu(): Promise<void> {
    await this.press(this.menu.getByRole("button", { name: "Close" }));
    await expect(this.menu).toBeHidden();
  }

  /** A row of the day menu: "Today", "Longest day", "Shortest day", "March equinox", … */
  menuRow(label: string): Locator {
    return this.menu.getByRole("button", { name: new RegExp(`^${label}\\b`) });
  }

  /** Open the menu and pick one of its rows (the menu closes itself). */
  async chooseDay(label: string): Promise<void> {
    await this.openMenu();
    await this.press(this.menuRow(label));
    await expect(this.menu).toBeHidden();
  }

  /**
   * Previous / next day. On desktop the arrows sit in the bar; on phones they
   * live in the day menu (which this opens if needed and leaves open).
   */
  async stepDay(direction: "Previous day" | "Next day"): Promise<void> {
    if (this.isPhone) {
      if (!(await this.menu.isVisible())) await this.openMenu();
      await this.press(this.menu.getByRole("button", { name: direction }));
    } else {
      await this.press(this.region.getByRole("button", { name: direction }));
    }
  }
}
