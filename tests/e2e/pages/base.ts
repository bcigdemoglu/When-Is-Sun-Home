import { expect, type Locator, type Page } from "@playwright/test";

/**
 * What every page object shares: the page, which layout it is in, and how a
 * person presses things there — a finger on the phone, a mouse on the desktop.
 * (The app tells the two apart: charts treat a touch as "tap or scroll" and a
 * mouse as "hover or click".)
 */
export abstract class PageObject {
  constructor(
    readonly page: Page,
    /** True in the phone layout (bottom sheet, full-screen search, dialogs as sheets). */
    readonly isPhone: boolean,
  ) {}

  /** Tap (phone) or click (desktop). */
  async press(target: Locator): Promise<void> {
    if (this.isPhone) await target.tap();
    else await target.click();
  }

  /**
   * Pick an option of a segmented control (a radio group whose inputs are
   * visually hidden: people press the label).
   */
  async chooseSegment(group: Locator, label: string): Promise<void> {
    await this.press(group.getByText(label, { exact: true }));
    await expect(group.getByRole("radio", { name: label, exact: true })).toBeChecked();
  }

  /** A toast (they all live in one polite status region). */
  toast(text: string | RegExp): Locator {
    return this.page.locator("[data-toaster]").getByText(text);
  }

  /** The action button of the toast on screen ("Rename", "Undo"). */
  toastAction(name: string): Locator {
    return this.page.locator("[data-toaster]").getByRole("button", { name, exact: true });
  }
}
