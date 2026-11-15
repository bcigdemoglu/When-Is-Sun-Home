import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

/** Saving a place, and the list of saved and recent places (a sheet on phones, the panel on desktop). */
export class PlacesPage extends PageObject {
  /** The heart on the report. `aria-pressed` says whether the place is saved. */
  readonly save = this.page.getByRole("button", { name: "Save this place" });
  /** The button next to search; its name carries the count: "Saved places (2)". */
  readonly open_ = this.page.getByRole("button", { name: /^Saved places( \(\d+\))?$/ });
  /** The list: a modal sheet on phones, a view of the side panel on desktop. */
  readonly panel = this.isPhone
    ? this.page.getByRole("dialog", { name: "Places" })
    : this.page.getByRole("region", { name: "Places", exact: true });
  readonly saved = this.panel.getByRole("region", { name: "Saved places" });
  readonly recent = this.panel.getByRole("region", { name: "Recent" });
  readonly emptyMessage = this.page.getByText("No saved places yet.");
  readonly edit = this.saved.getByRole("button", { name: "Edit", exact: true });
  readonly done = this.saved.getByRole("button", { name: "Done", exact: true });
  readonly compare = this.panel.getByRole("button", { name: /^Compare \d places$/ });
  readonly compareView = this.panel.getByRole("region", { name: /^Compare \d places$/ });
  readonly compareTable = this.panel.getByRole("table", { name: "Sun at the places you picked" });

  /** The rename prompt (its own modal, opened from the toast or from the list). */
  readonly renameDialog = this.page.getByRole("dialog", { name: "Name this place" });
  readonly renameField = this.renameDialog.getByRole("textbox", { name: "Name" });

  async open(): Promise<void> {
    await this.press(this.open_);
    await expect(this.panel).toBeVisible();
  }

  async close(): Promise<void> {
    if (this.isPhone) await this.press(this.panel.getByRole("button", { name: "Close" }));
    else await this.press(this.panel.getByRole("button", { name: "Back", exact: true }));
    await expect(this.panel).toBeHidden();
  }

  /** A saved place's row (the button that opens it). Its text carries the hours. */
  savedRow(label: string): Locator {
    return this.saved.getByRole("button", { name: `Open ${label}`, exact: true });
  }
  recentRow(label: string): Locator {
    return this.recent.getByRole("button", { name: `Open ${label}`, exact: true });
  }
  compareTick(label: string): Locator {
    return this.saved.getByRole("checkbox", { name: `Compare ${label}`, exact: true });
  }
  renameButton(label: string): Locator {
    return this.saved.getByRole("button", { name: `Rename ${label}`, exact: true });
  }
  removeButton(label: string): Locator {
    return this.saved.getByRole("button", { name: `Remove ${label} from saved places` });
  }

  /** Tick a place for comparison (the checkbox is invisible; people press its box). */
  async tick(label: string): Promise<void> {
    const box = this.compareTick(label);
    // The input covers its 48 px cell with opacity 0: pressing it is pressing the box.
    await this.press(box);
  }

  /** Save the place on screen and wait for the confirmation. */
  async saveCurrent(): Promise<void> {
    await this.press(this.save);
    await expect(this.save).toHaveAttribute("aria-pressed", "true");
  }

  /** Type a new name into the open rename prompt and confirm with Enter. */
  async renameTo(name: string): Promise<void> {
    await expect(this.renameField).toBeFocused();
    await this.renameField.fill(name);
    await this.renameField.press("Enter");
    await expect(this.renameDialog).toHaveCount(0);
  }
}
