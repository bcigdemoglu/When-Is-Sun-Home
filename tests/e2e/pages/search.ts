import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

/** Address search: a full-screen takeover on phones, an inline field with a drop-down on desktop. */
export class SearchPage extends PageObject {
  /** The text field (on phones it only exists while the takeover is open). */
  readonly field = this.page.getByRole("combobox", { name: "Search an address" });
  /** Phones: the pill at the top that opens the takeover; it shows the current place. */
  readonly pill = this.page.getByRole("banner").getByRole("button", { name: /^Search an address/ });
  /** Phones: the takeover itself. */
  readonly overlay = this.page.getByRole("dialog", { name: "Find a place" });
  readonly back = this.overlay.getByRole("button", { name: "Back" });
  readonly list = this.page.getByRole("listbox", { name: "Places" });
  readonly options = this.list.getByRole("option");
  readonly useCurrentLocation = this.list.getByRole("option", { name: /^Use my current location/ });
  readonly chooseOnMap = this.list.getByRole("option", { name: /^Choose on the map/ });
  /** The highlighted option (what Enter would pick). */
  readonly activeOption = this.list.locator('[role="option"][aria-selected="true"]');
  readonly clearText = this.page.getByRole("button", { name: "Clear search text" });
  /** The ⓧ that forgets the pinned place. */
  readonly clearPlace = this.page.getByRole("button", { name: "Clear this place" });
  /** The visible message (a screen-reader copy of it lives in a status region). */
  readonly noResults = this.page.locator("p").filter({ hasText: /^No address matches “/ });
  /** Photon is down: suggestions no longer follow the typing. */
  readonly submitNote = this.page.getByText(
    "Live suggestions are unavailable right now. Press Enter to search.",
    { exact: true },
  );
  /** Who the address results come from. */
  readonly attribution = this.page.getByTestId("search-attribution");
  /** Both geocoders failed. */
  readonly searchFailed = this.page.getByText("Couldn’t search — check your connection.");
  readonly tryAgain = this.page.getByRole("button", { name: "Try again" });

  option(name: string | RegExp): Locator {
    return this.list.getByRole("option", { name });
  }

  /** Open search the way a person would: tap the pill (phone) or click into the field (desktop). */
  async open(): Promise<void> {
    if (this.isPhone) await this.pill.tap();
    else await this.field.click();
    await expect(this.field).toBeFocused();
    await expect(this.list).toBeVisible();
  }

  /** Type into the (focused) field, key by key, as the suggestions follow the typing. */
  async type(text: string): Promise<void> {
    await this.field.pressSequentially(text);
  }

  /** Open, type and pick the suggestion called `name`. */
  async find(text: string, name: string | RegExp): Promise<void> {
    await this.open();
    await this.type(text);
    await this.press(this.option(name));
  }

  /** Search is closed: no list, and on phones no takeover. */
  async expectClosed(): Promise<void> {
    await expect(this.list).toHaveCount(0);
    if (this.isPhone) await expect(this.overlay).toHaveCount(0);
  }
}
